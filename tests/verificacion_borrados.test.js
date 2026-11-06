// Propagación de borrados (port O1): lápida oculta, sello más reciente gana, sin lápida no borra,
// y la regla de semillas sigue mandando antes que el tiempo. Funciones REALES de index.html.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const HTML = process.env.A132_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }
function extraer(nombre) {
  let ini = script.indexOf('async function ' + nombre + '(');
  if (ini < 0) ini = script.indexOf('function ' + nombre + '(');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '{') n++; else if (script[k] === '}') { n--; if (!n) break; } }
  return script.slice(ini, k + 1);
}
function extraerConst(nombre) {
  const ini = script.indexOf('const ' + nombre + '=');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('[', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '[') n++; else if (script[k] === ']') { n--; if (!n) break; } }
  return script.slice(ini, k + 1) + ';';
}
function crear() {
  const ctx = { JSON, Object, Array, String, Number, Set, Map, Math, Date, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext([extraerConst('GASTOS_SEMILLA'), ...['esSemilla', 'normalizarTexto', 'claveContenido', 'msDe', 'esTombstone', 'anotarTombstone', 'mapaTombstones', 'listaTombstones', 'tombGana', 'compararRegistros', 'fusionarGastos'].map(extraer)].join('\n'), ctx);
  return ctx;
}
const fusionar = (locales, remotos, tombs) => { const ctx = crear(); ctx.__l = locales; ctx.__r = remotos; ctx.__t = tombs || []; return vm.runInContext('fusionarGastos(__l, __r, __t)', ctx); };
const ids = (r) => r.gastos.map((g) => String(g.id));
const T = (iso) => ({ modificado: iso });
const G = (id, extra) => Object.assign({ id, fecha: '2026-01-01', contratista: 'X' + id, monto: 10, tipo: 'manual' }, extra || {});

// 1. Lápida más reciente oculta el registro remoto
{
  const r = fusionar([G(1)], [G(2)], [{ id: 2, borrado: true, modificado: '2026-11-05T10:00:00Z' }]);
  test('lápida más reciente: el gasto remoto NO se añade', !ids(r).includes('2'), ids(r));
}
// 2. Lápida más antigua que el registro: el gasto se añade (re-creado después)
{
  const r = fusionar([G(1)], [G(2, T('2026-11-05T12:00:00Z'))], [{ id: 2, borrado: true, modificado: '2026-11-05T10:00:00Z' }]);
  test('lápida más antigua que el registro: sí se añade', ids(r).includes('2'), ids(r));
}
// 3. Lápida sin sello no puede ganar
{
  const r = fusionar([G(1)], [G(2)], [{ id: 2, borrado: true }]);
  test('lápida sin sello: no oculta nada', ids(r).includes('2'), ids(r));
}
// 4. Mismo id: gana el modificado mayor
{
  const local = G(1, T('2026-11-05T10:00:00Z'));
  const remoto = Object.assign(G(1, T('2026-11-05T11:00:00Z')), { monto: 99 });
  const r = fusionar([local], [remoto]);
  test('mismo id: gana el remoto más reciente', r.gastos[0].monto === 99, r.gastos[0]);
}
{
  const local = G(1, T('2026-11-05T12:00:00Z'));
  const remoto = Object.assign(G(1, T('2026-11-05T11:00:00Z')), { monto: 99 });
  const r = fusionar([local], [remoto]);
  test('mismo id: gana el local más reciente', r.gastos[0].monto === 10, r.gastos[0]);
}
// 5. Sin sellos: se mantiene el comportamiento anterior (local + conflicto)
{
  const r = fusionar([G(1)], [Object.assign(G(1), { monto: 99 })]);
  test('sin sellos: se conserva el local y hay conflicto', r.gastos[0].monto === 10 && r.conflictos.length === 1, { monto: r.gastos[0].monto, conflictos: r.conflictos.length });
}
// 6. Sin lápidas, la fusión sigue igual
{
  const r = fusionar([G(1)], [G(2)]);
  test('sin lápidas: se añade el id nuevo', r.gastos.length === 2 && r.agregados === 1, r.agregados);
}
// 7. La regla de semillas manda antes que el tiempo
{
  const ctx = crear();
  const semilla = vm.runInContext('JSON.parse(JSON.stringify(GASTOS_SEMILLA[0]))', ctx);
  const real = { id: semilla.id, fecha: '2030-01-01', contratista: 'REAL', monto: 1, tipo: 'manual' };
  const r = fusionar([semilla], [real]);
  test('semilla intacta: el dato real gana aunque no tenga sello', r.gastos[0].contratista === 'REAL', r.gastos[0]);
}
// 8. listaTombstones deduplica por id y deja la más reciente
{
  const ctx = crear();
  ctx.__t = [[{ id: 1, borrado: true, modificado: '2026-01-01T00:00:00Z' }], [{ id: 1, borrado: true, modificado: '2026-06-01T00:00:00Z' }], [{ id: 2, borrado: true, modificado: '2026-06-01T00:00:00Z' }]];
  const lista = vm.runInContext('listaTombstones(mapaTombstones(__t))', ctx);
  test('lápidas: una por id y la más reciente', lista.length === 2 && lista.find((t) => String(t.id) === '1').modificado === '2026-06-01T00:00:00Z', lista);
}
// 9. La foto del gasto borrado no resucita: el registro desaparece y la fusión no lo devuelve
{
  const r = fusionar([G(1), G(2)], [G(2)], [{ id: 1, borrado: true, modificado: '2026-11-05T10:00:00Z' }]);
  test('el gasto borrado no vuelve aunque el remoto lo traiga sin sello', !ids(r).includes('1'), ids(r));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
