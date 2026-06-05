// Ingesta de documentos: obtiene el texto (archivo Storage / URL / texto crudo),
// lo trocea, genera embeddings y los guarda en fragmentos.
import { admin } from '../lib/supabase.js';
import { embed } from '../lib/openai.js';

// Trocea texto en chunks de ~chars con solape. Chunks grandes para que cada
// documento corto (ej: una linea de producto con todos sus colores) quede entero.
function trocear(texto, chars = 4000, solape = 200) {
  const limpio = (texto || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = [];
  let i = 0;
  while (i < limpio.length) {
    chunks.push(limpio.slice(i, i + chars));
    i += chars - solape;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

// Extrae texto plano de una pagina web (sin librerias: regex basico).
function htmlAtexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function obtenerTexto(doc) {
  if (doc.tipo === 'texto') return doc.contenido || '';
  // Shopify: el contenido ya viene formateado por el sync/webhook.
  if (doc.tipo === 'shopify') return doc.contenido || '';
  if (doc.tipo === 'url') {
    const res = await fetch(doc.fuente, { headers: { 'User-Agent': 'AgenteBot/1.0' } });
    if (!res.ok) throw new Error(`URL respondio ${res.status}`);
    const html = await res.text();
    return htmlAtexto(html);
  }
  if (doc.tipo === 'archivo') {
    // Descarga el archivo del bucket "conocimiento". Soporta texto plano / markdown.
    const { data, error } = await admin.storage.from('conocimiento').download(doc.fuente);
    if (error) throw new Error(`Storage: ${error.message}`);
    return await data.text();
  }
  return '';
}

// Procesa un documento completo. Pensado para ejecutarse en segundo plano.
export async function procesarDocumento(documentoId) {
  const { data: doc } = await admin.from('documentos').select('*').eq('id', documentoId).single();
  if (!doc) return;

  await admin.from('documentos').update({ estado: 'procesando', error_msg: null }).eq('id', documentoId);

  try {
    const texto = await obtenerTexto(doc);
    const chunks = trocear(texto);
    if (!chunks.length) throw new Error('No se extrajo texto util del documento');

    // Limpia fragmentos previos de este documento (re-ingesta).
    await admin.from('fragmentos').delete().eq('documento_id', documentoId);

    // Embeddings + insercion (en serie para no saturar rate limits).
    for (let i = 0; i < chunks.length; i++) {
      const vector = await embed(chunks[i]);
      await admin.from('fragmentos').insert({
        client_id: doc.client_id,
        agente_id: doc.agente_id,
        documento_id: doc.id,
        contenido: chunks[i],
        embedding: vector,
        orden: i,
      });
    }

    await admin.from('documentos').update({ estado: 'listo' }).eq('id', documentoId);
  } catch (e) {
    console.error('[ingest]', e.message);
    await admin.from('documentos')
      .update({ estado: 'error', error_msg: e.message })
      .eq('id', documentoId);
  }
}
