// Entrega WebSocket al widget via Supabase Realtime BROADCAST.
// En serverless (Vercel) no mantenemos un socket abierto: usamos el endpoint
// HTTP de broadcast de Supabase. El widget se suscribe por WS con la anon key.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Nombre de canal por conversacion.
export function canalDe(conversacionId) {
  return `widget:${conversacionId}`;
}

// Publica un evento en el canal de una conversacion.
// event: 'token' | 'done' | 'error' | 'mensaje'
export async function broadcast(conversacionId, event, payload) {
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [
          { topic: canalDe(conversacionId), event, payload: payload ?? {} },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[realtime] broadcast fallo', res.status, await res.text());
    }
  } catch (e) {
    console.error('[realtime] broadcast error', e.message);
  }
}
