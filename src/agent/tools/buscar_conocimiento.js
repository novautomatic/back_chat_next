// Tool: buscar_conocimiento
// RAG on-demand. Convierte el RAG de "siempre top-8 al inicio" a "el agente pide
// contexto cuando lo necesita". Envuelve services/rag.js (coseno en memoria).
import { recuperarContexto } from '../../services/rag.js';

export const key = 'buscar_conocimiento';

export const definicion = {
  type: 'function',
  function: {
    name: 'buscar_conocimiento',
    description:
      'Busca informacion relevante en la base de conocimiento del agente (catalogo, documentos, politicas, etc.). Usala SIEMPRE que necesites datos concretos para responder en vez de inventar.',
    parameters: {
      type: 'object',
      properties: {
        consulta: {
          type: 'string',
          description: 'La consulta o tema a buscar, en lenguaje natural (ej: "lana para calcetines", "politica de devoluciones").',
        },
      },
      required: ['consulta'],
    },
  },
};

// ctx = { clientId, agenteId, conversacionId }
export async function handler(args, ctx) {
  const consulta = String(args?.consulta || '').trim();
  if (!consulta) return { resultados: [], nota: 'Consulta vacia.' };
  const frags = await recuperarContexto(ctx.agenteId, consulta, 8);
  if (!frags?.length) {
    return { resultados: [], nota: 'Sin coincidencias en el conocimiento. No inventes: dilo honestamente.' };
  }
  return { resultados: frags.map((f, i) => ({ fuente: i + 1, contenido: f.contenido })) };
}
