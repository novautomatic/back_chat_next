// Recuperacion RAG: embebe la consulta y busca los fragmentos mas similares.
// Calcula la similitud en memoria (exacto) en vez de depender del indice IVFFlat,
// que con pocos datos por cliente devuelve resultados vacios. Para catalogos
// pequeños/medianos (lo habitual por cliente) esto es instantaneo y 100% preciso.
import { admin } from '../lib/supabase.js';
import { embed } from '../lib/openai.js';

function aVector(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') { try { return JSON.parse(emb); } catch { return null; } }
  return null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den ? dot / den : 0;
}

export async function recuperarContexto(agenteId, consulta, k = 8) {
  try {
    const q = await embed(consulta);
    const { data, error } = await admin
      .from('fragmentos')
      .select('contenido, embedding')
      .eq('agente_id', agenteId);
    if (error) { console.error('[rag]', error.message); return []; }
    if (!data || !data.length) return [];

    const rank = data
      .map((f) => {
        const v = aVector(f.embedding);
        return v ? { contenido: f.contenido, similitud: cosine(q, v) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.similitud - a.similitud)
      .slice(0, k);

    return rank;
  } catch (e) {
    console.error('[rag]', e.message);
    return [];
  }
}
