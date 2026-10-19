// Verifica el arreglo de ACCESO POR PIN (2026-10-19).
// Causa raiz: la version publicada entre el 5-jul y el 20-sep (base fc0a54e) guardaba el
// PIN con SHA-256 + sal; main usa un hash sincrono distinto. Un PIN correcto creado en esa
// ventana nunca coincidia -> 5 intentos -> bloqueo de 5 minutos que se repetia.
// Este arreglo ACEPTA los formatos anteriores y migra a SHA-256; NO desactiva la autenticacion.
// Uso: node tests/verificacion_pin_acceso.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }

const PIN_SALT = 'a132-jgarcia-realty-2025';
const sha256hex = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
// Reimplementacion host-side del hash con sal de fc0a54e (8 hex) para no validar con la
// misma funcion que se esta probando.
function legacySaltHost(pin) {
  let h = 0x9e3779b9;
  const str = PIN_SALT + pin;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
    h = ((h << 13) | (h >>> 19)) ^ (h + 0x6c62272e);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const results = { pass: 0, fail: 0 };
function test(n, c, d) {
  if (c) { results.pass++; console.log('PASS:', n); }
  else { results.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); }
}

let subtleOn = true;
function cargarApp(seed) {
  const store = Object.assign({}, seed || {});
  const registry = {};
  const almacen = {};
  function mkEl(id) {
    if (registry[id]) return registry[id];
    const el = { checked: false, disabled: false, style: {}, _t: '', innerHTML: '',
      classList: { add() {}, remove() {}, contains() { return false; } },
      querySelector() { return { style: {} }; }, addEventListener() {} };
    Object.defineProperty(el, 'value', { get() { return id in almacen ? almacen[id] : ''; }, set(v) { almacen[id] = v; } });
    Object.defineProperty(el, 'textContent', { get() { return el._t; }, set(v) { el._t = v; } });
    el.trim = () => (el.value || '').trim();
    registry[id] = el;
    return el;
  }
  const sandbox = {
    console, results, test,
    __store: store, __el: mkEl, __setSubtle: (v) => { subtleOn = v; },
    crypto: { get subtle() { return subtleOn ? nodeCrypto.webcrypto.subtle : undefined; } },
    TextEncoder,
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
    localStorage: { setItem(k, v) { store[k] = String(v); }, getItem(k) { return k in store ? store[k] : null; }, removeItem(k) { delete store[k]; }, get length() { return Object.keys(store).length; }, key(i) { return Object.keys(store)[i]; } },
    fetch: () => Promise.reject(new Error('sin red')),
    Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { timeout: 20000 });
  return sandbox;
}
const en = (sandbox, code) => vm.runInContext(code, sandbox, { timeout: 20000 });

(async () => {
  try {
    // ================= contexto principal =================
    const s = cargarApp({});
    const PIN_KEY = en(s, 'PIN_KEY');

    // ---- los tres formatos de credencial guardada ----
    await en(s, `(async () => {
      const fuerte = ${JSON.stringify(sha256hex(PIN_SALT + '1234'))};
      const legacy = ${JSON.stringify(legacySaltHost('1234'))};
      let r = await verificarPin('1234', fuerte);
      test('acepta el formato SHA-256 con sal', r.ok === true && r.migrar === false, r);
      r = await verificarPin('1234', legacy);
      test('acepta el formato de julio (sal + hash 8 hex) y pide migrar', r.ok === true && r.migrar === true, r);
      r = await verificarPin('1234', hashPin('1234'));
      test('sigue aceptando el formato actual de main', r.ok === true && r.migrar === false, r);
      r = await verificarPin('9999', fuerte);
      test('rechaza un PIN incorrecto en cualquier formato', r.ok === false && r.migrar === false, r);
      r = await verificarPin('1234', 'basura');
      test('rechaza una credencial corrupta sin lanzar excepcion', r.ok === false, r);
    })()`);

    // ---- login con credencial de julio: entra y migra a SHA-256 ----
    __seedStore(s, { a132_pin_hash: legacySaltHost('1234') });
    await en(s, `(async () => {
      pinBuffer = '1234';
      await processPin();
      test('PIN de julio correcto: entra (sesion creada)', !!localStorage.getItem('a132_session'));
      test('al entrar migra la credencial a SHA-256 (64 hex)',
        localStorage.getItem('a132_pin_hash') === ${JSON.stringify(sha256hex(PIN_SALT + '1234'))},
        localStorage.getItem('a132_pin_hash'));
      test('al entrar deja los intentos en 0 y sin bloqueo',
        localStorage.getItem('a132_attempts') === '0' && !localStorage.getItem('a132_lockuntil'));
    })()`);

    // ---- login con credencial actual de main: entra sin cambiar el hash ----
    __seedStore(s, {});
    const hashMain = en(s, `hashPin('1234')`);
    s.__store.a132_pin_hash = hashMain;
    await en(s, `(async () => {
      pinBuffer = '1234';
      await processPin();
      test('PIN guardado por main: entra y NO reescribe la credencial',
        localStorage.getItem('a132_pin_hash') === ${JSON.stringify(hashMain)} && !!localStorage.getItem('a132_session'));
    })()`);

    // ---- PIN incorrecto: no entra, cuenta el intento ----
    __seedStore(s, { a132_pin_hash: sha256hex(PIN_SALT + '1234') });
    await en(s, `(async () => {
      pinBuffer = '9999';
      await processPin();
      test('PIN incorrecto: NO crea sesion', !localStorage.getItem('a132_session'));
      test('PIN incorrecto: incrementa el contador a 1', localStorage.getItem('a132_attempts') === '1', localStorage.getItem('a132_attempts'));
      test('PIN incorrecto: muestra el aviso con intentos restantes',
        document.getElementById('pinError').textContent.includes('incorrecto') &&
        document.getElementById('pinError').textContent.includes('4'), document.getElementById('pinError').textContent);
      test('PIN incorrecto: no altera la credencial guardada',
        localStorage.getItem('a132_pin_hash') === ${JSON.stringify(sha256hex(PIN_SALT + '1234'))});
      // 4 intentos mas -> bloqueo de 5 minutos
      for (let i = 0; i < 4; i++) { pinBuffer = '9999'; await processPin(); }
      const hasta = parseInt(localStorage.getItem('a132_lockuntil') || '0', 10);
      const mins = (hasta - Date.now()) / 60000;
      test('al 5to intento bloquea ~5 minutos', mins > 4 && mins <= 5.1, mins);
      test('al bloquear muestra el mensaje de bloqueo',
        /Bloqueado|Demasiados intentos/.test(document.getElementById('pinError').textContent), document.getElementById('pinError').textContent);
    })()`);

    // ---- el bloqueo vencido se limpia (el defecto que re-bloqueaba) ----
    const s2 = cargarApp({ a132_attempts: '5', a132_lockuntil: String(Date.now() - 1000) });
    en(s2, `
      test('bloqueo vencido: se borra a132_lockuntil al arrancar', !localStorage.getItem('a132_lockuntil'));
      test('bloqueo vencido: los intentos vuelven a 0', localStorage.getItem('a132_attempts') === '0', localStorage.getItem('a132_attempts'));
      test('bloqueo vencido: el teclado queda usable (no bloqueado)', checkLockout() === false);
    `);

    // ---- bloqueo con fecha imposible (reloj cambiado / dato corrupto) ----
    const s3 = cargarApp({ a132_lockuntil: String(Date.now() + 24 * 60 * 60 * 1000) });
    en(s3, `
      test('bloqueo a 24h (imposible con ventana de 5 min): se descarta',
        !localStorage.getItem('a132_lockuntil') && checkLockout() === false);
    `);

    // ---- bloqueo vigente y legitimo: SI se respeta ----
    const hasta = Date.now() + 2 * 60 * 1000;
    const s4 = cargarApp({ a132_lockuntil: String(hasta) });
    en(s4, `
      test('bloqueo vigente: se mantiene y bloquea', checkLockout() === true && !!localStorage.getItem('a132_lockuntil'));
      test('bloqueo vigente: el teclado queda deshabilitado',
        document.getElementById('pinPad').style.pointerEvents === 'none');
    `);

    // ---- contador corrupto ----
    const s5 = cargarApp({ a132_attempts: 'abc' });
    en(s5, `test('contador no numerico: arranca en 0, no en NaN', pinAttempts === 0, pinAttempts);`);

    // ---- sin crypto.subtle (navegador viejo / contexto no seguro) ----
    const s6 = cargarApp({ a132_pin_hash: legacySaltHost('4321') });
    s6.__setSubtle(false);
    await en(s6, `(async () => {
      const f = await hashPinFuerte('4321');
      test('sin crypto.subtle: hashPinFuerte devuelve null sin lanzar', f === null, f);
      pinBuffer = '4321';
      await processPin();
      test('sin crypto.subtle: el PIN de julio sigue entrando', !!localStorage.getItem('a132_session'));
      test('sin crypto.subtle: conserva la credencial anterior (no puede migrar)',
        localStorage.getItem('a132_pin_hash') === ${JSON.stringify(legacySaltHost('4321'))});
    })()`);
    s6.__setSubtle(true);

    // ---- PIN nuevo se guarda fuerte y no deja los digitos en el hash ----
    const s7 = cargarApp({});
    await en(s7, `(async () => {
      pinBuffer = '5073'; await processPin();   // primer paso: pide confirmacion
      pinBuffer = '5073'; await processPin();   // confirmacion
      const g = localStorage.getItem('a132_pin_hash') || '';
      test('PIN nuevo: se guarda como SHA-256 (64 hex)', /^[0-9a-f]{64}$/.test(g), g);
      test('PIN nuevo: el hash coincide con SHA-256(sal+PIN)',
        g === ${JSON.stringify(sha256hex(PIN_SALT + '5073'))});
      test('PIN nuevo: el hash NO contiene los digitos del PIN en hexadecimal',
        !g.includes('5073') && !g.includes('35303733'));
      test('PIN nuevo: entra sin pedir intentos', !!localStorage.getItem('a132_session'));
    })()`);
  } catch (e) {
    test('la suite se ejecuta sin excepciones', false, e && e.message);
  }
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(results.fail ? 1 : 0);
})();

// Reemplaza el localStorage del contexto conservando el mismo objeto store.
function __seedStore(sandbox, seed) {
  for (const k of Object.keys(sandbox.__store)) delete sandbox.__store[k];
  Object.assign(sandbox.__store, seed);
}
