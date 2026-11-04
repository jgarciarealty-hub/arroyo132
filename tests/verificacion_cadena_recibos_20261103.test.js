// Verifica la CADENA completa de las referencias de recibos:
//   centralSincronizar → centralAdoptar → a132_recibos → leerRecibos → backupToDrive → combinado v4
// Reproduce, con el código REAL de index.html y los módulos central/*.js, el estado observado el
// 2026-11-03: central v5 con 62 gastos y 5 referencias externas, combinado v4 con 62 gastos y 0.
// No usa red ni Google real: usa un Drive simulado (v4 + central) y localStorage en memoria.
// Uso: node tests/verificacion_cadena_recibos_20261103.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../central/estado_central.js');
const D = require('../central/almacen_drive.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
if (!script) { console.error('FAIL: no se pudo extraer el script'); process.exit(1); }

let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }

// ───────────── Drive simulado: mismas rutas para el respaldo v4 y para el central v5 ─────────────
function crearDrive() {
  const porId = new Map(), porNombre = new Map(), llamadas = [];
  const control = { recortaRecibos: false };
  let n = 0, rev = 0;
  const BASE = Date.parse('2026-11-04T00:00:00.000Z');
  const ahora = () => new Date(BASE + (++rev) * 1000).toISOString();
  function crearArchivo(nombre) {
    const id = 'id-' + (++n);
    porId.set(id, { id, nombre, contenido: '', revisions: [] });
    porNombre.set(nombre, id);
    return id;
  }
  function poner(nombre, objeto) {
    let id = porNombre.get(nombre);
    if (!id) id = crearArchivo(nombre);
    const f = porId.get(id);
    f.contenido = JSON.stringify(objeto);
    f.revisions.push({ id: 'rev-' + (++rev), modifiedTime: ahora(), body: f.contenido });
    return f;
  }
  function meta(f) {
    const ultima = f.revisions[f.revisions.length - 1];
    return { id: f.id, name: f.nombre, createdTime: new Date(BASE).toISOString(), headRevisionId: ultima ? ultima.id : undefined, md5Checksum: 'm', size: String(f.contenido.length) };
  }
  async function fetchStub(url, opts) {
    const u = String(url), o = opts || {};
    const metodo = o.method || 'GET';
    llamadas.push(u);
    // Crear archivo
    if (metodo === 'POST' && /\/drive\/v3\/files(\?|$)/.test(u)) {
      const metaJson = JSON.parse(o.body);
      const id = crearArchivo(metaJson.name);
      return resp(200, { id, name: metaJson.name }, true);
    }
    // Subir contenido (v4 y central usan la misma ruta)
    if (metodo === 'PATCH' && u.includes('/upload/drive/v3/files/')) {
      const id = u.match(/files\/([^?]+)\?/)[1];
      const f = porId.get(id);
      if (!f) return resp(404, {}, true);
      f.contenido = o.body;
      if (control.recortaRecibos && f.nombre === 'arroyo132-datos.json') {
        const j = JSON.parse(o.body); delete j.recibos; f.contenido = JSON.stringify(j);
      }
      f.revisions.push({ id: 'rev-' + (++rev), modifiedTime: ahora(), body: f.contenido });
      return resp(200, { id }, true);
    }
    // Revisión concreta
    if (u.includes('/revisions/')) {
      const id = u.match(/files\/([^/]+)\/revisions\//)[1];
      const rid = u.match(/revisions\/([^?]+)/)[1];
      const f = porId.get(id);
      const r = f && f.revisions.find((x) => x.id === rid);
      if (!r) return resp(404, {}, false);
      return resp(200, r.body, false);
    }
    // Lista de revisiones
    if (u.includes('/revisions')) {
      const id = u.match(/files\/([^/?]+)\/revisions/)[1];
      const f = porId.get(id);
      return resp(200, { revisions: (f ? f.revisions : []).map((r) => ({ id: r.id, modifiedTime: r.modifiedTime })) }, true);
    }
    // Buscar por nombre
    if (u.includes('/drive/v3/files?q=')) {
      const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
      const nombre = (q.match(/name='([^']+)'/) || [])[1];
      const id = porNombre.get(nombre);
      const f = id ? porId.get(id) : null;
      return resp(200, { files: f ? [meta(f)] : [] }, true);
    }
    // Descargar contenido
    if (u.includes('alt=media')) {
      const id = u.match(/files\/([^?]+)\?/)[1];
      const f = porId.get(id);
      if (!f) return resp(404, {}, false);
      return resp(200, f.contenido, false);
    }
    return resp(200, {}, true);
  }
  function resp(status, cuerpo, esJson) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return {
      ok: status >= 200 && status < 300, status,
      text: async () => texto,
      json: async () => (esJson ? (typeof cuerpo === 'string' ? JSON.parse(cuerpo || '{}') : cuerpo) : JSON.parse(texto || '{}')),
    };
  }
  return { fetchStub, poner, porNombre, porId, llamadas, control, leer: (nombre) => { const id = porNombre.get(nombre); if (!id) return null; try { return JSON.parse(porId.get(id).contenido); } catch (e) { return null; } } };
}

// ───────────── Dispositivo: script real de la app en un contexto aislado ─────────────
function cargarDispositivo(drive, almacen) {
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
  const timers = [];
  const sandbox = {
    console, A132Central: C, A132Drive: D,
    document: {
      getElementById: mkEl,
      querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
      querySelectorAll: () => [], addEventListener() {},
      createElement: () => ({ getContext: () => ({ drawImage() {} }), width: 0, height: 0, toDataURL: () => 'data:image/jpeg;base64,MINIATURA', style: {}, click() {}, remove() {}, appendChild() {}, setAttribute() {} }),
      body: { classList: { add() {}, remove() {} }, appendChild() {} },
      visibilityState: 'visible',
    },
    window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    navigator: { onLine: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', share: null, clipboard: null },
    event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 0; }, clearTimeout: () => {},
    alert() {}, confirm: () => true, prompt: () => null,
    localStorage: { getItem: (k) => (almacen.has(String(k)) ? almacen.get(String(k)) : null), setItem: (k, v) => almacen.set(String(k), String(v)), removeItem: (k) => almacen.delete(String(k)), clear: () => almacen.clear(), get length() { return almacen.size; }, key: (i) => [...almacen.keys()][i] },
    fetch: drive.fetchStub,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: function () {},
    FileReader: function () { this.readAsDataURL = () => {}; }, Image: function () {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Set, Promise, Number, Boolean, Error, RegExp, isNaN, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const R = (c) => vm.runInContext(c, sandbox);
  return { R, almacen, sandbox, timers };
}

// ───────────── Estado de partida: 62 gastos y 5 referencias externas en el central ─────────────
const GASTOS = [];
for (let i = 1; i <= 62; i++) {
  GASTOS.push({ id: 700000 + i, contratista: 'Proveedor ' + i, fecha: '2026-04-' + String((i % 28) + 1).padStart(2, '0'), monto: Math.round(i * 13.37 * 100) / 100, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', tipo: 'manual', descripcion: 'gasto ' + i });
}
const IDS_CON_REF = ['700001', '700002', '700007', '700010', '700011'];
function estadoCentral({ conRefs = true, rev = 8 } = {}) {
  const e = C.nuevoEstado();
  for (const g of GASTOS) e.gastos[String(g.id)] = Object.assign({}, g, { _v: 1, _t: '2026-11-04T00:45:00.000Z', _o: 'movil' });
  e.rev = rev;
  if (conRefs) for (const id of IDS_CON_REF) e.recibos[id] = { origen: 'externo', docs: [{ driveId: 'DRV-' + id, nombre: 'A132-REC-' + id.slice(-3) + '.pdf', enlace: 'https://drive.google.com/file/d/DRV-' + id + '/view', rec: id.slice(-3) }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' };
  return e;
}
function dispositivoConCentral({ token = true, conRefsEnBase = false } = {}) {
  const drive = crearDrive();
  const central = estadoCentral({ conRefs: true });
  drive.poner('arroyo132-central-v5.json', central);
  const base = estadoCentral({ conRefs: conRefsEnBase, rev: 7 });
  const almacen = new Map();
  almacen.set('a132_gastos', JSON.stringify(GASTOS));
  almacen.set('a132_viajes', '[]');
  almacen.set('a132_central', '1');
  almacen.set('a132_central_base', JSON.stringify(base));
  if (token) {
    almacen.set('a132_drive_token', 'token-de-prueba');
    almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
  }
  const dev = cargarDispositivo(drive, almacen);
  return { drive, dev, almacen };
}
const refsLocales = (almacen) => { try { return JSON.parse(almacen.get('a132_recibos') || '{}'); } catch (e) { return {}; } };

(async () => {
  // ── 1. Cadena nominal: sync → adoptar → respaldar conserva las 5 ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    const huella = (lista) => JSON.stringify((lista || []).map((g) => [String(g.id), g.contratista, g.fecha, g.monto, g.descripcion, g.categoria, g.lote, g.metodo, g.tipo]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    const huellaOriginal = huella(GASTOS);
    test('nominal: antes de sincronizar, el dispositivo NO tiene las referencias', Object.keys(refsLocales(almacen)).length === 0);
    const r = await dev.R('centralSincronizar()');
    test('nominal: centralSincronizar devuelve {ok:true} cuando adopta', r && r.ok === true, r);
    test('nominal: centralAdoptar deja las 5 referencias en a132_recibos', Object.keys(refsLocales(almacen)).length === 5, Object.keys(refsLocales(almacen)));
    test('nominal: los 62 gastos siguen en la vista local', JSON.parse(almacen.get('a132_gastos')).length === 62);
    test('INTEGRIDAD: los 62 gastos conservan id, contratista, fecha, importe, descripción y clasificación', huella(JSON.parse(almacen.get('a132_gastos'))) === huellaOriginal);
    await dev.R('backupToDrive(false)');
    const combinado = drive.leer('arroyo132-datos.json');
    test('nominal: el combinado v4 recibe las 5 referencias', combinado && Object.keys(combinado.recibos || {}).length === 5, combinado && Object.keys(combinado.recibos || {}));
    test('nominal: el combinado conserva los 62 gastos', combinado && combinado.gastos.length === 62);
    test('INTEGRIDAD: el combinado no altera ningún dato de los 62 gastos', huella(combinado.gastos) === huellaOriginal);
    const central = drive.leer('arroyo132-central-v5.json');
    const docsDe = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, (v.docs || []).map((d) => d.driveId).sort().join(',')]));
    test('INTEGRIDAD: las 5 referencias del combinado son exactamente las del central', JSON.stringify(docsDe(combinado.recibos)) === JSON.stringify(docsDe(central.recibos)), { combinado: docsDe(combinado.recibos), central: docsDe(central.recibos) });
  }

  // ── 2. Sin token: la sincronización no adopta; el respaldo manual ahora sincroniza ANTES de escribir ──
  // Regresión 2026-11-03: el callback de OAuth y el botón ☁️ llamaban a backupToDrive(true) sin
  // esperar a la fuente central; el combinado quedaba con 0 referencias (estado de las 21:23).
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: false });
    await dev.R('centralSincronizar()');
    test('sin token: la sincronización queda pendiente y NO adopta (a132_recibos vacío)', Object.keys(refsLocales(almacen)).length === 0, Object.keys(refsLocales(almacen)));
    test('sin token: el panel avisa que Drive no está conectado', /no conectado/i.test(dev.R('centralTexto()')), dev.R('centralTexto()'));
    // El usuario conecta Drive; el callback de OAuth llama a backupToDrive(true) DIRECTAMENTE.
    almacen.set('a132_drive_token', 'token-de-prueba');
    almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
    await dev.R('backupToDrive(false)');
    const combinado = drive.leer('arroyo132-datos.json');
    test('ARREGLO: el respaldo adopta el central y el combinado v4 recibe las 5', combinado && Object.keys(combinado.recibos || {}).length === 5, combinado && Object.keys(combinado.recibos || {}));
    test('ARREGLO: el dispositivo también queda con las 5 en a132_recibos', Object.keys(refsLocales(almacen)).length === 5);
    test('el central sigue con sus 5 referencias', Object.keys(drive.leer('arroyo132-central-v5.json').recibos || {}).length === 5);
  }

  // ── 2b. Sin token no se intenta OAuth silencioso (evita ventanas de Google/previews) ──
  {
    const { dev, almacen } = dispositivoConCentral({ token: false });
    dev.R("var __oauthBackup=0; asegurarTokenDrive=async()=>{ __oauthBackup++; return null; }");
    await dev.R('backupToDrive(false)');
    test('SIN TOKEN: el respaldo no intenta OAuth silencioso', dev.R('__oauthBackup') === 0, dev.R('__oauthBackup'));
    test('SIN TOKEN: queda pendiente y no escribe archivos', almacen.get('a132_drive_pendiente') === '1');
  }

  // ── 3. Un respaldo que coincide con una sincronización en curso ESPERA a que termine ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    const fetchOriginal = drive.fetchStub;
    let soltar; const bloqueo = new Promise((res) => { soltar = res; });
    const driveLento = { fetchStub: async (u, o) => { if (String(u).includes('arroyo132-central-v5.json')) await bloqueo; return fetchOriginal(u, o); } };
    const dev2 = cargarDispositivo(driveLento, almacen);
    const sync = dev2.R('centralSincronizar()');          // queda bloqueada leyendo el central
    let backupTerminado = false;
    const backup = dev2.R('backupToDrive(false)').then(() => { backupTerminado = true; });
    await Promise.resolve(); await Promise.resolve();
    test('CARRERA: el respaldo no termina mientras la sincronización sigue en curso', backupTerminado === false);
    soltar(); await sync; await backup;
    const combinado = drive.leer('arroyo132-datos.json');
    test('CARRERA: el respaldo espera y el combinado recibe las 5', combinado && Object.keys(combinado.recibos || {}).length === 5, combinado && Object.keys(combinado.recibos || {}));
    test('CARRERA: el dispositivo queda con las 5', Object.keys(refsLocales(almacen)).length === 5);
  }

  // ── 3b. Guardar DURANTE una sincronización en vuelo: el respaldo reintenta y escribe el combinado ──
  // Hallazgo de la revisión independiente: la sync devolvía «hubo cambios mientras se sincronizaba»
  // y el respaldo quedaba pausado hasta el siguiente evento. Ahora se reintenta una vez en el mismo respaldo.
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    const fetchOriginal = drive.fetchStub;
    let soltar; const bloqueo = new Promise((res) => { soltar = res; });
    const driveLento = { fetchStub: async (u, o) => { if (String(u).includes('arroyo132-central-v5.json')) await bloqueo; return fetchOriginal(u, o); } };
    const dev2 = cargarDispositivo(driveLento, almacen);
    const sync = dev2.R('centralSincronizar()');
    await Promise.resolve(); await Promise.resolve();
    // El usuario edita y guarda mientras la sincronización está en vuelo.
    dev2.R("gastos.find(g=>String(g.id)==='700001').monto=99.99");
    const backup = dev2.R('backupToDrive(false)');
    await Promise.resolve(); await Promise.resolve();
    soltar(); await sync; await backup;
    const combinado = drive.leer('arroyo132-datos.json');
    test('SYNC EN VUELO: el respaldo no queda pausado y escribe el combinado', !!combinado);
    test('SYNC EN VUELO: el combinado conserva los 62 gastos y el valor editado', combinado && combinado.gastos.length === 62 && combinado.gastos.find((g) => String(g.id) === '700001').monto === 99.99, combinado && combinado.gastos && combinado.gastos.find((g) => String(g.id) === '700001'));
    test('SYNC EN VUELO: el combinado recibe las 5 referencias', combinado && Object.keys(combinado.recibos || {}).length === 5);
    test('SYNC EN VUELO: el aviso de pendiente se limpia tras el respaldo', almacen.get('a132_drive_pendiente') === undefined, almacen.get('a132_drive_pendiente'));
  }

  // ── 4. Si la fuente central no se puede confirmar, el combinado se pausa (fail-closed) ──
  // La copia propia del dispositivo ya se escribió: no se pierde ningún dato local.
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    drive.porNombre.delete('arroyo132-central-v5.json');   // el central desaparece de Drive
    await dev.R('backupToDrive(false)');
    test('CENTRAL ILEGIBLE: la copia propia del dispositivo sí se escribe', !!drive.leer(dev.R('deviceFile()')));
    test('CENTRAL ILEGIBLE: el combinado NO se crea ni se degrada', drive.leer('arroyo132-datos.json') === null);
    test('CENTRAL ILEGIBLE: queda un aviso de respaldo en pausa', /en pausa/i.test(dev.R("document.getElementById('btn-drive').title")), dev.R("document.getElementById('btn-drive').title"));
    test('CENTRAL ILEGIBLE: el panel visible explica el motivo, no solo el aviso', /en pausa/i.test(dev.R('estadoRespaldoTexto()')) && /no se pudo confirmar/i.test(dev.R('estadoRespaldoTexto()')), dev.R('estadoRespaldoTexto()'));
    dev.R('marcarRespaldoPendiente()');
    test('AVISO: un pendiente sin motivo no conserva el motivo viejo', !/en pausa/i.test(dev.R('estadoRespaldoTexto()')) && /HAY CAMBIOS SIN RESPALDAR/.test(dev.R('estadoRespaldoTexto()')), dev.R('estadoRespaldoTexto()'));
    test('CENTRAL ILEGIBLE: los gastos locales siguen intactos', JSON.parse(almacen.get('a132_gastos')).length === 62);
  }

  // ── 4b. Un combinado preexistente con 5 refs NO se degrada si el central cae ──
  {
    const { drive, dev } = dispositivoConCentral({ token: true });
    const previo = { version: 4, fecha: '2026-11-04T01:00:00.000Z', dispositivo: 'otro', gastos: GASTOS, recibos: estadoCentral({ conRefs: true }).recibos };
    drive.poner('arroyo132-datos.json', previo);
    drive.porNombre.delete('arroyo132-central-v5.json');
    await dev.R('backupToDrive(false)');
    const tras = drive.leer('arroyo132-datos.json');
    test('COMBINADO PREVIO: conserva las 5 referencias si el central no se confirma', tras && Object.keys(tras.recibos || {}).length === 5);
    test('COMBINADO PREVIO: conserva los 62 gastos', tras && tras.gastos.length === 62);
    test('COMBINADO PREVIO: conserva la fecha original (no se reescribió)', tras && tras.fecha === previo.fecha, tras && tras.fecha);
  }

  // ── 4c. Con la fuente central apagada no se consulta el central ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    almacen.delete('a132_central');
    drive.llamadas.length = 0;
    await dev.R('backupToDrive(false)');
    const pidioCentral = drive.llamadas.some((u) => u.includes('arroyo132-central-v5.json'));
    test('CENTRAL APAGADO: el respaldo no consulta ni sincroniza el central', !pidioCentral, drive.llamadas.filter((u) => u.includes('central')));
    test('CENTRAL APAGADO: el combinado se escribe con los datos locales', !!drive.leer('arroyo132-datos.json'));
  }

  // ── 4d. Si la sincronización falla mientras el respaldo espera, no se escribe un combinado degradado ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    const fetchOriginal = drive.fetchStub;
    let soltar; const bloqueo = new Promise((res) => { soltar = res; });
    const driveLento = { fetchStub: async (u, o) => { if (String(u).includes('arroyo132-central-v5.json')) await bloqueo; return fetchOriginal(u, o); } };
    const dev2 = cargarDispositivo(driveLento, almacen);
    const sync = dev2.R('centralSincronizar()');
    await Promise.resolve(); await Promise.resolve();
    const backup = dev2.R('backupToDrive(false)');
    await Promise.resolve(); await Promise.resolve();
    drive.porNombre.delete('arroyo132-central-v5.json');   // el central desaparece mientras se espera
    soltar(); await sync; await backup;
    test('SYNC FALLA MIENTRAS ESPERA: la copia propia del dispositivo sí se escribe', !!drive.leer(dev2.R('deviceFile()')));
    test('SYNC FALLA MIENTRAS ESPERA: no se crea un combinado incompleto', drive.leer('arroyo132-datos.json') === null);
  }

  // ── 4e. La relectura verifica también las referencias: si Drive no las guarda, no se declara éxito ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    drive.control.recortaRecibos = true;
    await dev.R('backupToDrive(false)');
    test('VERIFICACIÓN DE REFERENCIAS: si Drive pierde las refs, el respaldo queda pendiente', almacen.get('a132_drive_pendiente') === '1', almacen.get('a132_drive_pendiente'));
    test('VERIFICACIÓN DE REFERENCIAS: la copia propia del dispositivo sí se escribió', !!drive.leer(dev.R('deviceFile()')));
    const log = JSON.parse(almacen.get('a132_respaldo_log') || '[]');
    test('VERIFICACIÓN DE REFERENCIAS: la bitácora registra el fallo con el motivo', log.some((x) => x.resultado === 'FALLO' && /referencia/i.test(String(x.motivo || ''))), log.slice(-2));
  }

  // ── 4f. Recuperación: un combinado con las 5 refs las devuelve a un dispositivo vacío (central apagado) ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true });
    almacen.delete('a132_central');
    almacen.delete('a132_recibos');
    drive.poner('arroyo132-datos.json', { version: 4, fecha: '2026-11-04T01:00:00.000Z', dispositivo: 'otro', gastos: GASTOS, recibos: estadoCentral({ conRefs: true }).recibos });
    await dev.R('restaurarDesdeDrive()');
    test('RECUPERACIÓN: el combinado devuelve las 5 referencias a un dispositivo vacío', Object.keys(refsLocales(almacen)).length === 5, Object.keys(refsLocales(almacen)));
    test('RECUPERACIÓN: los 62 gastos quedan en el dispositivo', JSON.parse(almacen.get('a132_gastos')).length === 62);
  }

  // ── 4g. Fail-closed estrecho: un dispositivo que YA adoptó las refs puede respaldar sin central ──
  {
    const { drive, dev, almacen } = dispositivoConCentral({ token: true, conRefsEnBase: true });
    almacen.set('a132_recibos', JSON.stringify(estadoCentral({ conRefs: true }).recibos));
    drive.porNombre.delete('arroyo132-central-v5.json');   // el central no responde
    await dev.R('backupToDrive(false)');
    const combinado = drive.leer('arroyo132-datos.json');
    test('FAIL-CLOSED ESTRECHO: un dispositivo con las refs adoptadas escribe el combinado sin central', !!combinado);
    test('FAIL-CLOSED ESTRECHO: el combinado conserva las 5 refs y los 62 gastos', combinado && Object.keys(combinado.recibos || {}).length === 5 && combinado.gastos.length === 62);
    test('FAIL-CLOSED ESTRECHO: el respaldo se declara correcto', almacen.get('a132_drive_pendiente') === undefined, almacen.get('a132_drive_pendiente'));
  }

  // ── 4h. Guardar no duplica la sincronización cuando el respaldo ya puede sincronizar ──
  {
    const { dev, almacen } = dispositivoConCentral({ token: true });
    const antes = dev.timers.filter((t) => t.ms === 1500).length;
    dev.R('save()');
    const conToken = dev.timers.filter((t) => t.ms === 1500).length;
    test('SIN DOBLE SYNC: con token válido, guardar no programa otra sincronización', conToken === antes, { antes, conToken });
    almacen.delete('a132_drive_token');
    almacen.delete('a132_drive_expiry');
    const antes2 = dev.timers.filter((t) => t.ms === 1500).length;
    dev.R('save()');
    const sinToken = dev.timers.filter((t) => t.ms === 1500).length;
    test('SIN DOBLE SYNC: sin token válido, guardar sí programa la sincronización', sinToken === antes2 + 1, { antes2, sinToken });
  }

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
