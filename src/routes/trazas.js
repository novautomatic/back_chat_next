// Lectura de trazas (telemetria del motor) para el panel de observabilidad.
// Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

// Trazas de una conversacion (o las mas recientes del cliente).
router.get('/', async (req, res) => {
  let q = admin.from('trazas').select('*').eq('client_id', cid(req));
  if (req.query.conversacion_id) q = q.eq('conversacion_id', req.query.conversacion_id);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Resumen agregado sobre las trazas recientes (tokens, latencia, uso de tools).
router.get('/resumen', async (req, res) => {
  const { data, error } = await admin
    .from('trazas')
    .select('tipo, nombre, tokens_prompt, tokens_completion, latencia_ms, turno_id')
    .eq('client_id', cid(req))
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];

  const turnos = new Set(rows.map((r) => r.turno_id)).size;
  const llm = rows.filter((r) => r.tipo === 'llm');
  const tokens = llm.reduce((a, r) => a + (r.tokens_prompt || 0) + (r.tokens_completion || 0), 0);
  const latencias = llm.map((r) => r.latencia_ms).filter((n) => typeof n === 'number');
  const latProm = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : 0;

  const tools = {};
  for (const r of rows.filter((r) => r.tipo === 'tool')) {
    tools[r.nombre] = (tools[r.nombre] || 0) + 1;
  }
  const errores = rows.filter((r) => r.tipo === 'error').length;
  const delegaciones = rows.filter((r) => r.tipo === 'delegacion').length;

  res.json({ turnos, tokens, latencia_promedio_ms: latProm, tools, errores, delegaciones, muestras: rows.length });
});

export default router;
