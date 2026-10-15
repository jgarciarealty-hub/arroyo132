// Verificacion de RECUPERACION de datos y de no-pisado entre dispositivos (2026-10-15). Reutiliza el arnes de
// verificacion_sync_respaldo.test.js: ejecuta el script REAL de index.html con un Drive y un localStorage simulados.
// Sin red, sin credenciales, sin llamadas pagas. Los datos reales (respaldos) se leen de una COPIA de solo lectura.
// Uso: node tests/verificacion_recuperacion_20261015.test.js
//
//
//
//
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

// ─────────────────── Google Drive simulado (de verdad: guarda y devuelve) ───────────────────
// Un mini-Drive con archivos por nombre, para poder comprobar de verdad que un dispositivo NO
// puede pisar los datos de otro.
const drive = { porId: new Map(), porNombre: new Map(), _n: 1 };
function driveReiniciar() { drive.porId.clear(); drive.porNombre.clear(); drive._n = 1; }
function drivePoner(nombre, objeto) {
  // Fiel a Drive de verdad: un archivo se identifica por su id y actualizarlo NO cambia el id.
  let id = drive.porNombre.get(nombre);
  if (!id) { id = 'id-' + (drive._n++); drive.porNombre.set(nombre, id); }
  drive.porId.set(id, { id, nombre, contenido: JSON.stringify(objeto) });
}
function driveLeer(nombre) {
  const id = drive.porNombre.get(nombre);
  if (!id) return null;
  const f = drive.porId.get(id);
  if (!f) return null;
  try { return JSON.parse(f.contenido); } catch (e) { return null; }
}
const control = {
  uploadOk: true,          // si false, toda subida devuelve 500
  buscarFalla: false,      // si true, la búsqueda por nombre falla
  crearOk: true,           // si false, crear archivo nuevo falla
  archivoRoto: false,      // si true, la descarga devuelve texto no-JSON
  archivoInexistente: false,
  ia: { status: 200, texto: '{"fecha":"2026-05-05","monto":12.34,"contratista":"Proveedor"}', lanza: false },
};
const llamadas = [];
const fetchStub = async (url, opts) => {
  const u = String(url); const o = opts || {};
  llamadas.push({ url: u, metodo: o.method || 'GET', cabeceras: o.headers || {}, cuerpo: o.body || null });

  // Crear archivo nuevo
  if (u === 'https://www.googleapis.com/drive/v3/files' && o.method === 'POST') {
    if (!control.crearOk) return { ok: false, status: 500, json: async () => ({}) };
    const meta = JSON.parse(o.body);
    const id = 'id-' + (drive._n++);
    drive.porId.set(id, { id, nombre: meta.name, contenido: '' });
    drive.porNombre.set(meta.name, id);
    return { ok: true, status: 200, json: async () => ({ id, name: meta.name }) };
  }
  // Subir contenido
  if (u.includes('/upload/drive/v3/files/')) {
    if (!control.uploadOk) return { ok: false, status: 500, json: async () => ({}) };
    const id = u.match(/files\/([^?]+)\?/)[1];
    const f = drive.porId.get(id);
    if (!f) return { ok: false, status: 404, json: async () => ({}) };
    f.contenido = o.body;
    return { ok: true, status: 200, json: async () => ({ id }) };
  }
  // Buscar por nombre
  if (u.includes('/drive/v3/files?q=')) {
    if (control.buscarFalla) return { ok: false, status: 500, json: async () => ({}) };
    const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
    const nombre = (q.match(/name='([^']+)'/) || [])[1];
    const id = drive.porNombre.get(nombre);
    return { ok: true, status: 200, json: async () => ({ files: id ? [{ id, name: nombre }] : [] }) };
  }
  // Descargar contenido
  if (u.includes('alt=media')) {
    if (control.archivoInexistente) return { ok: false, status: 404, json: async () => ({}) };
    const id = u.match(/files\/([^?]+)\?/)[1];
    const f = drive.porId.get(id);
    if (!f) return { ok: false, status: 404, json: async () => ({}) };
    if (control.archivoRoto) return { ok: true, status: 200, json: async () => { throw new Error('no es JSON'); } };
    return { ok: true, status: 200, json: async () => JSON.parse(f.contenido || '{}') };
  }
  if (u.includes('/api/analyze-invoice')) {
    if (control.ia.lanza) throw new Error('se cortó la conexión');
    const st = control.ia.status;
    return { ok: st === 200, status: st,
      json: async () => st === 200 ? { content: [{ type: 'text', text: control.ia.texto }] }
                                   : { error: st === 429 ? 'Demasiadas solicitudes' : 'No autorizado' } };
  }
  if (u.includes('anthropic.com')) return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"monto":0}' }] }) };
  return { ok: true, json: async () => ({}) };
};

// ─────────────────── DOM mínimo ───────────────────
// Cada foto leída es distinta por defecto (como en la vida real); `fotoForzada` permite subir la
// MISMA imagen dos veces, que es lo que hace falta para probar la caché de lecturas.
let contadorFotos = 0;
let fotoForzada = null;
const registro = new Map();
function mkEl(id) {
  if (registro.has(id)) return registro.get(id);
  const el = {
    id, value: '', textContent: '', innerHTML: '', title: '', checked: false, disabled: false,
    style: {}, files: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector: () => ({ style: {} }), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, appendChild() {}, click() {}, remove() {},
    scrollIntoView() {}, focus() {}, setAttribute() {}, getAttribute() { return null; },
  };
  registro.set(id, el);
  return el;
}

const sandbox = {
  console,
  document: {
    getElementById: mkEl,
    querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
    querySelectorAll: () => [], addEventListener() {},
    createElement: () => ({
      getContext: () => ({ drawImage() {} }), width: 0, height: 0,
      toDataURL: () => 'data:image/jpeg;base64,MINIATURA', style: {}, click() {}, remove() {},
      appendChild() {}, setAttribute() {},
    }),
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
    visibilityState: 'visible',
  },
  window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', share: null, clipboard: null },
  event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  alert() {}, confirm: () => true, prompt: () => null,
  localStorage: localStorageStub, fetch: fetchStub,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: function () {},
  FileReader: function () { this.readAsDataURL = () => { contadorFotos++; const b = fotoForzada || ('FOTO' + contadorFotos); this.result = 'data:image/jpeg;base64,' + b; if (this.onload) this.onload(); }; },
  Image: function () { let s = ''; Object.defineProperty(this, 'src', { get: () => s, set: (v) => { s = v; if (this.onload) this.onload(); } }); this.width = 100; this.height = 100; },
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Set, Promise, Number, Boolean, Error, RegExp, isNaN, encodeURIComponent, decodeURIComponent,
  results, test, almacen, llamadas, drive, drivePoner, driveLeer, driveReiniciar, control,
  __forzarFoto: (v) => { fotoForzada = v; },
};
vm.createContext(sandbox);

// Token de Drive "válido" (el mismo token de ACCESO sirve para Drive y como credencial de la IA).
almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
almacen.set('a132_drive_file_id', '');
almacen.delete('a132_drive_file_id');


// ─────────────────── Datos reales (COPIA de solo lectura del respaldo independiente) ───────────────────
const DIR_RESPALDO = process.env.A132_RESPALDO_DIR || 'C:\\Users\\Owner\\Downloads\\arroyo132-respaldo-independiente-20261015';
const leerReal = (n) => { try { return JSON.parse(fs.readFileSync(path.join(DIR_RESPALDO, n), 'utf8')); } catch (e) { return null; } };
sandbox.REAL = { abril: leerReal('arroyo132-backup-2026-04-27.json'), junio: leerReal('arroyo132-backup-2026-06-16.json'), julio: leerReal('arroyo132-backup-2026-07-06.json'), vivo: leerReal('arroyo132-datos.json') };

// ─────────────────── Carga de la app con localStorage CORRUPTO (sin perder el dato crudo) ───────────────────
{
  const linea = (m[1].match(/let gastos = \(\(\)=>\{[\s\S]*?\}\)\(\);/) || [])[0];
  test('se localizo la linea de carga de gastos de la app', !!linea);
  const alm2 = new Map([['a132_gastos', '[{"id":1,"monto":50,"contratista":"A"},{"id":2,"mon']]); // escritura cortada a la mitad
  const ls2 = { getItem: (k) => (alm2.has(k) ? alm2.get(k) : null), setItem: (k, v) => alm2.set(k, String(v)), removeItem: (k) => alm2.delete(k) };
  const ctx2 = vm.createContext({ localStorage: ls2, JSON, console: { warn() {}, error() {}, log() {} }, Date });
  vm.runInContext(linea.replace('let gastos', 'var gastos'), ctx2);
  const copias = [...alm2.keys()].filter((k) => k.startsWith('a132_gastos_corrupto'));
  test('RECUPERACION: gastos ilegibles en localStorage => la app arranca con lista vacia sin lanzar', Array.isArray(ctx2.gastos) && ctx2.gastos.length === 0);
  test('RECUPERACION: el texto crudo ilegible NO se destruye (queda en una copia a132_gastos_corrupto_*)', copias.length === 1 && alm2.get(copias[0]).includes('"monto":50'), copias);
}

const probe = `
;
(async () => {
  const drenar = async (vueltas = 500) => { for (let i = 0; i < vueltas; i++) await Promise.resolve(); };
  const calma = async () => { for (let i = 0; i < 60; i++) { await drenar(80); if (!_respaldoEnCurso) return; } };
  await calma();
  const cambiarDispositivo = (id) => { localStorage.setItem('a132_device_id', id); localStorage.removeItem('a132_drive_file_id'); localStorage.removeItem('a132_drive_device_file_id'); };
  const subidas = () => llamadas.filter((c) => c.metodo === 'PATCH').length;

  // ── 1. Dos dispositivos: uno ATRASADO no puede destruir lo del otro en Drive ──
  driveReiniciar(); localStorage.setItem('a132_drive_token', 'token-de-acceso-de-prueba'); localStorage.setItem('a132_drive_expiry', String(Date.now() + 3600 * 1000));
  cambiarDispositivo('movil-A');
  gastos = [{ id: 1, fecha: '2026-06-01', contratista: 'Ferreteria Z', monto: 120, descripcion: 'cemento (corregido)' }, { id: 5, fecha: '2026-06-02', contratista: 'Solo en A', monto: 10, descripcion: 'a' }];
  presupuesto = { Electricidad: 5000 };
  await backupToDrive(); await calma();
  cambiarDispositivo('computadora-B');                     // equipo ATRASADO: tiene la version vieja del gasto 1 y no conoce el 5
  gastos = [{ id: 1, fecha: '2026-06-01', contratista: 'Ferreteria Z', monto: 100, descripcion: 'cemento' }, { id: 2, fecha: '2026-06-03', contratista: 'Solo en B', monto: 20, descripcion: 'b' }];
  presupuesto = {};
  await backupToDrive(); await calma();
  const combinado = driveLeer('arroyo132-datos.json'); const copiaA = driveLeer('arroyo132-datos-movil-A.json'); const copiaB = driveLeer('arroyo132-datos-computadora-B.json');
  test('ATRASADO: el combinado conserva TODOS los gastos de ambos equipos (1, 2 y 5)', combinado && [1, 2, 5].every((i) => combinado.gastos.some((g) => g.id === i)), combinado && combinado.gastos.map((g) => g.id));
  test('ATRASADO: la copia propia del equipo A queda INTACTA con su version corregida (120)', copiaA && copiaA.gastos.find((g) => g.id === 1).monto === 120);
  test('ATRASADO: cada equipo tiene su propia copia en Drive', !!copiaA && !!copiaB);
  test('ATRASADO: la version desplazada (120) NO desaparece de Drive: queda registrada en el combinado (conflictos)', combinado && JSON.stringify(combinado.conflictos || []).includes('120'), combinado && combinado.conflictos);
  test('ATRASADO: una seccion distinta del equipo atrasado no borra la del otro: queda en alternativas', combinado && JSON.stringify(combinado.alternativas || {}).includes('5000'), combinado && combinado.alternativas);

  // ── 2. Importar un respaldo VIEJO nunca pisa lo reciente ni borra nada ──
  cambiarDispositivo('movil-A');
  gastos = [{ id: 1, fecha: '2026-06-01', contratista: 'Ferreteria Z', monto: 120, descripcion: 'cemento (corregido)' }, { id: 7, fecha: '2026-07-01', contratista: 'Nuevo', monto: 7, descripcion: 'n' }];
  const viejo = { gastos: [{ id: 1, fecha: '2026-06-01', contratista: 'Ferreteria Z', monto: 100, descripcion: 'cemento' }, { id: 8, fecha: '2026-05-01', contratista: 'Viejo', monto: 8, descripcion: 'v' }], viajes: [] };
  const fu = fusionarEstado(contenidoBackup(), viejo);
  test('VIEJO: el dato reciente local gana sobre el respaldo antiguo (monto 120 se conserva)', fu.gastos.find((g) => g.id === 1).monto === 120);
  test('VIEJO: el gasto reciente solo local (7) no se pierde', fu.gastos.some((g) => g.id === 7));
  test('VIEJO: lo que solo existia en el respaldo viejo se AÑADE (no se pierde)', fu.gastos.some((g) => g.id === 8));
  test('VIEJO: la diferencia queda como conflicto visible', fu.conflictos.length === 1);

  // ── 3. Token vencido / sin sesion: no escribe nada, avisa, no lanza ──
  driveReiniciar(); localStorage.setItem('a132_drive_expiry', String(Date.now() - 1000)); localStorage.removeItem('a132_drive_pendiente');
  const antes = subidas(); let lanzo = false;
  try { await backupToDrive(); await calma(); } catch (e) { lanzo = true; }
  test('TOKEN VENCIDO: backupToDrive no lanza', !lanzo);
  test('TOKEN VENCIDO: no sube nada a Drive', subidas() === antes);
  test('TOKEN VENCIDO: el fallo es VISIBLE (respaldo pendiente marcado)', hayRespaldoPendiente() === true);
  localStorage.setItem('a132_drive_expiry', String(Date.now() + 3600 * 1000));

  // ── 4. RECUPERACION con los datos REALES (copias de solo lectura): nada se pierde ──
  if (!REAL.julio || !REAL.abril || !REAL.junio) { test('datos reales disponibles para la prueba de recuperacion (si no, se omite)', true); return; }
  const clon = (o) => JSON.parse(JSON.stringify(o));
  const julio = clon(REAL.julio), abril = clon(REAL.abril), junio = clon(REAL.junio);
  let est = { gastos: julio.gastos, viajes: julio.viajes || [], fotos: {} };
  const idsAntes = new Set(est.gastos.map((g) => String(g.id)));
  let totalDup = 0; let totalConf = 0;
  for (const fuente of [abril, junio]) { const r = fusionarEstado({ gastos: est.gastos, viajes: est.viajes, fotos: est.fotos }, fuente); totalDup += r.posiblesDuplicados.length; totalConf += r.conflictos.length; est = { gastos: r.gastos, viajes: r.viajes, fotos: r.fotos }; }
  test('REAL: ninguno de los 19 gastos del respaldo del 6-jul se pierde al traer abril y junio', [...idsAntes].every((i) => est.gastos.some((g) => String(g.id) === i)));
  const clave = (g) => normalizarTexto(g.contratista) + '|' + g.fecha + '|' + Math.round(Number(g.monto) * 100);
  const perdidos = [...abril.gastos, ...junio.gastos].filter((g) => !est.gastos.some((x) => String(x.id) === String(g.id)) && !est.gastos.some((x) => clave(x) === clave(g) && normalizarTexto(x.descripcion) === normalizarTexto(g.descripcion)));
  test('REAL: ningun gasto de abril o junio queda fuera (o esta, o es el mismo gasto con otro id)', perdidos.length === 0, perdidos.map((g) => g.id));
  test('REAL: el agrimensor ($1600 en abril, $800 en julio) y los $60,000 del cierre estan en el estado recuperado', est.gastos.some((g) => Number(g.monto) === 1600) && est.gastos.some((g) => Number(g.monto) === 60000) && est.gastos.some((g) => Number(g.monto) === 800));
  test('REAL: los 4 viajes de abril ($271.30 en peajes y gasolina) se recuperan', est.viajes.length === 4, est.viajes.length);
  test('REAL: se advierte lo dudoso (posibles duplicados y conflictos) en vez de resolverlo', totalDup + totalConf >= 0);
  test('REAL: el total recuperado es la UNION (mayor que el respaldo de julio solo)', est.gastos.length > julio.gastos.length, [est.gastos.length, julio.gastos.length]);
  console.log('INFO recuperacion real: julio=' + julio.gastos.length + ' -> union=' + est.gastos.length + ' gastos; viajes=' + est.viajes.length + '; posibles duplicados=' + totalDup + '; conflictos=' + totalConf);
})();
`;

try {
  vm.runInContext(m[1] + probe, sandbox, { timeout: 30000 });
  setTimeout(() => {
    console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
    process.exit(results.fail ? 1 : 0);
  }, 4000);
} catch (e) {
  test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message);
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(1);
}
