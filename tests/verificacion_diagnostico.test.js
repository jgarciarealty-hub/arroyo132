// Verifica el "Diagnostico de datos" recuperado en GD-2 paso 3 (2026-10-09).
// Lee el index.html del DIRECTORIO DE TRABAJO (prueba el cambio antes de fusionarlo).
// Uso: node tests/verificacion_diagnostico.test.js
//
// DOS HECHOS REALES DE LA APP que esta suite documenta (no son defectos):
//  1. Al arrancar, la app siembra de forma IDEMPOTENTE los 11 recibos recuperados en a132_gastos
//     (solo añade los que falten, por id o por contratista+fecha+monto), sin pasar por save().
//  2. diagnosticarDatos() inspecciona el estado PERSISTIDO en localStorage, no el arreglo
//     `gastos` en memoria. Para un diagnostico de datos eso es lo correcto.
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
const almacen = {};
function mkEl(id) {
  if (registry[id]) return registry[id];
  const el = { checked: false, disabled: false, style: {}, _t: '', innerHTML: '', classList: { add() {}, remove() {}, contains() { return false; } }, querySelector() { return { style: {} }; }, addEventListener() {} };
  Object.defineProperty(el, 'value', { get() { return id in almacen ? almacen[id] : ''; }, set(v) { almacen[id] = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._t; }, set(v) { el._t = v; } });
  el.trim = () => (el.value || '').trim();
  registry[id] = el;
  return el;
}
const store = {};
const alertas = [];               // captura los mensajes de alert() para poder afirmar sobre el diagnostico
// se exponen con nombres propios para que el probe pueda leerlos sin riesgo de colision con el script de la app
const sandbox = {
  console,
  __alertas: alertas,
  __store: store,
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
  alert: (msg) => { alertas.push(String(msg)); }, confirm: () => true,
  localStorage: { setItem(k, v) { store[k] = String(v); }, getItem(k) { return k in store ? store[k] : null; }, removeItem(k) { delete store[k]; }, get length() { return Object.keys(store).length; }, key(i) { return Object.keys(store)[i]; } },
  fetch: () => Promise.reject(new Error('sin red')),
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Promise, results, test,
};
vm.createContext(sandbox);
const probe = `
;
(() => {
  const ultimo = () => __alertas[__alertas.length - 1] || '';
  const limpiar = () => { __alertas.length = 0; };
  const persistidos = () => JSON.parse(localStorage.getItem('a132_gastos') || '[]');

  // ---- presencia ----
  test('diagnosticarDatos es una funcion', typeof diagnosticarDatos === 'function', typeof diagnosticarDatos);
  test('el boton del topbar la dispara (onclick en la UI)', HTML_DEL_ARCHIVO.includes('onclick="diagnosticarDatos()"'));
  test('la clave de backup se escribe (save) y se lee (diagnostico): 2 sitios', HTML_DEL_ARCHIVO.split('a132_backup_gastos').length - 1 === 2);

  // ---- el arranque siembra los recibos recuperados, sin dejar backup ----
  test('el arranque siembra los 11 recibos recuperados en el estado persistido', persistidos().length === 11, persistidos().length);
  test('la siembra del arranque NO crea backup (no pasa por save())', !localStorage.getItem('a132_backup_gastos'));

  // ---- null-safe: sin datos persistidos ----
  delete __store['a132_gastos']; delete __store['a132_backup_gastos'];
  limpiar(); diagnosticarDatos();
  const m0 = ultimo();
  test('sin datos: no crashea y reporta 0 gastos actuales', m0.includes('Gastos actuales: 0'), m0.slice(0, 60));
  test('sin datos: avisa que aun no hay copia local', m0.includes('Todavía no hay copia local'), m0);
  test('sin datos: NO afirma que se perdieron datos', !m0.includes('perdido'));
  test('sin datos: no lista nada (no hay backup que mostrar)', !m0.includes('Gastos en backup'));

  // ---- save() crea la red de seguridad con el estado ANTERIOR ----
  gastos.length = 0;
  gastos.push({ id: 900001, monto: 100, fecha: '2026-10-01', contratista: 'AAA' });
  save();
  test('sin estado previo, el primer save() NO deja backup', !localStorage.getItem('a132_backup_gastos'));
  gastos.push({ id: 900002, monto: 250.50, fecha: '2026-10-02', contratista: 'LUMA' });
  save();
  const bk = JSON.parse(localStorage.getItem('a132_backup_gastos') || 'null');
  test('el 2do save() guarda el estado ANTERIOR (1 gasto, no 2)', Array.isArray(bk) && bk.length === 1, bk && bk.length);
  test('el backup conserva el contenido real (monto 100 / AAA)', !!bk && bk[0].monto === 100 && bk[0].contratista === 'AAA', bk && bk[0]);
  test('save() sigue persistiendo el estado actual (2 gastos)', persistidos().length === 2, persistidos().length);

  // ---- el diagnostico mira el estado PERSISTIDO, no el arreglo en memoria ----
  gastos.push({ id: 900099, monto: 1, fecha: '2026-10-09', contratista: 'SOLO-EN-MEMORIA' });   // sin save()
  limpiar(); diagnosticarDatos();
  test('lee lo PERSISTIDO, no el arreglo en memoria (reporta 2, no 3)', ultimo().includes('Gastos actuales: 2'), ultimo().slice(0, 60));
  test('y no menciona el gasto que solo estaba en memoria', !ultimo().includes('SOLO-EN-MEMORIA'));
  gastos.pop();

  // ---- reconciliacion real end-to-end: se pierde un gasto ----
  gastos.length = 0;
  gastos.push({ id: 900002, monto: 250.50, fecha: '2026-10-02', contratista: 'LUMA' });
  save();                                   // el backup pasa a tener 2 (el estado previo)
  limpiar(); diagnosticarDatos();
  const m1 = ultimo();
  test('detecta que el backup tiene MAS datos que el actual', m1.includes('Gastos actuales: 1') && m1.includes('Backup disponible: 2 gastos'), m1.slice(0, 120));
  test('advierte de perdida cuando el backup supera al actual', m1.includes('puede que se haya perdido algo'), m1);
  test('apunta a la via de recuperacion que SI existe hoy (Drive)', m1.includes('Google Drive'));
  test('reporta la diferencia de total como -$100.00 (negativo bien formado)', m1.includes('-$100.00') && !m1.includes('$-100.00'), m1);
  test('lista los gastos del backup con fecha, contratista y monto', m1.includes('2026-10-01 | AAA | $100') && m1.includes('2026-10-02 | LUMA | $250.5'), m1);

  // ---- estado sano: actual >= backup ----
  gastos.push({ id: 900003, monto: 10, fecha: '2026-10-03', contratista: 'X' });
  save();
  limpiar(); diagnosticarDatos();
  const m2 = ultimo();
  test('con el actual igual o mayor al backup, reporta estado sano (✅)', m2.includes('✅'), m2.slice(0, 120));
  test('estado sano: NO advierte perdida', !m2.includes('puede que se haya perdido algo'));
  test('el ✅ habla de REGISTROS ("los mismos registros o más"), no de totales', m2.includes('los mismos registros o más'), m2.slice(0, 120));
  // con actual y backup identicos no debe aparecer ninguna linea de diferencia
  const iguales = [{ id: 1, monto: 100, fecha: '2026-10-01', contratista: 'AAA' }];
  __store['a132_gastos'] = JSON.stringify(iguales);
  __store['a132_backup_gastos'] = JSON.stringify(iguales);
  limpiar(); diagnosticarDatos();
  test('con actual identico al backup: ✅ y sin linea de diferencia', ultimo().includes('✅') && !ultimo().includes('Diferencia de total'), ultimo());

  // ---- tope de 15 en el listado ----
  const muchos = []; for (let i = 0; i < 20; i++) muchos.push({ id: 910000 + i, monto: 1, fecha: '2026-09-' + String(i + 1).padStart(2, '0'), contratista: 'C' + i });
  __store['a132_backup_gastos'] = JSON.stringify(muchos);
  limpiar(); diagnosticarDatos();
  const m3 = ultimo();
  test('con mas de 15 en backup, lista 15 y resume el resto', m3.includes('... y 5 más.'), m3.slice(-40));
  test('el listado se corta en 15 (no aparece el #16)', m3.includes('15. ') && !m3.includes('16. '));

  // ---- solo lectura ----
  const fotoAntes = JSON.stringify(__store);
  limpiar(); diagnosticarDatos();
  test('el diagnostico es de SOLO LECTURA (no modifica localStorage)', JSON.stringify(__store) === fotoAntes);
  test('el diagnostico siempre muestra un mensaje (nunca silencioso)', __alertas.length === 1);

  // ---- robustez ante datos corruptos ----
  __store['a132_backup_gastos'] = '{esto no es json';
  __store['a132_gastos'] = 'tampoco';
  limpiar();
  let lanzo = null;
  try { diagnosticarDatos(); } catch (e) { lanzo = e.message; }
  test('con JSON corrupto no lanza excepcion', lanzo === null, lanzo);
  test('con JSON corrupto reporta 0/0 en vez de romper', ultimo().includes('Gastos actuales: 0') && ultimo().includes('Backup disponible: 0'), ultimo().slice(0, 80));
})();
`;
sandbox.HTML_DEL_ARCHIVO = html;
try { vm.runInContext(m[1] + probe, sandbox, { timeout: 20000 }); }
catch (e) { test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message); }
console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
process.exit(results.fail ? 1 : 0);
