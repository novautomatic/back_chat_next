// Tool: consultar_producto
// Consulta productos EN VIVO en la tienda Shopify conectada al agente: precio,
// disponibilidad y stock al momento (no el snapshot del RAG). Si no hay tienda
// conectada, lo informa para que el agente use buscar_conocimiento en su lugar.
import { admin } from '../../lib/supabase.js';
import { searchProducts } from '../../lib/shopify.js';

export const key = 'consultar_producto';

export const definicion = {
  type: 'function',
  function: {
    name: 'consultar_producto',
    description:
      'Consulta productos EN VIVO en la tienda (precio, disponibilidad y stock actual). Usala cuando el cliente pregunte por disponibilidad/stock o por el precio vigente de un producto concreto. Devuelve el enlace oficial de cada producto.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Nombre o termino del producto a buscar (ej: "lana merino", "polera negra talla M").' },
      },
      required: ['consulta'],
    },
  },
};

function fmtMonto(amount) {
  const n = Math.round(Number(amount || 0));
  return n.toLocaleString('es-CL');
}

function precioDe(p) {
  const r = p.priceRangeV2;
  if (!r?.minVariantPrice?.amount) return null;
  const cur = r.minVariantPrice.currencyCode || '';
  const simbolo = cur === 'CLP' ? '$' : `${cur} `;
  const min = r.minVariantPrice.amount, max = r.maxVariantPrice?.amount;
  return (max != null && Number(max) !== Number(min))
    ? `${simbolo}${fmtMonto(min)} a ${simbolo}${fmtMonto(max)}`
    : `${simbolo}${fmtMonto(min)}`;
}

// ctx = { clientId, agenteId, conversacionId }
export async function handler(args, ctx) {
  const { data: integ } = await admin
    .from('integraciones_shopify').select('*').eq('agente_id', ctx.agenteId).maybeSingle();
  if (!integ) {
    return { nota: 'No hay tienda conectada a este agente. Usa buscar_conocimiento para responder con la informacion disponible.' };
  }

  let productos;
  try {
    productos = await searchProducts(integ, args?.consulta || '', 5);
  } catch (e) {
    return { error: `No se pudo consultar la tienda: ${e.message}` };
  }
  if (!productos.length) return { resultados: [], nota: 'No se encontraron productos para esa consulta.' };

  const resultados = productos.map((p) => {
    const variantes = (p.variants?.nodes || []).map((v) => ({
      titulo: v.title || 'Único',
      precio: v.price != null ? `$${fmtMonto(v.price)}` : null,
      disponible: !!v.availableForSale,
      stock: typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : null,
      sku: v.sku || null,
    }));
    const agotado = variantes.length > 0 && variantes.every((v) => !v.disponible);
    return {
      nombre: p.title,
      precio: precioDe(p),
      disponible: !agotado,
      url: `https://${integ.shop_domain}/products/${p.handle}`,
      variantes,
    };
  });
  return { resultados };
}
