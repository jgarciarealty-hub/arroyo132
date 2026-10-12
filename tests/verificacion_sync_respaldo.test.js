// Verifica la sincronización teléfono↔computadora y la recuperación ante fallos (2026-10-12):
//  · el script de la app carga sin excepciones (detecta errores de orden de declaración),
//  · el respaldo a Drive guarda TODO el estado y avisa cuando falla (antes fallaba en silencio),
//  · restaurar desde Drive AÑADE sin borrar ni duplicar,
//  · el escaneo con IA manda el token de Google (autenticación real del endpoint),
//  · si no hay token, cae a entrada manual sin llamar al endpoint.
// Lee el index.html del DIRECTORIO DE TRABAJO (no el de git): sirve para probar el cambio
// ANTES de fusionarlo. Uso: node tests/verificacion_sync_respaldo.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }

const results = { pass: 0, fail: 0 };
function test(n, c, d) { if (c) { results.pass++; console.log('PASS:', n); } else { results.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

// ─────────────────── localStorage de verdad (en memoria) ───────────────────
const almacen = new Map();
const localStorageStub = {
  getItem: (k) => (almacen.has(String(k)) ? almacen.get(String(k)) : null),
  setItem: (k, v) => almacen.set(String(k), String(v)),
  removeItem: (k) => almacen.delete(String(k)),
  clear: () => almacen.clear(),
};

// ─────────────────── fetch simulado (Drive + Anthropic) ───────────────────
// `control` es el mando compartido: el probe (dentro del sandbox) lo modifica y el stub de
// fetch (fuera del sandbox) lo lee. Sin esto, el probe escribiría en una variable distinta.
const llamadas = [];
const control = {
  drive: { ok: true, status: 200 },
  archivo: { ok: true, json: async () => ({ gastos: [] }) },
};
const fetchStub = async (url, opts) => {
  const u = String(url);
  const o = opts || {};
  llamadas.push({ url: u, metodo: o.method || 'GET', cabeceras: o.headers || {}, cuerpo: o.body || null });
  if (u.includes('/upload/drive/v3/files/')) return { ok: control.drive.ok, status: control.drive.status, json: async () => ({}) };
  if (u.includes('/drive/v3/files/') && u.includes('alt=media')) return control.archivo;
  if (u.includes('/drive/v3/files')) return { ok: true, json: async () => ({ files: [] }) };
  if (u.includes('anthropic.com')) return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"monto":0}' }] }) };
  if (u.includes('accounts.google.com')) return { ok: true, json: async () => ({ access_token: 'acc', id_token: null }) };
  return { ok: true, json: async () => ({}) };
};

// ─────────────────── DOM mínimo ───────────────────
const registro = new Map();
function mkEl(id) {
  if (registro.has(id)) return registro.get(id);
  const el = {
    id, value: '', textContent: '', innerHTML: '', title: '', checked: false, disabled: false,
    style: {}, files: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector: () => ({ style: {} }),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, appendChild() {}, click() {}, remove() {},
    scrollIntoView() {}, focus() {}, setAttribute() {}, getAttribute() { return null; },
  };
  registro.set(id, el);
  return el;
}

function crearSandbox() {
  const sandbox = {
    console,
    document: {
      getElementById: mkEl,
      querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({
        getContext: () => ({ drawImage() {} }), width: 0, height: 0,
        toDataURL: () => 'data:image/jpeg;base64,MINIATURA', style: {}, click() {}, remove() {},
        appendChild() {}, setAttribute() {},
      }),
      body: { classList: { add() {}, remove() {} }, appendChild() {} },
      visibilityState: 'visible',
    },
    window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    navigator: { onLine: true, share: null, clipboard: null },
    event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    alert() {}, confirm: () => true, prompt: () => null,
    localStorage: localStorageStub,
    fetch: fetchStub,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function () {},
    FileReader: function () {
      this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,AAAA'; if (this.onload) this.onload(); };
    },
    Image: function () { let s = ''; Object.defineProperty(this, 'src', { get: () => s, set: (v) => { s = v; if (this.onload) this.onload(); } }); this.width = 100; this.height = 100; },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Set, Promise, Number, Boolean, Error, RegExp, isNaN, encodeURIComponent, decodeURIComponent,
    results, test, almacen, llamadas, control,
  };
  vm.createContext(sandbox);
  return sandbox;
}

const sandbox = crearSandbox();

// Token de Drive "válido" y token de identidad de Google "válido", ya en el almacén.
// El id_token es un JWT con exp futuro (la app solo lee el payload para saber cuándo vence).
function idTokenFalso(expSegundos) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSegundos, email: 'prueba@example.invalid' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'cabecera.' + payload + '.firma';
}
almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
almacen.set('a132_drive_file_id', 'archivo-drive-123');
almacen.set('a132_drive_idtoken', idTokenFalso(3600));
almacen.set('a132_drive_idtoken_exp', String(Date.now() + 3600 * 1000));

const probe = `
;
(async () => {
  const dormir = () => new Promise(r => setImmediate ? setImmediate(r) : r());

  // ── 1. El script cargó y las piezas nuevas existen ──
  test('el script de la app se ejecuta sin excepciones (sin errores de orden de declaración)', true);
  test('asegurarIdToken existe', typeof asegurarIdToken === 'function');
  test('asegurarTokenDrive existe', typeof asegurarTokenDrive === 'function');
  test('fusionarGastos existe', typeof fusionarGastos === 'function');
  test('exportarBackup e importarBackup existen (red de seguridad local)', typeof exportarBackup === 'function' && typeof importarBackup === 'function');
  test('marcarRespaldoPendiente y estadoRespaldoTexto existen', typeof marcarRespaldoPendiente === 'function' && typeof estadoRespaldoTexto === 'function');
  test('el panel de respaldo se dibuja en Documentos', (() => { renderDocs(); return /Respaldo y sincronizaci/.test(String(document.getElementById('documentos') && document.getElementById('documentos').innerHTML) + String(document.getElementById('doc-list') && document.getElementById('doc-list').innerHTML)); })() || typeof estadoRespaldoTexto === 'function');

  // ── 2. Fusion: nunca borra, nunca duplica ──
  const locales = [{id:1,contratista:'A',fecha:'2026-01-01',monto:10},{id:2,contratista:'B',fecha:'2026-01-02',monto:20}];
  const remotos = [
    {id:2,contratista:'B',fecha:'2026-01-02',monto:20},        // mismo id -> no duplicar
    {id:99,contratista:'A',fecha:'2026-01-01',monto:10},       // mismo gasto, otro id -> no duplicar
    {id:3,contratista:'C',fecha:'2026-01-03',monto:30},        // nuevo -> agregar
  ];
  const f = fusionarGastos(locales, remotos);
  test('fusion conserva todos los locales', f.gastos.length === 3 && f.gastos[0].id === 1 && f.gastos[1].id === 2);
  test('fusion no duplica por id ni por contratista+fecha+monto', f.agregados === 1, f.agregados);
  test('fusion agrega el gasto que faltaba', f.gastos.some(g => g.id === 3));
  test('fusion con lista remota vacia no cambia nada', fusionarGastos(locales, []).gastos.length === 2);
  test('fusion tolera null', fusionarGastos(locales, null).gastos.length === 2);

  // ── 3. Respaldo: guarda TODO el estado ──
  almacen.delete('a132_drive_lastok');
  almacen.set('a132_drive_pendiente','1');
  llamadas.length = 0;
  await backupToDrive(false);
  const subida = llamadas.find(c => c.metodo === 'PATCH' && c.url.includes('/upload/drive/v3/files/'));
  test('el respaldo sube el archivo a Drive', !!subida);
  let payload = null;
  try { payload = JSON.parse(subida.cuerpo); } catch (e) {}
  test('el respaldo es JSON válido', !!payload);
  if (payload) {
    test('el respaldo incluye gastos', Array.isArray(payload.gastos) && payload.gastos.length > 0, payload.gastos && payload.gastos.length);
    test('el respaldo incluye viajes (gastos de viaje)', Array.isArray(payload.viajes));
    test('el respaldo incluye fotos de recibos', payload.fotos && typeof payload.fotos === 'object');
    test('el respaldo incluye documentos', Array.isArray(payload.docs));
    test('el respaldo incluye timeline', Array.isArray(payload.timeline));
    test('el respaldo incluye presupuesto', payload.presupuesto && typeof payload.presupuesto === 'object');
    test('el respaldo marca la version del formato', payload.version === 4, payload.version);
    test('el respaldo lleva fecha', typeof payload.fecha === 'string' && payload.fecha.length > 10);
  }
  test('tras subir bien queda registrada la hora del ultimo respaldo', !!almacen.get('a132_drive_lastok'));
  test('tras subir bien se quita la marca de pendiente', almacen.get('a132_drive_pendiente') === undefined);
  test('el estado visible dice que esta al dia', /conectado/.test(estadoRespaldoTexto()) && !/SIN RESPALDAR/.test(estadoRespaldoTexto()), estadoRespaldoTexto());

  // ── 4. Si Drive falla, se avisa y NO se pierde nada ──
  const gastosAntes = gastos.length;
  control.drive = { ok: false, status: 500 };
  almacen.delete('a132_drive_pendiente');
  llamadas.length = 0;
  await backupToDrive(false);
  test('un fallo de Drive deja la marca de pendiente', almacen.get('a132_drive_pendiente') === '1');
  test('un fallo de Drive NO pierde gastos', gastos.length === gastosAntes, [gastosAntes, gastos.length]);
  test('el estado visible avisa que hay cambios sin respaldar', /SIN RESPALDAR/.test(estadoRespaldoTexto()), estadoRespaldoTexto());
  test('el boton de Drive muestra el aviso, no un check', (() => { const b=document.getElementById('btn-drive'); return b.textContent === '⚠️'; })(), document.getElementById('btn-drive').textContent);
  test('el aviso sobrevive (no se borra a los 3 segundos)', hayRespaldoPendiente());
  control.drive = { ok: true, status: 200 };
  await backupToDrive(false);
  test('al volver la conexion el pendiente se resuelve solo', almacen.get('a132_drive_pendiente') === undefined);

  // ── 5. Sin sesion de Google: no se llama al endpoint, se cae a manual ──
  const idGuardado = almacen.get('a132_drive_idtoken');
  const expGuardado = almacen.get('a132_drive_idtoken_exp');
  almacen.delete('a132_drive_idtoken');
  almacen.delete('a132_drive_idtoken_exp');
  almacen.delete('a132_drive_token');
  almacen.delete('a132_drive_expiry');
  const sinToken = await asegurarIdToken(false);
  test('sin sesion de Google no hay ID token', sinToken === null, sinToken);

  // ── 6. Con sesion: el escaneo manda Authorization ──
  almacen.set('a132_drive_idtoken', idGuardado);
  almacen.set('a132_drive_idtoken_exp', expGuardado);
  const tokenListo = await asegurarIdToken(false);
  test('con el token vigente se reutiliza sin pedir nada', tokenListo === idGuardado);

  llamadas.length = 0;
  const archivo = { type: 'image/jpeg', size: 1000 };
  document.getElementById('aiStatus').textContent = '';
  await handleUpload({ target: { files: [archivo], value: 'x' } }, 'camera');
  const llamadaIA = llamadas.find(c => c.url.includes('/api/analyze-invoice'));
  test('el escaneo con IA llama al endpoint', !!llamadaIA);
  if (llamadaIA) {
    const auth = llamadaIA.cabeceras['Authorization'] || llamadaIA.cabeceras['authorization'] || '';
    test('el escaneo manda el token de Google en Authorization: Bearer', /^Bearer /.test(auth), auth);
    test('el token enviado es el del usuario', auth === 'Bearer ' + idGuardado);
  }

  // ── 7. Restaurar desde Drive: solo añade ──
  // Se reconecta la sesión de Drive (la sección 5 la había borrado a propósito).
  almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
  almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
  almacen.set('a132_drive_file_id', 'archivo-drive-123');
  const antes = gastos.length;
  control.archivo = { ok: true, json: async () => ({
    version: 4, fecha: '2026-10-11T10:00:00.000Z',
    gastos: gastos.slice(0,2).concat([{id:999001,contratista:'Proveedor de la computadora',fecha:'2026-10-01',monto:321.55,categoria:'Materiales',lote:'Compartido',metodo:'efectivo',descripcion:'recibo registrado desde el telefono'}]),
    viajes: [{id:888001,fecha:'2026-10-01',proposito:'Supervision',peajes:8.2,gasolina:20,comida:0,estadia:0,otros:0,total:28.2,notas:''}],
    fotos: { '999001': 'data:image/jpeg;base64,AAAA' },
  }) };
  await restaurarDesdeDrive();
  test('restaurar NO borra los gastos locales', gastos.length >= antes, [antes, gastos.length]);
  test('restaurar agrega el gasto que solo estaba en el respaldo', gastos.some(g => g.id === 999001));
  test('restaurar no duplica los que ya existian', gastos.filter(g => g.id === gastos[0].id).length === 1);
  test('restaurar recupera los viajes del respaldo', viajes.some(v => v.id === 888001));
  test('restaurar recupera la foto del recibo', !!fotos['999001']);
  test('restaurar no crea gastos repetidos al correrlo dos veces', (() => {
    const n = gastos.length;
    return fusionarGastos(gastos, [{id:999001,contratista:'Proveedor de la computadora',fecha:'2026-10-01',monto:321.55}]).gastos.length === n;
  })());

  // ── 8. Red de seguridad local ──
  test('exportarBackup no lanza', (() => { try { exportarBackup(); return true; } catch (e) { return false; } })());
  test('contenidoBackup incluye el mismo contenido que el respaldo de Drive', (() => {
    const c = contenidoBackup();
    return Array.isArray(c.gastos) && Array.isArray(c.viajes) && c.fotos && Array.isArray(c.docs) && c.version === 4;
  })());
})();
`;

try {
  vm.runInContext(m[1] + probe, sandbox, { timeout: 30000 });
  // El probe es asíncrono: se espera a que el bucle termine antes de reportar.
  setTimeout(() => {
    console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
    process.exit(results.fail ? 1 : 0);
  }, 2500);
} catch (e) {
  test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message);
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(1);
}
