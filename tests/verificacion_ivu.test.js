// Verifica la calculadora de IVU 11.5% recuperada en GD-2 (2026-10-09).
// A diferencia de verificacion_app_actual.test.js (que lee main:index.html via git, o sea lo
// DESPLEGADO), este lee el index.html del DIRECTORIO DE TRABAJO: sirve para probar un cambio
// ANTES de fusionarlo. Uso: node tests/verificacion_ivu.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }

const results = { pass: 0, fail: 0 };
function test(n, c, d) { if (c) { results.pass++; console.log('PASS:', n); } else { results.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

const valores = { 'f-monto': '111.50' };
const registry = {};
function mkEl(id) {
  if (registry[id]) return registry[id];
  const el = { checked: true, disabled: false, style: {}, _t: '', classList: { add() {}, remove() {}, contains() { return false; } }, querySelector() { return { style: {} }; }, addEventListener() {} };
  Object.defineProperty(el, 'value', { get() { return id in valores ? valores[id] : ''; }, set(v) { valores[id] = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._t; }, set(v) { el._t = v; } });
  el.trim = () => (el.value || '').trim();
  registry[id] = el;
  return el;
}
const sandbox = {
  console,
  document: {
    getElementById: (id) => mkEl(id),
    querySelectorAll: () => [], querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
    addEventListener() {}, body: { classList: { add() {}, remove() {} } },
    createElement: () => ({ getContext: () => ({ drawImage() {} }), width: 0, height: 0, toDataURL: () => 'data:image/jpeg;base64,' }),
    visibilityState: 'visible',
  },
  window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true }, event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  alert() {}, confirm: () => true,
  localStorage: { setItem() {}, getItem() { return null; }, removeItem() {} },
  fetch: () => Promise.reject(new Error('sin red')),
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Promise, results, test,
};
vm.createContext(sandbox);
const probe = `
;
(() => {
  test('toggleIVU y calcIVU existen', typeof toggleIVU === 'function' && typeof calcIVU === 'function', [typeof toggleIVU, typeof calcIVU]);
  test('la casilla del IVU existe en la UI', !!document.getElementById('f-ivu'));
  test('el desglose esta oculto por defecto', document.getElementById('f-ivu-desglose').style.display !== '');
  document.getElementById('f-ivu').checked = true;
  document.getElementById('f-monto').value = '111.50';
  calcIVU();
  test('subtotal correcto para 111.50 con IVU 11.5% (esperado $100.00)', document.getElementById('ivu-subtotal').textContent === '$100.00', document.getElementById('ivu-subtotal').textContent);
  test('IVU correcto (esperado $11.50)', document.getElementById('ivu-amount').textContent === '$11.50', document.getElementById('ivu-amount').textContent);
  test('total guardado = monto escrito (sin alterar el dato)', document.getElementById('ivu-total').textContent === '$111.50', document.getElementById('ivu-total').textContent);
  document.getElementById('f-ivu').checked = false;
  calcIVU();
  test('con la casilla apagada no recalcula (deja el valor previo)', document.getElementById('ivu-amount').textContent === '$11.50', document.getElementById('ivu-amount').textContent);
})();
`;
try { vm.runInContext(m[1] + probe, sandbox, { timeout: 20000 }); }
catch (e) { test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message); }

console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
process.exit(results.fail ? 1 : 0);
