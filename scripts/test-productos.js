// Verifica el payload COMPLETO que recibe el widget por Realtime (texto + productos + acciones).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE = `http://localhost:${process.env.PORT || 4000}`;
const WIDGET = 'd64247c4-6ef9-4032-b029-7c2af77df7ab';
const PREGUNTA = process.argv[2] || '¿Qué lana me recomiendas para calcetines y para un chal?';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  const s = await (await fetch(`${BASE}/widget/${WIDGET}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  })).json();
  console.log('Conversacion:', s.conversacion_id, '\nPregunta:', PREGUNTA, '\n');

  const done = new Promise((resolve) => {
    sb.channel(s.canal_realtime, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'done' }, ({ payload }) => resolve(payload))
      .on('broadcast', { event: 'error' }, ({ payload }) => resolve({ error: payload }))
      .subscribe();
  });

  // pequeña espera para asegurar la suscripcion antes de enviar
  await new Promise((r) => setTimeout(r, 1200));
  await fetch(`${BASE}/widget/${WIDGET}/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversacion_id: s.conversacion_id, texto: PREGUNTA }),
  });

  const payload = await Promise.race([done, new Promise((r) => setTimeout(() => r({ timeout: true }), 30000))]);
  console.log('=== PAYLOAD RECIBIDO POR EL WIDGET ===');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
