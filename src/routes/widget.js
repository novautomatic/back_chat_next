// Endpoints PUBLICOS del widget (sin login). Validados por widget_key.
import { Router } from 'express';
import { resolveWidget } from '../middleware/widget.js';
import { admin } from '../lib/supabase.js';
import { canalDe } from '../lib/realtime.js';
import { responder } from '../services/orchestrator.js';

const router = Router();

// Config publica del widget (apariencia + captura de lead) para pintar la burbuja.
router.get('/:widget_key/config', resolveWidget, async (req, res) => {
  const { data: agente } = await admin
    .from('agentes').select('nombre, saludo').eq('id', req.flujo.agente_id).single();
  res.json({
    flujo: { nombre: req.flujo.nombre },
    agente: { nombre: agente?.nombre, saludo: agente?.saludo },
    config_widget: req.flujo.config_widget || {},
  });
});

// Inicia una sesion/conversacion. Devuelve el canal Realtime a suscribir.
router.post('/:widget_key/session', resolveWidget, async (req, res) => {
  const { visitante, origen } = req.body || {};
  const { data, error } = await admin.from('conversaciones').insert({
    client_id: req.flujo.client_id,
    flujo_id: req.flujo.id,
    agente_id: req.flujo.agente_id,
    canal: 'web',
    visitante: visitante || {},
    origen: origen || {},
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    conversacion_id: data.id,
    canal_realtime: canalDe(data.id),
  });
});

// Envia un mensaje del visitante. La respuesta se transmite por Realtime;
// se espera a que termine para no cortar el streaming en serverless.
router.post('/:widget_key/mensaje', resolveWidget, async (req, res) => {
  const { conversacion_id, texto } = req.body || {};
  if (!conversacion_id || !texto) return res.status(400).json({ error: 'Falta conversacion_id/texto' });

  const { data: conv } = await admin
    .from('conversaciones').select('*').eq('id', conversacion_id).single();
  if (!conv || conv.flujo_id !== req.flujo.id) {
    return res.status(404).json({ error: 'Conversacion no valida' });
  }

  await responder({ conversacion: conv, agenteId: req.flujo.agente_id, textoUsuario: texto });
  res.json({ ok: true });
});

export default router;
