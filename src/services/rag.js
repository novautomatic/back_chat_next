// Recuperacion RAG: embebe la consulta y busca fragmentos similares del agente.
import { admin } from '../lib/supabase.js';
import { embed } from '../lib/openai.js';

export async function recuperarContexto(agenteId, consulta, k = 5) {
  try {
    const queryEmbedding = await embed(consulta);
    const { data, error } = await admin.rpc('match_fragmentos', {
      p_agente_id: agenteId,
      p_query_embedding: queryEmbedding,
      p_match_count: k,
    });
    if (error) {
      console.error('[rag] match_fragmentos', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('[rag]', e.message);
    return [];
  }
}
