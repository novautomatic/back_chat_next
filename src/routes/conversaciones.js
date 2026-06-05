// Bandeja de conversaciones + transcripciones. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

router.get('/', async (req, res) => {
  const { data, error } = await admin
    .from('conversaciones')
    .select('*, agentes(nombre), flujos(nombre)')
    .eq('client_id', cid(req))
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', async (req, res) => {
  const { data: conv } = await admin
    .from('conversaciones').select('*').eq('id', req.params.id).eq('client_id', cid(req)).single();
  if (!conv) return res.status(404).json({ error: 'No encontrada' });
  const { data: mensajes } = await admin
    .from('mensajes').select('*').eq('conversacion_id', req.params.id).order('created_at');
  res.json({ conversacion: conv, mensajes: mensajes || [] });
});

export default router;
