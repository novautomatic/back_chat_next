// Tool: escalar_humano
// Marca la conversacion como escalada (la atendera una persona) y, si el agente
// tiene configurado un webhook, lo notifica. No corta la conversacion: el agente
// debe avisar al usuario que un humano continuara.
import { admin } from '../../lib/supabase.js';
import { broadcast } from '../../lib/realtime.js';

export const key = 'escalar_humano';

export const definicion = {
  type: 'function',
  function: {
    name: 'escalar_humano',
    description:
      'Escala la conversacion a una persona/agente humano. Usala cuando el caso exceda lo que puedes resolver, el usuario lo pida explicitamente, o haya una queja/urgencia. Tras llamarla, avisa al usuario que un humano lo atendera.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por que se escala (resumen breve).' },
        resumen: { type: 'string', description: 'Resumen del caso para el humano que continue.' },
      },
      required: ['motivo'],
    },
  },
};

// ctx = { clientId, agenteId, conversacionId, toolConfigs }
export async function handler(args, ctx) {
  const motivo = args?.motivo?.trim() || 'Sin motivo';
  const resumen = args?.resumen?.trim() || null;

  // 1) Marcar la conversacion como escalada.
  const { error } = await admin.from('conversaciones').update({
    escalada: true,
    escalada_motivo: motivo,
    escalada_at: new Date().toISOString(),
  }).eq('id', ctx.conversacionId);
  if (error) return { error: `No se pudo escalar: ${error.message}` };

  // 2) Avisar por Realtime (el panel puede escuchar este evento).
  await broadcast(ctx.conversacionId, 'escalado', { motivo, resumen });

  // 3) Webhook opcional configurado por el cliente en agente_tools.config.
  const webhook = ctx.toolConfigs?.escalar_humano?.webhook_url;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversacion_id: ctx.conversacionId, motivo, resumen }),
      });
    } catch (e) {
      console.error('[escalar_humano] webhook:', e.message);
    }
  }

  return { ok: true, mensaje: 'Conversacion escalada a una persona. Avisa al usuario que sera atendido por un humano.' };
}
