// Orquestador del chat: toma un mensaje del visitante, arma el prompt desde la
// config del agente + RAG, llama a OpenAI en streaming y publica por Realtime.
import { admin } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { broadcast } from '../lib/realtime.js';
import { cargarCerebro, construirSystemPrompt } from './promptBuilder.js';
import { recuperarContexto } from './rag.js';

const MAX_HISTORIAL = 12; // ultimos N mensajes para el contexto

export async function responder({ conversacion, agenteId, textoUsuario }) {
  const convId = conversacion.id;
  const clientId = conversacion.client_id;

  // 1) Guardar el mensaje del usuario.
  await admin.from('mensajes').insert({
    client_id: clientId,
    conversacion_id: convId,
    rol: 'user',
    contenido: textoUsuario,
  });

  // 2) Cerebro + RAG + historial (en paralelo donde se pueda).
  const [cerebro, contexto, { data: historial }] = await Promise.all([
    cargarCerebro(agenteId),
    recuperarContexto(agenteId, textoUsuario, 5),
    admin.from('mensajes')
      .select('rol, contenido')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORIAL),
  ]);

  if (!cerebro.agente) {
    await broadcast(convId, 'error', { mensaje: 'Agente no disponible' });
    return;
  }

  const system = construirSystemPrompt(cerebro, contexto);
  const previos = (historial || []).reverse().map((m) => ({ role: m.rol, content: m.contenido }));

  const messages = [{ role: 'system', content: system }, ...previos];

  // 3) Llamada a OpenAI pidiendo SIEMPRE un JSON estructurado.
  let raw = '';
  try {
    const completion = await openai.chat.completions.create({
      model: cerebro.agente.modelo || 'gpt-4o-mini',
      temperature: Number(cerebro.agente.temperatura ?? 0.5),
      response_format: { type: 'json_object' },
      messages,
    });
    raw = completion.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[orchestrator] openai', e.message);
    await broadcast(convId, 'error', { mensaje: 'Error generando la respuesta' });
    return;
  }

  // 4) Parsear el JSON del agente -> texto + productos + acciones.
  let respuesta = raw, productos = [], acciones = [];
  try {
    const obj = JSON.parse(raw);
    if (typeof obj.respuesta === 'string') respuesta = obj.respuesta;
    if (Array.isArray(obj.productos)) productos = obj.productos;
    if (Array.isArray(obj.acciones)) acciones = obj.acciones;
  } catch {
    // Si no vino JSON valido, usamos el texto crudo como respuesta.
  }

  // 5) Guardar solo el texto (transcripcion legible) y emitir el mensaje completo.
  await admin.from('mensajes').insert({
    client_id: clientId,
    conversacion_id: convId,
    rol: 'assistant',
    contenido: respuesta,
  });
  await broadcast(convId, 'done', { contenido: respuesta, productos, acciones });
}
