// Agent loop: razona -> llama tools -> observa -> repite, hasta que el agente
// llama la tool terminal `responder_al_usuario` o se agotan los pasos.
//
// Devuelve { respuesta, productos, acciones, trazas } donde `trazas` es la lista
// de pasos (drafts) para que el orquestador los persista con turno_id/mensaje_id.
// En error de la API, lanza un Error con .trazas adjuntas (parciales).
import { openai } from '../lib/openai.js';
import { resumirTexto } from '../services/tracing.js';
import { openaiSchemasFor, ejecutar, TOOL_TERMINAL, TOOL_DELEGAR } from './toolRegistry.js';

const MAX_PASOS_HARD = 8; // tope absoluto de seguridad (Vercel serverless)

function parseArgs(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function salidaResumida(obj) {
  if (obj == null) return null;
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return resumirTexto(s);
}

// Red de seguridad: si el modelo respondio en TEXTO (sin usar responder_al_usuario)
// y ese texto es un JSON tipo {respuesta, productos, acciones} (porque el agente
// fue configurado para devolver JSON), lo extraemos. Si no, es texto normal.
function extraerSalida(content) {
  const texto = content || '';
  try {
    const o = JSON.parse(texto);
    if (o && typeof o === 'object' && (o.respuesta || o.contenido || o.mensaje || o.productos || o.acciones)) {
      return {
        respuesta: o.respuesta ?? o.contenido ?? o.mensaje ?? '',
        productos: Array.isArray(o.productos) ? o.productos : [],
        acciones: Array.isArray(o.acciones) ? o.acciones : [],
      };
    }
  } catch { /* no era JSON: texto normal */ }
  return { respuesta: texto, productos: [], acciones: [] };
}

// agente: fila de `agentes`. messages: [system, ...historial] (ya incluye el
// ultimo mensaje del usuario). ctx: { clientId, agenteId, conversacionId }.
// onStep(nombreTool): callback para emitir progreso (Realtime).
export async function ejecutarLoop({ agente, messages, ctx, maxPasos = 4, onStep }) {
  const tope = Math.min(Number(maxPasos) || 4, MAX_PASOS_HARD);
  const modelo = agente.modelo || 'gpt-4o-mini';
  const temperature = Number(agente.temperatura ?? 0.5);
  const tools = await openaiSchemasFor(ctx.agenteId);
  const trazas = [];
  const firmasVistas = new Set(); // anti-loop: misma tool + mismos args
  let final = null;
  let delegacion = null; // si el agente deriva a otro especialista

  for (let paso = 1; paso <= tope && !final && !delegacion; paso++) {
    const t0 = Date.now();
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: modelo, temperature, messages, tools, tool_choice: 'auto',
      });
    } catch (e) {
      trazas.push({ paso, tipo: 'error', nombre: modelo, modelo, latenciaMs: Date.now() - t0, error: e.message });
      throw Object.assign(new Error(e.message), { trazas });
    }
    const latenciaMs = Date.now() - t0;
    const msg = completion.choices?.[0]?.message;
    const usage = completion.usage;
    const toolCalls = msg?.tool_calls || [];

    trazas.push({
      paso, tipo: 'llm', nombre: modelo, modelo,
      tokensPrompt: usage?.prompt_tokens, tokensCompletion: usage?.completion_tokens,
      latenciaMs,
      salida: { tools: toolCalls.map((tc) => tc.function?.name), texto: resumirTexto(msg?.content || '') },
    });

    messages.push(msg); // turno del asistente (puede traer tool_calls)

    // Sin tools: el modelo respondio en texto -> esa es la respuesta final
    // (extraerSalida maneja el caso de agentes que devuelven JSON como texto).
    if (!toolCalls.length) {
      final = extraerSalida(msg?.content || '');
      break;
    }

    // Ejecutar las tools del paso (en paralelo: son independientes).
    const resultados = await Promise.all(toolCalls.map(async (tc) => {
      const nombre = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);

      // Tool terminal: sus argumentos SON la salida final del turno.
      if (nombre === TOOL_TERMINAL) {
        final = {
          respuesta: args.respuesta ?? '',
          productos: Array.isArray(args.productos) ? args.productos : [],
          acciones: Array.isArray(args.acciones) ? args.acciones : [],
        };
        return { id: tc.id, contenido: 'ok' };
      }

      // Tool de control: delegar a otro especialista (la maneja el orquestador).
      if (nombre === TOOL_DELEGAR) {
        delegacion = { destino: args.especialidad || args.agente || '', motivo: args.motivo || '' };
        trazas.push({ paso, tipo: 'delegacion', nombre, entrada: args });
        return { id: tc.id, contenido: 'ok' };
      }

      // Anti-loop: si ya llamo esta tool con los mismos args, no la re-ejecuta.
      const firma = `${nombre}:${tc.function?.arguments || ''}`;
      if (firmasVistas.has(firma)) {
        return { id: tc.id, contenido: JSON.stringify({ nota: 'Ya llamaste esta herramienta con los mismos argumentos. Usa el resultado anterior o responde al usuario.' }) };
      }
      firmasVistas.add(firma);

      const tt0 = Date.now();
      if (onStep) { try { await onStep(nombre); } catch { /* progreso best-effort */ } }
      const resultado = await ejecutar(nombre, args, ctx);
      trazas.push({
        paso, tipo: 'tool', nombre,
        entrada: args, salida: salidaResumida(resultado),
        latenciaMs: Date.now() - tt0,
        error: resultado?.error || null,
      });
      return { id: tc.id, contenido: typeof resultado === 'string' ? resultado : JSON.stringify(resultado) };
    }));

    // Empujar los resultados de las tools (uno por tool_call_id).
    for (const r of resultados) {
      messages.push({ role: 'tool', tool_call_id: r.id, content: r.contenido });
    }
  }

  // El agente decidio derivar: el orquestador ejecutara al especialista destino.
  if (delegacion) return { delegacion, trazas };

  // Se agotaron los pasos sin tool terminal: forzar una respuesta final sin tools.
  if (!final) {
    const t0 = Date.now();
    try {
      const completion = await openai.chat.completions.create({
        model: modelo, temperature,
        messages: [...messages, { role: 'system', content: 'Responde AHORA al usuario de forma final y util con lo que ya sabes. No uses herramientas.' }],
      });
      const msg = completion.choices?.[0]?.message;
      trazas.push({
        paso: tope + 1, tipo: 'llm', nombre: modelo, modelo,
        tokensPrompt: completion.usage?.prompt_tokens, tokensCompletion: completion.usage?.completion_tokens,
        latenciaMs: Date.now() - t0, salida: { texto: resumirTexto(msg?.content || ''), forzado: true },
      });
      final = extraerSalida(msg?.content || '');
    } catch (e) {
      trazas.push({ paso: tope + 1, tipo: 'error', nombre: modelo, modelo, latenciaMs: Date.now() - t0, error: e.message });
      throw Object.assign(new Error(e.message), { trazas });
    }
  }

  return { ...final, trazas };
}
