// Indexa (chunk + embeddings) todos los documentos 'pendiente'/'error'.
// Requiere OPENAI_API_KEY en .env. Uso opcional: node scripts/ingest-pendientes.js <agente_id>
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';
import { procesarDocumento } from '../src/services/ingest.js';

const agenteId = process.argv[2] || null;

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error('✗ Falta OPENAI_API_KEY en .env'); process.exit(1); }

  let q = admin.from('documentos').select('id, titulo, estado').in('estado', ['pendiente', 'error']);
  if (agenteId) q = q.eq('agente_id', agenteId);
  const { data: docs, error } = await q;
  if (error) throw new Error(error.message);
  if (!docs.length) { console.log('No hay documentos pendientes.'); return; }

  console.log(`Indexando ${docs.length} documentos…`);
  for (const d of docs) {
    process.stdout.write(`  • ${d.titulo} … `);
    await procesarDocumento(d.id);
    const { data: upd } = await admin.from('documentos').select('estado, error_msg').eq('id', d.id).single();
    console.log(upd.estado === 'listo' ? 'OK ✓' : `${upd.estado} (${upd.error_msg || ''})`);
  }
  console.log('\n✓ Indexación terminada.');
}
main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
