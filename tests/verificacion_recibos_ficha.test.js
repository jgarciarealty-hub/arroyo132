// Ficha del gasto: adjuntar recibo original a gastos ya registrados (D1/D3) y mensaje de asociación honesto (D4).
// Funciones REALES extraídas de index.html, Drive simulado, DOM mínimo. Sin red, sin IA, sin Drive real. Incluye mutaciones.
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
  if (drive.retardo) await new Promise(r => setTimeout(r, drive.retardo));
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
function ponerDom() { ['coincidencia-box', 'reg-form', 'orig-recibo-1783398814338', 'orig-recibo-700010', 'adjuntar-estado-1783398814338', 'adjuntar-estado-700010'].forEach(id => { dom[id] = new El('div'); }); dom['coincidencia-box'].style.display = 'none'; dom['reg-form'].style.display = 'block'; }

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
  fmt: v => '$' + v, openModal: (t, html) => { ctx.__modal = html; }, save() {}, closeModal() {}, renderHistorial() {}, renderDashboard() {},
});
const nombres = ['md5Hex', 'sha256Hex', 'extensionDe', 'verificarCargaOriginal', 'driveCarpetaRecibos', 'driveSubirOriginal', 'procesarColaOriginales', 'refrescarPanelRespaldo', 'registrarOriginalNuevo',
  'textoEstadoOriginal', 'textoEstadoOriginalBase', 'leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'guardarRecibosPend', 'escribirVerificado', 'actualizarPend', 'escHtml', 'jsArg', 'fetchConTiempo', 'limpiarRecibos',
  'docRefValido', 'listarDocumentos', 'sinHistorico', 'aplicarReferencia', 'gastoDeClave', 'clavesPendDeGasto', 'documentosDeGasto',
  'tokensProveedor', 'proveedorContenido', 'distanciaLev', 'similitudProveedor', 'diasEntreFechas', 'buscarGastoCoincidente', 'asociarOriginalAGasto', '_btnCoinc', '_esperar', '_estadoAsociacion', 'vigilarAsociacion', '_btnUnico', '_lineaGasto', 'cerrarCoincidencia', 'mostrarCoincidencia', 'terminarAsociacion',
  'verReciboOriginal', 'pintarOtrosDocumentos', 'eliminarGasto', 'textoSinOriginal', 'adjuntarReciboFicha', 'showGastoDetail'];
vm.runInContext("const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', RECIBOS_CARPETA_KEY='a132_recibos_carpeta', RECIBOS_CARPETA_NOMBRE='Arroyo 132 — Recibos originales'; const DRIVE_CAMPOS_ARCHIVO='id,name,size,md5Checksum,webViewLink,appProperties'; var _archivoOriginal=null; var _colaOriginalesEnCurso=false; var _pendMemoria={}; var _pendMemoriaAutoritativa=false; " + script.match(/^var _esperaColaMs=.*;$/m)[0] + " var _adjuntando={};\n"
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
  const esperaPorDefecto = Number(R('_esperaColaMs'));
  const foto = Buffer.alloc(5000, 7), foto2 = Buffer.alloc(3000, 9);
  const entrada = f => ({ files: [f], value: 'x' });
  const gAntes = () => JSON.stringify(ctx.gastos);
  const detalle = id => { R('showGastoDetail')(id); return ctx.__modal; };
  // ── D1/D3: texto y botón ───────────────────────────────────────────────────────
  let t = R('textoEstadoOriginal')(QID);
  test('D1: gasto antiguo con archivos[] (metadatos) dice que el original NO está vinculado y nombra el archivo', /no hay una referencia verificada/.test(t) && /A132-REC-033_QUALITYiS/.test(t) && /Adjuntar recibo original/.test(t), t);
  test('D1: gasto sin archivos ni recibo conserva el texto sin recibo', /Sin recibo original/.test(R('textoEstadoOriginal')(700010)));
  let m = detalle(QID);
  test('D3: la ficha de QUALITY iS ofrece «📎 Adjuntar recibo original» con input file image/pdf oculto', /Adjuntar recibo original/.test(m) && /type="file"[^>]*accept="image\/\*,application\/pdf"/.test(m) && m.includes('adjuntarReciboFicha(' + QID + ', this)'), m.slice(-700));
  test('D3: la ficha de Cosme (700010) también', /Adjuntar recibo original/.test(detalle(700010)));
  ctx.gastos.push({ id: 5, fecha: '2026-01-01', contratista: 'Viaje', categoria: 'Otros', monto: 10, tipo: 'viaje' });
  test('D3: un viaje no muestra el botón', !/Adjuntar recibo original/.test(detalle(5)));
  ctx.gastos.pop();
  // ── D3/D4: Drive caído → pendiente y mensaje honesto ──────────────────────────
  const antes = gAntes(), rec0 = JSON.stringify(R('leerRecibos')());
  drive.modo = 'caido';
  await R('adjuntarReciboFicha')(QID, entrada(archivo(foto, 'q.jpg')));
  await espera(40);
  const est = dom['adjuntar-estado-' + QID].textContent;
  test('D4: con Drive caído NO aparece «✅» (alertas ni estado visible) y el error es el estado visible', !alertas.some(a => /✅/.test(a)) && alertas.some(a => /NO se pudo confirmar la subida a Drive/.test(a)) && /NO se pudo confirmar/.test(est) && !/✅/.test(est), [alertas, est]);
  test('D3: el original queda pendiente en el dispositivo, sin referencia aún; sin lectura IA ni gasto nuevo ni campos tocados', R('leerRecibosPend')()[QID] && idb.has(String(QID)) && JSON.stringify(R('leerRecibos')()) === rec0 && gAntes() === antes && cont.guardarGasto === 0 && cont.reset === 0 && ctx.gastos.length === 5);   // reset===0: la ficha no toca el formulario de Registrar
  drive.modo = 'ok'; alertas.length = 0;
  await R('procesarColaOriginales')();
  const ref = R('leerRecibos')()[QID];
  test('D3: tras subir, la referencia de ESE gasto queda verificada (sha256 exacto) y solo ese gasto gana referencia; campos intactos', ref && ref.sha256 === sha(foto) && Object.keys(R('leerRecibos')()).join() === String(QID) && gAntes() === antes, ref);
  // ── Camino feliz con Cosme ────────────────────────────────────────────────────
  reiniciar();
  await R('adjuntarReciboFicha')(700010, entrada(archivo(foto2, 'c.jpg')));
  test('D4: con Drive disponible el «✅» llega después de verificar y lo dice', alertas.length === 1 && /^✅ El recibo original quedó verificado en Drive/.test(alertas[0]) && R('leerRecibos')()[700010] && R('leerRecibos')()[700010].sha256 === sha(foto2) && !R('leerRecibos')()[QID], alertas);
  test('D3: el estado de la ficha de Cosme muestra el resultado verificado; no se creó ningún gasto', /✅/.test(dom['adjuntar-estado-700010'].textContent) && ctx.gastos.length === 5);
  // ── Gasto con documento: flujo existente ──────────────────────────────────────
  alertas.length = 0;
  await R('adjuntarReciboFicha')(700010, entrada(archivo(foto, 'c2.jpg')));
  const box = dom['adjuntar-estado-700010'];
  test('D3: si ya tiene documento ofrece Conservar / Añadir / Actualizar y NO sube nada aún', !!boton(box, 'Conservar') && !!boton(box, 'Añadir otro') && !!boton(box, 'Actualizar') && Object.keys(R('leerRecibosPend')()).length === 0 && alertas.length === 0);
  await boton(box, 'Añadir otro').onclick();
  const r2 = R('leerRecibos')()[700010];
  test('D3: «Añadir» conserva el principal y suma el adicional', r2.sha256 === sha(foto2) && r2.adicionales && r2.adicionales.length === 1 && r2.adicionales[0].sha256 === sha(foto), r2);
  test('D4: el código ya no afirma «✅ … se asoció» antes de que Drive confirme', !/alert\('✅ El recibo original se asoció/.test(script) && /subiendo a Drive.*se confirma al terminar/.test(script));

  // ── Doble clic ────────────────────────────────────────────────────────────────
  reiniciar(); alertas.length = 0;
  const subidas = () => drive.llamadas.filter(l => l === 'POST /upload/drive/v3/files').length;
  await Promise.all([R('adjuntarReciboFicha')(700010, entrada(archivo(foto2, 'c.jpg'))), R('adjuntarReciboFicha')(700010, entrada(archivo(foto2, 'c.jpg')))]);
  test('Doble selección/clic en adjuntar (gasto sin documento): una sola asociación, una sola subida, un solo aviso', subidas() === 1 && alertas.length === 1 && Object.keys(R('leerRecibos')()).join() === '700010' && !R('leerRecibos')()[700010].adicionales, { s: subidas(), a: alertas });
  alertas.length = 0;
  await R('adjuntarReciboFicha')(700010, entrada(archivo(foto, 'c2.jpg')));
  const bx = dom['adjuntar-estado-700010'], bAn = boton(bx, 'Añadir otro'), bAc = boton(bx, 'Actualizar');
  const p1 = bAn.onclick(), p2 = bAn.onclick(), p3 = bAc.onclick();
  test('Doble clic en Añadir/Actualizar: se deshabilitan todos los botones al primer clic', bAn.disabled === true && bAc.disabled === true && botones(bx).every(b => b.disabled));
  await Promise.all([p1, p2, p3]);
  const rr = R('leerRecibos')()[700010];
  test('Doble clic: Añadir + Añadir + Actualizar seguidos → un solo adicional, ninguna actualización cruzada, un solo aviso', rr.adicionales.length === 1 && !rr.reemplazados && subidas() === 2 && alertas.length === 1 && /^✅/.test(alertas[0]), { rr, s: subidas(), a: alertas });
  // ── Espera larga de la cola (> tiempo de espera) y estado final sin quedar obsoleto ────────────
  reiniciar(); alertas.length = 0;
  R('_esperaColaMs=250; _sondeoColaMs=20'); drive.retardo = 150;
  await R('adjuntarReciboFicha')(700010, entrada(archivo(foto2, 'l.jpg')));
  const el7 = dom['adjuntar-estado-700010'];
  test('Cola aún subiendo tras la espera: estado «sigue subiendo», sin ✅ ni ⚠️ definitivos y sin alert', /Sigue subiendo/.test(el7.textContent) && !/✅/.test(el7.textContent) && alertas.length === 0, [el7.textContent, alertas]);
  for (let i = 0; i < 150 && !/✅|⚠️/.test(el7.textContent); i++) await espera(40);
  test('Al terminar más tarde la ficha se actualiza sola: ✅ solo con la referencia verificada', /^✅/.test(el7.textContent) && R('leerRecibos')()[700010] && R('leerRecibos')()[700010].sha256 === sha(foto2) && !/Sigue subiendo/.test(el7.textContent), el7.textContent);
  reiniciar(); alertas.length = 0; drive.retardo = 150;
  await R('adjuntarReciboFicha')(QID, entrada(archivo(foto2, 'm.jpg')));
  drive.modo = 'caido';
  const el8 = dom['adjuntar-estado-' + QID];
  for (let i = 0; i < 150 && !/✅|⚠️/.test(el8.textContent); i++) await espera(40);
  test('Si la subida tardía FALLA la ficha queda en ⚠️ (nunca ✅) y sin estado obsoleto «sigue subiendo»', /^⚠️/.test(el8.textContent) && !/✅|Sigue subiendo/.test(el8.textContent), el8.textContent);
  drive.retardo = 0; drive.modo = 'ok';
  R('_esperaColaMs=300000; _sondeoColaMs=500');
  test('La espera por defecto es de al menos 240 s y el mensaje neutro avisa que puede tardar', esperaPorDefecto >= 240000 && /puede tardar/.test(script));

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  if (process.env.A132_MUTANTE) process.exit(fail ? 1 : 0);
  const mutaciones = [
    ['D4: «✅» sin esperar a Drive', "if(pend.length===0 && documentosDeGasto(gastoId).docs.length>0) return {verificado:true", "if(true) return {verificado:true"],
    ['D4: no se espera la cola de subida', "  await procesarColaOriginales();\n  const limite=Date.now()+_esperaColaMs;\n  while(_colaOriginalesEnCurso && Date.now()<limite) await _esperar(_sondeoColaMs);\n  if(_colaOriginalesEnCurso){", "  if(false){"],
    ['D3: adjuntar desde la ficha pasa por el formulario de Registrar (resetRegistrar)', "if(!desdeFicha){ cerrarCoincidencia(); resetRegistrar(); }", "{ cerrarCoincidencia(); resetRegistrar(); }"],
    ['D3: gasto con documento se sobrescribe sin elegir', "if(!documentosDeGasto(id).tiene) return ejecutar('nuevo');", "return ejecutar('nuevo');"],
    ['D3: el viaje también muestra el botón', "${g.tipo!=='viaje'?`<div style=\"margin-top:8px\">", "${true?`<div style=\"margin-top:8px\">"],
    ['doble clic: los botones no se bloquean', "grupo.btns.forEach(x=>{ x.disabled=true; });", ""],
    ['doble clic: la decisión se puede ejecutar dos veces', ["if(grupo.ocupado) return; grupo.ocupado=true;", "grupo.ocupado=true;"], ["if(_adjuntando[id]) return; _adjuntando[id]=true;", "_adjuntando[id]=true;"]],
    ['doble clic: sin indicador de reentrada en adjuntar', ["if(_adjuntando[id]) return; _adjuntando[id]=true;", "_adjuntando[id]=true;"], ["  if(_adjuntando[id]) return;\n  const idEstado", "  const idEstado"]],
    ['espera de la cola de solo 30 s', "var _esperaColaMs=300000", "var _esperaColaMs=30000"],
    ['la ficha no se actualiza al terminar una subida tardía', "if(desdeFicha){ const el=document.getElementById(idEstado); if(el) el.textContent=aviso; vigilarAsociacion(gastoId,idEstado); }", "if(desdeFicha){ const el=document.getElementById(idEstado); if(el) el.textContent=aviso; }"],
    ['D1: el texto no distingue metadatos de original', "no hay una referencia verificada al recibo", "Sin recibo."],
  ];
  let vivos = 0;
  mutaciones.forEach(([nombre, de, a]) => {
    const des = Array.isArray(a) ? [de, a] : [[de, a]]; let mh = html, aplicable = true;
    des.forEach(([x, y]) => { if (mh.split(x).length < 2) aplicable = false; else mh = mh.replace(x, () => y); });
    if (!aplicable) { console.log('FAIL: mutación no aplicable (texto no encontrado):', nombre); vivos++; return; }
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mutF-')), 'index.html'); fs.writeFileSync(f, mh);
    const s = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { A132_HTML: f, A132_MUTANTE: '1' }), encoding: 'utf8', timeout: 120000 });
    const muerto = s.status !== 0; if (!muerto) vivos++;
    console.log((muerto ? 'PASS' : 'FAIL') + ': mutación detectada — ' + nombre + (muerto ? '' : ' (SOBREVIVIÓ)'));
  });
  console.log(`\nMutaciones: ${mutaciones.length - vivos}/${mutaciones.length} detectadas`);
  process.exit(fail || vivos ? 1 : 0);
})();

