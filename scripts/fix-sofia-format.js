// Alinea los datos del agente Sofía con el nuevo formato JSON:
// los enlaces van en "productos", no en el texto.
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';

const AGENTE_ID = '51d2d1fe-e8db-4388-9365-95cecb571517';

async function main() {
  // 1) Ajustar la línea de FORMATO dentro de instrucciones_extra.
  const { data: ag } = await admin.from('agentes').select('instrucciones_extra').eq('id', AGENTE_ID).single();
  if (ag?.instrucciones_extra) {
    const ie = ag.instrucciones_extra.replace(
      'Al recomendar un producto incluye: nombre de la línea + color, precio en CLP y el enlace https://dyetales.cl/products/{handle}.',
      'Cuando recomiendes lanas, ponlas en la lista "productos" (nombre+color, precio y enlace); no escribas enlaces ni markdown dentro del texto.'
    );
    await admin.from('agentes').update({ instrucciones_extra: ie }).eq('id', AGENTE_ID);
    console.log('instrucciones_extra actualizada ✓');
  }

  // 2) Ajustar la regla de proceso que pedía el enlace en el texto.
  const { data: reglas } = await admin.from('agente_reglas')
    .select('id, texto').eq('agente_id', AGENTE_ID).eq('fase', 'proceso');
  const objetivo = (reglas || []).find((r) => r.texto.startsWith('Entrega SIEMPRE el precio'));
  if (objetivo) {
    await admin.from('agente_reglas').update({
      texto: 'Cuando recomiendes una lana, inclúyela en la lista de productos con su precio en CLP y su enlace; no escribas el enlace dentro del texto.',
    }).eq('id', objetivo.id);
    console.log('Regla de proceso actualizada ✓');
  }

  console.log('Listo.');
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
