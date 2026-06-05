// Middleware de autenticacion del DASHBOARD.
// Verifica el JWT de Supabase, carga el perfil y resuelve:
//   req.user            -> { id, rol, client_id, nombre, email }
//   req.isSuper         -> boolean
//   req.effectiveClientId -> client_id efectivo (con impersonacion del super admin)
import { admin, getUserFromToken } from '../lib/supabase.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta token' });

    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Token invalido' });

    const { data: perfil } = await admin
      .from('perfiles')
      .select('id, rol, client_id, nombre, email')
      .eq('id', user.id)
      .single();

    if (!perfil) return res.status(403).json({ error: 'Perfil no encontrado' });

    req.user = perfil;
    req.isSuper = perfil.rol === 'super_admin';

    // Impersonacion: solo el super admin puede actuar como un cliente.
    const impersonate = req.headers['x-impersonate-client'];
    if (req.isSuper && impersonate) {
      req.effectiveClientId = impersonate;
    } else {
      req.effectiveClientId = perfil.client_id;
    }
    next();
  } catch (e) {
    console.error('[auth]', e);
    res.status(500).json({ error: 'Error de autenticacion' });
  }
}

// Exige rol super_admin.
export function requireSuper(req, res, next) {
  if (!req.isSuper) return res.status(403).json({ error: 'Solo super admin' });
  next();
}

// Exige un client_id efectivo (un cliente_admin o un super admin impersonando).
export function requireClient(req, res, next) {
  if (!req.effectiveClientId) {
    return res.status(400).json({
      error: 'Sin cliente activo. El super admin debe impersonar un cliente (header X-Impersonate-Client).',
    });
  }
  next();
}
