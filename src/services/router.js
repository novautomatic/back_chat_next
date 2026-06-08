// Orquestacion multi-agente: carga el equipo y decide QUE agente atiende.
// No es un flujo rigido A->B: el router (LLM o embedding) entiende el mensaje y
// elige al especialista mas adecuado. Cada especialista corre luego su propio
// cerebro/tools, asi ningun agente se satura.
import { admin } from '../lib/supabase.js';
import { openai, embed } from '../lib/openai.js';
import { cosine, aVector } from './rag.js';

// Carga el equipo + sus miembros (con nombre/descripcion del agente).
export async function cargarEquipo(equipoId) {
  const { data: equipo } = await admin
    .from('equipos').select('*').eq('id', equipoId).maybeSingle();
  if (!equipo || equipo.activo === false) return null;
  const { data: miembros } = await admin
    .from('equipo_miembros')
    .select('agente_id, rol, especialidad, especialidad_embedding, orden, agentes(nombre, descripcion)')
    .eq('equipo_id', equipoId)
    .order('orden');
  return { equipo, miembros: miembros || [] };
}

// Texto descriptivo de un miembro (para el prompt del router y para delegar_a).
export function descripcionMiembro(m) {
  const nombre = m.agentes?.nombre || 'Agente';
  const esp = m.especialidad || m.agentes?.descripcion || '';
  return esp ? `${nombre} — ${esp}` : nombre;
}

// Resuelve un destino de delegacion (especialidad o nombre) a un agente_id.
export function resolverDestino(miembros, destino) {
  const q = String(destino || '').trim().toLowerCase();
  if (!q) return null;
  for (const m of miembros) {
    const esp = String(m.especialidad || '').toLowerCase();
    const nom = String(m.agentes?.nombre || '').toLowerCase();
    if (esp && (esp === q || esp.includes(q) || q.includes(esp))) return m.agente_id;
    if (nom && (nom === q || nom.includes(q) || q.includes(nom))) return m.agente_id;
  }
  return null;
}

// Elige el agente que atendera. Devuelve { agenteId, motivo }.
export async function elegirAgente({ equipo, miembros, textoUsuario, resumen }) {
  const fallbackId = equipo.router_agente_id || miembros[0]?.agente_id || null;
  const candidatos = miembros.filter((m) => m.rol !== 'router');
  if (!candidatos.length) return { agenteId: fallbackId, motivo: 'sin especialistas' };

  if (equipo.modo_router === 'embedding') {
    const elec = await porEmbedding(candidatos, textoUsuario);
    if (elec) return elec;
    // sin embeddings o baja confianza -> cae a LLM
  }
  return porLLM({ miembros: candidatos, textoUsuario, resumen, fallbackId });
}

async function porEmbedding(candidatos, textoUsuario) {
  const conEmb = candidatos
    .map((m) => ({ m, v: aVector(m.especialidad_embedding) }))
    .filter((x) => x.v);
  if (!conEmb.length) return null;
  try {
    const q = await embed(textoUsuario || '');
    let mejor = null;
    for (const { m, v } of conEmb) {
      const sim = cosine(q, v);
      if (!mejor || sim > mejor.sim) mejor = { m, sim };
    }
    if (!mejor || mejor.sim < 0.2) return null; // baja confianza -> fallback LLM
    return { agenteId: mejor.m.agente_id, motivo: `match por especialidad (${mejor.sim.toFixed(2)})` };
  } catch {
    return null;
  }
}

async function porLLM({ miembros, textoUsuario, resumen, fallbackId }) {
  const lista = miembros
    .map((m) => `- agente_id: ${m.agente_id} | ${descripcionMiembro(m)}`)
    .join('\n');
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Eres un enrutador de soporte. Segun el mensaje del cliente, elige al especialista mas adecuado de la lista. Responde SOLO un JSON: {"agente_id":"<uuid exacto de la lista>","motivo":"<breve>"}. Si dudas, elige el mas general.',
        },
        ...(resumen ? [{ role: 'user', content: `Contexto previo: ${resumen}` }] : []),
        { role: 'user', content: `Especialistas:\n${lista}\n\nMensaje del cliente: ${textoUsuario}` },
      ],
    });
    const obj = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    const valido = miembros.some((m) => m.agente_id === obj.agente_id);
    if (valido) return { agenteId: obj.agente_id, motivo: obj.motivo || 'router' };
  } catch (e) {
    console.error('[router] llm', e.message);
  }
  return { agenteId: fallbackId, motivo: 'fallback' };
}
