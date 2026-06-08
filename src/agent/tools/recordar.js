// Tool: recordar
// Guarda un hecho o preferencia DURABLE del visitante para futuras
// conversaciones (memoria de largo plazo). Solo funciona si el visitante es
// identificable (email/telefono/cookie); si no, lo informa.
import { guardarMemoria } from '../../services/memory.js';

export const key = 'recordar';

export const definicion = {
  type: 'function',
  function: {
    name: 'recordar',
    description:
      'Guarda un dato DURABLE del visitante para recordarlo en futuras conversaciones (preferencias, datos relevantes, contexto que conviene no olvidar). No lo uses para cosas triviales o de un solo turno.',
    parameters: {
      type: 'object',
      properties: {
        contenido: { type: 'string', description: 'El hecho/preferencia a recordar, redactado de forma autocontenida (ej: "Prefiere lanas de algodon, teje para bebes").' },
        tipo: { type: 'string', enum: ['hecho', 'preferencia'], description: 'Tipo de memoria.' },
      },
      required: ['contenido'],
    },
  },
};

// ctx = { clientId, agenteId, conversacionId, visitanteKey, toolConfigs }
export async function handler(args, ctx) {
  if (!ctx.visitanteKey) {
    return { nota: 'No puedo guardar memoria porque el visitante no esta identificado (sin email/telefono).' };
  }
  const contenido = String(args?.contenido || '').trim();
  if (!contenido) return { error: 'Falta el contenido a recordar.' };
  const res = await guardarMemoria({
    clientId: ctx.clientId,
    agenteId: ctx.agenteId,
    visitanteKey: ctx.visitanteKey,
    tipo: args?.tipo === 'preferencia' ? 'preferencia' : 'hecho',
    contenido,
  });
  return res.ok ? { ok: true, mensaje: 'Guardado en memoria.' } : { error: res.error };
}
