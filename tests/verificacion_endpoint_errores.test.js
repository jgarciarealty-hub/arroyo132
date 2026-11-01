// Verifica el PARCHE P0 del endpoint de recibos (2026-11-01): errores genericos, sin fuga de credenciales.
// Usa SOLO una clave FALSA. El caso 1 usa el fetch real de Node con una clave falsa mal formada: Node lanza
// «Headers.append ... invalid header value» ANTES de cualquier conexion de red, que es exactamente la falla
// que filtro la clave real. Ninguna prueba contacta a Anthropic ni a Vercel.
// Uso: node tests/verificacion_endpoint_errores.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const FALSA = 'sk-ant-api03-CLAVE-FALSA-DE-PRUEBA-NO-ES-REAL';
const MAL_FORMADA = [FALSA, FALSA, FALSA].join('\n'); // mismo patron que el valor mal guardado en Vercel
const results = { pass: 0, fail: 0 };
function test(n, c, d) { if (c) { results.pass++; console.log('PASS:', n); } else { results.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

function cargar(codigo, nombre) {
  const m = { exports: {} };
  new Function('module', 'require', 'process', codigo)(m, require, process);
  return m.exports;
}
const nuevo = cargar(fs.readFileSync(path.join(__dirname, '..', 'api', 'analyze-invoice.js'), 'utf8'), 'nuevo');
const viejoCodigo = fs.readFileSync(path.join(__dirname, 'fixtures', 'analyze-invoice.anterior.js.txt'), 'utf8'); // copia fija de la version anterior (no depende de git)

function res() {
  const r = { code: 0, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
const valido = () => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }] });
async function llamar(handler, req, { clave, fetchFalso, real } = {}) {
  const guardado = { key: process.env.ANTHROPIC_API_KEY, fetch: global.fetch, err: console.error };
  const registros = []; console.error = (...a) => { registros.push(a.join(' ')); };
  if (clave === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = clave;
  if (!real) global.fetch = fetchFalso || (async () => { throw new Error('fetch no deberia llamarse'); });
  const r = res();
  try { await handler(req, r); } finally { process.env.ANTHROPIC_API_KEY = guardado.key; if (guardado.key === undefined) delete process.env.ANTHROPIC_API_KEY; global.fetch = guardado.fetch; console.error = guardado.err; }
  return { r, registros };
}
const sinClave = (texto) => !String(texto).includes('CLAVE-FALSA') && !/sk-ant/.test(String(texto));

(async () => {
  // 1. La falla real: clave mal formada con el fetch real de Node (sin red)
  {
    const { r, registros } = await llamar(nuevo, { method: 'POST', body: valido() }, { clave: MAL_FORMADA, real: true });
    const cuerpo = JSON.stringify(r.body);
    test('clave mal formada: responde 500 generico', r.code === 500 && r.body && r.body.error === 'Error procesando la solicitud', r);
    test('clave mal formada: la respuesta NO contiene la clave ni "sk-ant"', sinClave(cuerpo), cuerpo);
    test('clave mal formada: el registro del servidor NO contiene la clave', sinClave(registros.join('|')), registros);
    test('clave mal formada: el registro dice solo el TIPO de error', registros.length === 1 && /excepci/.test(registros[0]), registros);
  }
  // 2. Prueba de sensibilidad: la version anterior SI filtraba (misma entrada)
  {
    const viejo = cargar(viejoCodigo, 'viejo');
    const { r } = await llamar(viejo, { method: 'POST', body: valido() }, { clave: MAL_FORMADA, real: true });
    test('control: la version ANTERIOR filtraba la clave falsa en la respuesta (la prueba detecta el defecto)', !sinClave(JSON.stringify(r.body)), r.code);
  }
  // 3. Un POST vacio o malformado no toca la clave ni llama al proveedor
  for (const [nombre, cuerpo] of [['{}', {}], ['sin cuerpo', undefined], ['messages vacio', { messages: [] }], ['2 mensajes', { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }], ['rol no usuario', { messages: [{ role: 'assistant', content: 'a' }] }], ['JSON invalido', '{no es json'], ['content no es lista', { messages: [{ role: 'user', content: 'texto suelto' }] }], ['3 bloques', { messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }] }] }], ['tipo de bloque desconocido', { messages: [{ role: 'user', content: [{ type: 'tool_use', name: 'x' }] }] }]]) {
    let llamado = false;
    const { r } = await llamar(nuevo, { method: 'POST', body: cuerpo }, { clave: MAL_FORMADA, fetchFalso: async () => { llamado = true; return { ok: true, json: async () => ({}) }; } });
    test('cuerpo ' + nombre + ': 400 sin llamar al proveedor', r.code === 400 && !llamado && sinClave(JSON.stringify(r.body)), { code: r.code, llamado });
  }
  { const grande = { messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_300_000) }] }] };
    const { r } = await llamar(nuevo, { method: 'POST', body: grande }, { clave: FALSA });
    test('cuerpo demasiado grande: 413', r.code === 413, r.code); }
  // 4. Metodos y CORS
  { const g = await llamar(nuevo, { method: 'GET' }, { clave: FALSA }); test('GET: 405', g.r.code === 405, g.r.code);
    const o = await llamar(nuevo, { method: 'OPTIONS' }, { clave: FALSA }); test('OPTIONS: 200', o.r.code === 200 && o.r.ended, o.r.code);
    test('CORS: solo el origen de la app (no "*")', g.r.headers['access-control-allow-origin'] === 'https://arroyo132.vercel.app', g.r.headers); }
  // 5. Sin clave configurada
  { const { r } = await llamar(nuevo, { method: 'POST', body: valido() }, { clave: undefined });
    test('sin clave: 503 generico', r.code === 503 && sinClave(JSON.stringify(r.body)), r); }
  // 6. Error del proveedor: no se reenvia su cuerpo
  { const { r, registros } = await llamar(nuevo, { method: 'POST', body: valido() }, { clave: FALSA, fetchFalso: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key ' + FALSA } }) }) });
    test('proveedor 401: 502 generico y NO reenvia su cuerpo', r.code === 502 && r.body.error === 'La IA no pudo procesar el recibo' && sinClave(JSON.stringify(r.body)), r);
    test('proveedor 401: el registro no contiene la clave', sinClave(registros.join('|')), registros); }
  // 7. Excepcion cuyo mensaje contiene la clave
  { const { r, registros } = await llamar(nuevo, { method: 'POST', body: valido() }, { clave: FALSA, fetchFalso: async () => { throw new TypeError('fallo con ' + FALSA); } });
    test('excepcion con la clave en el mensaje: 500 generico', r.code === 500 && sinClave(JSON.stringify(r.body)), r);
    test('excepcion con la clave en el mensaje: no se registra el mensaje', sinClave(registros.join('|')) && /TypeError/.test(registros[0]), registros); }
  // 8. Camino feliz: la clave solo viaja hacia el proveedor
  { let visto = null;
    const { r } = await llamar(nuevo, { method: 'POST', body: valido() }, { clave: FALSA, fetchFalso: async (url, opts) => { visto = { url, key: opts.headers['x-api-key'], cuerpo: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"monto":1}' }] }) }; } });
    test('exito: 200 con la respuesta del proveedor', r.code === 200 && r.body.content[0].text === '{"monto":1}', r);
    test('exito: llama al proveedor oficial con la clave en el encabezado y max_tokens 600', visto && visto.url === 'https://api.anthropic.com/v1/messages' && visto.key === FALSA && visto.cuerpo.max_tokens === 600 && visto.cuerpo.messages.length === 1, visto && { url: visto.url });
    test('exito: la respuesta al cliente no contiene la clave', sinClave(JSON.stringify(r.body))); }

  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})();
