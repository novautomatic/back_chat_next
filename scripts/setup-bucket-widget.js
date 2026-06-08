// Crea el bucket PUBLICO "widget" donde viven los iconos del chat (logo de la
// burbuja). Es publico porque el icono se muestra en la web del cliente.
//   node scripts/setup-bucket-widget.js
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

async function main() {
  const { error } = await admin.storage.createBucket('widget', {
    public: true,
    fileSizeLimit: '2MB',
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'],
  });
  if (error && !/already exists/i.test(error.message)) {
    console.error('✗ Error creando bucket:', error.message);
    process.exit(1);
  }
  console.log('✓ Bucket publico "widget" listo (iconos del chat).');
}

main().catch((e) => { console.error(e); process.exit(1); });
