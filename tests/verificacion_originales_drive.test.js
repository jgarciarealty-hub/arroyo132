// Recibos originales en Google Drive (2026-11-01): MD5, subida verificada, duplicados, cola con reintento,
// copia temporal solo se borra tras verificar, referencias en el respaldo. Drive simulado con comportamiento real
// (guarda y devuelve bytes). Uso: node tests/verificacion_originales_drive.test.js
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

// ── Drive simulado ───────────────────────────────────────────────────────────
const drive = { archivos: new Map(), n: 1, modo: 'ok', llamadas: [] };
function nuevoId() { return 'F' + (drive.n++); }
const respuesta = (st, obj) => ({ ok: st >= 200 && st < 300, status: st, json: async () => obj });
async function fetchFalso(url, opts = {}) {
  const u = new URL(url); const m = opts.method || 'GET'; drive.llamadas.push(m + ' ' + u.pathname);
  if (drive.modo === 'caido') throw new Error('sin conexión');
  if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
    if (drive.modo === 'http500') return respuesta(500, {});
    const buf = Buffer.from(await opts.body.arrayBuffer());
    const lim = opts.headers['Content-Type'].split('boundary=')[1];
    const partes = buf.toString('latin1').split('--' + lim);
    const metaTxt = partes[1].split('\r\n\r\n')[1].replace(/\r\n$/, '');
    const meta = JSON.parse(Buffer.from(metaTxt, 'latin1').toString('utf8'));
    const ini = buf.indexOf('\r\n\r\n', buf.indexOf('--' + lim) + 2 + lim.length + 2 + metaTxt.length) + 4;
    const fin = buf.lastIndexOf('\r\n--' + lim + '--');
    let datos = buf.subarray(ini, fin);
    if (drive.modo === 'trunca') datos = datos.subarray(0, datos.length - 1);
    if (drive.modo === 'corrompe') { datos = Buffer.from(datos); datos[0] ^= 0xff; }
    const id = nuevoId();
    drive.archivos.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, appProperties: meta.appProperties, datos, folder: false });
    return respuesta(200, vista(drive.archivos.get(id)));
  }
  if (m === 'POST' && u.pathname === '/drive/v3/files') {
    const meta = JSON.parse(opts.body); const id = nuevoId();
    drive.archivos.set(id, { id, name: meta.name, folder: true, datos: Buffer.alloc(0) });
    return respuesta(200, { id });
  }
  const mid = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (m === 'GET' && mid) {
    const f = drive.archivos.get(mid[1]); if (!f) return respuesta(404, {});
    if (u.searchParams.get('alt') === 'media') return { ok: true, status: 200, blob: async () => new Blob([f.datos]) };
    return respuesta(200, f.folder ? { id: f.id, trashed: false } : vista(f));
  }
  if (m === 'GET' && u.pathname === '/drive/v3/files') {
    const q = u.searchParams.get('q');
    if (q.includes('google-apps.folder')) return respuesta(200, { files: [...drive.archivos.values()].filter(f => f.folder).map(f => ({ id: f.id })) });
    const sha = q.match(/value='([0-9a-f]{64})'/);
    return respuesta(200, { files: [...drive.archivos.values()].filter(f => !f.folder && sha && f.appProperties && f.appProperties.sha256 === sha[1]).map(vista) });
  }
  return respuesta(404, {});
}
function vista(f) { return { id: f.id, name: f.name, size: String(f.datos.length), md5Checksum: crypto.createHash('md5').update(f.datos).digest('hex'), webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view', appProperties: f.appProperties }; }

// ── Contexto con las funciones REALES ────────────────────────────────────────
const alm = new Map([['tok','T']]); const idb = new Map();
const ctx = vm.createContext({
  fetch: fetchFalso, AbortController, clearTimeout, Blob, crypto: crypto.webcrypto, Uint8Array, DataView, ArrayBuffer, Math, JSON, String, Number, Object, Array, Date, Error, URL, console, Promise, setTimeout,
  localStorage: { getItem: k => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: k => alm.delete(k) },
  document: { getElementById: () => null },
  DRIVE_TOKEN_KEY: 'tok', driveTokenValid: () => true, asegurarTokenDrive: async () => 'T',
  marcarRespaldoPendiente() { ctx.__pend++; }, backupToDrive() {}, __pend: 0,
  estadoRespaldoTexto: () => '',
  origLeer: async id => idb.get(String(id)) || null,
  origBorrar: async id => { idb.delete(String(id)); },
  origGuardar: async (id, a) => { idb.set(String(id), { blob: a, tipo: a.type }); return true; },
});
const nombres = ['md5Hex', 'sha256Hex', 'extensionDe', 'verificarCargaOriginal', 'driveCarpetaRecibos', 'driveSubirOriginal', 'procesarColaOriginales', 'refrescarPanelRespaldo', 'registrarOriginalNuevo', 'textoEstadoOriginal', 'leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'guardarRecibosPend', 'escribirVerificado', 'actualizarPend', 'escHtml', 'fetchConTiempo'];
vm.runInContext("const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', RECIBOS_CARPETA_KEY='a132_recibos_carpeta', RECIBOS_CARPETA_NOMBRE='Arroyo 132 — Recibos originales'; const DRIVE_CAMPOS_ARCHIVO='id,name,size,md5Checksum,webViewLink,appProperties'; let _colaOriginalesEnCurso=false;\n" + nombres.map(extraer).join('\n'), ctx);
const R = n => vm.runInContext(n, ctx);
const fotoFalsa = (bytes, name = 'r.jpg', type = 'image/jpeg') => new File([bytes], name, { type });

(async () => {
  // MD5 contra la implementación de referencia, en tamaños que cruzan los límites de bloque
  let md5ok = true;
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100000]) {
    const b = crypto.randomBytes(n);
    if (R('md5Hex')(new Uint8Array(b)) !== crypto.createHash('md5').update(b).digest('hex')) { md5ok = false; console.log('md5 distinto en', n); }
  }
  test('MD5 propio coincide con la referencia (0–100 000 B, límites de bloque)', md5ok);

  const V = R('verificarCargaOriginal');
  const loc = { bytes: 10, md5: 'ab' };
  test('verificar: coincide → ok', V({ id: 'x', size: '10', md5Checksum: 'AB' }, loc).ok);
  test('verificar: tamaño distinto → falla', !V({ id: 'x', size: '9', md5Checksum: 'ab' }, loc).ok);
  test('verificar: md5 distinto → falla', !V({ id: 'x', size: '10', md5Checksum: 'cd' }, loc).ok);
  test('verificar: sin md5 → falla (no se asume éxito)', !V({ id: 'x', size: '10' }, loc).ok);
  test('verificar: sin archivo → falla', !V(null, loc).ok);

  // Subida real simulada: foto y PDF
  const foto = crypto.randomBytes(3_500_000);
  const refF = await R('driveSubirOriginal')(101, fotoFalsa(foto), 'T');
  const guardado = drive.archivos.get(refF.driveId);
  test('foto: Drive guarda el original COMPLETO (bytes idénticos, sin reducir)', Buffer.compare(guardado.datos, foto) === 0 && refF.bytes === 3_500_000);
  test('foto: referencia con id, nombre, sha256, carpeta y enlace', refF.driveId && /^recibo-101-[0-9a-f]{8}\.jpg$/.test(refF.nombre) && refF.sha256.length === 64 && refF.carpetaId && refF.enlace.includes(refF.driveId));
  test('foto: sha256 de la referencia = sha256 real del archivo', refF.sha256 === crypto.createHash('sha256').update(foto).digest('hex'));
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(200000)]);
  const refP = await R('driveSubirOriginal')(102, fotoFalsa(pdf, 'f.pdf', 'application/pdf'), 'T');
  test('PDF: se guarda íntegro con extensión pdf', Buffer.compare(drive.archivos.get(refP.driveId).datos, pdf) === 0 && refP.nombre.endsWith('.pdf'));
  const carpetas = [...drive.archivos.values()].filter(f => f.folder).length;
  test('una sola carpeta de recibos (no se duplica)', carpetas === 1);

  // Duplicado: mismo contenido → se reutiliza, no se sube otro
  const antes = drive.archivos.size;
  const refD = await R('driveSubirOriginal')(103, fotoFalsa(foto), 'T');
  test('duplicado: mismo contenido se reutiliza y no crea otro archivo', refD.reutilizado === true && refD.driveId === refF.driveId && drive.archivos.size === antes);

  // Fallos: nada se declara guardado
  for (const modo of ['trunca', 'corrompe']) {
    drive.modo = modo;
    let err = null; try { await R('driveSubirOriginal')(200, fotoFalsa(crypto.randomBytes(5000)), 'T'); } catch (e) { err = e; }
    test('carga ' + modo + ': NO se verifica (lanza error)', err && /verificación/.test(err.message), err && err.message);
  }
  drive.modo = 'http500';
  let e500 = null; try { await R('driveSubirOriginal')(201, fotoFalsa(crypto.randomBytes(100)), 'T'); } catch (e) { e500 = e; }
  test('HTTP 500 → error, no éxito', e500 && /HTTP 500/.test(e500.message));
  drive.modo = 'ok';

  // Cola: la copia temporal se borra SOLO tras verificar
  alm.clear(); alm.set('tok','T'); idb.clear();
  const bytes = crypto.randomBytes(8000);
  drive.modo = 'caido';
  await R('registrarOriginalNuevo')(300, fotoFalsa(bytes));
  await new Promise(r => setTimeout(r, 80));   // deja terminar el intento automático en segundo plano
  let pend = R('leerRecibosPend')();
  test('Drive caído: queda pendiente/error y VISIBLE', pend[300] && ['pendiente', 'error'].includes(pend[300].estado) && pend[300].ultimoError, pend);
  test('Drive caído: la copia temporal se conserva', idb.has('300'));
  test('Drive caído: no hay referencia (no se declara guardado)', !R('leerRecibos')()[300]);
  test('estado en texto indica pendiente/error y que la copia sigue aquí', /Pendiente|Error/.test(R('textoEstadoOriginal')(300)) && /sigue en este dispositivo/.test(R('textoEstadoOriginal')(300)));
  drive.modo = 'corrompe';
  await R('procesarColaOriginales')();
  test('carga corrupta: sigue pendiente con error y copia temporal intacta', R('leerRecibosPend')()[300].estado === 'error' && idb.has('300') && !R('leerRecibos')()[300]);
  drive.modo = 'ok';
  await R('procesarColaOriginales')();
  test('reintento correcto: referencia guardada', !!R('leerRecibos')()[300] && R('leerRecibos')()[300].sha256 === crypto.createHash('sha256').update(bytes).digest('hex'));
  test('reintento correcto: recién ahora se borra la copia temporal y el pendiente', !idb.has('300') && !R('leerRecibosPend')()[300]);
  test('estado final muestra Google Drive y carpeta', /En Google Drive/.test(R('textoEstadoOriginal')(300)) && /Recibos originales/.test(R('textoEstadoOriginal')(300)));
  test('nunca se borra nada en Drive (no hay DELETE)', !drive.llamadas.some(l => l.startsWith('DELETE')));
  test('nunca se sobrescribe (no hay PATCH/PUT de archivos)', !drive.llamadas.some(l => /^(PATCH|PUT)/.test(l)));


  // ── Regresiones de la revisión independiente ────────────────────────────────
  // B-1: un gasto nuevo guardado mientras la cola trabaja NO se pierde
  alm.clear(); alm.set('tok','T'); idb.clear(); drive.modo='ok';
  const orig = ctx.fetch; let liberar; const compuerta = new Promise(r => { liberar = r; });
  let primera = true;
  ctx.fetch = async (u, o) => { if (primera && /upload/.test(u)) { primera = false; await compuerta; } return orig(u, o); };
  idb.set('1', { blob: fotoFalsa(crypto.randomBytes(500)), tipo: 'image/jpeg' });
  R('actualizarPend')(1, { estado: 'pendiente' });
  const corrida = R('procesarColaOriginales')();            // empieza a subir el gasto 1 y queda detenida en la subida
  await new Promise(r => setTimeout(r, 20));
  await R('registrarOriginalNuevo')(2, fotoFalsa(crypto.randomBytes(600)));   // se guarda el gasto 2 durante la corrida
  liberar(); await corrida;
  await new Promise(r => setTimeout(r, 50));
  test('B-1: ambos originales quedan verificados (el gasto guardado durante la cola no se pierde)', !!R('leerRecibos')()[1] && !!R('leerRecibos')()[2] && Object.keys(R('leerRecibosPend')()).length === 0 && idb.size === 0, { refs: Object.keys(R('leerRecibos')()), pend: R('leerRecibosPend')(), idb: [...idb.keys()] });
  ctx.fetch = orig;

  // B-2: si la referencia no se puede guardar, NO se borra la copia temporal
  alm.clear(); alm.set('tok','T'); idb.clear();
  const setOrig = ctx.localStorage.setItem; 
  ctx.localStorage.setItem = (k, v) => { if (k === 'a132_recibos') throw new Error('QuotaExceededError'); return setOrig(k, v); };
  idb.set('9', { blob: fotoFalsa(crypto.randomBytes(700)), tipo: 'image/jpeg' });
  R('actualizarPend')(9, { estado: 'pendiente' });
  await R('procesarColaOriginales')();
  test('B-2: sin poder guardar la referencia → copia temporal conservada y estado error visible', idb.has('9') && R('leerRecibosPend')()[9] && R('leerRecibosPend')()[9].estado === 'error' && /referencia/.test(R('leerRecibosPend')()[9].ultimoError), R('leerRecibosPend')());
  ctx.localStorage.setItem = setOrig;

  // I-A: nombreOriginal en appProperties ≤ 124 bytes (clave+valor) aun con acentos
  alm.clear(); alm.set('tok','T');
  await R('driveSubirOriginal')(50, fotoFalsa(crypto.randomBytes(300), 'Factura ÁÉÍÓÚ ñ — muy larga '.repeat(8) + '.pdf', 'application/pdf'), 'T');
  const ult = [...drive.archivos.values()].pop();
  test('I-A: nombreOriginal cabe en el límite de Drive (124 bytes clave+valor)', Buffer.byteLength('nombreOriginal' + ult.appProperties.nombreOriginal) <= 124, ult.appProperties.nombreOriginal.length);

  // I-B: HTML en datos de referencia no se inyecta
  R('guardarRecibos')({ 77: { nombre: '<img src=x onerror=alert(1)>', fecha: '2026-11-01T00:00', driveId: 'z' } });
  test('I-B: el estado del original escapa HTML', !/<img/.test(R('textoEstadoOriginal')(77)) && /&lt;img/.test(R('textoEstadoOriginal')(77)));
  test('I-B: el enlace solo se acepta si es https de Google', script.includes("typeof ref.enlace==='string'") && script.includes('google\.com'));
  test('I-B: la descripción del detalle se escapa', script.includes('${escHtml(g.descripcion)}'));

  // I-C: copia perdida → estado explícito, sin reintento infinito
  alm.clear(); alm.set('tok','T'); idb.clear();
  R('actualizarPend')(5, { estado: 'pendiente' });
  await R('procesarColaOriginales')();
  test('I-C: si la copia temporal falta queda "sin_copia" con mensaje honesto', R('leerRecibosPend')()[5].estado === 'sin_copia' && /se perdió/.test(R('textoEstadoOriginal')(5)));

  // Subida colgada: el tiempo máximo evita bloquear la cola
  test('la cola usa fetch con tiempo máximo (AbortController)', script.includes('new AbortController()') && script.includes('await fetchConTiempo(') && !extraer('driveSubirOriginal').includes('await fetch('));
  test('la vista previa libera su blob', script.split('revokeObjectURL(_fotoDataUrl)').length - 1 >= 2);
  test('regex del IVU corregida', !script.includes('replace(/[$,s]/g') && /obj\.ivu==null\?'':obj\.ivu\)\.replace\(\/\[\$,\\s\]\/g/.test(script));

  // Integración en la app
  test('guardarGasto delega en registrarOriginalNuevo', script.includes('registrarOriginalNuevo(nuevoId,_archivoOriginal)'));
  test('el respaldo incluye las referencias (contenidoBackup + fusión + combinado)', /recibos: leerRecibos\(\)/.test(script) && /recibosFusion/.test(script) && /recibos: fusion\.recibos/.test(script));
  test('restaurar e importar conservan las referencias', (script.match(/guardarRecibos\(fusion\.recibos\)/g) || []).length === 2);
  test('eliminar un gasto no toca Drive', /Drive no se toca/.test(script) && !/method:'DELETE'/.test(script));
  test('panel: ubicación de gastos y recibos, verificados/pendientes/errores y reintento', /Recibos originales: en Google Drive/.test(script) && /pendientes de subir/.test(script) && /con error/.test(script) && /reintentarOriginalesManual/.test(script));
  test('413 y archivo demasiado grande se manejan sin perder el original', /res\.status===413/.test(script) && /demasiado grande para leerlo con IA/.test(script));
  test('reducirParaIA garantiza ≤ 3 MB base64 (límite del servidor 4.2 MB)', /IA_MAX_BASE64=3000000/.test(script) && /\[1000,0\.55\]/.test(script));

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
