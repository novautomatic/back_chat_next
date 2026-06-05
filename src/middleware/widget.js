// Middleware del WIDGET publico. Valida el widget_key del flujo y resuelve
// el flujo + cliente + agente. Sin login: el visitante es anonimo.
import { admin } from '../lib/supabase.js';

export async function resolveWidget(req, res, next) {
  try {
    const { widget_key } = req.params;
    if (!widget_key) return res.status(400).json({ error: 'Falta widget_key' });

    const { data: flujo, error } = await admin
      .from('flujos')
      .select('id, client_id, agente_id, nombre, canal, config_widget, activo')
      .eq('widget_key', widget_key)
      .single();

    if (error || !flujo) return res.status(404).json({ error: 'Widget no encontrado' });
    if (!flujo.activo) return res.status(403).json({ error: 'Widget inactivo' });
    if (!flujo.agente_id) return res.status(409).json({ error: 'El flujo no tiene un agente asignado' });

    req.flujo = flujo;
    next();
  } catch (e) {
    console.error('[widget]', e);
    res.status(500).json({ error: 'Error resolviendo widget' });
  }
}
