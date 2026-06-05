import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();

// Perfil del usuario autenticado + cliente efectivo (incluye impersonacion).
router.get('/me', requireAuth, async (req, res) => {
  let clienteActivo = null;
  if (req.effectiveClientId) {
    const { data } = await admin
      .from('clientes')
      .select('id, nombre, estado, plan')
      .eq('id', req.effectiveClientId)
      .single();
    clienteActivo = data || null;
  }
  res.json({
    user: req.user,
    isSuper: req.isSuper,
    effectiveClientId: req.effectiveClientId || null,
    clienteActivo,
  });
});

export default router;
