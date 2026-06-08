// Salvaguardas finales que se aplican a la salida de CUALQUIER motor (clasico o
// agent-loop) antes de mostrarla al usuario. Es la unica fuente de verdad de:
//   1) Anti-enlaces-inventados: solo pasan productos cuyo enlace existe de verdad
//      en el conocimiento del agente (y se reconstruye la URL canonica).
//   2) Red de seguridad anti-WhatsApp (decision de producto del cliente).
//   3) Limpieza de URLs sueltas en el texto (los enlaces van en `productos`).
import { admin } from '../lib/supabase.js';

function handleDeUrl(url) {
  return String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

// Devuelve solo los productos cuyo enlace existe de verdad en el conocimiento
// del agente (compara el handle del url contra el texto del conocimiento).
async function soloProductosConEnlaceReal(agenteId, productos) {
  if (!productos.length) return [];
  const { data: docs } = await admin.from('documentos').select('contenido').eq('agente_id', agenteId);
  const conocimiento = (docs || []).map((d) => (d.contenido || '')).join(' ');
  // Handles validos = tokens "algo-algo(-algo...)" presentes en el conocimiento.
  // Coincidencia EXACTA: evita que "lana-jazmine" pase por ser parte de "lana-jazmine-te-con-leche".
  const validos = new Set((conocimiento.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || []));
  // Base real de la URL de producto, derivada del conocimiento (ej: https://dyetales.cl/products/).
  const base = (conocimiento.match(/https?:\/\/\S+?\/products\//i) || [null])[0];
  return productos
    .map((p) => {
      if (!p) return null;
      const handle = handleDeUrl(p.url);
      if (!validos.has(handle)) return null;
      // Reconstruye la URL canonica para que NUNCA falte /products/ ni quede mal armada.
      return base ? { ...p, url: base + handle } : p;
    })
    .filter(Boolean);
}

// Aplica las salvaguardas + el tope de productos (configurable por agente).
// Recibe y devuelve { respuesta, productos, acciones }. maxProductos: tope de
// productos a mostrar (0 o negativo = sin tope).
export async function postprocesar(agenteId, { respuesta, productos = [], acciones = [] } = {}, maxProductos = 0) {
  // 1) Anti-enlaces-inventados (el conocimiento es la unica fuente de verdad).
  let prods = await soloProductosConEnlaceReal(agenteId, Array.isArray(productos) ? productos : []);
  // 2) Tope configurable de productos por respuesta (evita "los manda todos de golpe").
  if (maxProductos > 0 && prods.length > maxProductos) prods = prods.slice(0, maxProductos);
  // 3) Nunca dejar pasar acciones/botones de WhatsApp.
  const accs = (Array.isArray(acciones) ? acciones : [])
    .filter((a) => a && !/wa\.me|whatsapp|56973851002/i.test(`${a.url || ''} ${a.texto || ''}`));
  // 4) Limpiar URLs que el modelo haya metido dentro del texto.
  const texto = String(respuesta ?? '').replace(/\s*https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
  return { respuesta: texto, productos: prods, acciones: accs };
}
