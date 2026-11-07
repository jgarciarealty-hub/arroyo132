// Copias del central y abortos (2026-11-07): localStorage lleno debe caer a IndexedDB,
// la base debe poder leerse desde memoria/IDB, y el aborto heredado debe conservar su motivo.
// Funciones REALES extraídas de index.html; sin red, sin Drive, sin datos reales.
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
function crear({ localOk = true, idbOk = true } = {}) {
  const store = new Map();
  const removed = [];
  const ctx = {
    JSON, Object, Array, String, Number, Set, Map, Math, Promise,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => { if (!localOk) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store.set(String(k), String(v)); },
      removeItem: (k) => { removed.push(String(k)); store.delete(String(k)); },
    },
    idbKvGuardar: async (k, v) => { if (!idbOk) return false; store.set('idb:' + k, String(v)); return true; },
    idbKvLeer: async (k) => store.has('idb:' + k) ? store.get('idb:' + k) : null,
    store, removed,
  };
  ctx.CENTRAL_BASE_KEY = 'a132_central_base';
  vm.createContext(ctx);
  vm.runInContext([
    extraer('guardarTextoCuota'), extraer('leerTextoCuota'), extraer('guardarCopiaCentral'),
    extraer('guardarBaseCentral'), extraer('centralLeerBase'), 'let _centralBaseTexto=null;',
  ].join('\n'), ctx);
  return ctx;
}
const run = async (ctx, expr) => await vm.runInContext(expr, ctx);

(async () => {
  // ── 1. localStorage disponible: no se toca IndexedDB ────────────────────────
  {
    const c = crear();
    test('guardarTextoCuota usa localStorage cuando cabe', (await run(c, 'guardarTextoCuota("k","v")')) === 'local');
    test('leerTextoCuota devuelve el texto local', (await run(c, 'leerTextoCuota("k")')) === 'v');
    test('no se escribió en IndexedDB', !c.store.has('idb:k'));
  }

  // ── 2. localStorage lleno: cae a IndexedDB ──────────────────────────────────
  {
    const c = crear({ localOk: false });
    test('guardarTextoCuota cae a IndexedDB', (await run(c, 'guardarTextoCuota("k","v")')) === 'idb');
    test('leerTextoCuota recupera de IndexedDB', (await run(c, 'leerTextoCuota("k")')) === 'v');
  }

  // ── 3. Ambos almacenes fallan: no se miente ─────────────────────────────────
  {
    const c = crear({ localOk: false, idbOk: false });
    test('con ambos llenos guardarTextoCuota devuelve null', (await run(c, 'guardarTextoCuota("k","v")')) === null);
  }

  // ── 4. La copia que va a IndexedDB retira la copia local vieja ──────────────
  {
    const c = crear({ localOk: false });
    c.store.set('copia', 'vieja');
    test('guardarCopiaCentral escribe en IndexedDB', (await run(c, 'guardarCopiaCentral("copia","nueva")')) === true);
    test('la copia nueva está en IndexedDB', c.store.get('idb:copia') === 'nueva');
    test('se retiró la copia local vieja', c.removed.includes('copia') && !c.store.has('copia'));
  }

  // ── 5. La base va a IndexedDB y centralLeerBase la ve ───────────────────────
  {
    const c = crear({ localOk: false });
    test('guardarBaseCentral tiene éxito con localStorage lleno', (await run(c, 'guardarBaseCentral({a:1})')) === true);
    test('centralLeerBase lee la base desde memoria/IDB', JSON.stringify(await run(c, 'centralLeerBase()')) === '{"a":1}');
    test('no queda una base local vieja', !c.store.has('a132_central_base'));
  }

  // ── 6. Si hay base local, tiene prioridad ───────────────────────────────────
  {
    const c = crear();
    c.store.set('a132_central_base', '{"local":1}');
    c.store.set('idb:a132_central_base', '{"idb":1}');
    test('centralLeerBase prefiere localStorage', JSON.stringify(await run(c, 'centralLeerBase()')) === '{"local":1}');
  }

  // ── 7. Ambos llenos: la base no se guarda ───────────────────────────────────
  {
    const c = crear({ localOk: false, idbOk: false });
    test('guardarBaseCentral falla si no hay ningún almacén', (await run(c, 'guardarBaseCentral({a:1})')) === false);
  }

  // ── 8. fetchConTiempo conserva el motivo del padre ──────────────────────────
  {
    const ctx = {
      JSON, Error, Promise, AbortController, setTimeout, clearTimeout,
      fetch: (url, opts) => new Promise((res, rej) => {
        const s = opts && opts.signal; if (!s) return;
        const falla = () => rej(s.reason || new Error('abortado'));
        if (s.aborted) return falla();
        s.addEventListener('abort', falla, { once: true });
      }),
    };
    vm.createContext(ctx);
    vm.runInContext(extraer('fetchConTiempo'), ctx);
    const padre = await vm.runInContext('new AbortController()', ctx);
    vm.runInContext('globalThis.__p = fetchConTiempo("x", {}, 60000, __ac.signal)', Object.assign(ctx, { __ac: padre }));
    setTimeout(() => padre.abort(new Error('motivo-padre')), 20);
    let msg = '';
    try { await vm.runInContext('__p', ctx); } catch (e) { msg = String(e && e.message || e); }
    test('el aborto heredado conserva el motivo', /motivo-padre/.test(msg), msg);

    let msgT = '';
    try { await vm.runInContext('fetchConTiempo("x", {}, 40)', ctx); } catch (e) { msgT = String(e && e.message || e); }
    test('el tiempo de espera conserva su motivo', /tiempo de espera agotado \(40 ms\)/.test(msgT), msgT);
  }

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e && e.stack || e); process.exit(1); });
