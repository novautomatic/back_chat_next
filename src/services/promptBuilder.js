// Ensambla el SYSTEM PROMPT dinamicamente desde la configuracion del agente.
// NINGUNA regla de negocio esta escrita aqui: todo viene de la base de datos.
import { admin } from '../lib/supabase.js';

// Carga agente + reglas (por fase) + secciones personalizadas + ejemplos.
export async function cargarCerebro(agenteId) {
  const [{ data: agente }, { data: reglas }, { data: secciones }, { data: ejemplos }] = await Promise.all([
    admin.from('agentes').select('*').eq('id', agenteId).single(),
    admin.from('agente_reglas').select('*').eq('agente_id', agenteId).eq('activo', true).order('orden'),
    admin.from('agente_secciones').select('*').eq('agente_id', agenteId).order('orden'),
    admin.from('agente_ejemplos').select('*').eq('agente_id', agenteId).order('orden'),
  ]);
  return { agente, reglas: reglas || [], secciones: secciones || [], ejemplos: ejemplos || [] };
}

function bloqueReglas(titulo, lista) {
  if (!lista.length) return '';
  const items = lista.map((r, i) => `${i + 1}. ${r.texto}`).join('\n');
  return `\n## ${titulo}\n${items}\n`;
}

// Bloque de una ETAPA de la conversacion. El disparador ("cuando aplica") le
// dice al agente como reconocer que el cliente esta en esta etapa.
function bloqueEtapa(titulo, cuando, lista) {
  if (!lista.length) return '';
  const items = lista.map((r, i) => `${i + 1}. ${r.texto}`).join('\n');
  const disparador = cuando ? `\n_Aplica cuando: ${cuando}_\n` : '';
  return `\n### Etapa: ${titulo}${disparador}${items}\n`;
}

// Construye el texto del system prompt. Recibe el contexto RAG ya recuperado.
export function construirSystemPrompt({ agente, reglas, secciones, ejemplos }, contextoRag) {
  const porFase = (f) => reglas.filter((r) => r.fase === f);

  let p = '';
  p += `Eres "${agente.nombre}".\n`;
  if (agente.persona) p += `\n## Personalidad y rol\n${agente.persona}\n`;
  if (agente.objetivo) p += `\n## Objetivo de la conversacion\n${agente.objetivo}\n`;
  if (agente.saludo) p += `\n## Saludo\nTu mensaje de saludo es: "${agente.saludo}".\n`;

  // --- Etapas de la conversacion ---------------------------------------------
  // El cliente puede estar en distintas etapas (inicio, proceso, cierre y las
  // que el negocio agregue: compra, postventa, agendar cita...). Identifica en
  // que etapa esta y sigue sus instrucciones; varias pueden aplicar a la vez.
  const etapasSec = (secciones || []).filter((s) => s.area === 'etapa');
  let etapas = '';
  etapas += bloqueEtapa('Inicio', 'el cliente recien llega y se abre la conversacion', porFase('inicio'));
  etapas += bloqueEtapa('Proceso', 'la conversacion esta en curso', porFase('proceso'));
  etapas += bloqueEtapa('Finalizacion', 'la conversacion se esta cerrando', porFase('finalizacion'));
  etapasSec.forEach((s) => { etapas += bloqueEtapa(s.titulo, s.descripcion, porFase(s.id)); });
  if (etapas) {
    p += `\n## Etapas de la conversacion\nIdentifica en que etapa esta el cliente y sigue las instrucciones de esa etapa (pueden aplicar varias a la vez):\n${etapas}`;
  }

  // --- Conocimiento y reglas generales ---------------------------------------
  p += bloqueReglas('Reglas GENERALES', porFase('general'));
  p += bloqueReglas('CASOS / automatizaciones (si ocurre la condicion, aplica la accion)', porFase('casos'));
  p += bloqueReglas('PROMOCIONES vigentes (mencionalas cuando sea relevante)', porFase('promociones'));
  p += bloqueReglas('PRODUCTOS NUEVOS o destacados (impulsalos cuando encaje)', porFase('productos_nuevos'));

  // Secciones de conocimiento del cliente (area=zona). Sus reglas usan fase = id.
  (secciones || []).filter((s) => s.area !== 'etapa').forEach((s) => {
    const titulo = s.descripcion ? `${s.titulo} (${s.descripcion})` : s.titulo;
    p += bloqueReglas(titulo, porFase(s.id));
  });

  // Instrucciones + FORMATO DE SALIDA: vienen 100% de la base de datos (campo
  // instrucciones_extra). NINGUNA regla ni formato esta escrito en el codigo.
  if (agente.instrucciones_extra) p += `\n## Instrucciones y formato de respuesta\n${agente.instrucciones_extra}\n`;

  if (ejemplos.length) {
    p += `\n## Ejemplos de como responder\n`;
    ejemplos.forEach((e, i) => {
      p += `Ejemplo ${i + 1}:\nUsuario: ${e.entrada}\nAsistente: ${e.salida}\n\n`;
    });
  }

  if (contextoRag && contextoRag.length) {
    const ctx = contextoRag.map((c, i) => `[Fuente ${i + 1}] ${c.contenido}`).join('\n\n');
    p += `\n## Base de conocimiento (usa SOLO esta informacion; si algo no esta aqui, dilo honestamente)\n${ctx}\n`;
  }

  return p;
}
