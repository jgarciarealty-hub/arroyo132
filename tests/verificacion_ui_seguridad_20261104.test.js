// Revisión integral 2026-11-04: navegación sin `window.event` (Firefox/Safari) y escapado de
// datos de usuario en las pantallas de contratistas, timeline, documentos, cuentas y viajes.
// Usa el script REAL de index.html con datos sintéticos maliciosos. Sin red, sin Drive, sin PIN.
// Uso: node tests/verificacion_ui_seguridad_20261104.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

const XSS = '<img src=x onerror=alert(1)>';
const SECCIONES = ['resumen','dashboard','timeline','registrar','historial','servicios','roi','graficas','financiamiento','viajes','banco','contratistas','documentos'];

class Clases {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); }
  remove(c) { this.s.delete(c); }
  toggle(c, on) { if (on === undefined) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); } else if (on) this.s.add(c); else this.s.delete(c); }
  contains(c) { return this.s.has(c); }
}
class El {
  constructor(id) { this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.style = {}; this.classList = new Clases(); this.children = []; this._attrs = {}; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  querySelector() { return { style: {} }; }
  querySelectorAll() { return []; }
  remove() {}
  click() {}
}

const store = new Map();
const dom = new Map();
const navItems = SECCIONES.map((s) => { const e = new El('nav-' + s); e.setAttribute('onclick', "showSection('" + s + "')"); return e; });
const bnavItems = SECCIONES.map((s) => { const e = new El('bnav-' + s); e.setAttribute('onclick', "bnav('" + s + "',this)"); return e; });
const sections = SECCIONES.map((s) => new El('sec-' + s));
function el(id) { if (!dom.has(id)) dom.set(id, new El(id)); return dom.get(id); }

// Datos sintéticos con carga maliciosa (simula un backup importado o datos sincronizados).
store.set('a132_cont', JSON.stringify([{ id: 1, nombre: XSS, especialidad: '<b>esp</b>', tel: '" onmouseover="alert(2)', notas: '<script>alert(3)</script>', montoContrato: 100, pagado: 0 }]));
store.set('a132_tl', JSON.stringify([{ id: 1, fecha: '<img src=x onerror=alert(4)>', titulo: '<script>alert(5)</script>', desc: '<svg onload=alert(6)>', estado: 'x" onclick="alert(7)' }]));
store.set('a132_docs', JSON.stringify([{ id: 1, nombre: XSS, lote: '132A', estado: 'listo', prioridad: 'alta', driveId: '"><img src=x onerror=alert(9)>' }]));
store.set('a132_viajes', JSON.stringify([{ id: 1, fecha: '<img src=x onerror=alert(10)>', proposito: '<script>alert(11)</script>', notas: '<svg onload=alert(12)>', peajes: 1, gasolina: 2, comida: 0, estadia: 0, otros: 0, total: 3 }]));
store.set('a132_gastos', JSON.stringify([
  { id: 1, fecha: '2026-11-04', contratista: '<img src=x onerror=alert(13)>', categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', monto: 10, descripcion: 'normal' },
  { id: 2, fecha: '2026-11-04', contratista: 'Cuenta', categoria: '<script>alert(14)</script>', lote: 'Compartido', metodo: 'efectivo', monto: 5, es_abono: true, cuenta: XSS, monto_total: 20 },
]));
store.set('a132_servicios', JSON.stringify({ '132A': { AAA: [{ id: 1, concepto: XSS, monto: 1, estado: '<b>pendiente</b>' }], LUMA: [] }, '132B': { AAA: [], LUMA: [] } }));
store.set('a132_fotos', JSON.stringify({ '1': 'x" onerror="alert(1)' }));
store.set('a132_tucoop', JSON.stringify({ activacion: [{ id: 1, concepto: XSS, monto: 1 }], intereses: [{ id: 1, mes: XSS, balance: 1, monto: 1, pagado: false }] }));

const sandbox = {
  console, A132Central: {}, A132Drive: {},
  document: {
    getElementById: (id) => el(id),
    querySelectorAll: (sel) => sel === '.nav-item' ? navItems : sel === '.bnav-item' ? bnavItems : sel === '.section' ? sections : [],
    querySelector: () => ({ style: {}, classList: new Clases(), addEventListener() {} }),
    addEventListener() {}, body: { classList: new Clases(), appendChild() {} },
    createElement: () => new El('dyn'), visibilityState: 'visible',
  },
  window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  alert() {}, confirm: () => true, prompt: () => null,
  localStorage: { getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null), setItem: (k, v) => store.set(String(k), String(v)), removeItem: (k) => store.delete(String(k)), clear: () => store.clear(), get length() { return store.size; }, key: (i) => [...store.keys()][i] },
  fetch: () => Promise.reject(new Error('sin red')),
  crypto: { get subtle() { return nodeCrypto.webcrypto.subtle; } }, TextEncoder,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: function () {},
  Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Set, Promise, Number, Boolean, Error, RegExp, isNaN, encodeURIComponent, decodeURIComponent,
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
const R = (c) => vm.runInContext(c, sandbox);

(async () => {
  // ── 1. Navegación sin window.event (Firefox/Safari) y estado activo ──
  let navOk = true, navErr = '';
  try { R("showSection('dashboard')"); } catch (e) { navOk = false; navErr = e.message; }
  test('showSection no depende de window.event y no lanza', navOk, navErr);
  test('la sección pedida queda activa', el('sec-dashboard').classList.contains('active'));
  test('el enlace lateral de esa sección queda activo', navItems[SECCIONES.indexOf('dashboard')].classList.contains('active'));
  test('el enlace inferior correspondiente queda activo', bnavItems[SECCIONES.indexOf('dashboard')].classList.contains('active'));
  test('las demás secciones quedan inactivas', !el('sec-resumen').classList.contains('active'));
  let directoOk = true;
  try { R("showSectionDirect('timeline')"); } catch (e) { directoOk = false; }
  test('showSectionDirect también marca la barra lateral', directoOk && navItems[SECCIONES.indexOf('timeline')].classList.contains('active'));


  // ── 2. Escapado de datos de usuario en las pantallas ──
  R('renderContratistas()');
  const cont = el('cont-list').innerHTML;
  test('contratistas: el nombre malicioso se escapa', cont.includes('&lt;img') && !cont.includes('<img src=x'), cont.slice(0, 300));
  test('contratistas: la especialidad, el teléfono y las notas se escapan', cont.includes('&lt;b&gt;esp') && cont.includes('&lt;script&gt;') && !cont.includes(' onmouseover="alert'), { esp: cont.includes('&lt;b&gt;esp'), notas: cont.includes('&lt;script&gt;'), tel: !cont.includes(' onmouseover="alert'), muestra: cont.slice(0, 900) });

  R('renderTimeline()');
  const tl = el('timeline-container').innerHTML;
  test('timeline: título, descripción y fecha se escapan', tl.includes('&lt;script&gt;') && tl.includes('&lt;svg') && !tl.includes('<script>alert(5)') && !tl.includes('<svg onload='), tl.slice(0, 300));
  test('timeline: el estado no puede inyectar atributos', !tl.includes('onclick="alert(7)'), tl.slice(0, 300));

  R('renderDocs()');
  const docs = el('docs-list').innerHTML;
  test('documentos: el nombre se escapa', docs.includes('&lt;img') && !docs.includes('<img src=x'), docs.slice(0, 300));
  test('documentos: un driveId inválido no genera enlace', !docs.includes('drive.google.com/file/d/"><img') && /Sin archivo/.test(docs), docs.slice(0, 400));

  R('renderViajes()');
  const viajes = el('v-tabla').innerHTML;
  test('viajes: fecha, propósito y notas se escapan', viajes.includes('&lt;img') && viajes.includes('&lt;script&gt;') && !viajes.includes('<script>alert(11)') && !viajes.includes('<svg onload='), viajes.slice(0, 300));

  R('renderHistorial()');
  const cuentas = el('lista-cuentas').innerHTML;
  test('cuentas: el nombre y la categoría se escapan', cuentas.includes('&lt;img') && cuentas.includes('&lt;script&gt;') && !cuentas.includes('<img src=x') && !cuentas.includes('<script>alert(14)'), cuentas.slice(0, 400));

  R('renderDashboard()');
  const dash = el('cat-bars').innerHTML;
  test('dashboard: la categoría del gráfico se escapa', dash.includes('&lt;script&gt;') && !dash.includes('<script>alert(14)'), dash.slice(0, 300));

  R('renderPresupuesto()');
  const pres = el('presupuesto-bars').innerHTML;
  test('presupuesto: la categoría y su atributo se escapan', pres.includes('&lt;script&gt;') && !pres.includes('data-cat="<script>'), pres.slice(0, 400));

  R('renderServicios()');
  const serv = el('serv-cards-A').innerHTML;
  test('servicios: concepto y estado se escapan', serv.includes('&lt;img') && serv.includes('&lt;b&gt;pendiente') && !serv.includes('<img src=x'), serv.slice(0, 400));

  R('renderFinanciamiento()');
  const fin = el('tc-act-list').innerHTML + el('tc-int-list').innerHTML;
  test('financiamiento: concepto y mes se escapan', fin.includes('&lt;img') && !fin.includes('<img src=x'), fin.slice(0, 400));

  R('showGastoDetail(1)');
  const detalle = el('modal-body').innerHTML;
  test('foto: una miniatura que no es data URL no se inyecta en src', !detalle.includes('x" onerror="alert(1)'), detalle.slice(0, 500));

  // IDs importados maliciosos: no deben inyectar código en los onclick.
  const ID_MALO = '1);alert(1)//';
  R("gastos=[{id:" + JSON.stringify(ID_MALO) + ",fecha:'2026-11-04',contratista:'X',categoria:'Otros',lote:'Compartido',metodo:'efectivo',monto:1,descripcion:''}]");
  R('renderHistorial()');
  const histMal = el('tabla-gastos').innerHTML;
  test('ids: un id malicioso de gasto no inyecta en showGastoDetail', histMal.includes('&quot;1);alert(1)//&quot;') && !histMal.includes('showGastoDetail(1);'), histMal.slice(0, 400));
  R("docs=[{id:" + JSON.stringify(ID_MALO) + ",nombre:'D',lote:'132A',estado:'listo',prioridad:'alta'}]");
  R('renderDocs()');
  const docsMal = el('docs-list').innerHTML;
  test('ids: un id malicioso de documento no inyecta en updateDoc', docsMal.includes('&quot;1);alert(1)//&quot;') && !docsMal.includes('updateDoc(1);'), docsMal.slice(0, 500));
  R("contratistas=[{id:" + JSON.stringify(ID_MALO) + ",nombre:'C',montoContrato:100,pagado:0}]");
  R('renderContratistas()');
  const contMal = el('cont-list').innerHTML;
  test('ids: un id malicioso de contratista no inyecta', contMal.includes('&quot;1);alert(1)//&quot;') && !contMal.includes('editarContratista(1);'), contMal.slice(0, 500));
  R("viajes=[{id:" + JSON.stringify(ID_MALO) + ",fecha:'2026-11-04',proposito:'P',notas:'',peajes:0,gasolina:0,comida:0,estadia:0,otros:0,total:0}]");
  R('renderViajes()');
  const viajeMal = el('v-tabla').innerHTML;
  test('ids: un id malicioso de viaje no inyecta', viajeMal.includes('&quot;1);alert(1)//&quot;') && !viajeMal.includes('eliminarViaje(1);'), viajeMal.slice(0, 400));

  // Un monto importado como cadena no debe romper el atributo value del formulario.
  R("gastos=[{id:1,fecha:'2026-11-04',contratista:'X',categoria:'Otros',lote:'Compartido',metodo:'efectivo',monto:'\\\"><img src=x onerror=alert(1)>',descripcion:''}]");
  R('editarGasto(1)');
  const editMal = el('modal-body').innerHTML;
  test('formulario: un monto no numérico no inyecta atributos', !editMal.includes('<img src=x') && !editMal.includes('onerror=alert(1)'), editMal.slice(0, 500));

  // ── 3. Balances con 62 gastos: los cálculos no lanzan y producen totales ──
  const GASTOS62 = [];
  for (let i = 1; i <= 62; i++) GASTOS62.push({ id: 700000 + i, fecha: '2026-04-' + String((i % 28) + 1).padStart(2, '0'), contratista: 'Proveedor ' + i, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', monto: Math.round(i * 13.37 * 100) / 100, descripcion: 'gasto ' + i });
  R('gastos = ' + JSON.stringify(GASTOS62));
  let balancesOk = true, balancesErr = '';
  try { R('updateResumen()'); R('renderDashboard()'); R('renderHistorial()'); R('renderBanco()'); } catch (e) { balancesOk = false; balancesErr = e.message; }
  test('balances: 62 gastos se procesan sin excepción', balancesOk, balancesErr);
  test('balances: el total del dashboard no queda vacío', String(el('d-total').textContent).length > 0, el('d-total').textContent);
  test('balances: el reporte del banco calcula la obra con los 62 gastos', String(el('banco-total-obra').textContent).length > 0, el('banco-total-obra').textContent);
  test('balances: el historial lista las 62 filas', (el('tabla-gastos').innerHTML.match(/<tr>/g) || []).length === 62, (el('tabla-gastos').innerHTML.match(/<tr>/g) || []).length);
  test('CSV: una celda con fórmula se neutraliza', R('csvCampo("=1+1")') === '"\'=1+1"', R('csvCampo("=1+1")'));
  test('CSV: las comillas se duplican (no rompen la fila)', R('csvCampo(\'a"b\')') === '"a""b"', R('csvCampo(\'a"b\')'));
  test('formulario: un valor numérico vacío queda vacío, no 0', R('valorNumero("")') === '' && R('valorNumero("12.5")') === '12.5', { vacio: R('valorNumero("")'), num: R('valorNumero("12.5")') });

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
