// Validación local de apertura de los CINCO recibos desde sus gastos.
// Usa el código REAL de index.html (verReciboOriginal) y las 5 referencias externas reales
// (ids y driveId leídos del central/combinado el 2026-11-03). No abre Google Drive ni usa red:
// comprueba que el botón «Ver recibo original» de cada gasto construye el enlace correcto.
// Uso: node tests/verificacion_apertura_5_recibos.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };
function extraer(nombre) {
  let ini = script.indexOf('async function ' + nombre + '(');
  if (ini < 0) ini = script.indexOf('function ' + nombre + '(');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '{') n++; else if (script[k] === '}') { n--; if (!n) break; } }
  return script.slice(ini, k + 1);
}

// ── Las 5 referencias verificadas (lectura viva del central/combinado, 2026-11-03) ──
const REFS = {
  '700001': { origen: 'externo', docs: [{ driveId: '1JKj9UNTB5808lUOu2enByRSbQnYAQgkr', nombre: 'A132-REC-010_Ferreterias3C_2026-04-15.pdf', enlace: 'https://drive.google.com/file/d/1JKj9UNTB5808lUOu2enByRSbQnYAQgkr/view', rec: '010' }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' },
  '700002': { origen: 'externo', docs: [{ driveId: '1Iqc_AAhRtqpMdmFeu4AQbrg19_am-UUF', nombre: 'A132-REC-007_AIG_Electrical_2026-04-13.pdf', enlace: 'https://drive.google.com/file/d/1Iqc_AAhRtqpMdmFeu4AQbrg19_am-UUF/view', rec: '007' }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' },
  '700007': { origen: 'externo', docs: [{ driveId: '1luglwAGirsW2Qm0SCDrFxveBx24IotKc', nombre: 'A132-REC-011_LaFerreteriaCatano_2026-04-15.pdf', enlace: 'https://drive.google.com/file/d/1luglwAGirsW2Qm0SCDrFxveBx24IotKc/view', rec: '011' }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' },
  '700010': { origen: 'externo', docs: [{ driveId: '1w3WSogvu-BXMSPJLFyy0jgaVB-I5UQJP', nombre: 'A132-REC-014_FerreteriaCosme_2026-04-28.pdf', enlace: 'https://drive.google.com/file/d/1w3WSogvu-BXMSPJLFyy0jgaVB-I5UQJP/view', rec: '014' }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' },
  '700011': { origen: 'externo', docs: [{ driveId: '1f3-1XVEYttMmb0mEKzUoumNQjSroeldT', nombre: 'A132-REC-001_CaguasCommercial_2025-04-02.pdf', enlace: 'https://drive.google.com/file/d/1f3-1XVEYttMmb0mEKzUoumNQjSroeldT/view', rec: '001' }], verificadoPorApp: false, fecha: '2026-11-04T00:45:55.145Z' },
};

// ── DOM mínimo (solo lo que usa la ruta externa) ──
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this._t = ''; this.className = ''; this.href = ''; this.target = ''; this.rel = ''; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return [this._t].concat(this.children.map((c) => c.textContent)).join(' | '); }
  set innerHTML(v) { this._t = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
}
const todos = (e) => [e].concat(...e.children.map(todos));
const enlaces = (e) => todos(e).filter((x) => x.tag === 'a');

const alm = new Map();
const llamadasRed = [];
const dom = {};
function prepararDom(ids) {
  Object.keys(dom).forEach((k) => delete dom[k]);
  ids.forEach((id) => { dom['orig-recibo-' + id] = new El('div'); });
}
const ctx = vm.createContext({
  console, JSON, String, Number, Object, Array, Date, Error, RegExp, Set, Map, Promise, Math, isNaN,
  localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k) },
  document: { getElementById: (id) => dom[id] || null, createElement: (t) => new El(t) },
  fetch: async (u) => { llamadasRed.push(String(u)); throw new Error('la ruta externa no debe descargar'); },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0,
  driveTokenValid: () => false, asegurarTokenDrive: async () => null,
  origLeer: async () => null, origBorrar: async () => {}, sha256Hex: async () => '',
  gastos: [], fotos: {},
});
const nombres = ['leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'escribirVerificado', 'actualizarPend', 'limpiarRecibos', 'docRefValido', 'listarDocumentos', 'clavesPendDeGasto', 'escHtml', 'textoSinOriginal', 'textoEstadoOriginalBase', 'textoEstadoOriginal', 'verReciboOriginal', 'pintarOtrosDocumentos'];
vm.runInContext("const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', RECIBOS_CARPETA_NOMBRE='Arroyo 132 — Recibos originales'; var _pendMemoria={}, _pendMemoriaAutoritativa=false;\n" + nombres.map(extraer).join('\n'), ctx);
const R = (n) => vm.runInContext(n, ctx);

function sembrar(refs) {
  alm.clear();
  alm.set('a132_recibos', JSON.stringify(refs));
  alm.set('a132_recibos_pend', '{}');
  prepararDom(Object.keys(refs));
}

(async () => {
  // ── 1. Los cinco gastos reales abren su enlace correcto ──
  sembrar(REFS);
  for (const [id, ref] of Object.entries(REFS)) {
    const esperado = 'https://drive.google.com/file/d/' + ref.docs[0].driveId + '/view';
    await R('verReciboOriginal(' + JSON.stringify(id) + ')');
    const cont = dom['orig-recibo-' + id];
    const as = enlaces(cont);
    test(id + ': muestra un enlace de Google Drive', as.length === 1, as.map((a) => a.href));
    test(id + ': el enlace apunta al driveId exacto del central', as[0] && as[0].href === esperado, as[0] && as[0].href);
    test(id + ': abre en pestaña nueva sin opener', as[0] && as[0].target === '_blank' && as[0].rel === 'noopener');
    test(id + ': etiqueta con el nombre real del PDF', as[0] && as[0].textContent.includes(ref.docs[0].nombre), as[0] && as[0].textContent);
    test(id + ': avisa que es un documento existente en Drive y que la app no puede verificar su integridad', /no lo subió esta app/.test(cont.textContent) && /se abre por enlace/.test(cont.textContent), cont.textContent);
  }
  test('la apertura externa no hizo ninguna llamada de red', llamadasRed.length === 0, llamadasRed);

  // ── 2. Estado visible antes de pulsar ──
  const t = R('textoEstadoOriginal')('700010');
  test('el estado del gasto dice que el documento existe y se abre por enlace', /Documento existente en tu Google Drive \(1 archivo/.test(t), t);

  // ── 3. Seguridad: un driveId inválido no genera enlace ──
  sembrar({ '700001': { origen: 'externo', docs: [{ driveId: 'javascript:alert(1)', nombre: 'malo.pdf' }], fecha: '2026-11-04T00:45:55Z' } });
  await R('verReciboOriginal("700001")');
  test('un driveId fuera del patrón permitido no crea ningún enlace', enlaces(dom['orig-recibo-700001']).length === 0, enlaces(dom['orig-recibo-700001']).map((a) => a.href));

  // ── 4. Gasto sin referencia: no inventa enlace ──
  sembrar({});
  dom['orig-recibo-700002'] = new El('div');
  await R('verReciboOriginal("700002")');
  test('un gasto sin recibo vinculado no genera enlace', enlaces(dom['orig-recibo-700002']).length === 0);
  test('un gasto sin recibo vinculado lo dice', /Sin recibo original/.test(dom['orig-recibo-700002'].textContent), dom['orig-recibo-700002'].textContent);

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
