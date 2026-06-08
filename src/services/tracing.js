// Telemetria / Observabilidad del motor del agente.
//
// Registra "trazas": un paso dentro de un turno de conversacion (una llamada al
// LLM, una tool, una decision de router, un error...). En el motor clasico es
// una sola traza tipo 'llm' por turno; en el agent-loop sera una por paso.
//
// Regla de oro: la telemetria NUNCA debe romper ni frenar la conversacion. Toda
// escritura es best-effort y atrapa sus propios errores.
import { randomUUID } from 'node:crypto';
import { admin } from '../lib/supabase.js';

// Genera el id que agrupa todos los pasos de un mismo turno.
export function nuevoTurno() {
  return randomUUID();
}

// Recorta textos largos antes de guardarlos en jsonb (evita blobs gigantes / PII).
const MAX_TEXTO = 2000;
export function resumirTexto(valor, max = MAX_TEXTO) {
  if (valor == null) return null;
  const s = typeof valor === 'string' ? valor : JSON.stringify(valor);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Registra un paso del turno. Best-effort: nunca lanza, nunca rompe el turno.
//   traza = { clientId, conversacionId?, mensajeId?, agenteId?, turnoId, paso?,
//             tipo, nombre?, entrada?, salida?, modelo?,
//             tokensPrompt?, tokensCompletion?, latenciaMs?, error? }
export async function registrarPaso(traza) {
  try {
    if (!traza || !traza.clientId || !traza.turnoId || !traza.tipo) return;
    await admin.from('trazas').insert({
      client_id: traza.clientId,
      conversacion_id: traza.conversacionId ?? null,
      mensaje_id: traza.mensajeId ?? null,
      agente_id: traza.agenteId ?? null,
      turno_id: traza.turnoId,
      paso: traza.paso ?? 1,
      tipo: traza.tipo,
      nombre: traza.nombre ?? null,
      entrada: traza.entrada ?? null,
      salida: traza.salida ?? null,
      modelo: traza.modelo ?? null,
      tokens_prompt: traza.tokensPrompt ?? null,
      tokens_completion: traza.tokensCompletion ?? null,
      latencia_ms: traza.latenciaMs ?? null,
      error: traza.error ?? null,
    });
  } catch (e) {
    console.error('[tracing] no se pudo registrar la traza:', e.message);
  }
}
