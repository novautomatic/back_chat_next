// Cliente minimo de la Admin API de Shopify (GraphQL) + helpers de webhooks.
// Una "integracion" es una fila de public.integraciones_shopify: contiene
// shop_domain, api_key (Client ID), api_secret (Client secret) y un access_token
// cacheado. Auth = "client credentials grant" del Dev Dashboard (servidor-a-
// servidor, sin OAuth interactivo): el backend canjea api_key + api_secret por un
// token de 24h y lo renueva solo.
import { admin } from './supabase.js';

const DEFAULT_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const MARGEN_MS = 60_000; // renovar el token 1 min antes de que venza

// Devuelve un access_token valido para la tienda, usando el cache (access_token /
// token_expira) o pidiendo uno nuevo via client credentials grant. Persiste el
// token cacheado en la fila de la integracion (si tiene id).
export async function obtenerAccessToken(integ) {
  const ahora = Date.now();
  if (integ.access_token && integ.token_expira &&
      new Date(integ.token_expira).getTime() - MARGEN_MS > ahora) {
    return integ.access_token;
  }
  const res = await fetch(`https://${integ.shop_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: integ.api_key,
      client_secret: integ.api_secret,
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Shopify devolvio un token no-JSON'); }
  if (!json.access_token) throw new Error('Shopify no devolvio access_token (revisa Client ID/secret y que la app este instalada en la tienda)');

  const expira = new Date(ahora + (Number(json.expires_in) || 86399) * 1000).toISOString();
  integ.access_token = json.access_token;
  integ.token_expira = expira;
  if (integ.id) {
    await admin.from('integraciones_shopify')
      .update({ access_token: json.access_token, token_expira: expira })
      .eq('id', integ.id);
  }
  return json.access_token;
}

// Normaliza el dominio: acepta "tienda", "tienda.myshopify.com" o una URL.
export function normalizarDominio(input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (d && !d.includes('.')) d = `${d}.myshopify.com`;
  return d;
}

function endpoint(integracion) {
  const ver = integracion.api_version || DEFAULT_VERSION;
  return `https://${integracion.shop_domain}/admin/api/${ver}/graphql.json`;
}

// Ejecuta una query/mutation GraphQL contra la tienda. Lanza si hay errores.
export async function shopifyGraphQL(integracion, query, variables = {}) {
  const token = await obtenerAccessToken(integracion);
  const res = await fetch(endpoint(integracion), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Shopify devolvio una respuesta no-JSON'); }
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const PRODUCTS_QUERY = `
  query Productos($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        title
        handle
        descriptionHtml
        productType
        status
        onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount } }
        collections(first: 20) { nodes { title } }
        variants(first: 100) {
          nodes { title price availableForSale inventoryQuantity sku }
        }
      }
    }
  }
`;

// Trae TODOS los productos de la tienda, paginando por cursor.
export async function fetchAllProducts(integracion) {
  const productos = [];
  let cursor = null;
  // Tope de seguridad (50 paginas * 50 = 2500 productos) para no quedar en bucle.
  for (let i = 0; i < 50; i++) {
    const data = await shopifyGraphQL(integracion, PRODUCTS_QUERY, { cursor });
    const conn = data?.products;
    if (!conn) break;
    productos.push(...conn.nodes);
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return productos;
}

const PRODUCT_FIELDS = `
  id
  legacyResourceId
  title
  handle
  descriptionHtml
  productType
  status
  onlineStoreUrl
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount } }
  collections(first: 20) { nodes { title } }
  variants(first: 100) {
    nodes { title price availableForSale inventoryQuantity sku }
  }
`;

const PRODUCT_BY_ID = `
  query Producto($id: ID!) {
    node(id: $id) { ... on Product { ${PRODUCT_FIELDS} } }
  }
`;

// Trae UN producto por su id numerico (legacy), como llega en los webhooks.
// Devuelve null si ya no existe en la tienda.
export async function fetchProductByLegacyId(integracion, legacyId) {
  const gid = `gid://shopify/Product/${legacyId}`;
  const data = await shopifyGraphQL(integracion, PRODUCT_BY_ID, { id: gid });
  return data?.node || null;
}

const PRODUCTS_SEARCH = `
  query Buscar($q: String!, $n: Int!) {
    products(first: $n, query: $q) {
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

// Busca productos EN VIVO por termino (precio y stock al momento). Usa la
// sintaxis de busqueda de Shopify; devuelve hasta `limit` productos.
export async function searchProducts(integracion, termino, limit = 5) {
  const q = String(termino || '').trim();
  const data = await shopifyGraphQL(integracion, PRODUCTS_SEARCH, { q, n: Math.min(Number(limit) || 5, 20) });
  return data?.products?.nodes || [];
}

const WEBHOOK_TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];

const WEBHOOK_CREATE = `
  mutation Crear($topic: WebhookSubscriptionTopic!, $url: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $url, format: JSON }
    ) { userErrors { message } webhookSubscription { id } }
  }
`;

// Registra (idempotente-ish) los webhooks de productos apuntando a este backend.
// Identificamos la tienda por el header X-Shopify-Shop-Domain, asi que la URL
// es comun a todas las tiendas. Devuelve true si quedaron todos OK.
export async function registrarWebhooks(integracion) {
  const base = process.env.APP_PUBLIC_URL;
  if (!base) {
    console.warn('[shopify] APP_PUBLIC_URL no configurada: se omite el registro de webhooks');
    return false;
  }
  const callbackUrl = `${base.replace(/\/$/, '')}/webhooks/shopify`;
  let ok = true;
  for (const topic of WEBHOOK_TOPICS) {
    try {
      const data = await shopifyGraphQL(integracion, WEBHOOK_CREATE, { topic, url: callbackUrl });
      const errs = data?.webhookSubscriptionCreate?.userErrors || [];
      // Shopify rechaza duplicados con un userError; lo tratamos como no-fatal.
      const dup = errs.some((e) => /already|taken|exists/i.test(e.message || ''));
      if (errs.length && !dup) { ok = false; console.error('[shopify] webhook', topic, errs); }
    } catch (e) {
      ok = false;
      console.error('[shopify] webhook', topic, e.message);
    }
  }
  return ok;
}

const WEBHOOK_LIST = `
  query { webhookSubscriptions(first: 100) { nodes { id endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }
`;
const WEBHOOK_DELETE = `
  mutation Borrar($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }
`;

// Elimina los webhooks que apuntan a este backend (al desconectar la tienda).
export async function eliminarWebhooks(integracion) {
  const base = process.env.APP_PUBLIC_URL;
  if (!base) return;
  const callbackUrl = `${base.replace(/\/$/, '')}/webhooks/shopify`;
  try {
    const data = await shopifyGraphQL(integracion, WEBHOOK_LIST);
    const nodes = data?.webhookSubscriptions?.nodes || [];
    for (const n of nodes) {
      if (n.endpoint?.callbackUrl === callbackUrl) {
        await shopifyGraphQL(integracion, WEBHOOK_DELETE, { id: n.id }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[shopify] eliminarWebhooks', e.message);
  }
}
