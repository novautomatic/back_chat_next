// Tool: crear_lead
// Registra los datos de contacto del visitante: los guarda en la conversacion
// (conversaciones.visitante) y en la tabla `leads` para que el cliente los vea.
import { admin } from '../../lib/supabase.js';

export const key = 'crear_lead';

export const definicion = {
  type: 'function',
  function: {
    name: 'crear_lead',
    description:
      'Guarda los datos de contacto del visitante (lead). Usala cuando el visitante comparta su nombre, email o telefono y tenga sentido registrarlo (interes de compra, solicitud de contacto, etc.).',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        nota: { type: 'string', description: 'Contexto del interes del lead (que pidio, que producto, etc.).' },
      },
    },
  },
};

// ctx = { clientId, agenteId, conversacionId }
export async function handler(args, ctx) {
  const nombre = args?.nombre?.trim() || null;
  const email = args?.email?.trim() || null;
  const telefono = args?.telefono?.trim() || null;
  const nota = args?.nota?.trim() || null;
  if (!nombre && !email && !telefono) {
    return { error: 'Falta al menos un dato de contacto (nombre, email o telefono).' };
  }

  // 1) Mezclar en conversaciones.visitante (sin perder lo ya capturado).
  try {
    const { data: conv } = await admin
      .from('conversaciones').select('visitante').eq('id', ctx.conversacionId).maybeSingle();
    const visitante = { ...(conv?.visitante || {}) };
    if (nombre) visitante.nombre = nombre;
    if (email) visitante.email = email;
    if (telefono) visitante.telefono = telefono;
    await admin.from('conversaciones').update({ visitante }).eq('id', ctx.conversacionId);
  } catch (e) {
    return { error: `No se pudo actualizar la conversacion: ${e.message}` };
  }

  // 2) Insertar en la tabla leads (best-effort: si no existe la tabla, no falla el turno).
  const { error: errLead } = await admin.from('leads').insert({
    client_id: ctx.clientId,
    agente_id: ctx.agenteId,
    conversacion_id: ctx.conversacionId,
    nombre, email, telefono, nota,
  });
  if (errLead) console.error('[crear_lead] tabla leads:', errLead.message);

  return { ok: true, mensaje: 'Datos de contacto guardados.' };
}
