// Limpia del Conocimiento los documentos de PRODUCTO cargados a mano, dejando que
// los productos vengan solo de Shopify (tipo='shopify'). CONSERVA la info que no
// es producto (envíos, pagos, FAQ, contacto, guías, etc.).
//
// Modo seguro: por defecto SOLO lista (dry-run). Para borrar de verdad: --confirm
// Uso: node scripts/limpiar-catalogo-manual.js [agente_id] [--confirm]
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
let agenteId = args.find((a) => !a.startsWith('--')) || null;

// Heurística: ¿este documento manual es un PRODUCTO? (se borraría)
function esProducto(titulo) {
  const t = (titulo || '').toLowerCase();
  return (
    /^lana\b/.test(t) ||                 // "Lana Aurora ...", etc.
    t.includes('accesorios') ||          // "Accesorios, kits y suscripción"
    t.includes('cuidado de tejidos') ||  // shampoo / acondicionador
    t.includes('kit ') || t.includes('kits')
  );
}

async function main() {
  // Si no dieron agente_id, usar el de la (única) integración Shopify conectada.
  if (!agenteId) {
    const { data: integs } = await admin.from('integraciones_shopify').select('agente_id');
    if (integs?.length === 1) agenteId = integs[0].agente_id;
    else { console.error('Indica el agente_id: node scripts/limpiar-catalogo-manual.js <agente_id> [--confirm]'); process.exit(1); }
  }

  // Documentos manuales (todo lo que NO viene de Shopify).
  const { data: docs, error } = await admin
    .from('documentos')
    .select('id, tipo, titulo')
    .eq('agente_id', agenteId)
    .neq('tipo', 'shopify')
    .order('titulo');
  if (error) throw new Error(error.message);

  const aBorrar = docs.filter((d) => esProducto(d.titulo));
  const aConservar = docs.filter((d) => !esProducto(d.titulo));

  console.log(`\nAgente: ${agenteId}`);
  console.log(`Documentos manuales: ${docs.length}\n`);

  console.log(`🗑️  SE BORRARÍAN (productos manuales) — ${aBorrar.length}:`);
  aBorrar.forEach((d) => console.log(`   - [${d.tipo}] ${d.titulo}`));

  console.log(`\n✅ SE CONSERVAN (info no-producto) — ${aConservar.length}:`);
  aConservar.forEach((d) => console.log(`   - [${d.tipo}] ${d.titulo}`));

  if (!confirm) {
    console.log('\n(DRY-RUN) No se borró nada. Para borrar de verdad: agrega --confirm');
    return;
  }

  if (!aBorrar.length) { console.log('\nNada que borrar.'); return; }

  const ids = aBorrar.map((d) => d.id);
  const { error: delErr } = await admin.from('documentos').delete().in('id', ids);
  if (delErr) throw new Error(delErr.message);
  console.log(`\n✓ Borrados ${ids.length} documentos de producto manuales (sus fragmentos caen por cascade).`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
