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
  const [{ data: agente }, { data: reglas }, { data: secciones }, { data: ejemplos }] = await Promise.all([
    admin.from('agentes').select('*').eq('id', req.params.id).single(),
    admin.from('agente_reglas').select('*').eq('agente_id', req.params.id).order('orden'),
    admin.from('agente_secciones').select('*').eq('agente_id', req.params.id).order('orden'),
    admin.from('agente_ejemplos').select('*').eq('agente_id', req.params.id).order('orden'),
  ]);
  res.json({ agente, reglas: reglas || [], secciones: secciones || [], ejemplos: ejemplos || [] });
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
  // Solo actualiza los campos presentes (evita nulear lo que no se envia).
  const campos = ['nombre', 'descripcion', 'modelo', 'temperatura', 'persona',
    'objetivo', 'saludo', 'instrucciones_extra', 'activo', 'modo_motor', 'max_pasos',
    'max_productos', 'rag_fragmentos', 'max_historial'];
  const update = {};
  for (const k of campos) if (k in b) update[k] = b[k];
  const { data, error } = await admin.from('agentes').update(update)
    .eq('id', req.params.id).select().single();
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

// ---- Secciones: etapas de la conversacion (area=etapa) y cuadrados de
//      "Conocimiento y reglas" (area=zona). Misma tabla, distinto `area`. -----
router.post('/:id/secciones', agentePropio, async (req, res) => {
  const { titulo, descripcion, icono, color, tipo, area, orden } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'Falta el título' });
  const { data, error } = await admin.from('agente_secciones').insert({
    client_id: cid(req), agente_id: req.params.id,
    titulo: titulo.trim(), descripcion: descripcion || null,
    icono: icono || '📋', color: color || 'slate',
    tipo: tipo === 'caso' ? 'caso' : 'simple',
    area: area === 'etapa' ? 'etapa' : 'zona', orden: orden ?? 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id/secciones/:secId', agentePropio, async (req, res) => {
  const { titulo, descripcion, icono, color, tipo, area, orden } = req.body;
  const { data, error } = await admin.from('agente_secciones')
    .update({ titulo, descripcion, icono, color, tipo, area, orden })
    .eq('id', req.params.secId).eq('agente_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id/secciones/:secId', agentePropio, async (req, res) => {
  // Borra primero las reglas de la seccion (su fase es el id de la seccion),
  // ya que agente_reglas referencia la seccion por texto, no por FK.
  await admin.from('agente_reglas')
    .delete().eq('agente_id', req.params.id).eq('fase', req.params.secId);
  const { error } = await admin.from('agente_secciones')
    .delete().eq('id', req.params.secId).eq('agente_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ---- Herramientas (tools) del agente -------------------------------------
// Devuelve el catalogo de tools con un flag de si estan activas para el agente
// y su config. buscar_conocimiento y responder_al_usuario van SIEMPRE activas
// (el backend las incluye aunque no esten aqui), por eso se marcan como base.
const TOOLS_SIEMPRE = ['buscar_conocimiento', 'responder_al_usuario'];

// ¿El plan/cliente puede usar esta tool? permisos = { planes:[], clientes:[] }.
function toolPermitida(t, plan, clientId) {
  const p = t.permisos || {};
  if (Array.isArray(p.planes) && p.planes.length && !p.planes.includes(plan)) return false;
  if (Array.isArray(p.clientes) && p.clientes.length && !p.clientes.includes(clientId)) return false;
  return true;
}

router.get('/:id/tools', agentePropio, async (req, res) => {
  const [{ data: catalogo }, { data: activos }, { data: cli }] = await Promise.all([
    admin.from('tools').select('*').eq('activo', true).order('categoria').order('nombre'),
    admin.from('agente_tools').select('*').eq('agente_id', req.params.id),
    admin.from('clientes').select('plan').eq('id', cid(req)).single(),
  ]);
  const plan = cli?.plan || 'free';
  const porTool = Object.fromEntries((activos || []).map((a) => [a.tool_id, a]));
  // El cliente solo ve las base + las permitidas por su plan/whitelist.
  const merged = (catalogo || [])
    .filter((t) => TOOLS_SIEMPRE.includes(t.key) || toolPermitida(t, plan, cid(req)))
    .map((t) => ({
      ...t,
      base: TOOLS_SIEMPRE.includes(t.key),
      activo_agente: TOOLS_SIEMPRE.includes(t.key) || !!porTool[t.id]?.activo,
      config: porTool[t.id]?.config || {},
    }));
  res.json(merged);
});

router.post('/:id/tools', agentePropio, async (req, res) => {
  const { tool_id, activo, config } = req.body || {};
  if (!tool_id) return res.status(400).json({ error: 'Falta tool_id' });
  const { data, error } = await admin.from('agente_tools').upsert({
    client_id: cid(req), agente_id: req.params.id, tool_id,
    activo: activo ?? true, config: config || {},
  }, { onConflict: 'agente_id,tool_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
