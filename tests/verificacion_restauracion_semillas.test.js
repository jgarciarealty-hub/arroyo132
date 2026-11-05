// Colisión de semillas (2026-11-05): un respaldo real debe sustituir una semilla intacta,
// pero NUNCA debe pisar un registro que el usuario editó ni un gasto normal.
// Funciones REALES extraídas de index.html; sin red, sin Drive, sin datos reales.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

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
  const ctx = { JSON, Object, Array, String, Number, Set, Map, Math };
  vm.createContext(ctx);
  vm.runInContext([extraerConst('GASTOS_SEMILLA'), extraer('esSemilla'), extraer('normalizarTexto'), extraer('claveContenido'), extraer('fusionarGastos')].join('\n'), ctx);
  return ctx;
}
const fusionar = (locales, remotos) => { const ctx = crear(); ctx.__l = locales; ctx.__r = remotos; return vm.runInContext('fusionarGastos(__l, __r)', ctx); };
const clon = o => JSON.parse(JSON.stringify(o));
const semillas = () => { const ctx = crear(); return vm.runInContext('JSON.parse(JSON.stringify(GASTOS_SEMILLA))', ctx); };

// ── 1. El dato real sustituye a la semilla intacta ──────────────────────────
{
  const S = semillas();
  const seed = S.find(x => String(x.id) === '700010');
  test('existe la semilla 700010', !!seed, seed && seed.contratista);
  const real = { id: 700010, fecha: '2026-04-28', contratista: 'Ferretería Cosme Inc.', categoria: 'Materiales', lote: '132A', metodo: 'efectivo', monto: 232.48, descripcion: 'GASTO REAL', tipo: 'manual' };
  const r = fusionar([clon(seed)], [real]);
  test('el registro real sustituye a la semilla', r.gastos.length === 1 && r.gastos[0].contratista === 'Ferretería Cosme Inc.' && r.gastos[0].monto === 232.48, r.gastos[0]);
  test('se cuenta como semilla reemplazada', r.semillasReemplazadas.length === 1 && String(r.semillasReemplazadas[0].id) === '700010', r.semillasReemplazadas);
  test('no se registra como conflicto', r.conflictos.length === 0, r.conflictos);
  test('no se cuenta como gasto agregado', r.agregados === 0, r.agregados);
}

// ── 2. Una semilla EDITADA por el usuario no se pisa ────────────────────────
{
  const S = semillas();
  const seed = clon(S.find(x => String(x.id) === '700010'));
  seed.monto = 1600;                      // el usuario la corrigió
  const real = { id: 700010, fecha: '2026-04-28', contratista: 'Ferretería Cosme Inc.', monto: 232.48, tipo: 'manual' };
  const r = fusionar([seed], [real]);
  test('una semilla editada conserva su valor', r.gastos[0].monto === 1600, r.gastos[0]);
  test('y se reporta como conflicto', r.conflictos.length === 1, r.conflictos.length);
  test('sin reemplazos', r.semillasReemplazadas.length === 0, r.semillasReemplazadas.length);
}

// ── 3. Un gasto normal con el mismo id conserva el comportamiento previo ────
{
  const local = { id: 700010, fecha: '2026-01-01', contratista: 'MIO', monto: 1, tipo: 'manual' };
  const remoto = { id: 700010, fecha: '2026-02-02', contratista: 'OTRO', monto: 2, tipo: 'manual' };
  const r = fusionar([local], [remoto]);
  test('gasto normal: se conserva el local', r.gastos[0].contratista === 'MIO', r.gastos[0]);
  test('gasto normal: conflicto registrado', r.conflictos.length === 1, r.conflictos.length);
  test('gasto normal: sin reemplazos', r.semillasReemplazadas.length === 0, r.semillasReemplazadas.length);
}

// ── 4. Comportamiento general intacto ───────────────────────────────────────
{
  const r = fusionar([{ id: 1, contratista: 'A', fecha: '2026-01-01', monto: 5 }], [{ id: 2, contratista: 'B', fecha: '2026-02-02', monto: 6 }]);
  test('id nuevo se añade', r.gastos.length === 2 && r.agregados === 1, r.agregados);
}
{
  const r = fusionar([{ id: 1, contratista: 'A', fecha: '2026-01-01', monto: 5, descripcion: 'x' }], [{ id: 9, contratista: 'A', fecha: '2026-01-01', monto: 5, descripcion: 'x' }]);
  test('mismo contenido con otro id no duplica', r.gastos.length === 1 && r.agregados === 0, r.agregados);
}
{
  const S = semillas();
  const seed = clon(S.find(x => String(x.id) === '700011'));
  const r = fusionar([clon(seed)], [clon(seed)]);
  test('semilla idéntica: ni reemplazo ni conflicto', r.semillasReemplazadas.length === 0 && r.conflictos.length === 0, { sem: r.semillasReemplazadas.length, con: r.conflictos.length });
}

// ── 5. Todas las semillas ceden ante datos reales ───────────────────────────
{
  const S = semillas();
  const reales = S.map(s => ({ id: s.id, fecha: '2030-12-31', contratista: 'REAL-' + s.id, monto: 999, tipo: 'manual' }));
  const r = fusionar(clon(S), reales);
  test('las 11 semillas ceden ante el respaldo real', r.semillasReemplazadas.length === S.length && r.gastos.every(g => String(g.contratista).startsWith('REAL-')), { n: S.length, reemplazadas: r.semillasReemplazadas.length });
}

// ── 6. Mutación: quitar la preferencia por el dato real debe fallar ─────────
if (!process.env.A132_HTML) {
  const mut = html.replace("if(gemelo && esSemilla(gemelo) && !esSemilla(r) && JSON.stringify(gemelo)!==JSON.stringify(r)){", "if(false){");
  test('mutación aplicable (quitar preferencia por el dato real)', mut !== html);
  if (mut !== html) {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'a132-sem-'));
    const p = path.join(dir, 'm.html');
    fs.writeFileSync(p, mut);
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, A132_HTML: p }, encoding: 'utf8' });
    test('la mutación hace fallar la suite', r.status !== 0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
