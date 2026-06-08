// Tool: agendar
// Reserva/agenda una cita. v1: si el agente tiene un webhook de agenda
// configurado (agente_tools.config.webhook_url), le delega la reserva; si no,
// registra la solicitud como lead-nota y responde que se coordinara el contacto.
import { admin } from '../../lib/supabase.js';

export const key = 'agendar';

export const definicion = {
  type: 'function',
  function: {
    name: 'agendar',
    description:
      'Agenda una cita/reserva con los datos que entregue el cliente. Usala cuando el cliente quiera reservar hora, agendar una reunion o pedir una cita. Confirma siempre fecha/hora y datos de contacto antes de llamarla.',
    parameters: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha solicitada (ej: 2026-06-20).' },
        hora: { type: 'string', description: 'Hora solicitada (ej: 15:30).' },
        nombre: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        detalle: { type: 'string', description: 'Motivo o detalle de la cita.' },
      },
      required: ['fecha'],
    },
  },
};

// ctx = { clientId, agenteId, conversacionId, toolConfigs }
export async function handler(args, ctx) {
  const datos = {
    fecha: args?.fecha?.trim() || null,
    hora: args?.hora?.trim() || null,
    nombre: args?.nombre?.trim() || null,
    email: args?.email?.trim() || null,
    telefono: args?.telefono?.trim() || null,
    detalle: args?.detalle?.trim() || null,
  };

  // Si hay webhook de agenda, le delegamos la reserva real.
  const webhook = ctx.toolConfigs?.agendar?.webhook_url;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversacion_id: ctx.conversacionId, ...datos }),
      });
      const texto = await res.text();
      if (!res.ok) return { error: `La agenda rechazo la reserva (${res.status}).` };
      let json; try { json = JSON.parse(texto); } catch { json = { respuesta: texto }; }
      return { ok: true, agenda: json };
    } catch (e) {
      return { error: `No se pudo contactar la agenda: ${e.message}` };
    }
  }

  // Sin webhook: dejamos constancia como lead-nota para seguimiento manual.
  const nota = `Solicitud de cita: ${datos.fecha || '?'} ${datos.hora || ''} — ${datos.detalle || 'sin detalle'}`.trim();
  await admin.from('leads').insert({
    client_id: ctx.clientId,
    agente_id: ctx.agenteId,
    conversacion_id: ctx.conversacionId,
    nombre: datos.nombre, email: datos.email, telefono: datos.telefono, nota,
  });
  return {
    ok: true,
    pendiente: true,
    mensaje: 'Solicitud de cita registrada. Avisa al cliente que se le contactara para confirmar la hora.',
  };
}
