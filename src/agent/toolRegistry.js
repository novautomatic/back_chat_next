// Registro de herramientas del agent-loop.
//
// Hay dos clases de tools:
//  - 'sistema': su comportamiento vive en código (mapa REGISTRO key->modulo).
//  - 'webhook': las crea el super admin desde el panel (sin código); se ejecutan
//    con el ejecutor genérico (webhookRunner) usando las plantillas de la fila.
//
// El catálogo, las variables, la marca y los permisos viven en la tabla `tools`.
// Qué tools usa cada agente se decide en `agente_tools`. Los permisos (plan del
// cliente / whitelist) se aplican aquí al construir los esquemas.
import { admin } from '../lib/supabase.js';
import { ejecutarWebhook } from './webhookRunner.js';
import * as buscarConocimiento from './tools/buscar_conocimiento.js';
import * as responderAlUsuario from './tools/responder_al_usuario.js';
import * as consultarProducto from './tools/consultar_producto.js';
import * as crearLead from './tools/crear_lead.js';
import * as escalarHumano from './tools/escalar_humano.js';
import * as agendar from './tools/agendar.js';
import * as recordar from './tools/recordar.js';
import * as delegarA from './tools/delegar_a.js';

export const TOOL_TERMINAL = 'responder_al_usuario';
export const TOOL_DELEGAR = 'delegar_a';

const REGISTRO = {
  [buscarConocimiento.key]: buscarConocimiento,
  [responderAlUsuario.key]: responderAlUsuario,
  [consultarProducto.key]: consultarProducto,
  [crearLead.key]: crearLead,
  [escalarHumano.key]: escalarHumano,
  [agendar.key]: agendar,
  [recordar.key]: recordar,
  [delegarA.key]: delegarA,
};

// Tools que están SIEMPRE disponibles (fundamentales del loop).
const TOOLS_BASE = [buscarConocimiento.key, responderAlUsuario.key];

// ¿El plan/cliente puede usar esta tool? permisos = { planes:[], clientes:[] }.
function permitido(tool, plan, clientId) {
  const p = tool.permisos || {};
  if (Array.isArray(p.planes) && p.planes.length && !p.planes.includes(plan)) return false;
  if (Array.isArray(p.clientes) && p.clientes.length && !p.clientes.includes(clientId)) return false;
  return true;
}

// Construye el schema OpenAI de una tool tipo webhook desde su parametros_schema.
function defDesdeTool(tool) {
  const params = tool.parametros_schema && Object.keys(tool.parametros_schema).length
    ? tool.parametros_schema
    : { type: 'object', properties: {} };
  return {
    type: 'function',
    function: {
      name: tool.key,
      description: tool.descripcion || tool.nombre || tool.key,
      parameters: params,
    },
  };
}

// Devuelve el array de tools (formato OpenAI) para un agente, respetando
// activación (agente_tools) y permisos (plan del cliente / whitelist). Las base
// van siempre.
export async function openaiSchemasFor(agenteId) {
  // Plan del cliente del agente (para permisos).
  let clientId = null, plan = 'free';
  try {
    const { data: ag } = await admin.from('agentes').select('client_id').eq('id', agenteId).single();
    clientId = ag?.client_id || null;
    if (clientId) {
      const { data: cl } = await admin.from('clientes').select('plan').eq('id', clientId).single();
      plan = cl?.plan || 'free';
    }
  } catch { /* sin plan -> free */ }

  let catalogo = [], activosKeys = new Set();
  try {
    const [{ data: cat }, { data: act }] = await Promise.all([
      admin.from('tools').select('*').eq('activo', true),
      admin.from('agente_tools').select('activo, tools(key)').eq('agente_id', agenteId).eq('activo', true),
    ]);
    catalogo = cat || [];
    activosKeys = new Set((act || []).map((r) => r.tools?.key).filter(Boolean));
  } catch { /* sin catálogo -> solo base por código */ }

  const schemas = [];
  const incluidas = new Set();
  for (const t of catalogo) {
    const esBase = TOOLS_BASE.includes(t.key);
    if (!esBase && !activosKeys.has(t.key)) continue;
    if (!esBase && !permitido(t, plan, clientId)) continue;
    const def = REGISTRO[t.key]?.definicion || (t.tipo === 'webhook' ? defDesdeTool(t) : null);
    if (def) { schemas.push(def); incluidas.add(t.key); }
  }
  // Garantía: las base siempre presentes aunque el catálogo no esté (fallback código).
  for (const k of TOOLS_BASE) {
    if (!incluidas.has(k) && REGISTRO[k]?.definicion) { schemas.push(REGISTRO[k].definicion); incluidas.add(k); }
  }
  return schemas;
}

// Carga la config (overrides/credenciales) por tool del agente -> ctx.toolConfigs.
export async function cargarConfigs(agenteId) {
  const out = {};
  try {
    const { data } = await admin
      .from('agente_tools').select('config, tools(key)').eq('agente_id', agenteId).eq('activo', true);
    for (const r of data || []) { const k = r.tools?.key; if (k) out[k] = r.config || {}; }
  } catch { /* sin tabla */ }
  return out;
}

// Ejecuta una tool. Sistema -> handler en código; webhook -> ejecutor genérico.
// Nunca lanza: ante error devuelve { error }.
export async function ejecutar(key, args, ctx) {
  const mod = REGISTRO[key];
  if (mod?.handler) {
    try { return await mod.handler(args, ctx); }
    catch (e) { return { error: e.message }; }
  }
  try {
    const { data: tool } = await admin.from('tools').select('*').eq('key', key).single();
    if (tool?.tipo === 'webhook') return await ejecutarWebhook(tool, args, ctx);
    return { error: `Herramienta desconocida o no ejecutable: ${key}` };
  } catch (e) {
    return { error: e.message };
  }
}
