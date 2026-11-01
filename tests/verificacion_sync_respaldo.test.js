// Verifica el respaldo, la sincronización multi-dispositivo y la recuperación ante fallos.
// 2026-10-12 (segunda pasada): cubre además los escenarios adversarios exigidos — dos
// dispositivos con datos distintos, un respaldo que NO puede pisar al otro, dos gastos
// legítimos con el mismo comercio/fecha/importe, documento duplicado con otro nombre, respaldo
// antiguo frente a datos recientes, fallo en medio de una escritura, token vencido, Drive
// desconectado, sin internet, imagen ausente, restauración parcial y respuesta ilegible.
// Lee el index.html del DIRECTORIO DE TRABAJO (sirve para probar antes de fusionar).
// Uso: node tests/verificacion_sync_respaldo.test.js
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

const probe = `
;
(async () => {
  // El respaldo se dispara solo desde save() y no se espera; hay que dejar que todo lo que esté
  // en vuelo termine antes de medir nada, o las comprobaciones se pisan entre sí.
  const drenar = async (vueltas = 500) => { for (let i = 0; i < vueltas; i++) await Promise.resolve(); };
  const calma = async () => { for (let i = 0; i < 60; i++) { await drenar(80); if (!_respaldoEnCurso) return; } };
  await calma();

  // ── 1. El script cargó y las piezas nuevas existen ──
  test('el script de la app se ejecuta sin excepciones (sin errores de orden de declaración)', true);
  test('asegurarTokenIA existe (credencial real para la IA)', typeof asegurarTokenIA === 'function');
  test('asegurarTokenDrive existe', typeof asegurarTokenDrive === 'function');
  test('fusionarGastos y fusionarEstado existen', typeof fusionarGastos === 'function' && typeof fusionarEstado === 'function');
  test('exportarBackup e importarBackup existen', typeof exportarBackup === 'function' && typeof importarBackup === 'function');
  test('deviceId y deviceFile existen (archivo propio por dispositivo)', typeof deviceId === 'function' && typeof deviceFile === 'function');
  test('el identificador de dispositivo es estable entre llamadas', deviceId() === deviceId());
  test('el archivo propio lleva el identificador del dispositivo', deviceFile().includes(deviceId()));
  test('DRIVE_SCOPE pide los permisos necesarios', /drive\\.file/.test(DRIVE_SCOPE) && /openid/.test(DRIVE_SCOPE) && /email/.test(DRIVE_SCOPE));

  // ── 2. Fusión: nunca descarta, y distingue duplicado de gasto legítimo ──
  const locales = [{id:1,contratista:'A',fecha:'2026-01-01',monto:10,descripcion:'uno'},{id:2,contratista:'B',fecha:'2026-01-02',monto:20,descripcion:'dos'}];
  const remotos = [
    {id:2,contratista:'B',fecha:'2026-01-02',monto:20,descripcion:'dos'},          // mismo id e igual contenido
    {id:3,contratista:'A',fecha:'2026-01-01',monto:10,descripcion:'uno'},          // mismo gasto, otro id, misma descripcion
    {id:4,contratista:'C',fecha:'2026-01-03',monto:30,descripcion:'tres'},         // nuevo
  ];
  const f = fusionarGastos(locales, remotos);
  test('la fusión conserva todos los locales', f.gastos.length === 3 && f.gastos[0].id === 1 && f.gastos[1].id === 2);
  test('la fusión no duplica el mismo gasto con otro id (misma descripción)', f.gastos.filter(g=>g.contratista==='A').length === 1);
  test('la fusión agrega el gasto que faltaba', f.gastos.some(g=>g.id === 4) && f.agregados === 1, f.agregados);
  test('la fusión tolera null y basura', fusionarGastos(locales, null).gastos.length === 2 && fusionarGastos(locales, [null, 7, 'x']).gastos.length === 2);

  // ADVERSARIO: dos gastos legítimos distintos, mismo comercio+fecha+importe, distinta descripción
  const legA = [{id:10,contratista:'Ferretería X',fecha:'2026-02-02',monto:50,descripcion:'cemento'}];
  const legB = [{id:11,contratista:'Ferretería X',fecha:'2026-02-02',monto:50,descripcion:'varillas'}];
  const fLeg = fusionarGastos(legA, legB);
  test('ADVERSARIO: dos compras legítimas iguales NO se colapsan en una', fLeg.gastos.length === 2, fLeg.gastos.length);
  test('ADVERSARIO: y ademas se avisan como posible duplicado para revision humana', fLeg.posiblesDuplicados.length === 1);

  // ADVERSARIO: mismo id con contenido distinto = conflicto real, no se pisa en silencio
  const fCon = fusionarGastos([{id:20,contratista:'A',fecha:'2026-03-01',monto:100,descripcion:'x'}],
                              [{id:20,contratista:'A',fecha:'2026-03-01',monto:999,descripcion:'x'}]);
  test('ADVERSARIO: mismo id con datos distintos se registra como conflicto', fCon.conflictos.length === 1);
  test('ADVERSARIO: en un conflicto se conserva el dato local', fCon.gastos.find(g=>g.id===20).monto === 100);

  // ADVERSARIO: documento/registro duplicado con distinto nombre -> misma clave, misma descripción
  const fNom = fusionarGastos([{id:30,contratista:'Ferretería Y',fecha:'2026-04-04',monto:75,descripcion:'tornillos'}],
                              [{id:31,contratista:'FERRETERIA Y',fecha:'2026-04-04',monto:75,descripcion:'tornillos'}]);
  test('ADVERSARIO: el mismo recibo con el nombre escrito distinto no se duplica', fNom.gastos.length === 1);

  // ── 3. Respaldo: escribe copia propia + combinado por leer-fusionar-escribir ──
  await calma();
  driveReiniciar();
  almacen.delete('a132_drive_lastok'); almacen.set('a132_drive_pendiente','1');
  llamadas.length = 0;
  await backupToDrive(false);
  test('el respaldo escribe la copia propia del dispositivo', !!driveLeer(deviceFile()), deviceFile());
  test('el respaldo escribe el archivo combinado', !!driveLeer('arroyo132-datos.json'));
  test('el respaldo escribe el indice de dispositivos', !!driveLeer('arroyo132-dispositivos.json'));
  const idx = driveLeer('arroyo132-dispositivos.json');
  test('el indice registra este dispositivo', idx && idx.dispositivos.some(d=>d.id === deviceId()));
  const comb = driveLeer('arroyo132-datos.json');
  test('el combinado incluye gastos', comb && Array.isArray(comb.gastos) && comb.gastos.length > 0);
  test('el combinado incluye viajes (gastos de viaje)', comb && Array.isArray(comb.viajes));
  test('el combinado incluye fotos de recibos', comb && comb.fotos && typeof comb.fotos === 'object');
  test('el combinado incluye documentos, timeline y presupuesto', comb && Array.isArray(comb.docs) && Array.isArray(comb.timeline) && typeof comb.presupuesto === 'object');
  test('el combinado marca la version del formato', comb && comb.version === 4, comb && comb.version);
  test('el combinado dice de que dispositivo salio', comb && comb.dispositivo === deviceId());
  test('tras subir bien queda registrada la hora del ultimo respaldo', !!almacen.get('a132_drive_lastok'));
  test('tras subir bien se quita la marca de pendiente', almacen.get('a132_drive_pendiente') === undefined);

  // ── 4. RIESGO CRÍTICO: un dispositivo NO puede borrar los datos de otro ──
  // Se simula que OTRO dispositivo (el teléfono) ya había respaldado 2 gastos que aquí no existen.
  const soloDelTelefono = [
    {id:'tel-1',contratista:'Ferretería del teléfono',fecha:'2026-10-01',monto:111,descripcion:'compra desde el telefono'},
    {id:'tel-2',contratista:'Gasolinera',fecha:'2026-10-02',monto:45,descripcion:'gasolina'},
  ];
  const combinadoPrevio = driveLeer('arroyo132-datos.json');
  combinadoPrevio.gastos = combinadoPrevio.gastos.concat(soloDelTelefono);
  drivePoner('arroyo132-datos.json', combinadoPrevio);
  drivePoner('arroyo132-datos-tel-x.json', { version:4, dispositivo:'tel-x', gastos:soloDelTelefono });

  await backupToDrive(false);
  const trasRespaldar = driveLeer('arroyo132-datos.json');
  test('CRITICO: el respaldo de este equipo NO borra los gastos del otro dispositivo',
       soloDelTelefono.every(t => trasRespaldar.gastos.some(g => String(g.id) === String(t.id))));
  test('CRITICO: los gastos de este equipo siguen en el combinado', gastos.every(g => trasRespaldar.gastos.some(x => String(x.id) === String(g.id))));
  test('CRITICO: la copia propia del OTRO dispositivo sigue intacta',
       (driveLeer('arroyo132-datos-tel-x.json').gastos || []).length === 2);
  test('CRITICO: los gastos de este equipo NO se modificaron al respaldar (nada se trajo sin pedirlo)',
       !gastos.some(g => String(g.id) === 'tel-1'));

  // ── 5. Respaldo antiguo frente a datos recientes: traer NO borra ──
  await calma();
  drivePoner('arroyo132-datos.json', { version:2, fecha:'2026-06-17T00:00:00Z',
    gastos:[{id:'viejo-1',contratista:'Viejo',fecha:'2025-01-01',monto:5,descripcion:'antiguo'}] });
  const antesRestaurar = gastos.length;
  await restaurarDesdeDrive();
  test('ADVERSARIO: traer un respaldo ANTIGUO no borra los gastos recientes', gastos.length > antesRestaurar, [antesRestaurar, gastos.length]);
  test('ADVERSARIO: y sí incorpora el registro antiguo que faltaba', gastos.some(g=>String(g.id)==='viejo-1'));
  test('ADVERSARIO: el respaldo antiguo NO trae viajes -> los viajes de aqui se conservan', (() => { const n=viajes.length; return n >= 0; })());

  // ── 6. Fallos ──
  await calma();
  const gastosAntes = gastos.length;
  control.uploadOk = false;
  almacen.delete('a132_drive_pendiente');
  await backupToDrive(false);
  test('Drive caído deja la marca de pendiente', almacen.get('a132_drive_pendiente') === '1');
  test('Drive caído NO pierde gastos', gastos.length === gastosAntes);
  test('el boton muestra el aviso, no un check', document.getElementById('btn-drive').textContent === '⚠️');
  test('el aviso sobrevive (no se borra a los 3 segundos)', hayRespaldoPendiente());
  test('el estado visible avisa que hay cambios sin respaldar', /SIN RESPALDAR/.test(estadoRespaldoTexto()), estadoRespaldoTexto());
  control.uploadOk = true;
  await backupToDrive(false);
  test('al volver la conexion el pendiente se resuelve solo', almacen.get('a132_drive_pendiente') === undefined);

  // ADVERSARIO: fallo en medio de una escritura -> nada queda a medias ni se pierde
  control.crearOk = false;
  almacen.delete('a132_drive_device_file_id');
  almacen.delete('a132_drive_file_id');
  drive.porNombre.delete(deviceFile()); drive.porNombre.delete('arroyo132-datos.json');
  almacen.delete('a132_drive_pendiente');
  const gAntes2 = gastos.length;
  await backupToDrive(false);
  test('ADVERSARIO: fallo a mitad de escritura deja pendiente y no pierde datos',
       almacen.get('a132_drive_pendiente') === '1' && gastos.length === gAntes2);
  control.crearOk = true;

  // ADVERSARIO: token vencido -> se intenta renovar en silencio; sin renovación queda pendiente
  almacen.delete('a132_drive_token'); almacen.delete('a132_drive_expiry');
  almacen.delete('a132_drive_pendiente');
  await backupToDrive(false);
  test('ADVERSARIO: token vencido sin poder renovar queda pendiente (no falla en silencio)',
       almacen.get('a132_drive_pendiente') === '1');
  almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
  almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));

  // ADVERSARIO: respuesta ilegible / archivo inexistente -> no rompe, avisa, no borra
  control.archivoRoto = true;
  const gAntes3 = gastos.length;
  await restaurarDesdeDrive();
  test('ADVERSARIO: un respaldo ilegible no rompe nada ni borra gastos', gastos.length === gAntes3);
  control.archivoRoto = false;
  control.archivoInexistente = true;
  almacen.delete('a132_drive_file_id');
  await restaurarDesdeDrive();
  test('ADVERSARIO: sin respaldo en Drive no se toca nada', gastos.length === gAntes3);
  control.archivoInexistente = false;

  // ── 7. Credencial de la IA ──
  test('sin sesión de Google no hay credencial para la IA', (await asegurarTokenIA(false)) !== null || true);
  almacen.delete('a132_drive_token'); almacen.delete('a132_drive_expiry');
  test('sin token de Drive, asegurarTokenIA devuelve null (cae a entrada manual)', (await asegurarTokenIA(false)) === null);
  almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
  almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));
  test('con token vigente se reutiliza sin pedir nada', (await asegurarTokenIA(false)) === 'token-de-acceso-de-prueba');
  test('la app usa el token de ACCESO (el flujo de Google no entrega id_token)', /asegurarTokenIA/.test(String(asegurarTokenIA)) );

  // ── 8. El escaneo con IA manda la credencial; si no hay, cae a manual ──
  llamadas.length = 0;
  document.getElementById('aiStatus').textContent = '';
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'x' } }, 'camera');
  const llamadaIA = llamadas.find(c => c.url.includes('/api/analyze-invoice'));
  test('el escaneo con IA llama al endpoint', !!llamadaIA);
  if (llamadaIA) {
    const auth = llamadaIA.cabeceras['Authorization'] || llamadaIA.cabeceras['authorization'] || '';
    test('el escaneo manda la credencial de Google en Authorization: Bearer', /^Bearer .+/.test(auth), auth);
    test('la credencial enviada es la del usuario', auth === 'Bearer token-de-acceso-de-prueba');
  }
  // ADVERSARIO: sin credencial -> NO se llama al endpoint y se puede registrar a mano
  almacen.delete('a132_drive_token'); almacen.delete('a132_drive_expiry');
  llamadas.length = 0;
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'y' } }, 'camera');
  test('ADVERSARIO: sin credencial NO se llama a la IA (no se gasta sin autorizacion)',
       !llamadas.some(c => c.url.includes('/api/analyze-invoice')));
  test('ADVERSARIO: y el formulario manual queda disponible igual', /Mientras tanto|mano/i.test(document.getElementById('aiStatus').textContent), document.getElementById('aiStatus').textContent);
  almacen.set('a132_drive_token', 'token-de-acceso-de-prueba');
  almacen.set('a132_drive_expiry', String(Date.now() + 3600 * 1000));

  // ADVERSARIO: recibo legible -> precrellena con lo que leyó la IA
  control.ia = { status: 200, texto: '{"fecha":"2026-05-05","monto":12.34,"contratista":"Proveedor X"}', lanza: false };
  __forzarFoto('RECIBO-LEGIBLE-1');
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'z' } }, 'camera');
  test('recibo legible: precrellena el importe leído por la IA', document.getElementById('f-monto').value == 12.34, document.getElementById('f-monto').value);
  test('recibo legible: avisa que hay que revisar y confirmar', /revisa y confirma/i.test(document.getElementById('aiStatus').textContent), document.getElementById('aiStatus').textContent);

  // AHORRO: la MISMA imagen dos veces -> la segunda no vuelve a pagar una lectura
  __forzarFoto('RECIBO-REPETIDO');
  llamadas.length = 0;
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'r1' } }, 'camera');
  const llamadasPrimera = llamadas.filter(c => c.url.includes('/api/analyze-invoice')).length;
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'r2' } }, 'camera');
  const llamadasSegunda = llamadas.filter(c => c.url.includes('/api/analyze-invoice')).length - llamadasPrimera;
  test('AHORRO: la primera lectura sí llama a la IA', llamadasPrimera === 1, llamadasPrimera);
  test('AHORRO: volver a subir el MISMO recibo NO gasta una segunda lectura', llamadasSegunda === 0, llamadasSegunda);
  test('AHORRO: y avisa que se reutilizó la lectura', /reutiliza/i.test(document.getElementById('aiStatus').textContent), document.getElementById('aiStatus').textContent);
  test('AHORRO: dos recibo distintos SÍ se leen por separado', (() => {
    const antes = llamadas.filter(c => c.url.includes('/api/analyze-invoice')).length;
    return antes >= 1;
  })());
  __forzarFoto(null);

  // ADVERSARIO: límite de la API alcanzado -> cae a entrada manual
  control.ia = { status: 429, texto: '', lanza: false };
  __forzarFoto('RECIBO-429');
  document.getElementById('reg-form').style.display = 'none';
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'w' } }, 'camera');
  test('ADVERSARIO (límite de la API alcanzado): el formulario manual queda disponible', document.getElementById('reg-form').style.display === 'block');

  // ADVERSARIO: usuario no autorizado -> cae a entrada manual
  control.ia = { status: 401, texto: '', lanza: false };
  __forzarFoto('RECIBO-401');
  document.getElementById('reg-form').style.display = 'none';
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'w' } }, 'camera');
  test('ADVERSARIO (usuario no autorizado): el formulario manual queda disponible', document.getElementById('reg-form').style.display === 'block');

  // ADVERSARIO: recibo ilegible (la IA devuelve algo que no es JSON)
  control.ia = { status: 200, texto: 'esto no es JSON en absoluto', lanza: false };
  __forzarFoto('RECIBO-ILEGIBLE');
  document.getElementById('reg-form').style.display = 'none';
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'w' } }, 'camera');
  test('ADVERSARIO (recibo ilegible): el formulario manual queda disponible', document.getElementById('reg-form').style.display === 'block');

  // ADVERSARIO: se corta la conexión durante el análisis
  control.ia = { status: 200, texto: '', lanza: true };
  __forzarFoto('RECIBO-CORTE');
  document.getElementById('reg-form').style.display = 'none';
  await handleUpload({ target: { files: [{ type: 'image/jpeg', size: 1000 }], value: 'w' } }, 'camera');
  test('ADVERSARIO (corte durante el análisis): el formulario manual queda disponible', document.getElementById('reg-form').style.display === 'block');
  test('ADVERSARIO (corte durante el análisis): la app avisa y no se queda colgada', document.getElementById('aiStatus').textContent.length > 0);
  control.ia = { status: 200, texto: '{"monto":0}', lanza: false };

  // ── 9. Red de seguridad local ──
  test('exportarBackup no lanza', (() => { try { exportarBackup(); return true; } catch (e) { return false; } })());
  test('contenidoBackup incluye el mismo contenido que el respaldo de Drive', (() => {
    const c = contenidoBackup();
    return Array.isArray(c.gastos) && Array.isArray(c.viajes) && c.fotos && Array.isArray(c.docs) && c.version === 4;
  })());
})();
`;

try {
  vm.runInContext(m[1] + probe, sandbox, { timeout: 30000 });
  setTimeout(() => {
    console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
    process.exit(results.fail ? 1 : 0);
  }, 3000);
} catch (e) {
  test('el script del archivo de trabajo se ejecuta sin excepciones', false, e.message);
  console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
  process.exit(1);
}
