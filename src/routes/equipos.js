// Equipos (orquestacion multi-agente) + sus miembros. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

async function equipoPropio(req, res, next) {
  const { data } = await admin.from('equipos').select('id, client_id').eq('id', req.params.id).single();
  if (!data || data.client_id !== cid(req)) return res.status(404).json({ error: 'Equipo no encontrado' });
  next();
}

// Lista equipos + miembros (con nombre del agente).
router.get('/', async (req, res) => {
  const { data: equipos, error } = await admin
    .from('equipos').select('*').eq('client_id', cid(req)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: miembros } = await admin
    .from('equipo_miembros')
    .select('*, agentes(nombre)')
    .eq('client_id', cid(req))
    .order('orden');
  const porEquipo = {};
  for (const m of miembros || []) (porEquipo[m.equipo_id] ||= []).push(m);
  res.json((equipos || []).map((e) => ({ ...e, miembros: porEquipo[e.id] || [] })));
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const { data, error } = await admin.from('equipos').insert({
    client_id: cid(req),
    nombre: b.nombre || 'Nuevo equipo',
    router_agente_id: b.router_agente_id || null,
    modo_router: b.modo_router === 'embedding' ? 'embedding' : 'llm',
    config: b.config || {},
    activo: b.activo ?? true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', equipoPropio, async (req, res) => {
  const b = req.body || {};
  const campos = ['nombre', 'router_agente_id', 'modo_router', 'config', 'activo'];
  const update = {};
  for (const k of campos) if (k in b) update[k] = b[k];
  const { data, error } = await admin.from('equipos').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', equipoPropio, async (req, res) => {
  const { error } = await admin.from('equipos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ---- Miembros ------------------------------------------------------------
router.post('/:id/miembros', equipoPropio, async (req, res) => {
  const { agente_id, rol, especialidad, orden } = req.body || {};
  if (!agente_id) return res.status(400).json({ error: 'Falta agente_id' });
  const { data, error } = await admin.from('equipo_miembros').upsert({
    client_id: cid(req), equipo_id: req.params.id, agente_id,
    rol: rol === 'router' ? 'router' : 'especialista',
    especialidad: especialidad || null, orden: orden ?? 0,
  }, { onConflict: 'equipo_id,agente_id' }).select('*, agentes(nombre)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/:id/miembros/:miembroId', equipoPropio, async (req, res) => {
  const { error } = await admin.from('equipo_miembros')
    .delete().eq('id', req.params.miembroId).eq('equipo_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
