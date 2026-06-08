// Memoria del agente. Dos niveles:
//  1) Resumen incremental de la conversacion (conversaciones.resumen): da
//     continuidad mas alla de la ventana de ultimos N mensajes.
//  2) Memoria de largo plazo por visitante recurrente (memoria_visitante): hechos
//     y preferencias persistentes, recuperados por similitud (coseno en memoria,
//     igual criterio que rag.js para evitar el indice con pocas filas).
import { admin } from '../lib/supabase.js';
import { openai, embed } from '../lib/openai.js';
import { cosine, aVector } from './rag.js';

// --- Identidad del visitante -----------------------------------------------
// Prioridad: email > telefono > cookie estable del widget (visitante.vid).
// Devuelve null si no hay forma estable de identificarlo (no se guarda memoria).
export function derivarVisitanteKey(visitante) {
  const v = visitante || {};
  const email = String(v.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const tel = String(v.telefono || '').replace(/\s+/g, '');
  if (tel) return `tel:${tel}`;
  const vid = String(v.vid || '').trim();
  if (vid) return `cookie:${vid}`;
  return null;
}

// --- Lectura: recuperar memoria relevante para inyectar en el prompt --------
export async function recuperarMemoria(clientId, visitanteKey, consulta, k = 5) {
  if (!visitanteKey) return [];
  try {
    const { data, error } = await admin
      .from('memoria_visitante')
      .select('contenido, tipo, embedding')
      .eq('client_id', clientId)
      .eq('visitante_key', visitanteKey);
    if (error || !data?.length) return [];

    const q = await embed(consulta || '');
    return data
      .map((m) => {
        const v = aVector(m.embedding);
        return v ? { contenido: m.contenido, tipo: m.tipo, similitud: cosine(q, v) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.similitud - a.similitud)
      .slice(0, k);
  } catch (e) {
    console.error('[memory] recuperar', e.message);
    return [];
  }
}

// --- Escritura: guardar un hecho/preferencia durable -----------------------
export async function guardarMemoria({ clientId, agenteId, visitanteKey, tipo = 'hecho', contenido }) {
  if (!visitanteKey || !contenido) return { error: 'Falta visitante_key o contenido.' };
  try {
    const embedding = await embed(contenido);
    const { error } = await admin.from('memoria_visitante').insert({
      client_id: clientId,
      agente_id: agenteId,
      visitante_key: visitanteKey,
      tipo,
      contenido,
      embedding,
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// --- Resumen incremental de la conversacion --------------------------------
// Se dispara cada cierto numero de mensajes. Resume TODO menos los ultimos
// `dejarCrudos` y lo guarda en conversaciones.resumen. Best-effort.
const RESUMIR_DESDE = 14;     // no resumir conversaciones cortas
const RESUMIR_CADA = 8;       // re-resumir aprox. cada N mensajes nuevos
const DEJAR_CRUDOS = 6;       // mensajes recientes que NO se resumen

export async function actualizarResumen(convId, modelo = 'gpt-4o-mini') {
  try {
    const { data: msgs } = await admin
      .from('mensajes')
      .select('id, rol, contenido, created_at')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: true });
    const total = msgs?.length || 0;
    if (total < RESUMIR_DESDE) return;
    if (total % RESUMIR_CADA !== 0) return; // solo en hitos, para no llamar al LLM cada turno

    const aResumir = msgs.slice(0, Math.max(0, total - DEJAR_CRUDOS));
    if (!aResumir.length) return;

    const { data: conv } = await admin
      .from('conversaciones').select('resumen').eq('id', convId).maybeSingle();

    const transcripcion = aResumir
      .map((m) => `${m.rol === 'user' ? 'Cliente' : 'Asistente'}: ${m.contenido}`)
      .join('\n')
      .slice(0, 12000);

    const completion = await openai.chat.completions.create({
      model: modelo,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Resume la conversacion para que un asistente la retome sin perder contexto. Incluye: que busca el cliente, datos/preferencias que dio, acuerdos y pendientes. Se breve y concreto (maximo ~150 palabras). Devuelve solo el resumen.' },
        ...(conv?.resumen ? [{ role: 'user', content: `Resumen previo:\n${conv.resumen}` }] : []),
        { role: 'user', content: `Conversacion:\n${transcripcion}` },
      ],
    });
    const resumen = completion.choices?.[0]?.message?.content?.trim();
    if (!resumen) return;

    await admin.from('conversaciones').update({
      resumen,
      resumen_hasta_mensaje: aResumir[aResumir.length - 1].id,
      resumen_actualizado_at: new Date().toISOString(),
    }).eq('id', convId);
  } catch (e) {
    console.error('[memory] resumen', e.message);
  }
}
