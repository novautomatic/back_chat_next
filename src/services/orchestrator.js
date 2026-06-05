// Orquestador del chat: toma un mensaje del visitante, arma el prompt desde la
// config del agente + RAG, llama a OpenAI en streaming y publica por Realtime.
import { admin } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { broadcast } from '../lib/realtime.js';
import { cargarCerebro, construirSystemPrompt } from './promptBuilder.js';
import { recuperarContexto } from './rag.js';

const MAX_HISTORIAL = 12; // ultimos N mensajes para el contexto

// Devuelve solo los productos cuyo enlace existe de verdad en el conocimiento
// del agente (compara el handle del url contra el texto del conocimiento).
function handleDeUrl(url) {
  return String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

async function soloProductosConEnlaceReal(agenteId, productos) {
  if (!productos.length) return [];
  const { data: docs } = await admin.from('documentos').select('contenido').eq('agente_id', agenteId);
  const conocimiento = (docs || []).map((d) => (d.contenido || '')).join(' ');
  // Handles validos = tokens completos "algo-algo(-algo...)" presentes en el conocimiento.
  // Coincidencia EXACTA: evita que "lana-jazmine" pase por ser parte de "lana-jazmine-te-con-leche".
  const validos = new Set((conocimiento.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || []));
  // Base real de la URL de producto, derivada del conocimiento (ej: https://dyetales.cl/products/).
  const base = (conocimiento.match(/https?:\/\/\S+?\/products\//i) || [null])[0];
  return productos
    .map((p) => {
      if (!p) return null;
      const handle = handleDeUrl(p.url);
      if (!validos.has(handle)) return null;
      // Reconstruye la URL canonica para que NUNCA falte /products/ ni quede mal armada.
      return base ? { ...p, url: base + handle } : p;
    })
    .filter(Boolean);
}

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
    recuperarContexto(agenteId, textoUsuario, 8),
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

  // 4) Parsear el JSON del agente -> texto + productos + acciones (tolerante a nombres).
  let respuesta = raw, productos = [], acciones = [];
  try {
    const obj = JSON.parse(raw);
    respuesta = obj.respuesta ?? obj.contenido ?? obj.mensaje ?? raw;
    if (Array.isArray(obj.productos)) productos = obj.productos;
    if (Array.isArray(obj.acciones)) acciones = obj.acciones;
  } catch {
    // Si no vino JSON valido, usamos el texto crudo como respuesta.
  }

  // 4b) Anti-enlaces-inventados: descarta productos cuyo enlace NO exista en el
  //     conocimiento del agente. El conocimiento es la unica fuente de verdad.
  productos = await soloProductosConEnlaceReal(agenteId, productos);

  // 4c) Red de seguridad: nunca dejar pasar acciones/botones de WhatsApp.
  acciones = acciones.filter((a) => a && !/wa\.me|whatsapp|56973851002/i.test(`${a.url || ''} ${a.texto || ''}`));

  // 4d) Limpiar URLs que el modelo haya metido dentro del texto (los enlaces van en productos).
  respuesta = String(respuesta).replace(/\s*https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim();

  // 5) Guardar solo el texto (transcripcion legible) y emitir el mensaje completo.
  await admin.from('mensajes').insert({
    client_id: clientId,
    conversacion_id: convId,
    rol: 'assistant',
    contenido: respuesta,
  });
  await broadcast(convId, 'done', { contenido: respuesta, productos, acciones });
}
