// Evals: banco de casos por agente + correrlos con "LLM-as-judge".
// Correr un caso ejecuta el motor REAL del agente (responder) sobre una
// conversacion temporal y evalua la respuesta. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { responder } from '../services/orchestrator.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

async function agenteDelCliente(req, agenteId) {
  const { data } = await admin.from('agentes').select('id, client_id').eq('id', agenteId).single();
  return data && data.client_id === cid(req) ? data : null;
}

// ---- Casos ---------------------------------------------------------------
router.get('/casos', async (req, res) => {
  if (!req.query.agente_id) return res.status(400).json({ error: 'Falta agente_id' });
  const { data, error } = await admin.from('eval_casos')
    .select('*').eq('client_id', cid(req)).eq('agente_id', req.query.agente_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/casos', async (req, res) => {
  const { agente_id, entrada, criterio, referencia } = req.body || {};
  if (!agente_id || !entrada || !criterio) return res.status(400).json({ error: 'Falta agente_id, entrada o criterio' });
  if (!(await agenteDelCliente(req, agente_id))) return res.status(404).json({ error: 'Agente no encontrado' });
  const { data, error } = await admin.from('eval_casos').insert({
    client_id: cid(req), agente_id, entrada, criterio, referencia: referencia || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/casos/:id', async (req, res) => {
  const { error } = await admin.from('eval_casos')
    .delete().eq('id', req.params.id).eq('client_id', cid(req));
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ---- Corridas ------------------------------------------------------------
router.get('/corridas', async (req, res) => {
  if (!req.query.agente_id) return res.status(400).json({ error: 'Falta agente_id' });
  const { data, error } = await admin.from('eval_corridas')
    .select('*').eq('client_id', cid(req)).eq('agente_id', req.query.agente_id)
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

async function juzgar(caso, respuesta) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Eres un evaluador estricto. Dada la PREGUNTA, la RESPUESTA del agente y el CRITERIO, decide si la respuesta cumple. Responde SOLO JSON: {"aprobado":true|false,"puntaje":0.0-1.0,"notas":"breve"}.' },
      { role: 'user', content:
        `PREGUNTA:\n${caso.entrada}\n\nCRITERIO:\n${caso.criterio}` +
        (caso.referencia ? `\n\nRESPUESTA IDEAL:\n${caso.referencia}` : '') +
        `\n\nRESPUESTA DEL AGENTE:\n${respuesta}` },
    ],
  });
  try { return JSON.parse(completion.choices?.[0]?.message?.content || '{}'); }
  catch { return { aprobado: false, puntaje: 0, notas: 'juez devolvio no-JSON' }; }
}

// Corre TODOS los casos activos de un agente y devuelve el resumen.
router.post('/run', async (req, res) => {
  const { agente_id } = req.body || {};
  const agente = agente_id && await agenteDelCliente(req, agente_id);
  if (!agente) return res.status(404).json({ error: 'Agente no encontrado' });

  const { data: casos } = await admin.from('eval_casos')
    .select('*').eq('agente_id', agente_id).eq('activo', true);
  if (!casos?.length) return res.json({ total: 0, aprobados: 0, resultados: [] });

  const resultados = [];
  for (const caso of casos) {
    const { data: conv } = await admin.from('conversaciones').insert({
      client_id: agente.client_id, agente_id, canal: 'eval', visitante: {},
    }).select().single();
    await responder({ conversacion: conv, agenteId: agente_id, textoUsuario: caso.entrada });
    const { data: msgs } = await admin.from('mensajes')
      .select('rol, contenido').eq('conversacion_id', conv.id).order('created_at');
    const respuesta = (msgs || []).filter((m) => m.rol === 'assistant').pop()?.contenido || '';
    const v = await juzgar(caso, respuesta);
    await admin.from('eval_corridas').insert({
      client_id: agente.client_id, agente_id, caso_id: caso.id, respuesta,
      aprobado: !!v.aprobado, puntaje: Number(v.puntaje) || 0, juez_notas: v.notas || null,
    });
    resultados.push({ caso_id: caso.id, entrada: caso.entrada, respuesta, aprobado: !!v.aprobado, puntaje: Number(v.puntaje) || 0, notas: v.notas || '' });
  }
  res.json({ total: casos.length, aprobados: resultados.filter((r) => r.aprobado).length, resultados });
});

export default router;
