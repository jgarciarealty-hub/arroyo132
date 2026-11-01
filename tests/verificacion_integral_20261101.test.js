// Corrección integral 2026-11-01: extracción IA veraz, recibo original, respaldo verificado y causa 61 vs 11.
// Uso: node tests/verificacion_integral_20261101.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

function extraer(nombre) {
  const i = script.indexOf('function ' + nombre + '(');
  const j = script.indexOf('async function ' + nombre + '(');
  let ini = i >= 0 ? i : j;
  if (i >= 0 && script.slice(Math.max(0,i-6), i) === "async ") ini = i - 6;
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), nivel = 0;
  for (; k < script.length; k++) { if (script[k] === '{') nivel++; else if (script[k] === '}') { nivel--; if (!nivel) break; } }
  return script.slice(ini, k + 1);
}

// ── 1. Extracción veraz ──────────────────────────────────────────────────────
const ctx = vm.createContext({});
vm.runInContext(['interpretarExtraccion', 'textoEstadoExtraccion', 'verificarEscrituraBackup'].map(extraer).join('\n'), ctx);
const I = (t) => vm.runInContext('interpretarExtraccion', ctx)(t);
const T = (l) => vm.runInContext('textoEstadoExtraccion', ctx)(l);

const buena = I('{"fecha":"2026-04-15","monto":293.02,"contratista":"Ferretería X","categoria":"Electricidad"}');
test('respuesta completa → completa y mensaje de éxito', buena.estado === 'completa' && T(buena).startsWith('✅'), buena);
test('respuesta con texto alrededor se interpreta', I('Aquí va: {"fecha":"2026-04-15","monto":"$1,200.50","contratista":"A"} fin').campos.monto === 1200.5);
const vacia = I('');
test('texto vacío → vacia y NUNCA dice "Datos extraídos"', vacia.estado === 'vacia' && !T(vacia).includes('Datos extraídos'), T(vacia));
test('JSON con ceros/cadenas vacías → vacia', I('{"fecha":"","monto":0,"contratista":""}').estado === 'vacia');
test('texto ilegible → vacia', I('lo siento, no puedo leer').estado === 'vacia');
test('JSON truncado (max_tokens) → vacia o parcial, nunca completa', I('{"fecha":"2026-04-15","monto":29').estado !== 'completa');
const parc = I('{"fecha":"2026-04-15","monto":0,"contratista":"Casa X"}');
test('parcial indica qué falta', parc.estado === 'parcial' && parc.faltan.join() === 'monto' && T(parc).includes('monto') && !T(parc).startsWith('✅'), T(parc));
test('fecha imposible se descarta', I('{"fecha":"2026-13-45","monto":5,"contratista":"A"}').faltan.includes('fecha'));
test('monto negativo se descarta', I('{"fecha":"2026-04-15","monto":-5,"contratista":"A"}').faltan.includes('monto'));
test('array o null no rompe', I('[1,2]').estado === 'vacia' && I('null').estado === 'vacia');

// el handler usa el intérprete y no cachea respuestas vacías
test('handleUpload usa interpretarExtraccion y textoEstadoExtraccion', /interpretarExtraccion\(text\)/.test(script) && /textoEstadoExtraccion\(lectura\)/.test(script));
test('no se cachea lectura vacía', /if\(lectura\.estado!=='vacia'\) guardarEnCacheIA/.test(script));
test('ya no existe el éxito incondicional', !/aiStatus\.textContent='✅ Datos extraídos — revisa y confirma';\s*\n\s*aiBox/.test(script));

// ── 2. Verificación del respaldo ─────────────────────────────────────────────
const V = (a, b) => vm.runInContext('verificarEscrituraBackup', ctx)(a, b);
const esp = { gastos: [{ id: 1, monto: 10 }, { id: 2, monto: 5.5 }] };
test('relectura completa → ok con conteo y suma', (() => { const r = V(esp, { gastos: [{ id: 1, monto: 10 }, { id: 2, monto: 5.5 }] }); return r.ok && r.gastos === 2 && r.monto === 15.5; })());
test('relectura con faltantes → falla', V(esp, { gastos: [{ id: 1, monto: 10 }] }).ok === false);
test('relectura sin lista → falla', V(esp, {}).ok === false && V(esp, null).ok === false);
test('Drive con más gastos que lo escrito → ok (no se pierde nada)', V(esp, { gastos: [{ id: 1 }, { id: 2 }, { id: 3, monto: 1 }] }).ok === true);
const iOk = script.search(/marcarRespaldoOk\(\);\s*if\(mostrarFeedback\)/);
const iVer = script.indexOf('verificarEscrituraBackup(combinado');
test('marcarRespaldoOk ocurre DESPUÉS de verificar por relectura', iVer > 0 && iOk > iVer);
test('guarda de no-regresión antes de subir el combinado', script.indexOf('el combinado perdería') > 0 && script.indexOf('el combinado perdería') < script.indexOf('const idArchivo = await driveSubir'));

// ── 3. Recibo original (IndexedDB simulado) ──────────────────────────────────
const bd = new Map();
const fakeIDB = { open() {
  const rq = {};
  setTimeout(() => {
    const db = { createObjectStore() {}, close() {}, transaction() {
      const tx = { objectStore() { return {
        put(v, k) { bd.set(k, v); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
        get(k) { const r = { result: bd.get(k) }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
        delete(k) { bd.delete(k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
      }; } };
      return tx;
    } };
    rq.result = db; rq.onupgradeneeded && rq.onupgradeneeded(); rq.onsuccess && rq.onsuccess();
  }, 0);
  return rq;
} };
const ctx2 = vm.createContext({ indexedDB: fakeIDB, setTimeout, console, String });
vm.runInContext('const ORIG_DB="a132_originales", ORIG_STORE="recibos";' + ['origAbrir', 'origGuardar', 'origLeer', 'origBorrar'].map(extraer).join('\n'), ctx2);
(async () => {
  const archivo = { type: 'image/jpeg', name: 'recibo.jpg', size: 3500000 };
  const ok = await vm.runInContext('origGuardar', ctx2)(777, archivo);
  test('guarda el original completo (no miniatura)', ok === true && bd.get('777').blob === archivo && bd.get('777').bytes === 3500000);
  const leido = await vm.runInContext('origLeer', ctx2)(777);
  test('lo recupera por id de gasto', leido && leido.tipo === 'image/jpeg');
  test('gasto sin original → null (la UI muestra aviso, no falla)', (await vm.runInContext('origLeer', ctx2)(1)) === null);
  await vm.runInContext('origBorrar', ctx2)(777);
  test('al eliminar el gasto se borra su original', !bd.has('777'));
  const ctx3 = vm.createContext({ console, String });
  vm.runInContext('const ORIG_DB="x", ORIG_STORE="y";' + ['origAbrir', 'origGuardar', 'origLeer'].map(extraer).join('\n'), ctx3);
  test('sin IndexedDB: guardar devuelve false y no lanza', (await vm.runInContext('origGuardar', ctx3)(1, archivo)) === false);
  test('detalle del gasto ofrece «Ver recibo original»', /verReciboOriginal\(\$\{g\.id\}\)/.test(script) && /id="orig-recibo-\$\{g\.id\}"/.test(script));
  test('guardarGasto conserva el original', /origGuardar\(nuevoId,_archivoOriginal\)/.test(script));

  // ── 4. Causa 61 vs 11: el conjunto sembrado ─────────────────────────────────
  const bloque = script.slice(script.indexOf('const recuperados=['), script.indexOf('];', script.indexOf('const recuperados=[')));
  const montos = [...bloque.matchAll(/\{id:7000\d\d,[^\n]*?monto:([\d.]+)/g)].map(x => +x[1]);
  test('conjunto sembrado = 11 gastos por $3,299.58 (el "respaldo viejo")', montos.length === 11 && Math.abs(montos.reduce((a, b) => a + b, 0) - 3299.58) < 0.005, montos.length);

  // ── 5. Panel de estado ──────────────────────────────────────────────────────
  test('panel muestra ubicación, conteo y verificación por relectura', /Datos en este dispositivo/.test(script) && /Drive verificado por relectura/.test(script) && /solo en este dispositivo, no en Drive/.test(script));

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
