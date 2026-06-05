// Clientes de Supabase para el backend.
// - admin: usa service_role (acceso total, ignora RLS). NUNCA exponer al navegador.
// - anonClient(token): valida el JWT de un usuario del dashboard.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url) console.warn('[supabase] Falta SUPABASE_URL en .env');

// Cliente privilegiado (service_role). Toda la lectura/escritura del backend pasa por aqui.
export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Verifica un token de usuario y devuelve su user de auth.
export async function getUserFromToken(token) {
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user;
}
