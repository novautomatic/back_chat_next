// Cliente de OpenAI + helpers de embeddings.
import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
export const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

// Genera el embedding (vector 1536) de un texto.
export async function embed(text) {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.replace(/\n/g, ' ').slice(0, 8000),
  });
  return res.data[0].embedding;
}
