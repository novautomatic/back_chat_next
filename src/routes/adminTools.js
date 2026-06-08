// Gestión del CATÁLOGO de herramientas. Solo SUPER ADMIN.
// Permite crear/editar/eliminar tools (sistema y webhook), con toda su marca,
// variables, configuración y permisos.
import { Router } from 'express';
import { requireAuth, requireSuper } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';

const router = Router();
router.use(requireAuth, requireSuper);

// Campos editables del catálogo.
const CAMPOS = [
  'key', 'nombre', 'descripcion', 'tipo', 'categoria', 'proveedor', 'icono', 'color',
  'tags', 'parametros_schema', 'config_schema', 'metodo', 'url_plantilla', 'headers',
  'cuerpo_plantilla', 'permisos', 'ambito', 'activo',
];

function limpiar(body) {
  const out = {};
  for (const k of CAMPOS) if (k in body) out[k] = body[k];
  return out;
}

router.get('/', async (_req, res) => {
  const { data, error } = await admin.from('tools').select('*').order('categoria').order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/', async (req, res) => {
  const body = limpiar(req.body || {});
  if (!body.key || !/^[a-z0-9_]+$/.test(body.key)) {
    return res.status(400).json({ error: 'key inválida (usa minúsculas, números y guion bajo)' });
  }
  if (!body.nombre) return res.status(400).json({ error: 'Falta nombre' });
  body.tipo = body.tipo === 'webhook' ? 'webhook' : 'sistema';
  const { data, error } = await admin.from('tools').insert(body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const body = limpiar(req.body || {});
  delete body.key; // la key no se cambia tras crearla (es la referencia del handler)
  const { data, error } = await admin.from('tools').update(body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await admin.from('tools').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
