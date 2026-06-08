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

// URL firmada para subir el ICONO del chat al bucket PUBLICO "widget".
// Devuelve { path, token, publicUrl } -> el front sube directo y guarda la
// publicUrl en config_widget.icono.
router.post('/icono-upload-url', async (req, res) => {
  const { agente_id, filename } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'Falta filename' });
  const safe = String(filename).replace(/[^\w.-]+/g, '_');
  const path = `${cid(req)}/${agente_id || 'sin-agente'}/${Date.now()}-${safe}`;
  const { data, error } = await admin.storage.from('widget').createSignedUploadUrl(path);
  if (error) return res.status(500).json({ error: error.message });
  const { data: pub } = admin.storage.from('widget').getPublicUrl(path);
  res.json({ path, publicUrl: pub.publicUrl, ...data });
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
  const campos = ['agente_id', 'equipo_id', 'nombre', 'descripcion',
    'trigger_tipo', 'trigger_palabras', 'config_widget', 'activo'];
  const update = {};
  for (const k of campos) if (k in b) update[k] = b[k];
  const { data, error } = await admin.from('flujos').update(update)
    .eq('id', req.params.id).eq('client_id', cid(req)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await admin.from('flujos').delete().eq('id', req.params.id).eq('client_id', cid(req));
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
