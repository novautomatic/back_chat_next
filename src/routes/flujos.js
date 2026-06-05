// Flujos (iniciadores) + generador del script embed. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

router.get('/', async (req, res) => {
  const { data, error } = await admin
    .from('flujos').select('*, agentes(nombre)').eq('client_id', cid(req))
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await admin
    .from('flujos').select('*').eq('id', req.params.id).eq('client_id', cid(req)).single();
  if (error || !data) return res.status(404).json({ error: 'Flujo no encontrado' });
  res.json(data);
});

router.post('/', async (req, res) => {
  const b = req.body;
  const { data, error } = await admin.from('flujos').insert({
    client_id: cid(req),
    agente_id: b.agente_id || null,
    nombre: b.nombre || 'Nuevo flujo',
    descripcion: b.descripcion,
    canal: 'web',
    trigger_tipo: b.trigger_tipo || 'inicio_conversacion',
    trigger_palabras: b.trigger_palabras || [],
    config_widget: b.config_widget || {},
    activo: b.activo ?? true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const b = req.body;
  const { data, error } = await admin.from('flujos').update({
    agente_id: b.agente_id, nombre: b.nombre, descripcion: b.descripcion,
    trigger_tipo: b.trigger_tipo, trigger_palabras: b.trigger_palabras,
    config_widget: b.config_widget, activo: b.activo,
  }).eq('id', req.params.id).eq('client_id', cid(req)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await admin.from('flujos').delete().eq('id', req.params.id).eq('client_id', cid(req));
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
