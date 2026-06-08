// Orquestador del turno de chat.
//  - Si el flujo apunta a un EQUIPO: un router elige al especialista (services/
//    router.js) y un agente puede delegar a otro via la tool delegar_a (cota
//    MAX_DELEGACIONES). Si no hay equipo: comportamiento mono-agente.
//  - Por cada agente, elige el MOTOR segun agente.modo_motor:
//      'clasico' (default): UNA llamada a OpenAI con JSON estructurado.
//      'loop': agent-loop con function calling (ver agent/loop.js).
//  - Finalizacion compartida: salvaguardas (agent/postproceso.js) -> guardar
//    mensaje -> broadcast -> telemetria (services/tracing.js) -> resumen.
import { admin } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { broadcast } from '../lib/realtime.js';
import { cargarCerebro, construirSystemPrompt } from './promptBuilder.js';
import { recuperarContexto } from './rag.js';
import { nuevoTurno, registrarPaso, resumirTexto } from './tracing.js';
import { postprocesar } from '../agent/postproceso.js';
import { ejecutarLoop } from '../agent/loop.js';
import { cargarConfigs } from '../agent/toolRegistry.js';
import { derivarVisitanteKey, recuperarMemoria, actualizarResumen } from './memory.js';
import { cargarEquipo, elegirAgente, resolverDestino, descripcionMiembro } from './router.js';

const CARGA_HISTORIAL = 40;  // tope que se LEE de la BD; cada agente recorta a su max_historial
const MAX_DELEGACIONES = 2;  // tope de saltos entre especialistas por turno

// Instruccion que se añade al system SOLO en modo loop.
const INSTRUCCIONES_LOOP = `

## Modo de operacion (herramientas)
Tienes herramientas disponibles. Usalas para obtener informacion o ejecutar acciones en vez de inventar:
- Para buscar datos concretos en la base de conocimiento, llama a "buscar_conocimiento".
- Cuando ya tengas todo para responder, DEBES terminar llamando a "responder_al_usuario": el texto va en "respuesta", y si aplica, los productos en "productos" y los botones en "acciones".
No escribas la respuesta final como texto plano ni como JSON manual: entregala SIEMPRE a traves de la herramienta "responder_al_usuario". Si una instruccion anterior pedia devolver un JSON, ese mismo contenido va ahora como argumentos de "responder_al_usuario".`;

// ---------------------------------------------------------------------------
// Motor CLASICO: una sola llamada con response_format json_object.
// ---------------------------------------------------------------------------
async function motorClasico({ agente, system, previos, textoUsuario, contexto }) {
  const modelo = agente.modelo || 'gpt-4o-mini';
  const messages = [{ role: 'system', content: system }, ...previos];
  const t0 = Date.now();
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: modelo,
      temperature: Number(agente.temperatura ?? 0.5),
      response_format: { type: 'json_object' },
      messages,
    });
  } catch (e) {
    throw Object.assign(new Error(e.message), {
      trazas: [{ tipo: 'error', nombre: modelo, modelo, latenciaMs: Date.now() - t0, entrada: { texto: resumirTexto(textoUsuario) }, error: e.message }],
    });
  }
  const latenciaMs = Date.now() - t0;
  const raw = completion.choices?.[0]?.message?.content || '';
  const usage = completion.usage;

  let respuesta = raw, productos = [], acciones = [];
  try {
    const obj = JSON.parse(raw);
    respuesta = obj.respuesta ?? obj.contenido ?? obj.mensaje ?? raw;
    if (Array.isArray(obj.productos)) productos = obj.productos;
    if (Array.isArray(obj.acciones)) acciones = obj.acciones;
  } catch {
    // Si no vino JSON valido, usamos el texto crudo como respuesta.
  }

  const trazas = [{
    tipo: 'llm', nombre: modelo, modelo,
    tokensPrompt: usage?.prompt_tokens, tokensCompletion: usage?.completion_tokens, latenciaMs,
    entrada: { texto: resumirTexto(textoUsuario), fragmentos_rag: contexto?.length ?? 0 },
    salida: { respuesta: resumirTexto(respuesta), productos: productos.length, acciones: acciones.length },
  }];
  return { respuesta, productos, acciones, trazas };
}

// ---------------------------------------------------------------------------
// Motor LOOP: agent-loop con function calling. Puede devolver { delegacion }.
// ---------------------------------------------------------------------------
async function motorLoop({ agente, system, previos, ctx, convId }) {
  const toolConfigs = await cargarConfigs(ctx.agenteId);
  const messages = [{ role: 'system', content: system + INSTRUCCIONES_LOOP }, ...previos];
  return ejecutarLoop({
    agente,
    messages,
    ctx: { ...ctx, toolConfigs },
    maxPasos: Number(agente.max_pasos) || 4,
    onStep: (tool) => broadcast(convId, 'step', { tool, estado: 'ejecutando' }),
  });
}

// ---------------------------------------------------------------------------
// Ejecuta UN agente: carga su cerebro + RAG, arma el system (memoria, briefing,
// equipo) y corre el motor. Devuelve la salida del motor + el modelo usado.
// ---------------------------------------------------------------------------
async function ejecutarAgente({ agenteId, clientId, convId, visitanteKey, textoUsuario, previos, resumen, memoria, equipoData, briefing }) {
  // Cargamos el cerebro primero para leer SUS ajustes (rag_fragmentos, etc.).
  const cerebro = await cargarCerebro(agenteId);
  if (!cerebro.agente) {
    throw Object.assign(new Error('Agente no disponible'), {
      trazas: [{ tipo: 'error', nombre: 'agente_no_disponible', error: 'Agente no disponible o inactivo' }],
    });
  }
  const agente = cerebro.agente;

  // Ajustes configurables por agente (con base por defecto).
  const ragK = Number(agente.rag_fragmentos) || 8;
  const maxHist = Number(agente.max_historial) || 12;
  const maxProductos = Number(agente.max_productos) || 0;

  const contexto = await recuperarContexto(agenteId, textoUsuario, ragK);
  const previosCortado = previos.slice(-maxHist); // últimos N mensajes (configurable)

  let system = construirSystemPrompt(cerebro, contexto) + bloqueMemoria(resumen, memoria);
  if (briefing) system += `\n\n## Te derivaron este caso\n${briefing}\n`;
  if (agente.modo_motor === 'loop') system += bloqueEquipo(equipoData, agenteId);

  const ctx = { clientId, agenteId, conversacionId: convId, visitanteKey };
  const salida = agente.modo_motor === 'loop'
    ? await motorLoop({ agente, system, previos: previosCortado, ctx, convId })
    : await motorClasico({ agente, system, previos: previosCortado, textoUsuario, contexto });
  return { ...salida, modelo: agente.modelo, maxProductos };
}

export async function responder({ conversacion, agenteId: agenteIdArg, flujo, textoUsuario }) {
  const convId = conversacion.id;
  const clientId = conversacion.client_id;
  const turnoId = nuevoTurno();
  const visitanteKey = derivarVisitanteKey(conversacion.visitante);

  // 1) Guardar el mensaje del usuario.
  await admin.from('mensajes').insert({
    client_id: clientId, conversacion_id: convId, rol: 'user', contenido: textoUsuario,
  });

  // 2) Historial + memoria (no cambian entre delegaciones del mismo turno).
  const [{ data: historial }, memoria] = await Promise.all([
    admin.from('mensajes').select('rol, contenido').eq('conversacion_id', convId)
      .order('created_at', { ascending: false }).limit(CARGA_HISTORIAL),
    recuperarMemoria(clientId, visitanteKey, textoUsuario, 5),
  ]);
  const previos = (historial || []).reverse().map((m) => ({ role: m.rol, content: m.contenido }));

  const trazas = [];

  // 3) Elegir agente inicial: router de equipo, o agente directo del flujo.
  let agenteId = agenteIdArg || flujo?.agente_id || null;
  let equipoData = null;
  if (flujo?.equipo_id) {
    equipoData = await cargarEquipo(flujo.equipo_id);
    if (equipoData?.miembros?.length) {
      const t0 = Date.now();
      const elec = await elegirAgente({
        equipo: equipoData.equipo, miembros: equipoData.miembros,
        textoUsuario, resumen: conversacion.resumen,
      });
      trazas.push({
        tipo: 'router', nombre: 'router', latenciaMs: Date.now() - t0,
        entrada: { texto: resumirTexto(textoUsuario) },
        salida: { agente: elec.agenteId, motivo: elec.motivo },
      });
      if (elec.agenteId) agenteId = elec.agenteId;
    }
  }

  if (!agenteId) {
    await broadcast(convId, 'error', { mensaje: 'No hay agente disponible' });
    await persistirTrazas([...trazas, { tipo: 'error', error: 'Flujo sin agente ni equipo' }], { clientId, convId, agenteId: null, turnoId });
    return;
  }

  // 4) Ejecutar con delegacion acotada.
  let resultado = null, modeloFinal = 'gpt-4o-mini', maxProductosFinal = 0, briefing = null, delegaciones = 0;
  try {
    for (;;) {
      const salida = await ejecutarAgente({
        agenteId, clientId, convId, visitanteKey, textoUsuario, previos,
        resumen: conversacion.resumen, memoria, equipoData, briefing,
      });
      trazas.push(...(salida.trazas || []));
      modeloFinal = salida.modelo || modeloFinal;
      maxProductosFinal = salida.maxProductos ?? maxProductosFinal;

      // El agente decidio derivar a otro especialista del equipo.
      if (salida.delegacion && equipoData && delegaciones < MAX_DELEGACIONES) {
        const destinoId = resolverDestino(equipoData.miembros, salida.delegacion.destino);
        if (destinoId && destinoId !== agenteId) {
          delegaciones += 1;
          trazas.push({ tipo: 'delegacion', nombre: salida.delegacion.destino, salida: { de: agenteId, a: destinoId, motivo: salida.delegacion.motivo } });
          agenteId = destinoId;
          briefing = salida.delegacion.motivo || null;
          continue;
        }
        // No se pudo resolver el destino: respondemos con lo que haya en briefing.
      }

      resultado = salida.delegacion
        ? { respuesta: 'Un momento, te ayudo con eso.', productos: [], acciones: [] } // delegacion sin destino valido
        : { respuesta: salida.respuesta, productos: salida.productos, acciones: salida.acciones };
      break;
    }
  } catch (e) {
    console.error('[orchestrator] motor', e.message);
    await broadcast(convId, 'error', { mensaje: 'Error generando la respuesta' });
    await persistirTrazas([...trazas, ...(e.trazas || [{ tipo: 'error', error: e.message }])], { clientId, convId, agenteId, turnoId });
    return;
  }

  // 5) Salvaguardas finales + tope de productos (configurable por agente).
  const limpio = await postprocesar(agenteId, resultado, maxProductosFinal);

  // 6) Guardar la transcripcion legible y emitir el mensaje completo.
  const { data: msgAsistente } = await admin.from('mensajes').insert({
    client_id: clientId, conversacion_id: convId, rol: 'assistant', contenido: limpio.respuesta,
  }).select('id').single();
  await broadcast(convId, 'done', { contenido: limpio.respuesta, productos: limpio.productos, acciones: limpio.acciones, mensaje_id: msgAsistente?.id });

  // 7) Telemetria del turno (best-effort) + resumen incremental.
  await persistirTrazas(trazas, { clientId, convId, agenteId, turnoId, mensajeId: msgAsistente?.id });
  await actualizarResumen(convId, modeloFinal);
}

// Persiste una lista de trazas-draft estampando los campos comunes del turno.
async function persistirTrazas(trazas, { clientId, convId, agenteId, turnoId, mensajeId = null }) {
  for (const [i, t] of (trazas || []).entries()) {
    await registrarPaso({
      clientId, conversacionId: convId, mensajeId, agenteId, turnoId,
      paso: t.paso ?? i + 1, ...t,
    });
  }
}

// Bloque opcional para el system prompt: resumen previo + memoria del visitante.
function bloqueMemoria(resumen, memoria) {
  let b = '';
  if (resumen) b += `\n\n## Resumen de la conversacion previa\n${resumen}\n`;
  if (memoria?.length) {
    const lineas = memoria.map((m) => `- ${m.contenido}`).join('\n');
    b += `\n## Lo que ya sabes de este visitante (memoria)\n${lineas}\n`;
  }
  return b;
}

// Bloque de equipo: lista a los OTROS especialistas para que delegar_a pueda
// derivar con precision. Solo se incluye en modo loop (delegar_a es una tool).
function bloqueEquipo(equipoData, agenteId) {
  const otros = (equipoData?.miembros || []).filter((m) => m.agente_id !== agenteId && m.rol !== 'router');
  if (!otros.length) return '';
  const lista = otros.map((m) => `- ${descripcionMiembro(m)}`).join('\n');
  return `\n\n## Equipo (puedes derivar con delegar_a)\nSi el caso corresponde mejor a otro especialista, usa la tool "delegar_a" con su especialidad. Especialistas disponibles:\n${lista}\n`;
}
