// Guardado con almacenamiento lleno: save() no debe lanzar ni mentir, y el botón no debe quedar en «Guardando…».
// Funciones REALES extraídas de index.html; localStorage simulado; sin red ni Drive real.
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
function ejecutarSave(ls) {
  const ctx = {
    localStorage: typeof ls === 'function' ? { getItem: () => null, setItem: ls, removeItem: () => {} } : ls,
    gastos: [{ id: 1 }], servicios: [], contratistas: [], timeline: [], docs: [], fotos: {},
    console: { warn: () => {} }, JSON, backupToDrive: null, modoCentral: null,
  };
  vm.createContext(ctx);
  vm.runInContext(extraer('save') + '\nthis.__r = save();', ctx);
  return ctx.__r;
}

// ── save(): cuota llena ────────────────────────────────────────────────────────
let lanzo = false, r;
try { r = ejecutarSave(() => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }); }
catch (e) { lanzo = true; }
test('save() no propaga la excepción de cuota', !lanzo);
test('save() devuelve false cuando la cuota está llena', r === false, r);

// ── save(): vía normal ────────────────────────────────────────────────────────
const escritos = [];
const r2 = ejecutarSave((k, v) => { escritos.push(k); });
test('save() devuelve true cuando la persistencia funciona', r2 === true, r2);
test('save() escribe el estado de gastos', escritos.includes('a132_gastos'), escritos);

// ── guardarGasto: el botón no queda bloqueado y el gasto no se anuncia sin persistir ──
const g = extraer('guardarGasto');
test('guardarGasto comprueba el resultado de save()', /if\s*\(\s*!save\(\)\s*\)/.test(g));
const iFallo = g.indexOf('if(!save())') >= 0 ? g.indexOf('if(!save())') : g.search(/if\s*\(\s*!save\(\)\s*\)/);
const iReactivar = g.indexOf('reactivarBoton()', iFallo);
const iRegistrar = g.indexOf('registrarOriginalNuevo');
test('en el fallo se reactiva el botón antes de seguir', iReactivar > iFallo && (iRegistrar < 0 || iReactivar < iRegistrar));
test('el original solo se registra después del guardado exitoso', iRegistrar > iFallo);
test('no se anuncia «Gasto guardado» sin pasar por la comprobación', g.indexOf('✅ Gasto guardado') > iFallo);

// ── save(): con cuota llena NO borra miniaturas históricas ───────────────────
let removido = false; const escritosPost = [];
const fake = {
  getItem: () => null,
  removeItem: (k) => { if (k === 'a132_fotos') removido = true; },
  setItem: (k) => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; },
};
const r3 = ejecutarSave(fake);
test('con cuota llena save() devuelve false y NO borra a132_fotos', r3 === false && removido === false && !escritosPost.includes('a132_fotos'), { r3, removido, escritosPost });
test('save() no contiene un removeItem destructivo de a132_fotos', !/removeItem\('a132_fotos'\)/.test(extraer('save')));

// ── Miniaturas en IndexedDB (migración) ──────────────────────────────────────
test('save() ya no escribe las miniaturas en localStorage', !/localStorage\.setItem\('a132_fotos'/.test(extraer('save')));
test('guardarGasto guarda la miniatura en IndexedDB', /fotosGuardar\(nuevoId,_fotoSmall\)/.test(extraer('guardarGasto')));
test('existe fotosMigrar y borra la clave legacy tras escribir', /async function fotosMigrar\(/.test(script) && /localStorage\.removeItem\('a132_fotos'\)/.test(script));
test('la migración y el volcado usan la base separada a132_fotos_db', /const FOTOS_DB='a132_fotos_db'/.test(script) && /async function fotosVolcar\(/.test(script));

console.log('');
console.log(pass + ' pasaron, ' + fail + ' fallaron');
process.exit(fail ? 1 : 0);
