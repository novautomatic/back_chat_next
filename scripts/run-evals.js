// Corre el banco de evals de un agente contra el backend en vivo y evalua cada
// respuesta con un "LLM-as-judge". Guarda los resultados en eval_corridas.
//
// Uso:  node scripts/run-evals.js <widget_key>
// Requiere: backend corriendo en :4000 con OPENAI_API_KEY, y casos en eval_casos
// para el agente del flujo de ese widget_key.
import 'dotenv/config';
import { admin } from '../src/lib/supabase.js';
import { openai } from '../src/lib/openai.js';

const BASE = `http://localhost:${process.env.PORT || 4000}`;
const WIDGET = process.argv[2];

async function preguntar(texto) {
  const s = await (await fetch(`${BASE}/widget/${WIDGET}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitante: {}, origen: { url: 'eval' } }),
  })).json();
  if (!s.conversacion_id) throw new Error('No se creo conversacion: ' + JSON.stringify(s));
  await fetch(`${BASE}/widget/${WIDGET}/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversacion_id: s.conversacion_id, texto }),
  });
  const { data: msgs } = await admin.from('mensajes')
    .select('rol, contenido').eq('conversacion_id', s.conversacion_id).order('created_at');
  return (msgs || []).filter((m) => m.rol === 'assistant').pop()?.contenido || '';
}

async function juzgar(caso, respuesta) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Eres un evaluador estricto. Dada la PREGUNTA, la RESPUESTA del agente y el CRITERIO, decide si la respuesta cumple el criterio. Responde SOLO JSON: {"aprobado":true|false,"puntaje":0.0-1.0,"notas":"breve"}.' },
      { role: 'user', content:
        `PREGUNTA:\n${caso.entrada}\n\nCRITERIO:\n${caso.criterio}` +
        (caso.referencia ? `\n\nRESPUESTA IDEAL (referencia):\n${caso.referencia}` : '') +
        `\n\nRESPUESTA DEL AGENTE:\n${respuesta}` },
    ],
  });
  try { return JSON.parse(completion.choices?.[0]?.message?.content || '{}'); }
  catch { return { aprobado: false, puntaje: 0, notas: 'juez devolvio no-JSON' }; }
}

async function main() {
  if (!WIDGET) { console.error('Uso: node scripts/run-evals.js <widget_key>'); process.exit(1); }

  const { data: flujo } = await admin.from('flujos')
    .select('agente_id, client_id').eq('widget_key', WIDGET).single();
  if (!flujo?.agente_id) throw new Error('El widget_key no tiene un agente asociado.');

  const { data: casos } = await admin.from('eval_casos')
    .select('*').eq('agente_id', flujo.agente_id).eq('activo', true).order('created_at');
  if (!casos?.length) { console.log('No hay casos de eval para este agente.'); return; }

  console.log(`Corriendo ${casos.length} caso(s)…\n`);
  let ok = 0;
  for (const caso of casos) {
    const respuesta = await preguntar(caso.entrada);
    const veredicto = await juzgar(caso, respuesta);
    await admin.from('eval_corridas').insert({
      client_id: flujo.client_id,
      agente_id: flujo.agente_id,
      caso_id: caso.id,
      respuesta,
      aprobado: !!veredicto.aprobado,
      puntaje: Number(veredicto.puntaje) || 0,
      juez_notas: veredicto.notas || null,
    });
    if (veredicto.aprobado) ok += 1;
    console.log(`${veredicto.aprobado ? '✓' : '✗'} [${(Number(veredicto.puntaje) || 0).toFixed(2)}] ${caso.entrada.slice(0, 60)}`);
    if (veredicto.notas) console.log(`   ↳ ${veredicto.notas}`);
  }
  console.log(`\nResultado: ${ok}/${casos.length} aprobados (${Math.round((ok / casos.length) * 100)}%).`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
