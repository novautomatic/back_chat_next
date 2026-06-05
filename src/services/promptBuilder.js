// Ensambla el SYSTEM PROMPT dinamicamente desde la configuracion del agente.
// NINGUNA regla de negocio esta escrita aqui: todo viene de la base de datos.
import { admin } from '../lib/supabase.js';

// Carga agente + reglas (por fase) + ejemplos.
export async function cargarCerebro(agenteId) {
  const [{ data: agente }, { data: reglas }, { data: ejemplos }] = await Promise.all([
    admin.from('agentes').select('*').eq('id', agenteId).single(),
    admin.from('agente_reglas').select('*').eq('agente_id', agenteId).eq('activo', true).order('orden'),
    admin.from('agente_ejemplos').select('*').eq('agente_id', agenteId).order('orden'),
  ]);
  return { agente, reglas: reglas || [], ejemplos: ejemplos || [] };
}

function bloqueReglas(titulo, lista) {
  if (!lista.length) return '';
  const items = lista.map((r, i) => `${i + 1}. ${r.texto}`).join('\n');
  return `\n## ${titulo}\n${items}\n`;
}

// Construye el texto del system prompt. Recibe el contexto RAG ya recuperado.
export function construirSystemPrompt({ agente, reglas, ejemplos }, contextoRag) {
  const porFase = (f) => reglas.filter((r) => r.fase === f);

  let p = '';
  p += `Eres "${agente.nombre}".\n`;
  if (agente.persona) p += `\n## Personalidad y rol\n${agente.persona}\n`;
  if (agente.objetivo) p += `\n## Objetivo de la conversacion\n${agente.objetivo}\n`;
  if (agente.saludo) p += `\n## Saludo\nTu mensaje de saludo es: "${agente.saludo}".\n`;

  p += bloqueReglas('Reglas de INICIO de la conversacion', porFase('inicio'));
  p += bloqueReglas('Reglas durante el PROCESO de la conversacion', porFase('proceso'));
  p += bloqueReglas('Reglas para FINALIZAR la conversacion', porFase('finalizacion'));
  p += bloqueReglas('Reglas GENERALES', porFase('general'));

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
