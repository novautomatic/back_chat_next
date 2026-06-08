// Sincroniza productos de Shopify hacia la tabla `documentos` (fuente del RAG).
// Cada producto se guarda como un documento tipo='shopify', fuente='shopify:{id}',
// con el contenido ya formateado a texto; luego procesarDocumento() lo vectoriza.
import { admin } from '../lib/supabase.js';
import { procesarDocumento } from './ingest.js';
import { fetchAllProducts } from '../lib/shopify.js';

function htmlAtexto(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// "19900.00" -> "19.900" (separador de miles, sin decimales si son .00).
function fmtMonto(amount) {
  const n = Math.round(Number(amount || 0));
  return n.toLocaleString('es-CL');
}

function rangoPrecio(product) {
  const r = product.priceRangeV2;
  if (!r) return '';
  const cur = r.minVariantPrice?.currencyCode || '';
  const min = r.minVariantPrice?.amount;
  const max = r.maxVariantPrice?.amount;
  if (min == null) return '';
  const simbolo = cur === 'CLP' ? '$' : `${cur} `;
  if (max != null && Number(max) !== Number(min)) return `${simbolo}${fmtMonto(min)} a ${simbolo}${fmtMonto(max)}`;
  return `${simbolo}${fmtMonto(min)}`;
}

// Formatea un producto (forma GraphQL) a texto para el RAG. INCLUYE el handle y
// la URL del producto: imprescindible para el filtro anti-invencion del chat.
export function productoAContenido(product, shopDomain) {
  const url = `https://${shopDomain}/products/${product.handle}`;
  const precio = rangoPrecio(product);
  const desc = htmlAtexto(product.descriptionHtml);
  const colecciones = (product.collections?.nodes || []).map((c) => c.title).filter(Boolean);
  const variantes = (product.variants?.nodes || []).map((v) => {
    const disp = v.availableForSale ? 'disponible' : 'agotado';
    return `${v.title || 'Único'} — $${fmtMonto(v.price)} (${disp})`;
  });
  const agotado = (product.variants?.nodes || []).every((v) => !v.availableForSale);

  const partes = [];
  partes.push(`${product.title}${precio ? ` — ${precio}` : ''}.`);
  if (product.productType) partes.push(`Tipo: ${product.productType}.`);
  if (desc) partes.push(desc);
  if (colecciones.length) partes.push(`Colecciones: ${colecciones.join(', ')}.`);
  partes.push(`Estado: ${agotado ? 'agotado' : 'disponible'}.`);
  partes.push(`Enlace del producto: ${url}`);
  if (variantes.length) partes.push(`Variantes: ${variantes.join('; ')}.`);
  return partes.join(' ');
}

function fuenteDe(product) {
  return `shopify:${product.legacyResourceId || product.id}`;
}

// Inserta o actualiza el documento de un producto y lo re-vectoriza.
export async function upsertProductoDoc(integracion, product) {
  const fuente = fuenteDe(product);
  const contenido = productoAContenido(product, integracion.shop_domain);
  const fila = {
    client_id: integracion.client_id,
    agente_id: integracion.agente_id,
    tipo: 'shopify',
    titulo: product.title,
    fuente,
    contenido,
    estado: 'pendiente',
    error_msg: null,
  };

  const { data: existente } = await admin
    .from('documentos')
    .select('id, bloqueado')
    .eq('agente_id', integracion.agente_id)
    .eq('fuente', fuente)
    .maybeSingle();

  // Editado a mano: no lo sobreescribimos con los datos de Shopify.
  if (existente?.bloqueado) return existente.id;

  let docId;
  if (existente) {
    await admin.from('documentos').update(fila).eq('id', existente.id);
    docId = existente.id;
  } else {
    const { data, error } = await admin.from('documentos').insert(fila).select('id').single();
    if (error) throw new Error(error.message);
    docId = data.id;
  }
  await procesarDocumento(docId);
  return docId;
}

// Borra el documento de un producto (sus fragmentos caen por cascade).
export async function eliminarProductoDoc(integracion, legacyId) {
  await admin
    .from('documentos')
    .delete()
    .eq('agente_id', integracion.agente_id)
    .eq('fuente', `shopify:${legacyId}`);
}

// Backfill / re-sincronizacion completa: trae TODO el catalogo, reemplaza los
// documentos tipo='shopify' del agente y los vectoriza. Devuelve el conteo.
export async function sincronizarTienda(integracionId) {
  const { data: integ } = await admin
    .from('integraciones_shopify').select('*').eq('id', integracionId).single();
  if (!integ) throw new Error('Integracion no encontrada');

  await admin.from('integraciones_shopify')
    .update({ estado: 'sincronizando', error_msg: null }).eq('id', integracionId);

  try {
    const productos = await fetchAllProducts(integ);

    // Productos editados a mano (bloqueado): NO se borran ni se reemplazan.
    const { data: bloqueados } = await admin.from('documentos')
      .select('fuente').eq('agente_id', integ.agente_id).eq('tipo', 'shopify').eq('bloqueado', true);
    const fuentesBloqueadas = new Set((bloqueados || []).map((d) => d.fuente));

    // Reemplazo limpio de los productos de Shopify NO bloqueados.
    await admin.from('documentos').delete()
      .eq('agente_id', integ.agente_id).eq('tipo', 'shopify').neq('bloqueado', true);

    const nuevos = productos.filter((p) => !fuentesBloqueadas.has(fuenteDe(p)));
    if (nuevos.length) {
      const filas = nuevos.map((p) => ({
        client_id: integ.client_id,
        agente_id: integ.agente_id,
        tipo: 'shopify',
        titulo: p.title,
        fuente: fuenteDe(p),
        contenido: productoAContenido(p, integ.shop_domain),
        estado: 'pendiente',
      }));
      const { data: insertados, error } = await admin
        .from('documentos').insert(filas).select('id');
      if (error) throw new Error(error.message);
      for (const d of insertados) await procesarDocumento(d.id);
    }

    await admin.from('integraciones_shopify').update({
      estado: 'conectado',
      ultima_sync: new Date().toISOString(),
      productos_sync: productos.length,
      error_msg: null,
    }).eq('id', integracionId);

    return productos.length;
  } catch (e) {
    console.error('[shopifySync]', e.message);
    await admin.from('integraciones_shopify')
      .update({ estado: 'error', error_msg: e.message }).eq('id', integracionId);
    throw e;
  }
}
