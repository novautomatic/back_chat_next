// Prueba el chat real del widget contra el backend en :4000.
// session -> mensaje -> lee el ultimo mensaje del asistente guardado en la BD.
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

const BASE = `http://localhost:${process.env.PORT || 4000}`;
const WIDGET = 'd64247c4-6ef9-4032-b029-7c2af77df7ab';
const PREGUNTA = process.argv[2] || '¿Qué lana me recomiendas para tejer calcetines?';

async function main() {
  // 1) sesion
  const s = await (await fetch(`${BASE}/widget/${WIDGET}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitante: {}, origen: { url: 'test' } }),
  })).json();
  if (!s.conversacion_id) throw new Error('No se creo conversacion: ' + JSON.stringify(s));
  console.log('Conversacion:', s.conversacion_id);

  // 2) mensaje (espera a que termine la orquestacion)
  console.log('Pregunta:', PREGUNTA);
  await fetch(`${BASE}/widget/${WIDGET}/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversacion_id: s.conversacion_id, texto: PREGUNTA }),
  });

  // 3) leer respuesta guardada
  const { data: msgs } = await admin.from('mensajes')
    .select('rol, contenido').eq('conversacion_id', s.conversacion_id).order('created_at');
  const asistente = (msgs || []).filter((m) => m.rol === 'assistant').pop();
  if (asistente) {
    console.log('\n=== RESPUESTA DE SOFÍA ===\n' + asistente.contenido + '\n');
    console.log('✓ El chat funciona.');
  } else {
    console.log('\n✗ No se guardo respuesta del asistente -> el backend en :4000 probablemente NO tiene la OPENAI_API_KEY (hay que reiniciarlo).');
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
