// Lectura de leads (contactos capturados por la tool crear_lead / agendar).
// Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

router.get('/', async (req, res) => {
  const { data, error } = await admin
    .from('leads')
    .select('*, agentes(nombre)')
    .eq('client_id', cid(req))
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

export default router;
