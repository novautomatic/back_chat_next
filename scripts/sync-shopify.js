// Sincroniza el catalogo de Shopify de un agente hacia documentos (backfill).
// Util para probar sin pasar por el panel. La integracion (tienda + token) debe
// existir ya en la tabla integraciones_shopify.
// Uso: node scripts/sync-shopify.js <agente_id>
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';
import { sincronizarTienda } from '../src/services/shopifySync.js';

const agenteId = process.argv[2];

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error('✗ Falta OPENAI_API_KEY en .env'); process.exit(1); }
  if (!agenteId) { console.error('Uso: node scripts/sync-shopify.js <agente_id>'); process.exit(1); }

  const { data: integ, error } = await admin
    .from('integraciones_shopify').select('id, shop_domain').eq('agente_id', agenteId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!integ) { console.error('✗ No hay integracion Shopify para ese agente. Conectala primero desde el panel.'); process.exit(1); }

  console.log(`Sincronizando ${integ.shop_domain}…`);
  const n = await sincronizarTienda(integ.id);
  console.log(`\n✓ ${n} productos sincronizados e indexados.`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
