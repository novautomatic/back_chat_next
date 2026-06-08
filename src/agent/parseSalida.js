// Parser robusto de la salida del modelo en el formato del cerebro:
//   { "respuesta": "...", "productos": [...], "acciones": [...] }
//
// El modelo puede entregar el JSON limpio, envuelto en ```json ... ```, con
// texto antes/despues, o MALFORMADO/TRUNCADO (p.ej. finish_reason: "length").
// El objetivo es NUNCA volcarle al usuario el JSON crudo: si algo se puede
// rescatar (sobre todo "respuesta"), lo rescatamos; si no, devolvemos el texto
// ya despojado del andamiaje JSON.

const arr = (v) => (Array.isArray(v) ? v : []);

// Intenta JSON.parse sobre el primer objeto {...} balanceado del texto.
// Devuelve el objeto o null. Respeta comillas y escapes para no cortar mal.
function objetoBalanceado(texto) {
  const ini = texto.indexOf('{');
  if (ini < 0) return null;
  let prof = 0, enStr = false, esc = false;
  for (let i = ini; i < texto.length; i++) {
    const c = texto[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { enStr = !enStr; continue; }
    if (enStr) continue;
    if (c === '{') prof++;
    else if (c === '}') {
      prof--;
      if (prof === 0) {
        try { return JSON.parse(texto.slice(ini, i + 1)); } catch { return null; }
      }
    }
  }
  return null; // se acabo el texto sin cerrar -> JSON truncado
}

// Ultimo recurso para JSON truncado: extrae el valor de "respuesta" por regex,
// manejando comillas escapadas. No intenta recuperar productos/acciones rotos.
function respuestaPorRegex(texto) {
  const m = texto.match(/"respuesta"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

// Quita andamiaje JSON visible para que, en el peor caso, el usuario no vea
// llaves, comillas de campos ni claves tecnicas sueltas.
function despojarJson(texto) {
  return String(texto)
    .replace(/```(?:json)?/gi, '')
    .replace(/[{}\[\]]/g, ' ')
    .replace(/"(respuesta|productos|acciones|contenido|mensaje|nombre|precio|url|texto)"\s*:/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Normaliza un objeto ya parseado al contrato { respuesta, productos, acciones }.
function desdeObjeto(o) {
  return {
    respuesta: o.respuesta ?? o.contenido ?? o.mensaje ?? '',
    productos: arr(o.productos),
    acciones: arr(o.acciones),
  };
}

// Devuelve { respuesta, productos, acciones }. `raw` es el content del modelo.
// Nunca devuelve el JSON crudo en `respuesta`.
export function parseSalida(raw) {
  const texto = String(raw ?? '').trim();
  if (!texto) return { respuesta: '', productos: [], acciones: [] };

  // 1) Camino feliz: el content ES JSON valido.
  try {
    const o = JSON.parse(texto);
    if (o && typeof o === 'object' && !Array.isArray(o)) return desdeObjeto(o);
  } catch { /* sigue */ }

  // 2) JSON envuelto en texto o code-fences: primer objeto balanceado.
  const bal = objetoBalanceado(texto);
  if (bal && typeof bal === 'object') return desdeObjeto(bal);

  // 3) JSON truncado/roto: al menos rescatar "respuesta".
  const resc = respuestaPorRegex(texto);
  if (resc != null) return { respuesta: resc, productos: [], acciones: [] };

  // 4) No parecia el contrato JSON. Si igual trae andamiaje JSON, lo despojamos;
  //    si era texto plano normal, queda tal cual.
  const pareceJson = /["{]\s*"?(respuesta|productos|acciones)"?\s*:/.test(texto) || /^[\[{]/.test(texto);
  return { respuesta: pareceJson ? despojarJson(texto) : texto, productos: [], acciones: [] };
}
