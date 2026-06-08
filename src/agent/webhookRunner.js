// Ejecutor genérico de herramientas tipo 'webhook' definidas por el super admin
// desde el panel (sin código). Interpola plantillas con tres ámbitos:
//   {{args.x}}   -> lo que el LLM rellenó (parametros_schema)
//   {{config.x}} -> lo que el cliente configuró por agente (config_schema)
//   {{ctx.x}}    -> contexto: conversacion_id, cliente_id, agente_id
const TIMEOUT_MS = 15000;

function resolver(path, scope) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

// Reemplaza {{ ruta.punteada }} por su valor del scope (vacío si no existe).
function interpolar(tpl, scope) {
  return String(tpl ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = resolver(p, scope);
    return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}

// tool: fila de `tools` (tipo='webhook'). ctx: { clientId, agenteId, conversacionId, toolConfigs }
export async function ejecutarWebhook(tool, args, ctx) {
  const scope = {
    args: args || {},
    config: ctx?.toolConfigs?.[tool.key] || {},
    ctx: { conversacion_id: ctx?.conversacionId, cliente_id: ctx?.clientId, agente_id: ctx?.agenteId },
  };

  const url = interpolar(tool.url_plantilla, scope).trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { error: 'Esta herramienta no tiene una URL de webhook válida configurada.' };
  }
  const metodo = (tool.metodo || 'POST').toUpperCase();

  const headers = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(tool.headers || {})) headers[k] = interpolar(v, scope);

  let body;
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    body = tool.cuerpo_plantilla ? interpolar(tool.cuerpo_plantilla, scope) : JSON.stringify(args || {});
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: metodo, headers, body, signal: ctrl.signal });
    const texto = await res.text();
    if (!res.ok) return { error: `El servicio respondió ${res.status}`, detalle: texto.slice(0, 300) };
    try { return { ok: true, data: JSON.parse(texto) }; }
    catch { return { ok: true, data: texto.slice(0, 1500) }; }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'El webhook tardó demasiado (timeout).' : e.message };
  } finally {
    clearTimeout(t);
  }
}
