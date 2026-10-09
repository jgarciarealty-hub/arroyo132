// Verifica el panel "Presupuesto vs. Real por Categoria" recuperado en GD-2 (2026-10-09).
// Lee el index.html del DIRECTORIO DE TRABAJO (prueba el cambio antes de fusionarlo).
// Uso: node tests/verificacion_presupuesto.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }
const results = { pass: 0, fail: 0 };
function test(n, c, d) { if (c) { results.pass++; console.log('PASS:', n); } else { results.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

const registry = {};
function mkEl(id) {
  if (registry[id]) return registry[id];
  const el = { checked: false, disabled: false, style: {}, _t: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } }, querySelector() { return { style: {} }; }, addEventListener() {} };
  Object.defineProperty(el, 'value', { get() { return id in almacen ? almacen[id] : ''; }, set(v) { almacen[id] = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._t; }, set(v) { el._t = v; } });
  el.trim = () => (el.value || '').trim();
  registry[id] = el;
  return el;
}
const almacen = {};
const store = {};
const sandbox = {
  console,
  document: {
    getElementById: (id) => mkEl(id), querySelectorAll: () => [],
    querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
    addEventListener() {}, body: { classList: { add() {}, remove() {} } },
    createElement: () => ({ getContext: () => ({ drawImage() {} }), width: 0, height: 0, toDataURL: () => 'data:,' }),
    visibilityState: 'visible',
  },
  window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true }, event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  alert() {}, confirm: () => true,
  localStorage: { setItem(k, v) { store[k] = String(v); }, getItem(k) { return k in store ? store[k] : null; }, removeItem(k) { delete store[k]; } },
  fetch: () => Promise.reject(new Error('sin red')),
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Promise, results, test,
};
vm.createContext(sandbox);
const probe = `
;
(() => {
  test('renderPresupuesto y guardarPresupuesto existen', typeof renderPresupuesto === 'function' && typeof guardarPresupuesto === 'function', [typeof renderPresupuesto, typeof guardarPresupuesto]);
  test('el contenedor del panel existe en la UI', !!document.getElementById('presupuesto-bars'));
  // sin datos -> mensaje de vacio
  gastos.length = 0;
  renderPresupuesto();
  test('sin datos muestra el mensaje de vacio (no crashea)', String(document.getElementById('presupuesto-bars').innerHTML).includes('Registra gastos'));
  // con datos: Techo 300 real vs 400 presupuesto = 75% (naranja), Electricidad 100 sin presupuesto
  gastos.push({id:900001,monto:300,categoria:'Techo',fecha:'2026-10-09'});
  gastos.push({id:900002,monto:100,categoria:'Electricidad',fecha:'2026-10-09'});
  presupuesto['Techo']=400;
  renderPresupuesto();
  const h1 = String(document.getElementById('presupuesto-bars').innerHTML);
  test('lista la categoria con presupuesto (Techo)', h1.includes('Techo'));
  test('muestra lo real gastado ($300.00)', h1.includes('$300.00'), h1.slice(0,120));
  test('muestra el presupuesto ($400.00)', h1.includes('$400.00'));
  test('la barra de Techo queda al 75% (300/400)', h1.includes('width:75%'), h1.match(/width:[0-9.]+%/g));
  test('el color cambia al llegar al 75% (naranja #e67e22)', h1.includes('#e67e22'));
  test('lista la categoria sin presupuesto (Electricidad)', h1.includes('Electricidad'));
  test('crea el campo para escribir el presupuesto (pres_Techo)', h1.includes('pres_Techo'));
  // al 100% o mas -> rojo
  presupuesto['Techo']=300; renderPresupuesto();
  test('al 100% la barra es roja (var(--red))', String(document.getElementById('presupuesto-bars').innerHTML).includes('var(--red)'));
  // guardar persiste
  guardarPresupuesto();
  test('guardarPresupuesto() persiste en localStorage (a132_presupuesto)', !!localStorage.getItem('a132_presupuesto') && localStorage.getItem('a132_presupuesto').includes('Techo'));
})();
`;
try { vm.runInContext(m[1] + probe, sandbox, { timeout: 20000 }); }
catch (e) { test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message); }
console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
process.exit(results.fail ? 1 : 0);
