// READ-ONLY: inspecciona el estado real de la base para entender el esquema.
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

const AGENTE_ID = '957a6361-c27b-4f6c-b53f-2bb5153cf94c';
const ID_MARCA = '17841472714306622';

async function existeTabla(t) {
  const { error } = await admin.from(t).select('*').limit(1);
  if (!error) return true;
  if (/does not exist|find the table|schema cache/i.test(error.message)) return false;
  return `?? ${error.message}`;
}

async function main() {
  const tablas = ['clientes', 'perfiles', 'agentes', 'agente_reglas', 'agente_ejemplos',
    'flujos', 'documentos', 'fragmentos', 'conversaciones', 'mensajes',
    'conocimiento_marca', 'agente_conocimiento', 'marcas'];

  console.log('=== Existencia de tablas ===');
  for (const t of tablas) console.log(`${(await existeTabla(t)) === true ? '✓' : '✗'}  ${t}`);

  console.log('\n=== Columnas reales de "agentes" (primera fila) ===');
  const { data: ag } = await admin.from('agentes').select('*').limit(1);
  if (ag && ag[0]) console.log(Object.keys(ag[0]).join(', '));
  else console.log('(sin filas)');

  console.log('\n=== Todos los agentes existentes ===');
  const { data: agentes } = await admin.from('agentes').select('id, nombre').limit(50);
  console.log(agentes || []);

  console.log(`\n=== ¿Existe el agente ${AGENTE_ID}? ===`);
  const { data: target } = await admin.from('agentes').select('*').eq('id', AGENTE_ID).maybeSingle();
  console.log(target ? JSON.stringify(target, null, 2) : 'NO existe en esta base');

  console.log('\n=== Columnas reales de "flujos" (primera fila) ===');
  const { data: fl } = await admin.from('flujos').select('*').limit(1);
  if (fl && fl[0]) console.log(Object.keys(fl[0]).join(', '));
  else console.log('(sin filas)');

  console.log('\n=== Flujos existentes ===');
  const { data: flujos } = await admin.from('flujos').select('id, nombre, agente_id, widget_key').limit(50);
  console.log(flujos || []);
}
main().catch((e) => { console.error(e); process.exit(1); });
