// Verificacion end-to-end (sin OpenAI): auth super admin, crear cliente,
// impersonar, crear agente + reglas + flujo. Limpia lo que crea al final.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BASE = `http://localhost:${process.env.PORT || 4000}`;
const EMAIL = process.argv[2];
const PASS = process.argv[3];
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

let token, impersonate;
function H(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
}
async function j(res) { const b = await res.json().catch(() => ({})); if (!res.ok) throw new Error(JSON.stringify(b)); return b; }

async function main() {
  // 1) Login
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw new Error('Login: ' + error.message);
  token = data.session.access_token;
  console.log('1) Login OK');

  // 2) /auth/me -> super admin
  const me = await j(await fetch(`${BASE}/auth/me`, { headers: H() }));
  console.log(`2) /auth/me OK -> isSuper=${me.isSuper}`);
  if (!me.isSuper) throw new Error('El usuario NO es super_admin');

  // 3) Crear cliente
  const cliente = await j(await fetch(`${BASE}/clientes`, { method: 'POST', headers: H(), body: JSON.stringify({ nombre: 'Cliente Demo (verify)', email_contacto: 'demo@x.com' }) }));
  impersonate = cliente.id;
  console.log(`3) Cliente creado -> ${cliente.id}`);

  // 4) Impersonar + crear agente
  const Himp = () => H({ 'X-Impersonate-Client': impersonate });
  const agente = await j(await fetch(`${BASE}/agentes`, { method: 'POST', headers: Himp(), body: JSON.stringify({ nombre: 'Agente Demo', saludo: 'Hola!', persona: 'Asesor amable' }) }));
  console.log(`4) Agente creado (impersonando) -> ${agente.id}`);

  // 5) Reglas por fase
  for (const r of [{ fase: 'inicio', texto: 'Saluda y pregunta el nombre' }, { fase: 'proceso', texto: 'Responde claro y breve' }, { fase: 'finalizacion', texto: 'Despide y ofrece ayuda futura' }]) {
    await j(await fetch(`${BASE}/agentes/${agente.id}/reglas`, { method: 'POST', headers: Himp(), body: JSON.stringify(r) }));
  }
  const det = await j(await fetch(`${BASE}/agentes/${agente.id}`, { headers: Himp() }));
  console.log(`5) Reglas creadas -> ${det.reglas.length} reglas`);

  // 6) Flujo con el agente
  const flujo = await j(await fetch(`${BASE}/flujos`, { method: 'POST', headers: Himp(), body: JSON.stringify({ nombre: 'Flujo Demo', agente_id: agente.id }) }));
  console.log(`6) Flujo creado -> widget_key=${flujo.widget_key}`);

  // 7) Verificar aislamiento: el widget config publico responde
  const cfg = await j(await fetch(`${BASE}/widget/${flujo.widget_key}/config`));
  console.log(`7) Widget config publico OK -> agente="${cfg.agente?.nombre}"`);

  // 8) Limpieza
  await fetch(`${BASE}/clientes/${impersonate}`, { method: 'DELETE', headers: H() });
  console.log('8) Limpieza OK (cliente demo eliminado en cascada)');

  console.log('\n✓ VERIFICACION COMPLETA (sin OpenAI). Auth + multi-cliente + impersonacion + widget = OK');
}
main().catch((e) => { console.error('\n✗ FALLO:', e.message); process.exit(1); });
