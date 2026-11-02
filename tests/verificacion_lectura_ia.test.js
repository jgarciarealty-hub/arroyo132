// Verifica la interpretación y el DIAGNÓSTICO de la lectura de recibos con IA (2026-11-02).
// Antes, cuatro causas distintas (sin texto, texto cortado, sin JSON, JSON con todo vacío) terminaban
// en el mismo mensaje genérico y no se podía saber cuál era. Uso: node tests/verificacion_lectura_ia.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').split('\r\n').join('\n');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }
function extraer(nombre) {
  const i = m[1].indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('no existe ' + nombre);
  let d = 0, j = m[1].indexOf('{', i);
  for (let k = j; k < m[1].length; k++) { if (m[1][k] === '{') d++; else if (m[1][k] === '}') { d--; if (d === 0) return m[1].slice(i, k + 1); } }
  throw new Error('llaves sin cerrar ' + nombre);
}
const guardado = {};
const sb = { console: { info() {}, warn() {}, error() {} }, localStorage: { setItem: (k, v) => { guardado[k] = v; }, getItem: () => null }, JSON, Date, Math, parseFloat, isFinite, isNaN, String, Array, Object };
vm.createContext(sb);
for (const f of ['interpretarExtraccion', 'diagnosticarLectura', 'guardarUltimaLecturaIA', 'textoEstadoExtraccion']) vm.runInContext(extraer(f), sb);

let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }
const ia = (texto, stop, extra) => Object.assign({ content: texto === null ? [] : [{ type: 'text', text: texto }], stop_reason: stop || 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }, extra || {});
function diag(resp) { const t = (resp.content || []).map((c) => c.text || '').join(''); const l = sb.interpretarExtraccion(t); return { l, d: sb.diagnosticarLectura(resp, t, l) }; }

const bueno = '{"fecha":"2026-06-24","monto":25.06,"ivu":2.58,"contratista":"QUALITY iS","categoria":"Materiales","descripcion":"Compra de puntas hammer"}';
let r = diag(ia(bueno));
test('lectura completa: estado completa, causa ok, monto 25.06', r.l.estado === 'completa' && r.d.causa === 'ok' && r.l.campos.monto === 25.06, r);
r = diag(ia('```json\n' + bueno + '\n```'));
test('JSON dentro de bloque markdown también se lee', r.l.estado === 'completa', r.l);
r = diag(ia('Aquí está: ' + bueno + ' Espero que sirva.'));
test('JSON rodeado de texto también se lee', r.l.estado === 'completa', r.l);
r = diag(ia('{"fecha":"","monto":0,"ivu":0,"contratista":"","categoria":"","descripcion":""}'));
test('todo vacío → vacia / sin_datos, con mensaje que orienta (acerca la cámara)', r.l.estado === 'vacia' && r.d.causa === 'sin_datos' && /acerca la cámara/.test(r.d.mensaje), r.d);
r = diag(ia('{"fecha":"2026-06-24","monto":0,"contratista":""}'));
test('solo fecha → parcial y se dice qué falta (no se inventa)', r.l.estado === 'parcial' && r.l.faltan.join() === 'monto,contratista' && r.l.campos.monto === undefined, r.l);
r = diag(ia('{"fecha":"2026-06-24","monto":-5,"contratista":"X"}'));
test('monto negativo no se acepta como lectura', r.l.campos.monto === undefined, r.l);
r = diag(ia('{"fecha":"24/06/2026","monto":"$1,234.50","contratista":"X"}'));
test('fecha en otro formato se descarta (no se inventa) y "$1,234.50" se lee como 1234.5', r.l.campos.fecha === undefined && r.l.campos.monto === 1234.5, r.l);
r = diag(ia(null));
test('sin bloques de contenido → causa sin_contenido', r.d.causa === 'sin_contenido', r.d);
r = diag({ content: [{ type: 'thinking', thinking: '…' }], stop_reason: 'max_tokens', usage: {} });
test('solo "thinking" y max_tokens → sin_texto_max_tokens (la IA gastó el espacio pensando)', r.d.causa === 'sin_texto_max_tokens', r.d);
r = diag({ content: [{ type: 'text', text: '' }], stop_reason: 'end_turn', usage: {} });
test('texto vacío sin max_tokens → sin_texto', r.d.causa === 'sin_texto', r.d);
r = diag(ia('No puedo leer esta imagen.'));
test('respuesta en prosa sin JSON → sin_json', r.d.causa === 'sin_json', r.d);
r = diag(ia('{"fecha":"2026-06-24","monto":25.06,"contra', 'max_tokens'));
test('JSON cortado por max_tokens → json_truncado', r.d.causa === 'json_truncado' && r.l.estado === 'vacia', r);
r = diag(ia('{"fecha": 2026-06-24, monto}', 'end_turn'));
test('JSON mal formado → json_invalido', r.d.causa === 'json_invalido', r.d);
test('el mensaje de estado vacío sigue sin marcar éxito', /No se pudo leer/.test(sb.textoEstadoExtraccion({ estado: 'vacia', faltan: [] })) && !/✅/.test(sb.textoEstadoExtraccion({ estado: 'vacia', faltan: [] })));
sb.guardarUltimaLecturaIA(r.d, 'TOTAL 99.99 COMERCIO SECRETO ' + 'x'.repeat(5000));
const g = JSON.parse(guardado.a132_ultima_lectura_ia || 'null');
test('la última lectura guarda SOLO metadatos: sin texto, sin valores del recibo, sin imagen', g && g.causa === 'json_invalido' && !('texto' in g) && !JSON.stringify(g).includes('SECRETO') && !JSON.stringify(g).includes('99.99') && !('data' in g) && !('base64' in g), g && Object.keys(g));
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
