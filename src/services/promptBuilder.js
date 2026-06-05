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
  p += `Eres un asistente conversacional llamado "${agente.nombre}".\n`;
  if (agente.persona) p += `\n## Personalidad y rol\n${agente.persona}\n`;
  if (agente.objetivo) p += `\n## Objetivo de la conversacion\n${agente.objetivo}\n`;
  if (agente.saludo) p += `\n## Saludo inicial\nSOLO en tu PRIMER mensaje de la conversacion saluda asi (adaptalo con naturalidad): "${agente.saludo}". En los mensajes siguientes NO vuelvas a saludar ni a presentarte: responde directo a lo que pregunta.\n`;

  p += bloqueReglas('Reglas de INICIO de la conversacion', porFase('inicio'));
  p += bloqueReglas('Reglas durante el PROCESO de la conversacion', porFase('proceso'));
  p += bloqueReglas('Reglas para FINALIZAR la conversacion', porFase('finalizacion'));
  p += bloqueReglas('Reglas GENERALES', porFase('general'));

  if (agente.instrucciones_extra) p += `\n## Instrucciones adicionales\n${agente.instrucciones_extra}\n`;

  if (ejemplos.length) {
    p += `\n## Ejemplos de como responder\n`;
    ejemplos.forEach((e, i) => {
      p += `Ejemplo ${i + 1}:\nUsuario: ${e.entrada}\nAsistente: ${e.salida}\n\n`;
    });
  }

  if (contextoRag && contextoRag.length) {
    const ctx = contextoRag.map((c, i) => `[Fuente ${i + 1}] ${c.contenido}`).join('\n\n');
    p += `\n## Base de conocimiento (usa esta informacion para responder; si no esta aqui, dilo honestamente)\n${ctx}\n`;
  }

  p += `\nResponde siempre en el idioma del usuario. Se claro, ordenado y fiel a las reglas anteriores.`;

  // Contrato de salida: SIEMPRE JSON. Los enlaces NO van en el texto, van aparte.
  p += `

## FORMATO DE SALIDA (OBLIGATORIO)
Responde SIEMPRE en JSON valido, con EXACTAMENTE esta estructura:
{
  "respuesta": "Tu mensaje en texto plano, claro y calido. Prohibido: markdown, asteriscos (**), enlaces tipo [texto](url), URLs dentro del texto y comillas innecesarias. Solo texto natural.",
  "productos": [
    { "nombre": "Linea + color", "precio": "Precio en CLP (ej: $18.700)", "url": "Enlace https completo del producto" }
  ],
  "acciones": [
    { "texto": "Etiqueta corta del boton (ej: Escribir por WhatsApp)", "url": "Enlace https o https://wa.me/56973851002" }
  ]
}
Reglas del formato:
- Si recomiendas lanas/productos, ponlos en "productos" (uno por cada uno) con su precio y su enlace real. Si no recomiendas ninguno, usa "productos": [].
- Usa "acciones" solo para botones utiles (ej: WhatsApp para concretar la compra). Si no aplica, usa "acciones": [].
- NUNCA escribas enlaces, URLs ni markdown dentro de "respuesta". Los enlaces SOLO viven en "productos" y "acciones".
- En "url" usa EXACTAMENTE un enlace que aparezca en el conocimiento (los handles reales suelen ser por color, ej: .../products/lana-gretel-cayena). NUNCA inventes handles genericos como .../products/gretel. Si no tienes el enlace exacto de un color, usa el de un color disponible de esa linea, o pide al cliente que elija color y deja "productos": [] hasta tenerlo.`;
  return p;
}
