// Setup post-schema: crea el usuario SUPER ADMIN, lo promueve y crea el bucket.
// Ejecutar DESPUES de correr db/schema.sql en Supabase.
//   node scripts/setup.js <email> <password>
// Ej: node scripts/setup.js pbezama@crecetec.com MiClaveSegura123
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Uso: node scripts/setup.js <email> <password>');
  process.exit(1);
}

async function main() {
  // 0) Verificar que el schema existe.
  const { error: tblErr } = await admin.from('perfiles').select('id').limit(1);
  if (tblErr) {
    console.error('✗ Las tablas no existen aun. Ejecuta db/schema.sql en Supabase primero.');
    console.error('  Detalle:', tblErr.message);
    process.exit(1);
  }

  // 1) Crear el usuario (o reutilizarlo si ya existe).
  let userId;
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (e1) {
    if (/already.*registered|exists/i.test(e1.message)) {
      const { data: list } = await admin.auth.admin.listUsers();
      const u = list.users.find((x) => x.email === email);
      if (!u) { console.error('✗ No se pudo localizar el usuario existente'); process.exit(1); }
      userId = u.id;
      await admin.auth.admin.updateUserById(userId, { password });
      console.log('• Usuario ya existia, contraseña actualizada.');
    } else {
      console.error('✗ Error creando usuario:', e1.message); process.exit(1);
    }
  } else {
    userId = created.user.id;
    console.log('• Usuario creado.');
  }

  // 2) Promover a super_admin (el trigger ya creo el perfil).
  const { error: e2 } = await admin.from('perfiles')
    .update({ rol: 'super_admin', client_id: null, nombre: 'Super Admin' })
    .eq('id', userId);
  if (e2) { console.error('✗ Error promoviendo a super_admin:', e2.message); process.exit(1); }
  console.log('• Perfil promovido a super_admin.');

  // 3) Crear el bucket de conocimiento.
  const { error: e3 } = await admin.storage.createBucket('conocimiento', { public: false });
  if (e3 && !/already exists/i.test(e3.message)) {
    console.warn('• Aviso bucket:', e3.message);
  } else {
    console.log('• Bucket "conocimiento" listo.');
  }

  // 4) Crear el bucket PUBLICO de iconos del chat (se muestran en webs externas).
  const { error: e4 } = await admin.storage.createBucket('widget', {
    public: true,
    fileSizeLimit: '2MB',
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'],
  });
  if (e4 && !/already exists/i.test(e4.message)) {
    console.warn('• Aviso bucket widget:', e4.message);
  } else {
    console.log('• Bucket publico "widget" listo (iconos del chat).');
  }

  console.log(`\n✓ Setup completo. Inicia sesion en el front con: ${email}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
