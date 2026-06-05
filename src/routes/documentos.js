// Documentos de "educacion" del agente + ingesta RAG. Scope por cliente efectivo.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';
import { procesarDocumento } from '../services/ingest.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

// Listar documentos de un agente.
router.get('/', async (req, res) => {
  const { agente_id } = req.query;
  let q = admin.from('documentos').select('*').eq('client_id', cid(req)).order('created_at', { ascending: false });
  if (agente_id) q = q.eq('agente_id', agente_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Pedir una URL firmada para subir un archivo al bucket "conocimiento".
// Devuelve { path, token, signedUrl } -> el front sube el archivo directo a Storage.
router.post('/upload-url', async (req, res) => {
  const { agente_id, filename } = req.body;
  if (!agente_id || !filename) return res.status(400).json({ error: 'Falta agente_id/filename' });
  const path = `${cid(req)}/${agente_id}/${Date.now()}-${filename}`;
  const { data, error } = await admin.storage.from('conocimiento').createSignedUploadUrl(path);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ path, ...data });
});

// Registrar un documento (texto | url | archivo) y disparar la ingesta.
router.post('/', async (req, res) => {
  const { agente_id, tipo, titulo, fuente, contenido } = req.body;
  if (!agente_id || !tipo || !titulo) return res.status(400).json({ error: 'Faltan campos' });

  const { data, error } = await admin.from('documentos').insert({
    client_id: cid(req), agente_id, tipo, titulo, fuente, contenido, estado: 'pendiente',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Ingesta en segundo plano (no bloquea la respuesta).
  procesarDocumento(data.id);
  res.status(201).json(data);
});

// Re-procesar.
router.post('/:id/reprocesar', async (req, res) => {
  const { data } = await admin.from('documentos').select('id, client_id').eq('id', req.params.id).single();
  if (!data || data.client_id !== cid(req)) return res.status(404).json({ error: 'No encontrado' });
  procesarDocumento(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { error } = await admin.from('documentos').delete().eq('id', req.params.id).eq('client_id', cid(req));
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
