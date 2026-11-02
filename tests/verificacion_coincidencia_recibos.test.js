// Coincidencia recibo ↔ gasto existente, asociación sin duplicar y varios documentos por gasto (2026-11-01).
// Funciones REALES extraídas de index.html, Drive simulado con bytes reales, DOM mínimo simulado. Sin red, sin IA, sin Drive real.
// Uso: node tests/verificacion_coincidencia_recibos.test.js        (incluye mutaciones sobre copias temporales)
//      A132_HTML=<ruta> node tests/...                              (usado por las mutaciones)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HTML = process.env.A132_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));   // el árbol de trabajo puede tener CRLF (autocrlf)
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const C = require('../central/estado_central.js');
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
function constante(nombre) { const m = script.match(new RegExp('^const ' + nombre + '=.*;$', 'm')); if (!m) throw new Error('no existe const ' + nombre); return m[0]; }

// ── Drive simulado (guarda y devuelve bytes reales) ─────────────────────────────
const drive = { archivos: new Map(), n: 1, modo: 'ok', llamadas: [] };
const respuesta = (st, obj) => ({ ok: st >= 200 && st < 300, status: st, json: async () => obj });
function vista(f) { return { id: f.id, name: f.name, size: String(f.datos.length), md5Checksum: crypto.createHash('md5').update(f.datos).digest('hex'), webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view', appProperties: f.appProperties }; }
async function fetchFalso(url, opts = {}) {
  const u = new URL(url); const m = opts.method || 'GET'; drive.llamadas.push(m + ' ' + u.pathname);
  if (drive.modo === 'caido') throw new Error('sin conexión');
  if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
    const buf = Buffer.from(await opts.body.arrayBuffer());
    const lim = opts.headers['Content-Type'].split('boundary=')[1];
    const partes = buf.toString('latin1').split('--' + lim);
    const metaTxt = partes[1].split('\r\n\r\n')[1].replace(/\r\n$/, '');
    const meta = JSON.parse(Buffer.from(metaTxt, 'latin1').toString('utf8'));
    const ini = buf.indexOf('\r\n\r\n', buf.indexOf('--' + lim) + 2 + lim.length + 2 + metaTxt.length) + 4;
    const fin = buf.lastIndexOf('\r\n--' + lim + '--');
    const id = 'F' + (drive.n++);
    drive.archivos.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, appProperties: meta.appProperties, datos: buf.subarray(ini, fin), folder: false });
    return respuesta(200, vista(drive.archivos.get(id)));
  }
  if (m === 'POST' && u.pathname === '/drive/v3/files') { const meta = JSON.parse(opts.body); const id = 'F' + (drive.n++); drive.archivos.set(id, { id, name: meta.name, folder: true, datos: Buffer.alloc(0) }); return respuesta(200, { id }); }
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

// ── DOM mínimo ───────────────────────────────────────────────────────────────────
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this._t = ''; this.onclick = null; this.disabled = false; this.className = ''; this.innerHTMLAsignado = false; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return [this._t].concat(this.children.map(c => c.textContent)).join(' | '); }
  set innerHTML(v) { this.innerHTMLAsignado = true; this._t = String(v); }
  appendChild(c) { this.children.push(c); return c; }
}
const todos = e => [e].concat(...e.children.map(todos));
const botones = e => todos(e).filter(x => x.tag === 'button');
const boton = (e, txt) => botones(e).find(b => b.textContent.includes(txt));
const dom = {};
function ponerDom() { ['coincidencia-box', 'reg-form', 'orig-recibo-1783398814338', 'orig-recibo-700010'].forEach(id => { dom[id] = new El('div'); }); dom['coincidencia-box'].style.display = 'none'; dom['reg-form'].style.display = 'block'; }

// ── Contexto con las funciones REALES ────────────────────────────────────────────
const alm = new Map([['tok', 'T']]); const idb = new Map();
const alertas = [];
const cont = { reset: 0, guardarGasto: 0 };
const ctx = vm.createContext({
  fetch: fetchFalso, AbortController, clearTimeout, Blob, crypto: crypto.webcrypto, Uint8Array, DataView, ArrayBuffer, Math, JSON, String, Number, Object, Array, Date, Error, URL, console, Promise, setTimeout, isFinite, isNaN, Set, RegExp,
  localStorage: { getItem: k => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: k => alm.delete(k) },
  document: { getElementById: id => dom[id] || null, createElement: t => new El(t) },
  DRIVE_TOKEN_KEY: 'tok', driveTokenValid: () => true, asegurarTokenDrive: async () => 'T',
  marcarRespaldoPendiente() {}, backupToDrive() {}, estadoRespaldoTexto: () => '', gastos: [], fotos: {},
  origClaves: async () => [...idb.keys()],
  origLeer: async id => idb.get(String(id)) || null,
  origBorrar: async id => { idb.delete(String(id)); },
  origGuardar: async (id, a) => { idb.set(String(id), { blob: a, tipo: a.type, bytes: a.size }); return true; },
  alert: m => alertas.push(String(m)), confirm: () => true,
  resetRegistrar: () => { cont.reset++; }, guardarGasto: () => { cont.guardarGasto++; },
  save() {}, closeModal() {}, renderHistorial() {}, renderDashboard() {},
});
const nombres = ['md5Hex', 'sha256Hex', 'extensionDe', 'verificarCargaOriginal', 'driveCarpetaRecibos', 'driveSubirOriginal', 'procesarColaOriginales', 'refrescarPanelRespaldo', 'registrarOriginalNuevo',
  'textoEstadoOriginal', 'textoEstadoOriginalBase', 'leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'guardarRecibosPend', 'escribirVerificado', 'actualizarPend', 'escHtml', 'fetchConTiempo', 'limpiarRecibos',
  'docRefValido', 'listarDocumentos', 'sinHistorico', 'aplicarReferencia', 'gastoDeClave', 'clavesPendDeGasto', 'documentosDeGasto',
  '_esperar', '_estadoAsociacion', 'vigilarAsociacion', '_btnUnico', 'tokensProveedor', 'proveedorContenido', 'distanciaLev', 'similitudProveedor', 'diasEntreFechas', 'buscarGastoCoincidente', 'asociarOriginalAGasto', '_btnCoinc', '_lineaGasto', 'cerrarCoincidencia', 'mostrarCoincidencia', 'terminarAsociacion',
  'verReciboOriginal', 'pintarOtrosDocumentos', 'eliminarGasto'];
vm.runInContext("const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', RECIBOS_CARPETA_KEY='a132_recibos_carpeta', RECIBOS_CARPETA_NOMBRE='Arroyo 132 — Recibos originales'; const DRIVE_CAMPOS_ARCHIVO='id,name,size,md5Checksum,webViewLink,appProperties'; var _archivoOriginal=null; var _colaOriginalesEnCurso=false; " + script.match(/^var _esperaColaMs=.*;$/m)[0] + " var _adjuntando={};\n"
  + constante('PROV_RUIDO') + '\n' + constante('_cents') + '\n' + nombres.map(extraer).join('\n'), ctx);
const R = n => vm.runInContext(n, ctx);
const archivo = (bytes, name = 'r.jpg', type = 'image/jpeg') => new File([bytes], name, { type });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const espera = ms => new Promise(r => setTimeout(r, ms));
const QID = 1783398814338;
const base = () => [
  { id: QID, fecha: '2026-06-24', contratista: 'QUALITY iS', categoria: 'Herramientas', monto: 25.06, descripcion: 'Compra de puntas hammer', archivos: [{ nombre: 'A132-REC-033_QUALITYiS_2026-06-24.jpg' }] },
  { id: 700010, fecha: '2026-04-28', contratista: 'Ferretería Cosme', categoria: 'Materiales', monto: 232.48, descripcion: 'Materiales varios' },
  { id: 800001, fecha: '2026-05-10', contratista: 'Autoexpreso', categoria: 'Otros', monto: 28.13, descripcion: 'Peaje' },
  { id: 800002, fecha: '2026-05-10', contratista: 'Autoexpreso', categoria: 'Otros', monto: 28.13, descripcion: 'Peaje' },
  { id: 900001, fecha: '2026-03-01', contratista: 'Plomería López', categoria: 'Plomería', monto: 410, descripcion: 'Tubería' },
];
function reiniciar() {
  alm.clear(); alm.set('tok', 'T'); idb.clear(); drive.archivos.clear(); drive.llamadas.length = 0; drive.modo = 'ok'; alertas.length = 0; cont.reset = 0; cont.guardarGasto = 0;
  ctx.gastos.length = 0; base().forEach(g => ctx.gastos.push(g)); ponerDom(); R('_archivoOriginal=null');
}
const asentar = async () => { await espera(60); await R('procesarColaOriginales')(); await espera(20); };
const nivel = (campos, lista) => R('buscarGastoCoincidente')(campos, lista || ctx.gastos);
const ids = r => r.candidatos.map(c => c.gasto.id);

(async () => {
  reiniciar();
  // ── 1. Función pura de coincidencia ────────────────────────────────────────────
  const Q = { fecha: '2026-06-24', monto: 25.06, contratista: 'QUALITY IS' };
  let r = nivel(Q);
  test('CASO OBLIGATORIO: «QUALITY IS» $25.06 2026-06-24 → ALTA hacia el gasto 1783398814338', r.nivel === 'ALTA' && ids(r).join() === String(QID), r);
  r = nivel(Object.assign({}, Q, { contratista: 'Quality iS Inc.' }));
  test('«Quality iS Inc.» → ALTA (tolera mayúsculas y sufijo Inc.)', r.nivel === 'ALTA' && ids(r)[0] === QID);
  r = nivel(Object.assign({}, Q, { monto: 25.60 }));
  test('importe erróneo 25.60 → INCIERTA (nunca ALTA) y lista el gasto con su motivo', r.nivel === 'INCIERTA' && ids(r).includes(QID) && r.candidatos[0].motivos.length >= 2, r.nivel);
  r = nivel(Object.assign({}, Q, { fecha: '2026-06-26' }));
  test('fecha 2026-06-26 (2 días) → INCIERTA', r.nivel === 'INCIERTA' && ids(r).includes(QID), r.nivel);
  r = nivel({ fecha: '2026-06-24', monto: 99.99, contratista: 'Otra Cosa SRL' });
  test('1 de 3 criterios (solo la fecha) → NINGUNA', r.nivel === 'NINGUNA' && r.candidatos.length === 0);
  r = nivel({ fecha: '2026-04-28', monto: 232.48, contratista: 'FERRETERIA COSME INC.' });
  test('Ferretería Cosme Inc. ≈ Ferretería Cosme (acentos, mayúsculas, Inc.) → ALTA', r.nivel === 'ALTA' && ids(r)[0] === 700010);
  r = nivel({ fecha: '2026-05-10', monto: 28.13, contratista: 'Autoexpreso' });
  test('peajes idénticos del mismo día → NO ALTA: INCIERTA ambigua con ambos candidatos', r.nivel === 'INCIERTA' && r.ambiguo === true && ids(r).sort().join() === '800001,800002', r);
  r = nivel({ fecha: '2026-04-28', monto: 107, ivu: 7, contratista: 'Ferretería Cosme' }, [{ id: 5, fecha: '2026-04-28', contratista: 'Ferretería Cosme', monto: 100, categoria: 'Materiales' }]);
  test('importe igual al subtotal (total − IVU leído) → ALTA con motivo explicado', r.nivel === 'ALTA' && r.candidatos[0].motivos.some(m => /subtotal/.test(m)), r.candidatos[0] && r.candidatos[0].motivos);
  r = nivel({ fecha: '2026-04-28', monto: 232.48, contratista: 'Ferretería Rincón' });
  test('proveedor dudoso (comparte solo una palabra) con fecha e importe → INCIERTA, no ALTA', r.nivel === 'INCIERTA' && r.candidatos[0].gasto.id === 700010 && r.candidatos[0].proveedor === 'dudoso', r.nivel);
  r = nivel({ fecha: '2026-04-30', monto: 232.48, contratista: 'Ferretería Rincón' });
  test('proveedor dudoso + fecha a 2 días + mismo importe → INCIERTA (la regla del proveedor dudoso)', r.nivel === 'INCIERTA' && r.candidatos[0].gasto.id === 700010, r.nivel);
  r = nivel({ fecha: '2026-03-01', monto: 410, contratista: 'Sin especificar' }, [{ id: 6, fecha: '2026-03-01', contratista: 'Sin especificar', monto: 410 }]);
  test('«Sin especificar» nunca cuenta como proveedor coincidente (queda INCIERTA por fecha+importe)', r.nivel === 'INCIERTA');
  const cuatro = [1, 2, 3, 4].map(i => ({ id: i, fecha: '2026-01-01', contratista: 'X Y', monto: 10 }));
  r = nivel({ fecha: '2026-01-01', monto: 10, contratista: 'X Y' }, cuatro);
  test('máximo 3 candidatos, cada uno con motivos', r.candidatos.length === 3 && r.candidatos.every(c => c.motivos.length >= 3));
  const antes = JSON.stringify(ctx.gastos); nivel(Q); nivel({ fecha: '2026-05-10', monto: 28.13, contratista: 'Autoexpreso' });
  test('buscar no modifica la lista de gastos', JSON.stringify(ctx.gastos) === antes);
  test('lectura vacía o lista vacía → NINGUNA sin error', nivel({}).nivel === 'NINGUNA' && nivel(Q, []).nivel === 'NINGUNA' && nivel(null, null).nivel === 'NINGUNA');

  // ── 2. ALTA: asociar sin duplicar ──────────────────────────────────────────────
  reiniciar();
  const foto = crypto.randomBytes(2_400_000);
  R('_archivoOriginal=null'); ctx.__f = archivo(foto, 'IMG_hammer.jpg'); R('_archivoOriginal=__f');
  const gastosAntes = JSON.stringify(ctx.gastos);
  test('UI ALTA: muestra el mensaje «parece ser el gasto» y oculta el formulario de gasto nuevo', R('mostrarCoincidencia')(nivel(Q)) === true && /parece ser el gasto/.test(dom['coincidencia-box'].textContent) && /QUALITY iS/.test(dom['coincidencia-box'].textContent) && /25\.06/.test(dom['coincidencia-box'].textContent) && dom['reg-form'].style.display === 'none');
  test('UI ALTA: ofrece «Asociar el recibo a ese gasto» y «Es un gasto distinto»', !!boton(dom['coincidencia-box'], 'Asociar el recibo a ese gasto') && !!boton(dom['coincidencia-box'], 'Es un gasto distinto'));
  test('UI ALTA: mostrar no sube nada todavía', drive.archivos.size === 0 && idb.size === 0);
  drive.modo = 'caido';
  await boton(dom['coincidencia-box'], 'Asociar el recibo a ese gasto').onclick();
  await espera(60);
  test('asociar: el original queda PENDIENTE (copia temporal completa + estado visible) mientras no se verifica', R('leerRecibosPend')()[QID] && idb.has(String(QID)) && !R('leerRecibos')()[QID] && /Pendiente|Error/.test(R('textoEstadoOriginal')(QID)));
  drive.modo = 'ok'; await asentar();
  const ref = R('leerRecibos')()[QID], enDrive = ref && drive.archivos.get(ref.driveId);
  test('asociar: pendiente → VERIFICADO, el archivo completo (bytes idénticos, sin reducir) está en Drive', ref && ref.sha256 === sha(foto) && ref.bytes === 2_400_000 && Buffer.compare(enDrive.datos, foto) === 0 && !idb.has(String(QID)) && !R('leerRecibosPend')()[QID]);
  test('asociar: NO se creó otro gasto ni se tocó ningún campo (importe, fecha, proveedor, archivos)', JSON.stringify(ctx.gastos) === gastosAntes && ctx.gastos.length === 5);
  test('asociar: el formulario de gasto nuevo NO se guardó (guardarGasto nunca llamado) y la pantalla se reinició', cont.guardarGasto === 0 && cont.reset === 1 && alertas.some(a => /NO se pudo confirmar la subida a Drive/.test(a)) && !alertas.some(a => /✅/.test(a)));   // D4: con Drive caído no hay «✅» prematuro
  test('asociar: se abre desde el detalle del gasto (verReciboOriginal muestra el original y verifica integridad)', await (async () => { await R('verReciboOriginal')(QID); const t = dom['orig-recibo-' + QID].textContent; return /integridad verificada/.test(t) && dom['orig-recibo-' + QID].children.some(c => c.tag === 'img' || c.tag === 'a'); })());
  test('asociar: nunca se borra ni se sobrescribe en Drive', !drive.llamadas.some(l => /^(DELETE|PATCH|PUT)/.test(l)));

  // ── 3. INCIERTA: exige confirmación explícita ──────────────────────────────────
  reiniciar(); ctx.__f = archivo(crypto.randomBytes(5000), 'x.jpg'); R('_archivoOriginal=__f');
  r = nivel(Object.assign({}, Q, { monto: 25.60 }));
  R('mostrarCoincidencia')(r);
  const cb = dom['coincidencia-box'];
  test('UI INCIERTA: lista el candidato con el motivo y pide confirmación; sin botón de asociación automática', /Por qué/.test(cb.textContent) && !boton(cb, 'Asociar el recibo a ese gasto') && !!boton(cb, 'Es este gasto: asociar el recibo') && !!boton(cb, 'Es un gasto distinto') && dom['reg-form'].style.display === 'none');
  await espera(30);
  test('UI INCIERTA: nada se asocia ni se sube sin confirmar', drive.archivos.size === 0 && idb.size === 0 && !Object.keys(R('leerRecibosPend')()).length);
  await boton(cb, 'Es un gasto distinto').onclick();
  test('«Es un gasto distinto» → vuelve el formulario de gasto nuevo, caja oculta, nada subido', dom['reg-form'].style.display === 'block' && cb.style.display === 'none' && idb.size === 0 && drive.archivos.size === 0);
  // peajes: se elige uno concreto
  reiniciar(); ctx.__f = archivo(crypto.randomBytes(3000), 'peaje.jpg'); R('_archivoOriginal=__f');
  R('mostrarCoincidencia')(nivel({ fecha: '2026-05-10', monto: 28.13, contratista: 'Autoexpreso' }));
  const bs = botones(dom['coincidencia-box']).filter(b => /Es este gasto/.test(b.textContent));
  test('peajes idénticos: 2 candidatos, ninguno preseleccionado', bs.length === 2 && !boton(dom['coincidencia-box'], 'Asociar el recibo a ese gasto'));
  await bs[1].onclick(); await asentar();
  const rp = R('leerRecibos')();
  test('peajes: solo el gasto elegido recibe el documento (no se asocia a ciegas al otro)', Object.keys(rp).length === 1 && Object.keys(rp)[0] === '800002' || Object.keys(rp)[0] === '800001' && Object.keys(rp).length === 1, Object.keys(rp));

  // ── 4. Gasto que YA tiene documento: conservar / añadir / actualizar ───────────
  const externo = () => ({ origen: 'externo', docs: [{ driveId: 'ABCDEFGHIJ12', nombre: 'Cosme_0428.pdf', enlace: 'https://drive.google.com/file/d/ABCDEFGHIJ12/view' }] });
  const campCosme = { fecha: '2026-04-28', monto: 232.48, contratista: 'Ferretería Cosme Inc.' };
  async function escenarioCosme() {
    reiniciar(); R('guardarRecibos')({ 700010: externo() });
    ctx.__f = archivo(crypto.randomBytes(7000), 'cosme_nuevo.jpg'); R('_archivoOriginal=__f');
    R('mostrarCoincidencia')(nivel(campCosme));
    await boton(dom['coincidencia-box'], 'Asociar el recibo a ese gasto').onclick();
  }
  await escenarioCosme();
  let box = dom['coincidencia-box'];
  test('con documento externo existente: pregunta con las TRES opciones explícitas', /ya tiene documento/.test(box.textContent) && !!boton(box, 'Conservar el actual (no subir nada)') && !!boton(box, 'Añadir otro documento') && !!boton(box, 'Actualizar (el nuevo pasa a ser el principal; el anterior se conserva como histórico)') && drive.archivos.size === 0);
  await boton(box, 'Conservar el actual').onclick(); await espera(40);
  test('Conservar: no sube nada, la referencia queda idéntica y se reinicia la pantalla', drive.archivos.size === 0 && idb.size === 0 && JSON.stringify(R('leerRecibos')()) === JSON.stringify({ 700010: externo() }) && cont.reset === 1 && !drive.llamadas.length);

  await escenarioCosme(); await boton(dom['coincidencia-box'], 'Añadir otro documento').onclick(); await asentar();
  let rc = R('leerRecibos')()[700010];
  test('Añadir (sobre externo): el externo sigue como principal intacto y el nuevo va en adicionales[]', JSON.stringify(Object.assign({}, rc, { adicionales: undefined })) === JSON.stringify(Object.assign(externo(), { adicionales: undefined })) && rc.adicionales.length === 1 && rc.adicionales[0].sha256 && !rc.reemplazados);
  test('Añadir: el gasto no cambió y el estado lo cuenta', ctx.gastos.length === 5 && ctx.gastos[1].monto === 232.48 && /1 documento\(s\) adicional/.test(R('textoEstadoOriginal')(700010)));

  await escenarioCosme(); await boton(dom['coincidencia-box'], 'Actualizar (').onclick(); await asentar();
  rc = R('leerRecibos')()[700010];
  test('Actualizar (sobre externo): el nuevo es el principal y el externo se CONSERVA en reemplazados[]', rc.driveId && rc.sha256 && rc.reemplazados.length === 1 && JSON.stringify(rc.reemplazados[0]) === JSON.stringify(externo()));
  test('Actualizar: ni el archivo antiguo ni su referencia se borraron (sin DELETE en Drive)', !drive.llamadas.some(l => /^DELETE/.test(l)) && R('listarDocumentos')(rc).map(x => x.rol).join() === 'principal,anterior' && /1 anterior\(es\) conservado/.test(R('textoEstadoOriginal')(700010)));

  // cadena sobre documento propio: principal → añadir → actualizar
  reiniciar();
  const A = crypto.randomBytes(4000), B = crypto.randomBytes(4100), D = crypto.randomBytes(4200);
  const subir = async (bytes, modo, nombre) => { ctx.__f = archivo(bytes, nombre); R('_archivoOriginal=__f'); const o = await R('asociarOriginalAGasto')(QID, ctx.__f, modo); await asentar(); return o; };
  test('gasto sin documento: asociar con modo cualquiera lo guarda como principal', (await subir(A, undefined, 'a.jpg')).ok && R('leerRecibos')()[QID].sha256 === sha(A));
  const sinModo = await subir(crypto.randomBytes(100), undefined, 'z.jpg');
  test('gasto con documento: asociar SIN elegir modo se rechaza (no se pisa nada)', !sinModo.ok && /conservar, añadir o actualizar/.test(sinModo.motivo) && R('leerRecibos')()[QID].sha256 === sha(A) && !(R('leerRecibos')()[QID].adicionales));
  await subir(B, 'anadir', 'b.jpg');
  let rq = R('leerRecibos')()[QID];
  test('añadir sobre propio: principal intacto, B en adicionales', rq.sha256 === sha(A) && rq.adicionales.length === 1 && rq.adicionales[0].sha256 === sha(B));
  await subir(B, 'anadir', 'b-otra-vez.jpg'); rq = R('leerRecibos')()[QID];
  test('añadir el MISMO archivo otra vez no duplica la referencia ni sube de nuevo', rq.adicionales.length === 1 && [...drive.archivos.values()].filter(f => !f.folder).length === 2);
  await subir(D, 'actualizar', 'd.jpg'); rq = R('leerRecibos')()[QID];
  test('actualizar: D es el principal; A pasa a reemplazados[] (sin historial anidado); B sigue en adicionales[]', rq.sha256 === sha(D) && rq.reemplazados.length === 1 && rq.reemplazados[0].sha256 === sha(A) && !rq.reemplazados[0].reemplazados && !rq.reemplazados[0].adicionales && rq.adicionales.length === 1 && rq.adicionales[0].sha256 === sha(B));
  test('los 3 archivos siguen íntegros en Drive y no hubo borrados', [A, B, D].every(b => [...drive.archivos.values()].some(f => !f.folder && Buffer.compare(f.datos, b) === 0)) && !drive.llamadas.some(l => /^(DELETE|PATCH|PUT)/.test(l)));
  test('roles listados: principal, adicional, anterior', R('listarDocumentos')(rq).map(x => x.rol).join() === 'principal,adicional,anterior');
  test('importes y fechas del gasto intactos tras la cadena', ctx.gastos[0].monto === 25.06 && ctx.gastos[0].fecha === '2026-06-24' && ctx.gastos[0].contratista === 'QUALITY iS' && ctx.gastos.length === 5);

  // detalle: visor con todos los documentos y escape de HTML
  const refVis = R('leerRecibos')()[QID]; refVis.adicionales[0].nombre = '<img src=x onerror=alert(1)>'; R('guardarRecibos')({ [QID]: refVis });
  await R('verReciboOriginal')(QID);
  const cv = dom['orig-recibo-' + QID], bsv = botones(cv);
  test('visor: muestra el principal y lista los otros (adicional + anterior) como botones', /Otros documentos de este gasto \(2\)/.test(cv.textContent) && bsv.length === 2 && bsv.some(b => /Anterior \(histórico\)/.test(b.textContent)) && bsv.some(b => /Adicional/.test(b.textContent)));
  test('visor: el nombre con HTML se muestra como texto (textContent), nunca como HTML', bsv.some(b => b.textContent.includes('<img src=x')) && !todos(cv).some(e => e.innerHTMLAsignado));
  const bAnt = bsv.find(b => /Anterior/.test(b.textContent)); await bAnt.onclick();
  test('visor: abrir el anterior lo descarga de Drive y verifica su SHA-256', /integridad verificada/.test(cv.textContent));
  test('el HTML de pintarOtrosDocumentos no usa innerHTML', !/innerHTML/.test(extraer('pintarOtrosDocumentos')));

  // ── 5. Cola con documentos pendientes y orden ──────────────────────────────────
  reiniciar();
  const P1 = crypto.randomBytes(1500), P2 = crypto.randomBytes(1600), P3 = crypto.randomBytes(1700);
  drive.modo = 'caido';
  ctx.__f = archivo(P1, 'p1.jpg'); await R('asociarOriginalAGasto')(QID, ctx.__f, 'nuevo'); await espera(60);
  test('pendiente en cola cuenta como «ya tiene documento»', R('documentosDeGasto')(QID).tiene === true && R('documentosDeGasto')(QID).pendientes.length === 1);
  ctx.__f = archivo(P2, 'p2.jpg'); const oa = await R('asociarOriginalAGasto')(QID, ctx.__f, 'anadir'); await espera(60);
  ctx.__f = archivo(P3, 'p3.jpg'); const ou = await R('asociarOriginalAGasto')(QID, ctx.__f, 'actualizar'); await espera(60);
  test('con el principal aún pendiente, añadir/actualizar usan claves propias y NO pisan la copia temporal', oa.ok && ou.ok && idb.size === 3 && Object.keys(R('leerRecibosPend')()).length === 3 && /2 documento\(s\) más pendiente/.test(R('textoEstadoOriginal')(QID)), [idb.size, Object.keys(R('leerRecibosPend')())]);
  drive.modo = 'ok'; await asentar(); await asentar();
  rq = R('leerRecibos')()[QID];
  test('al volver Drive: se suben los 3 en orden y no se pierde ninguno (P1 principal → P2 adicional → P3 actualiza)', rq.sha256 === sha(P3) && R('listarDocumentos')(rq).length === 3 && [P1, P2, P3].every(b => R('listarDocumentos')(rq).some(x => x.doc.sha256 === sha(b))) && idb.size === 0 && !Object.keys(R('leerRecibosPend')()).length, rq);
  // guarda: un original base tardío no pisa una referencia que ya existe
  reiniciar();
  const T1 = crypto.randomBytes(900), T2 = crypto.randomBytes(950);
  ctx.__f = archivo(T1, 't1.jpg'); await R('asociarOriginalAGasto')(QID, ctx.__f, 'nuevo'); await asentar();
  idb.set(String(QID), { blob: archivo(T2, 't2.jpg'), tipo: 'image/jpeg' }); R('actualizarPend')(QID, { estado: 'pendiente', intentos: 0 });
  await asentar();
  rq = R('leerRecibos')()[QID];
  test('un pendiente «base» tardío NO sobrescribe la referencia existente: pasa a adicionales', rq.sha256 === sha(T1) && rq.adicionales.length === 1 && rq.adicionales[0].sha256 === sha(T2));
  // eliminar el gasto limpia también los pendientes con clave compuesta
  reiniciar(); drive.modo = 'caido';
  ctx.__f = archivo(crypto.randomBytes(300), 'e1.jpg'); await R('asociarOriginalAGasto')(700010, ctx.__f, 'nuevo'); ctx.__f = archivo(crypto.randomBytes(310), 'e2.jpg'); await R('asociarOriginalAGasto')(700010, ctx.__f, 'anadir'); await espera(60);
  const nIdb = idb.size; R('eliminarGasto')(700010);
  test('eliminar un gasto borra sus copias temporales y pendientes compuestos (Drive no se toca)', nIdb === 2 && idb.size === 0 && !Object.keys(R('leerRecibosPend')()).length);
  drive.modo = 'ok';

  // ── 6. Esquema compatible con limpiarRecibos y la fuente central ───────────────
  const refCompleta = { driveId: 'D1', sha256: 'h1', nombre: 'a', adicionales: [{ driveId: 'D2', sha256: 'h2' }, { basura: 1 }, null], reemplazados: [{ origen: 'externo', docs: [{ driveId: 'ABCDEFGHIJ12' }] }, 'x'] };
  const L = R('limpiarRecibos')({ 1: refCompleta, 2: { driveId: 'D', sha256: 'h', adicionales: 'no-es-arreglo' }, 3: { driveId: 'D3', sha256: 'h3' } });
  test('limpiarRecibos conserva adicionales[]/reemplazados[] válidos y descarta lo inválido', L[1].adicionales.length === 1 && L[1].reemplazados.length === 1 && L[1].driveId === 'D1' && L[2].adicionales === undefined && L[3].driveId === 'D3');
  const Lc = C.limpiarRecibos({ 1: refCompleta, 2: { driveId: 'D', sha256: 'h', adicionales: 'no-es-arreglo' } });
  test('la fuente central (estado_central.js) limpia exactamente igual', JSON.stringify(Lc[1]) === JSON.stringify(L[1]) && Lc[2].adicionales === undefined);
  const ea = C.nuevoEstado(), eb = C.nuevoEstado(); ea.recibos = { 1: refCompleta }; eb.recibos = { 9: { driveId: 'D9', sha256: 'h9', adicionales: [{ driveId: 'DX', sha256: 'hx' }] } };
  const fus = C.fusionar(ea, eb);
  test('la fusión central (fusionar) no pierde adicionales[] / reemplazados[] de ninguno de los dos lados', fus.recibos[1].adicionales.length === 1 && fus.recibos[1].reemplazados.length === 1 && fus.recibos[9].adicionales[0].driveId === 'DX', fus.recibos);
  const mapa = C.fusionar(ea, C.nuevoEstado());
  test('el round-trip por JSON (respaldo/Drive) conserva el esquema', JSON.stringify(JSON.parse(JSON.stringify(mapa)).recibos[1]) === JSON.stringify(mapa.recibos[1]));

  // ── 7. Integración en la app ───────────────────────────────────────────────────
  // ── 6b. D2: lectura SIN fecha ───────────────────────────────────────────────────
  r = nivel({ monto: 25.06, contratista: 'Quality iS (Herramientas PR)' });
  test('D2: sin fecha, «Quality iS (Herramientas PR)» $25.06 → INCIERTA hacia QUALITY iS (no ofrece gasto nuevo)', r.nivel === 'INCIERTA' && ids(r)[0] === QID, r);
  r = nivel({ monto: 25.06, contratista: 'Ferretería Cosme' });
  test('D2: sin fecha, mismo importe con proveedor distinto → NINGUNA', r.nivel === 'NINGUNA', r);
  r = nivel({ monto: 25.07, contratista: 'Quality iS (Herramientas PR)' });
  test('D2: sin fecha, proveedor compatible con importe distinto → NINGUNA', r.nivel === 'NINGUNA', r);
  r = nivel({ fecha: '2026-06-24', monto: 25.07, contratista: 'QUALITY IS' });
  test('D2: proveedor y fecha iguales con importe distinto → nunca ALTA', r.nivel !== 'ALTA', r.nivel);
  r = nivel({ monto: 25.06, contratista: 'QUALITY IS' });
  test('D2: sin fecha jamás es ALTA aunque proveedor e importe sean exactos', r.nivel === 'INCIERTA', r.nivel);
  r = nivel({ monto: 25.06, contratista: 'Sin especificar' });
  test('D2: «Sin especificar» sin fecha con importe exacto → NINGUNA', r.nivel === 'NINGUNA', r);
  // Revisión independiente: el placeholder «Sin especificar» (también con espacios alrededor) nunca debe emparejar por sí solo.
  {
    const lst = [{ id: 1, fecha: '2026-06-01', contratista: 'Sin especificar', categoria: 'Otros', monto: 25.06 }, { id: 2, fecha: '2026-06-01', contratista: '  Sin especificar  ', categoria: 'Otros', monto: 25.06 }];
    r = nivel({ monto: 25.06, contratista: 'Sin especificar' }, lst);
    test('D2: «Sin especificar» vs «Sin especificar» con importe exacto y sin fecha → NO INCIERTA', r.nivel === 'NINGUNA', r);
    r = nivel({ monto: 25.06, contratista: ' Sin especificar ' }, lst);
    test('D2: «Sin especificar» con espacios alrededor, importe exacto, sin fecha → NO INCIERTA', r.nivel === 'NINGUNA', r);
    test('D2: proveedorContenido excluye el placeholder también con espacios', R('proveedorContenido')(' Sin especificar ', 'Sin especificar') === false && R('proveedorContenido')('Sin especificar', '  sin especificar') === false && R('proveedorContenido')('Otro proveedor sin especificar', '  Sin especificar  ') === false);
  }
  test('handleUpload busca coincidencia tras la lectura (ruta normal y ruta de caché)', script.includes('mostrarCoincidencia(buscarGastoCoincidente(ext,gastos))') && script.includes('mostrarCoincidencia(buscarGastoCoincidente(cacheIA,gastos))'));
  test('la lectura vacía no dispara la búsqueda (solo campos válidos)', /if\(lectura\.estado!=='vacia'\) mostrarCoincidencia/.test(script));
  test('el HTML tiene la caja de coincidencia y resetRegistrar la limpia', html.includes('id="coincidencia-box"') && /_archivoOriginal=null;\n  \{ const cb=document\.getElementById\('coincidencia-box'\)/.test(script));
  test('la asociación no toca los campos del gasto (asociarOriginalAGasto no escribe en gastos)', !/gastos\.(push|splice)|gastos\s*=|\.monto\s*=|\.fecha\s*=|\.contratista\s*=/.test(extraer('asociarOriginalAGasto') + extraer('terminarAsociacion') + extraer('mostrarCoincidencia')));
  test('sin envíos: ninguna de las funciones nuevas llama a /api ni a la IA', !/analyze-invoice|\/api\//.test(extraer('buscarGastoCoincidente') + extraer('asociarOriginalAGasto') + extraer('mostrarCoincidencia')));

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  if (process.env.A132_MUTANTE) process.exit(fail ? 1 : 0);

  // ── 8. Mutaciones: quitar cada guarda debe hacer fallar las pruebas ────────────
  const mutaciones = [
    ['ALTA sin exigir fecha igual', "if(pOk && fFuerte && iOk) nivel='ALTA';", "if(pOk && iOk) nivel='ALTA';"],
    ['un único ALTA entre varios idénticos (asociar a ciegas peajes)', 'if(altas.length===1) return', 'if(altas.length>=1) return'],
    ['proveedor dudoso cuenta como INCIERTA', '(pDud && (fFuerte||fDebil) && iOk)', 'false'],
    ['umbral de proveedor demasiado laxo', 'const pOk=sim>=0.8', 'const pOk=sim>=0.3'],
    ['actualizar pierde el histórico (reemplazados)', "sal.reemplazados=(Array.isArray(actual.reemplazados)?actual.reemplazados:[]).concat([sinHistorico(actual)]);", 'sal.reemplazados=[];'],
    ['la cola pisa la referencia existente', "refs[gid]=aplicarReferencia(refs[gid], ref, refs[gid] ? (modoP==='actualizar'?'actualizar':'anadir') : 'nuevo');", 'refs[gid]=ref;'],
    ['asociar sin elegir modo cuando ya hay documento', "const m=tiene ? (modo==='actualizar'?'actualizar':(modo==='anadir'?'anadir':null)) : 'nuevo';", "const m=modo||'nuevo';"],
    ['limpiarRecibos descarta adicionales', 'if(Array.isArray(c[f])) c[f]=c[f].filter(docRefValido); else delete c[f];', 'delete c[f];'],
    ['el formulario de gasto nuevo no se oculta', "const form=document.getElementById('reg-form'); if(form) form.style.display='none';", ''],
    ['Conservar sube el archivo', "cerrarCoincidencia(); resetRegistrar(); alert('No se subió nada", "terminarAsociacion(g.id,'anadir'); alert('No se subió nada"],
    ['asociar guarda un gasto nuevo', 'if(!desdeFicha){ cerrarCoincidencia(); resetRegistrar(); }   // NO se guarda', 'guardarGasto(); if(!desdeFicha){ cerrarCoincidencia(); resetRegistrar(); }   // NO se guarda'],
    ['sin fecha basta el importe con cualquier proveedor (D2)', '(pDud || proveedorContenido(c.contratista,g.contratista))', 'true'],
    ['proveedorContenido pierde las barras invertidas del placeholder (D2)', "|| /^\\s*sin especificar\\s*$/i.test(String(b||''))) return false;", "|| /^s*sin especificars*$/i.test(String(b||''))) return false;"],
    ['proveedorContenido no excluye el placeholder (D2)', "if(/^\\s*sin especificar\\s*$/i.test(String(a||'')) || /^\\s*sin especificar\\s*$/i.test(String(b||''))) return false;", ''],
    ['sin fecha se promueve a ALTA (D2)', "nivel='INCIERTA'; motivos.push('la lectura no trae fecha", "nivel='ALTA'; motivos.push('la lectura no trae fecha"],
    ['sin deduplicar el mismo documento', 'if(listarDocumentos(actual).some(x=>x.doc.driveId===nueva.driveId && x.doc.sha256===nueva.sha256)) return actual;', ''],
    ['eliminar gasto no limpia pendientes compuestos', 'ks.forEach(k=>origBorrar(k)); ', ''],
    ['añadir pisa la copia temporal pendiente (sin clave propia)', "const clave=modo ? String(gastoId)+'~'+Date.now().toString(36)+Math.random().toString(36).slice(2,5) : gastoId;", 'const clave=gastoId;'],
    ['el visor no lista adicionales/anteriores', 'pintarOtrosDocumentos(cont, ref);\n}', '}'],
  ];
  let vivos = 0;
  mutaciones.forEach(([nombre, de, a]) => {
    if (html.split(de).length < 2) { console.log('FAIL: mutación no aplicable (texto no encontrado):', nombre); vivos++; return; }
    const f = path.join(os.tmpdir(), 'a132_mut_' + process.pid + '.html'); fs.writeFileSync(f, html.replace(de, a));
    const s = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { A132_HTML: f, A132_MUTANTE: '1' }), encoding: 'utf8', timeout: 120000 });
    fs.rmSync(f, { force: true });
    const muerto = s.status !== 0;
    if (!muerto) vivos++;
    console.log((muerto ? 'PASS' : 'FAIL') + ': mutación detectada — ' + nombre + (muerto ? '' : ' (SOBREVIVIÓ)'));
  });
  console.log(`\nMutaciones: ${mutaciones.length - vivos}/${mutaciones.length} detectadas`);
  process.exit(fail || vivos ? 1 : 0);
})().catch(e => { console.log('ERROR', e && e.stack || e); process.exit(2); });
