// Integraciones externas del agente. Por ahora: Shopify (productos para el RAG).
// Scope por cliente efectivo. Los secretos (access_token/api_secret) NUNCA se
// devuelven al frontend.
import { Router } from 'express';
import { requireAuth, requireClient } from '../middleware/auth.js';
import { admin } from '../lib/supabase.js';
import { normalizarDominio, registrarWebhooks, eliminarWebhooks, obtenerAccessToken } from '../lib/shopify.js';
import { sincronizarTienda } from '../services/shopifySync.js';

const router = Router();
router.use(requireAuth, requireClient);
const cid = (req) => req.effectiveClientId;

// Columnas seguras (sin secretos) para devolver al front.
const PUBLIC_COLS = 'id, agente_id, shop_domain, api_version, estado, webhooks_ok, ultima_sync, productos_sync, error_msg, created_at';

// Estado de la integracion Shopify de un agente (o null si no hay).
router.get('/', async (req, res) => {
  const { agente_id } = req.query;
  if (!agente_id) return res.status(400).json({ error: 'Falta agente_id' });
  const { data, error } = await admin
    .from('integraciones_shopify')
    .select(PUBLIC_COLS)
    .eq('client_id', cid(req))
    .eq('agente_id', agente_id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

// Conectar (o reconectar) una tienda Shopify a un agente.
// Recibe el Client ID (api_key) y el Client secret (api_secret) de la app del
// Dev Dashboard. El access_token lo obtiene el backend (client credentials grant).
router.post('/shopify', async (req, res) => {
  const { agente_id, shop_domain, api_key, api_secret, api_version } = req.body;
  if (!agente_id || !shop_domain || !api_key || !api_secret) {
    return res.status(400).json({ error: 'Faltan campos (agente_id, shop_domain, api_key, api_secret)' });
  }

  // El agente debe pertenecer al cliente efectivo.
  const { data: ag } = await admin
    .from('agentes').select('id').eq('id', agente_id).eq('client_id', cid(req)).maybeSingle();
  if (!ag) return res.status(404).json({ error: 'Agente no encontrado' });

  // El endpoint de token de Shopify solo responde en el dominio .myshopify.com
  // (el dominio publico/personalizado devuelve un 403 de Cloudflare).
  const dominio = normalizarDominio(shop_domain);
  if (!dominio.endsWith('.myshopify.com')) {
    return res.status(400).json({
      error: 'Usa el dominio interno de Shopify (xxxxx.myshopify.com), no el dominio público. Lo encuentras en Configuración → Dominios.',
    });
  }

  const fila = {
    client_id: cid(req),
    agente_id,
    shop_domain: dominio,
    api_key: String(api_key).trim(),
    api_secret: String(api_secret).trim(),
    access_token: null,
    token_expira: null,
    api_version: (api_version || process.env.SHOPIFY_API_VERSION || '2024-10').trim(),
    estado: 'conectado',
    error_msg: null,
  };

  // upsert por agente_id (constraint unico).
  const { data: integ, error } = await admin
    .from('integraciones_shopify')
    .upsert(fila, { onConflict: 'agente_id' })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Validar credenciales obteniendo un token ya (feedback inmediato al usuario).
  try {
    await obtenerAccessToken(integ);
  } catch (e) {
    await admin.from('integraciones_shopify')
      .update({ estado: 'error', error_msg: e.message }).eq('id', integ.id);
    return res.status(400).json({ error: e.message });
  }

  // Registrar webhooks + backfill en segundo plano (no bloquea la respuesta).
  (async () => {
    try {
      const ok = await registrarWebhooks(integ);
      await admin.from('integraciones_shopify').update({ webhooks_ok: ok }).eq('id', integ.id);
      await sincronizarTienda(integ.id);
    } catch (e) {
      console.error('[integraciones] conexion', e.message);
    }
  })();

  // Devolver solo columnas seguras.
  const { api_key: _k, api_secret: _s, access_token: _t, ...safe } = integ;
  res.status(201).json(safe);
});

// Re-sincronizar manualmente ("Sincronizar ahora").
router.post('/shopify/:id/resync', async (req, res) => {
  const { data: integ } = await admin
    .from('integraciones_shopify').select('id, client_id').eq('id', req.params.id).single();
  if (!integ || integ.client_id !== cid(req)) return res.status(404).json({ error: 'No encontrado' });
  sincronizarTienda(req.params.id).catch((e) => console.error('[integraciones] resync', e.message));
  res.json({ ok: true });
});

// Desconectar: borra webhooks en Shopify y elimina la integracion.
// ?borrar_docs=1 elimina tambien los documentos importados.
router.delete('/shopify/:id', async (req, res) => {
  const { data: integ } = await admin
    .from('integraciones_shopify').select('*').eq('id', req.params.id).single();
  if (!integ || integ.client_id !== cid(req)) return res.status(404).json({ error: 'No encontrado' });

  await eliminarWebhooks(integ).catch(() => {});
  if (req.query.borrar_docs === '1') {
    await admin.from('documentos').delete().eq('agente_id', integ.agente_id).eq('tipo', 'shopify');
  }
  const { error } = await admin.from('integraciones_shopify').delete().eq('id', integ.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
