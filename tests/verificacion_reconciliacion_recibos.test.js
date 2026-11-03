// Reconciliación de recibos desde IndexedDB, persistencia y prevención de duplicados (2026-11-03).
// Funciones REALES extraídas de index.html; Drive simulado con bytes reales; localStorage e
// IndexedDB simulados. El «reinicio» crea un contexto VM nuevo con el mismo localStorage y la
// misma IndexedDB, como al cerrar y volver a abrir la app.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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

// ── Drive simulado: guarda los bytes y devuelve metadatos verificables ────────────────────────
function crearDrive() {
  const d = { archivos: new Map(), n: 1, modo: 'ok', llamadas: [] };
  const nuevoId = () => 'F' + (d.n++);
  const respuesta = (st, obj) => ({ ok: st >= 200 && st < 300, status: st, json: async () => obj });
  const vista = f => ({ id: f.id, name: f.name, size: String(f.datos.length), md5Checksum: crypto.createHash('md5').update(f.datos).digest('hex'), webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view', appProperties: f.appProperties });
  d.fetch = async (url, opts = {}) => {
    const u = new URL(url); const m = opts.method || 'GET'; d.llamadas.push(m + ' ' + u.pathname);
    if (d.modo === 'caido') throw new Error('sin conexión');
    if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
      if (d.modo === 'http500') return respuesta(500, {});
      const buf = Buffer.from(await opts.body.arrayBuffer());
      const lim = opts.headers['Content-Type'].split('boundary=')[1];
      const partes = buf.toString('latin1').split('--' + lim);
      const metaTxt = partes[1].split('\r\n\r\n')[1].replace(/\r\n$/, '');
      const meta = JSON.parse(Buffer.from(metaTxt, 'latin1').toString('utf8'));
      const ini = buf.indexOf('\r\n\r\n', buf.indexOf('--' + lim) + 2 + lim.length + 2 + metaTxt.length) + 4;
      const fin = buf.lastIndexOf('\r\n--' + lim + '--');
      const datos = buf.subarray(ini, fin);
      const id = nuevoId();
      d.archivos.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, appProperties: meta.appProperties, datos, folder: false });
      return respuesta(200, vista(d.archivos.get(id)));
    }
    if (m === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(opts.body); const id = nuevoId();
      d.archivos.set(id, { id, name: meta.name, folder: true, datos: Buffer.alloc(0) });
      return respuesta(200, { id });
    }
    const mid = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m === 'GET' && mid) {
      const f = d.archivos.get(mid[1]); if (!f) return respuesta(404, {});
      if (u.searchParams.get('alt') === 'media') return { ok: true, status: 200, blob: async () => new Blob([f.datos]) };
      return respuesta(200, f.folder ? { id: f.id, trashed: false } : vista(f));
    }
    if (m === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      if (q.includes('google-apps.folder')) return respuesta(200, { files: [...d.archivos.values()].filter(f => f.folder).map(f => ({ id: f.id })) });
      const sha = q.match(/value='([0-9a-f]{64})'/);
      return respuesta(200, { files: [...d.archivos.values()].filter(f => !f.folder && sha && f.appProperties && f.appProperties.sha256 === sha[1]).map(vista) });
    }
    return respuesta(404, {});
  };
  d.ficheros = () => [...d.archivos.values()].filter(f => !f.folder);
  return d;
}

const NOMBRES = ['md5Hex', 'sha256Hex', 'extensionDe', 'verificarCargaOriginal', 'driveCarpetaRecibos', 'driveSubirOriginal', 'procesarColaOriginales', 'refrescarPanelRespaldo', 'registrarOriginalNuevo', 'textoEstadoOriginal', 'textoEstadoOriginalBase', 'textoSinOriginal', 'leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'guardarRecibosPend', 'escribirVerificado', 'actualizarPend', 'escHtml', 'fetchConTiempo', 'limpiarRecibos', 'docRefValido', 'listarDocumentos', 'sinHistorico', 'aplicarReferencia', 'gastoDeClave', 'clavesPendDeGasto', 'documentosDeGasto', 'save'];

// Nuevo «arranque» de la app: mismo localStorage (Map) y misma IndexedDB (Map).
function crearContexto(alm, idb, gastos, drive, opts = {}) {
  const ctx = vm.createContext({
    fetch: drive.fetch, AbortController, clearTimeout, Blob, crypto: crypto.webcrypto,
    Uint8Array, DataView, ArrayBuffer, Math, JSON, String, Number, Object, Array, Date, Error, URL,
    console: { warn: () => {}, log: () => {} }, Promise, setTimeout,
    localStorage: { getItem: k => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: k => alm.delete(k) },
    document: { getElementById: () => null, visibilityState: 'visible' },
    DRIVE_TOKEN_KEY: 'tok',
    driveTokenValid: () => opts.token !== false,
    asegurarTokenDrive: async () => (opts.token === false ? null : 'T'),
    marcarRespaldoPendiente() { ctx.__pend++; }, backupToDrive() {}, __pend: 0,
    estadoRespaldoTexto: () => '', gastos,
    servicios: [], contratistas: [], timeline: [], docs: [], fotos: {},
    origClaves: async () => [...idb.keys()],
    origLeer: async id => idb.get(String(id)) || null,
    origBorrar: async id => { idb.delete(String(id)); },
    origGuardar: async (id, a) => { idb.set(String(id), { blob: a, tipo: a.type || '', bytes: a.size || 0, nombre: a.name || '' }); return true; },
  });
  vm.runInContext("const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', RECIBOS_CARPETA_KEY='a132_recibos_carpeta', RECIBOS_CARPETA_NOMBRE='Arroyo 132 — Recibos originales'; const DRIVE_CAMPOS_ARCHIVO='id,name,size,md5Checksum,webViewLink,appProperties'; let _colaOriginalesEnCurso=false; let _pendMemoria={}; let _pendMemoriaAutoritativa=false;\n" + NOMBRES.map(extraer).join('\n'), ctx);
  return ctx;
}
const F = (ctx, n) => vm.runInContext(n, ctx);
const archivo = (bytes, name = 'r.jpg', type = 'image/jpeg') => new File([bytes], name, { type });
const refs = alm => { try { return JSON.parse(alm.get('a132_recibos') || '{}'); } catch (e) { return {}; } };
const pend = alm => { try { return JSON.parse(alm.get('a132_recibos_pend') || '{}'); } catch (e) { return {}; } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // ── 1. Persistencia del gasto y recarga ────────────────────────────────────────────────────
  {
    const alm = new Map();
    const ctx = crearContexto(alm, new Map(), [{ id: 101, fecha: '2026-11-03', contratista: 'Prueba', monto: 10 }], crearDrive());
    const ok = F(ctx, 'save')();
    test('save() persiste el gasto y devuelve true', ok === true && JSON.parse(alm.get('a132_gastos') || '[]')[0].id === 101, alm.get('a132_gastos'));
    test('tras reiniciar (releer localStorage), el gasto sigue ahí', JSON.parse(alm.get('a132_gastos') || '[]').some(g => g.id === 101));
  }

  // ── 2. Cuota llena: save() no miente ni deja un gasto fantasma ─────────────────────────────
  {
    const alm = new Map();
    const ctx = crearContexto(alm, new Map(), [{ id: 102, fecha: '2026-11-03', contratista: 'Prueba', monto: 20 }], crearDrive());
    ctx.localStorage.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    let lanzo = false, r; try { r = F(ctx, 'save')(); } catch (e) { lanzo = true; }
    test('con cuota llena, save() no lanza, devuelve false y no persiste el gasto', !lanzo && r === false && !alm.has('a132_gastos'), { lanzo, r });
  }

  // ── 2b. Fallo en la ÚLTIMA clave: save() restaura las anteriores y no deja gasto fantasma ──
  {
    const alm = new Map();
    const ctx = crearContexto(alm, new Map(), [{ id: 103, fecha: '2026-11-03', contratista: 'Prueba', monto: 30 }], crearDrive());
    const setItem = ctx.localStorage.setItem;
    ctx.localStorage.setItem = (k, v) => { if (k === 'a132_gastos') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return setItem(k, v); };
    const r = F(ctx, 'save')();
    test('si falla a132_gastos, save() devuelve false, no deja gasto fantasma y revierte las claves anteriores', r === false && !alm.has('a132_gastos') && !alm.has('a132_servicios') && !alm.has('a132_cont') && !alm.has('a132_tl') && !alm.has('a132_docs'), { r, claves: [...alm.keys()] });
  }

  // ── 3. Reinicio: cola perdida + original huérfano en IndexedDB ─────────────────────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(6000);
    idb.set('100', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    const gastos = [{ id: 100 }];
    const ctx = crearContexto(alm, idb, gastos, drive);
    await F(ctx, 'procesarColaOriginales')();
    const r = refs(alm)[100];
    test('reinicio: la copia huérfana se reencola, se sube y se verifica', !!r && r.sha256 === sha(bytes), r);
    test('reinicio: la copia temporal se borra solo tras verificar', idb.size === 0);
    test('reinicio: la cola queda vacía', Object.keys(pend(alm)).length === 0, pend(alm));
    test('reinicio: un solo archivo en Drive (sin duplicado)', drive.ficheros().length === 1);
  }

  // ── 4. Cuota llena + Drive caído → reinicio con Drive recuperado ───────────────────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive(); drive.modo = 'caido';
    const bytes = crypto.randomBytes(7000);
    idb.set('101', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    const gastos = [{ id: 101 }];
    const ctx = crearContexto(alm, idb, gastos, drive);
    const setItem = ctx.localStorage.setItem;
    ctx.localStorage.setItem = (k, v) => { if (k === 'a132_recibos_pend') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return setItem(k, v); };
    await F(ctx, 'procesarColaOriginales')();
    test('cuota llena + Drive caído: el original se conserva en IndexedDB', idb.has('101'));
    test('cuota llena: la cola no se persistió pero sigue visible en memoria', Object.keys(F(ctx, 'leerRecibosPend')()).includes('101') && !alm.has('a132_recibos_pend'), F(ctx, 'leerRecibosPend')());
    test('cuota llena + Drive caído: no se declara ninguna referencia', !refs(alm)[101]);

    drive.modo = 'ok';
    const ctx2 = crearContexto(alm, idb, gastos, drive);
    await F(ctx2, 'procesarColaOriginales')();
    test('reinicio tras cuota llena: la cola se reconstruye desde IndexedDB y sube', !!refs(alm)[101] && idb.size === 0 && Object.keys(pend(alm)).length === 0, { refs: refs(alm), idb: [...idb.keys()], pend: pend(alm) });
  }

  // ── 5. Duplicados: dos copias del mismo contenido (clave base + compuesta) ─────────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(5000);
    idb.set('200', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    idb.set('200~a', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    const gastos = [{ id: 200 }];
    const ctx = crearContexto(alm, idb, gastos, drive);
    await F(ctx, 'procesarColaOriginales')();
    const docs = F(ctx, 'listarDocumentos')(refs(alm)[200]);
    test('duplicados: dos copias del mismo contenido dejan UNA sola referencia', docs.length === 1, docs);
    test('duplicados: no se crea un segundo archivo en Drive', drive.ficheros().length === 1);
    test('duplicados: las dos copias temporales se retiran y la cola queda vacía', idb.size === 0 && Object.keys(pend(alm)).length === 0);
  }

  // ── 6. Reinicio tras referencia guardada, con copia temporal sobrante ───────────────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(4000); const gastos = [{ id: 300 }];
    const ctx = crearContexto(alm, idb, gastos, drive);
    const ref = await F(ctx, 'driveSubirOriginal')(300, archivo(bytes), 'T');
    F(ctx, 'guardarRecibos')({ 300: ref });
    idb.set('300~x', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });

    const ctx2 = crearContexto(alm, idb, gastos, drive);
    await F(ctx2, 'procesarColaOriginales')();
    const docs = F(ctx2, 'listarDocumentos')(refs(alm)[300]);
    test('reinicio tras subida verificada: no se duplica la referencia', docs.length === 1, docs);
    test('reinicio tras subida verificada: no se duplica el archivo de Drive', drive.ficheros().length === 1);
    test('reinicio tras subida verificada: se retira la copia temporal sobrante', idb.size === 0 && Object.keys(pend(alm)).length === 0);
  }

  // ── 7. Cola vieja persistida + referencia ya guardada ───────────────────────────────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(3000); const gastos = [{ id: 400 }];
    const ctx = crearContexto(alm, idb, gastos, drive);
    const ref = await F(ctx, 'driveSubirOriginal')(400, archivo(bytes), 'T');
    F(ctx, 'guardarRecibos')({ 400: ref });
    idb.set('400', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    alm.set('a132_recibos_pend', JSON.stringify({ 400: { estado: 'pendiente', intentos: 0 } }));

    const ctx2 = crearContexto(alm, idb, gastos, drive);
    await F(ctx2, 'procesarColaOriginales')();
    const docs = F(ctx2, 'listarDocumentos')(refs(alm)[400]);
    test('cola vieja + referencia ya guardada: no se duplica la referencia ni el archivo', docs.length === 1 && drive.ficheros().length === 1, { docs, files: drive.ficheros().length });
    test('cola vieja: se limpia y se retira la copia temporal', idb.size === 0 && Object.keys(pend(alm)).length === 0);
  }

  // ── 8. La cola en memoria prevalece sobre la copia vieja de localStorage ───────────────────
  {
    const alm = new Map([['a132_recibos_pend', JSON.stringify({ 9: { estado: 'pendiente', intentos: 0 } })]]);
    const ctx = crearContexto(alm, new Map(), [], crearDrive());
    const setItem = ctx.localStorage.setItem;
    ctx.localStorage.setItem = (k, v) => { if (k === 'a132_recibos_pend') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return setItem(k, v); };
    const ok = F(ctx, 'guardarRecibosPend')({ 9: { estado: 'error', intentos: 3 } });
    const p = F(ctx, 'leerRecibosPend')();
    test('la cola en memoria prevalece sobre la copia vieja (no reinicia intentos)', ok === false && p[9] && p[9].estado === 'error' && p[9].intentos === 3, p);
  }

  // ── 9. Subida correcta aunque la cola no se pueda persistir; reinicio sin duplicar ──────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(2500); const gastos = [{ id: 500 }];
    idb.set('500', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    const ctx = crearContexto(alm, idb, gastos, drive);
    const setItem = ctx.localStorage.setItem;
    ctx.localStorage.setItem = (k, v) => { if (k === 'a132_recibos_pend') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return setItem(k, v); };
    await F(ctx, 'procesarColaOriginales')();
    test('subida correcta con cola no persistible: referencia guardada y original retirado', !!refs(alm)[500] && idb.size === 0, { refs: refs(alm), idb: [...idb.keys()] });

    const ctx2 = crearContexto(alm, idb, gastos, drive);
    await F(ctx2, 'procesarColaOriginales')();
    test('tras reiniciar no se vuelve a subir ni se duplica', drive.ficheros().length === 1 && Object.keys(pend(alm)).length === 0 && Object.keys(refs(alm)).length === 1, { files: drive.ficheros().length, refs: Object.keys(refs(alm)), pend: pend(alm) });
  }

  // ── 9b. Una entrada «sin_copia» con la copia presente se recupera al reiniciar ──────────────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(2200); const gastos = [{ id: 700 }];
    idb.set('700', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    alm.set('a132_recibos_pend', JSON.stringify({ 700: { estado: 'sin_copia', intentos: 0, ultimoError: 'la copia temporal ya no está en este dispositivo' } }));
    const ctx = crearContexto(alm, idb, gastos, drive);
    await F(ctx, 'procesarColaOriginales')();
    test('sin_copia con la copia presente: se reencola, se sube y se limpia', !!refs(alm)[700] && idb.size === 0 && Object.keys(pend(alm)).length === 0, { refs: refs(alm)[700], idb: [...idb.keys()], pend: pend(alm) });
  }

  // ── 10. Sin Drive conectado: la reconciliación local deja el pendiente visible ─────────────
  {
    const alm = new Map(); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(1500); const gastos = [{ id: 600 }];
    idb.set('600', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'r.jpg' });
    const ctx = crearContexto(alm, idb, gastos, drive, { token: false });
    await F(ctx, 'procesarColaOriginales')();
    test('sin Drive: el pendiente se reconstruye y queda visible, sin subir ni borrar', Object.keys(F(ctx, 'leerRecibosPend')()).includes('600') && idb.has('600') && !refs(alm)[600], F(ctx, 'leerRecibosPend')());

    alm.set('tok', 'T');
    const ctx2 = crearContexto(alm, idb, gastos, drive, { token: true });
    await F(ctx2, 'procesarColaOriginales')();
    test('al conectar Drive: se sube, se verifica y se limpia la cola', !!refs(alm)[600] && idb.size === 0 && Object.keys(pend(alm)).length === 0);
  }

  // ── 10b. Clave compuesta con referencia verificada del mismo tamaño: se limpia, no «sin_copia»
  {
    const alm = new Map([['tok', 'T']]);
    alm.set('a132_recibos', JSON.stringify({ 900: { driveId: 'F900', sha256: 'b'.repeat(64), bytes: 22, fecha: '2026-11-03T00:00:00Z' } }));
    alm.set('a132_recibos_pend', JSON.stringify({ '900~abc': { estado: 'error', intentos: 2, bytes: 22 } }));
    const idb = new Map();
    const gastos = [{ id: 900 }];
    const ctx = crearContexto(alm, idb, gastos, crearDrive());
    await F(ctx, 'procesarColaOriginales')();
    test('clave compuesta con referencia del mismo tamaño: se limpia y NO se marca «sin_copia»', !pend(alm)['900~abc'], pend(alm));
  }

  // ── 11. Cola vieja de la clave base con referencia ya verificada: se limpia, no «sin_copia»
  {
    const alm = new Map([['tok', 'T']]);
    alm.set('a132_recibos', JSON.stringify({ 800: { driveId: 'F800', sha256: 'a'.repeat(64), fecha: '2026-11-03T00:00:00Z' } }));
    alm.set('a132_recibos_pend', JSON.stringify({ 800: { estado: 'error', intentos: 3, ultimoError: 'x' } }));
    const idb = new Map();
    const gastos = [{ id: 800 }];
    const ctx = crearContexto(alm, idb, gastos, crearDrive());
    await F(ctx, 'procesarColaOriginales')();
    test('cola vieja con referencia verificada: se limpia y NO se marca «sin_copia»', !pend(alm)[800], pend(alm));
  }

  // ── 12. Dos pestañas simultáneas: Web Locks serializa la cola y no duplica la subida ──────
  {
    const alm = new Map([['tok', 'T']]); const idb = new Map(); const drive = crearDrive();
    const bytes = crypto.randomBytes(3500);
    idb.set('1000', { blob: archivo(bytes), tipo: 'image/jpeg', bytes: bytes.length, nombre: 'doble.jpg' });
    const gastos = [{ id: 1000 }];
    const ctx1 = crearContexto(alm, idb, gastos, drive);
    const ctx2 = crearContexto(alm, idb, gastos, drive);
    let cola = Promise.resolve();
    const locks = { request: (nombre, opciones, fn) => { const p = cola.then(fn); cola = p.catch(() => {}); return p; } };
    ctx1.navigator = { locks }; ctx2.navigator = { locks };
    await Promise.all([F(ctx1, 'procesarColaOriginales')(), F(ctx2, 'procesarColaOriginales')()]);
    test('12: dos pestañas simultáneas suben UN solo archivo y dejan UNA referencia', drive.ficheros().length === 1 && Object.keys(refs(alm)).length === 1 && idb.size === 0 && Object.keys(pend(alm)).length === 0, { files: drive.ficheros().length, refs: Object.keys(refs(alm)), idb: [...idb.keys()], pend: pend(alm) });
  }

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  process.exit(fail ? 1 : 0);
})();
