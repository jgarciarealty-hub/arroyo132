// Verifica la presentación de fechas: los timestamps se GUARDAN en UTC y se MUESTRAN en hora local.
// Regresión 2026-11-03: la app mostraba String(fecha).slice(0,16) (UTC); en UTC-4 «01:23Z» se veía
// como 01:23 cuando la hora local era 21:23 del día anterior (y 8 h de diferencia en UTC+8).
// Los valores guardados NO cambian: solo su representación.
// Uso: node tests/verificacion_fecha_local_20261103.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../central/estado_central.js');
const D = require('../central/almacen_drive.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

const almacen = new Map();
const registro = new Map();
function mkEl(id) { if (registro.has(id)) return registro.get(id); const el = { id, value: '', textContent: '', innerHTML: '', title: '', style: {}, files: null, classList: { add() {}, remove() {}, contains() { return false; } }, querySelector: () => ({ style: {} }), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, appendChild() {}, click() {}, remove() {}, scrollIntoView() {}, focus() {}, setAttribute() {}, getAttribute() { return null; } }; registro.set(id, el); return el; }
const sandbox = {
  console, A132Central: C, A132Drive: D,
  document: { getElementById: mkEl, querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }), querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ getContext: () => ({ drawImage() {} }), width: 0, height: 0, toDataURL: () => '', style: {}, click() {}, remove() {}, appendChild() {}, setAttribute() {} }), body: { classList: { add() {}, remove() {} }, appendChild() {} }, visibilityState: 'visible' },
  window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', share: null, clipboard: null },
  event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  alert() {}, confirm: () => true, prompt: () => null,
  localStorage: { getItem: (k) => (almacen.has(String(k)) ? almacen.get(String(k)) : null), setItem: (k, v) => almacen.set(String(k), String(v)), removeItem: (k) => almacen.delete(String(k)), clear: () => almacen.clear(), get length() { return almacen.size; }, key: (i) => [...almacen.keys()][i] },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: function () {},
  FileReader: function () { this.readAsDataURL = () => {}; }, Image: function () {},
  atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Set, Promise, Number, Boolean, Error, RegExp, isNaN, encodeURIComponent, decodeURIComponent,
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
const R = (c) => vm.runInContext(c, sandbox);

const ISO = '2026-11-04T01:23:56.496Z';
const ESPERADO = new Date(ISO).toLocaleString('es-PR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const NAIVE_UTC = '2026-11-04 01:23';

// ── 1. La función de presentación convierte a local y no toca el valor guardado ──
test('fechaHoraLocal convierte el timestamp a la hora local', R('fechaHoraLocal(' + JSON.stringify(ISO) + ')') === ESPERADO, R('fechaHoraLocal(' + JSON.stringify(ISO) + ')'));
test('fechaHoraLocal NO reproduce el troceo UTC anterior', R('fechaHoraLocal(' + JSON.stringify(ISO) + ')') !== NAIVE_UTC);
if (new Date(ISO).getTimezoneOffset() !== 0) {
  test('la representación local coincide con la fecha real del dispositivo, no con la UTC', R('fechaHoraLocal(' + JSON.stringify(ISO) + ')') !== ISO.slice(0, 16).replace('T', ' '));
}
test('un valor no-fecha se devuelve tal cual (no rompe el panel)', R("fechaHoraLocal('sin fecha')") === 'sin fecha' && R('fechaHoraLocal(undefined)') === '');
test('null y cadena vacía no se convierten en 1969 (epoch)', R('fechaHoraLocal(null)') === '' && R("fechaHoraLocal('')") === '', { nul: R('fechaHoraLocal(null)'), vacio: R("fechaHoraLocal('')") });
test('una fecha sin hora (YYYY-MM-DD) se muestra tal cual, sin desplazarse al día anterior', R("fechaHoraLocal('2026-11-04')") === '2026-11-04', R("fechaHoraLocal('2026-11-04')"));
test('una fecha ya parseada (Date) también se presenta en local', R('fechaHoraLocal(new Date(' + JSON.stringify(ISO) + '))') === ESPERADO);

// ── 2. Las fechas de formulario usan el calendario LOCAL, no el UTC ──
const d = new Date();
const localYMD = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const localYM = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
test('hoyLocalISO devuelve el año/mes/día locales', R('hoyLocalISO()') === localYMD, { obtenido: R('hoyLocalISO()'), localYMD });
test('mesLocalISO devuelve el año/mes locales', R('mesLocalISO()') === localYM, { obtenido: R('mesLocalISO()'), localYM });
test('el código ya no propone fechas con toISOString().split("T")[0]', !script.includes("toISOString().split('T')[0]"));
test('el código ya no usa toISOString().slice para fechas de archivo o de formulario', !/toISOString\(\)\.slice/.test(script), (script.match(/toISOString\(\)\.slice/g) || []).length);
test('el código ya no muestra timestamps con slice(0,16).replace("T"," ")', !script.includes(".slice(0,16).replace('T',' ')"));

// ── 3. Los paneles visibles muestran hora local ──
almacen.set('a132_drive_token', 'token-de-prueba');
almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
almacen.set('a132_drive_lastok', ISO);
almacen.set('a132_drive_verificado', JSON.stringify({ fecha: ISO, gastos: 62, monto: 100, archivo: 'arroyo132-datos.json' }));
const textoRespaldo = R('estadoRespaldoTexto()');
test('el panel de respaldo muestra el último respaldo en hora local', textoRespaldo.includes(ESPERADO), textoRespaldo);
test('el panel de respaldo ya no muestra el valor UTC crudo', !textoRespaldo.includes(NAIVE_UTC));
test('la verificación por relectura también se muestra en hora local', (textoRespaldo.match(new RegExp(ESPERADO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2, textoRespaldo);

almacen.set('a132_central', '1');
almacen.set('a132_central_base', JSON.stringify({ gastos: {}, recibos: {}, viajes: [] }));
almacen.set('a132_central_estado', JSON.stringify({ estado: 'ok', fecha: ISO, rev: 8, gastos: 62, suma: 1000 }));
const textoCentral = R('centralTexto()');
test('el panel de la fuente central muestra la sincronización en hora local', textoCentral.includes(ESPERADO), textoCentral);
test('el panel de la fuente central ya no muestra el valor UTC crudo', !textoCentral.includes(NAIVE_UTC));

// ── 4. Se sigue GUARDANDO en UTC (los timestamps originales no cambian) ──
R('marcarRespaldoOk()');
test('el último respaldo se guarda como ISO UTC (con Z)', /Z$/.test(almacen.get('a132_drive_lastok')), almacen.get('a132_drive_lastok'));
test('contenidoBackup().fecha sigue siendo ISO UTC', /Z$/.test(R('contenidoBackup().fecha')), R('contenidoBackup().fecha'));
R("centralMarcar('ok','prueba')");
const estadoCentral = JSON.parse(almacen.get('a132_central_estado'));
test('la marca de sincronización se guarda como ISO UTC (con Z)', /Z$/.test(estadoCentral.fecha), estadoCentral.fecha);

console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
process.exit(fail ? 1 : 0);
