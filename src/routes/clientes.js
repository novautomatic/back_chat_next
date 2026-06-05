// Gestion de clientes (tenants). Solo SUPER ADMIN.
import { Router } from 'express';
import { requireAuth, requireSuper } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireSuper);

// Listar clientes (+ conteo de usuarios/agentes opcional simple).
router.get('/', async (_req, res) => {
  const { data, error } = await admin
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Crear cliente.
router.post('/', async (req, res) => {
  const { nombre, email_contacto, plan } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { data, error } = await admin
    .from('clientes')
    .insert({ nombre, email_contacto, plan: plan || 'free' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Editar cliente.
router.patch('/:id', async (req, res) => {
  const { nombre, email_contacto, plan, estado } = req.body;
  const { data, error } = await admin
    .from('clientes')
    .update({ nombre, email_contacto, plan, estado })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Eliminar cliente (cascada borra agentes/flujos/etc).
router.delete('/:id', async (req, res) => {
  const { error } = await admin.from('clientes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// Usuarios de un cliente.
router.get('/:id/usuarios', async (req, res) => {
  const { data, error } = await admin
    .from('perfiles')
    .select('id, nombre, email, rol, created_at')
    .eq('client_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Crear un usuario (cliente_admin) para un cliente.
router.post('/:id/usuarios', async (req, res) => {
  const { email, password, nombre } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Falta email/password' });

  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (e1) return res.status(500).json({ error: e1.message });

  // El trigger crea el perfil; lo vinculamos al cliente.
  const { data, error: e2 } = await admin
    .from('perfiles')
    .update({ client_id: req.params.id, rol: 'cliente_admin', nombre })
    .eq('id', created.user.id)
    .select()
    .single();
  if (e2) return res.status(500).json({ error: e2.message });
  res.status(201).json(data);
});

export default router;
