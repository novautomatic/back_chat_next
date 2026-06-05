// Webhooks entrantes de Shopify (PUBLICOS, sin auth de dashboard).
// Shopify firma cada webhook con el "API secret key" de la app (HMAC-SHA256 del
// body crudo). Por eso este router usa express.raw y debe montarse ANTES del
// express.json() global (ver app.js). La tienda se identifica por el header
// X-Shopify-Shop-Domain.
import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { admin } from '../lib/supabase.js';
import { fetchProductByLegacyId } from '../lib/shopify.js';
import { upsertProductoDoc, eliminarProductoDoc } from '../services/shopifySync.js';

const router = Router();

// Body crudo (Buffer) solo para esta ruta: necesario para validar el HMAC.
router.use(express.raw({ type: '*/*', limit: '2mb' }));

function hmacValido(rawBody, header, secret) {
  if (!header || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/shopify', async (req, res) => {
  const shopDomain = req.get('X-Shopify-Shop-Domain');
  const topic = req.get('X-Shopify-Topic');
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const rawBody = req.body; // Buffer (express.raw)

  if (!shopDomain || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Webhook invalido' });
  }

  // Buscar la integracion por dominio para obtener su api_secret.
  const { data: integ } = await admin
    .from('integraciones_shopify').select('*').eq('shop_domain', shopDomain).maybeSingle();
  if (!integ) return res.status(401).json({ error: 'Tienda no registrada' });

  if (!hmacValido(rawBody, hmac, integ.api_secret)) {
    return res.status(401).json({ error: 'Firma invalida' });
  }

  let payload = {};
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { /* deja {} */ }

  // Responder 200 cuanto antes; el procesamiento (embeddings) corre en segundo plano.
  res.status(200).json({ ok: true });

  (async () => {
    try {
      if (topic === 'products/delete') {
        await eliminarProductoDoc(integ, payload.id);
        return;
      }
      // create | update: re-leer el producto completo (incluye colecciones/stock)
      // para formatearlo igual que el backfill.
      if (topic === 'products/create' || topic === 'products/update') {
        const product = await fetchProductByLegacyId(integ, payload.id);
        if (product) await upsertProductoDoc(integ, product);
        else await eliminarProductoDoc(integ, payload.id); // ya no existe
      }
    } catch (e) {
      console.error('[webhook shopify]', topic, e.message);
    }
  })();
});

export default router;
