// Agentes + sus reglas (por fase) + ejemplos. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);

const cid = (req) => req.effectiveClientId;

// Verifica que un agente pertenezca al cliente efectivo.
async function agentePropio(req, res, next) {
  const { data } = await admin
    .from('agentes')
    .select('id, client_id')
    .eq('id', req.params.id)
    .single();
  if (!data || data.client_id !== cid(req)) return res.status(404).json({ error: 'Agente no encontrado' });
  next();
}

// ---- Agentes -------------------------------------------------------------
router.get('/', async (req, res) => {
  const { data, error } = await admin
    .from('agentes').select('*').eq('client_id', cid(req)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', agentePropio, async (req, res) => {
  const [{ data: agente }, { data: reglas }, { data: ejemplos }] = await Promise.all([
    admin.from('agentes').select('*').eq('id', req.params.id).single(),
    admin.from('agente_reglas').select('*').eq('agente_id', req.params.id).order('orden'),
    admin.from('agente_ejemplos').select('*').eq('agente_id', req.params.id).order('orden'),
  ]);
  res.json({ agente, reglas: reglas || [], ejemplos: ejemplos || [] });
});

router.post('/', async (req, res) => {
  const b = req.body;
  const { data, error } = await admin.from('agentes').insert({
    client_id: cid(req),
    nombre: b.nombre || 'Nuevo agente',
    descripcion: b.descripcion,
    modelo: b.modelo || 'gpt-4o-mini',
    temperatura: b.temperatura ?? 0.5,
    persona: b.persona,
    objetivo: b.objetivo,
    saludo: b.saludo,
    instrucciones_extra: b.instrucciones_extra,
    activo: b.activo ?? true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', agentePropio, async (req, res) => {
  const b = req.body;
  const { data, error } = await admin.from('agentes').update({
    nombre: b.nombre, descripcion: b.descripcion, modelo: b.modelo,
    temperatura: b.temperatura, persona: b.persona, objetivo: b.objetivo,
    saludo: b.saludo, instrucciones_extra: b.instrucciones_extra, activo: b.activo,
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', agentePropio, async (req, res) => {
  const { error } = await admin.from('agentes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ---- Reglas --------------------------------------------------------------
router.post('/:id/reglas', agentePropio, async (req, res) => {
  const { fase, texto, orden } = req.body;
  const { data, error } = await admin.from('agente_reglas').insert({
    client_id: cid(req), agente_id: req.params.id,
    fase: fase || 'general', texto, orden: orden ?? 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id/reglas/:reglaId', agentePropio, async (req, res) => {
  const { fase, texto, orden, activo } = req.body;
  const { data, error } = await admin.from('agente_reglas')
    .update({ fase, texto, orden, activo })
    .eq('id', req.params.reglaId).eq('agente_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id/reglas/:reglaId', agentePropio, async (req, res) => {
  const { error } = await admin.from('agente_reglas')
    .delete().eq('id', req.params.reglaId).eq('agente_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ---- Ejemplos ------------------------------------------------------------
router.post('/:id/ejemplos', agentePropio, async (req, res) => {
  const { entrada, salida, orden } = req.body;
  const { data, error } = await admin.from('agente_ejemplos').insert({
    client_id: cid(req), agente_id: req.params.id, entrada, salida, orden: orden ?? 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/:id/ejemplos/:ejId', agentePropio, async (req, res) => {
  const { error } = await admin.from('agente_ejemplos')
    .delete().eq('id', req.params.ejId).eq('agente_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
