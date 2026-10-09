// Verificación de la app ACTUAL (main = lo que corre en producción), 2026-10-08.
// Contexto: la auditoría integral (docs/AUDITORIA_INTEGRAL_2026-10-08.md) encontró que la app
// perdió capacidades en el rediseño del commit 7735957 y que el único test existente cubría la
// rama del port, no main. Esta suite convierte "verificado por lectura de código" en
// "verificado por pruebas" sobre el código que producción sirve.
//
// Dev-only: no forma parte del bundle desplegado (Vercel solo sirve index.html).
// Uso: node tests/verificacion_app_actual.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
// Se lee el index.html de MAIN (no el del directorio de trabajo, que puede estar en otra rama):
// lo que se quiere verificar es exactamente lo que producción sirve (verificado byte a byte).
let html;
try {
  html = execSync('git show main:index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  console.error('No se pudo leer main:index.html:', e.message);
  process.exit(1);
}

const results = { pass: 0, fail: 0 };
function test(name, cond, detail) {
  if (cond) { results.pass++; console.log('PASS:', name); }
  else { results.fail++; console.log('FAIL:', name, detail !== undefined ? '-- ' + JSON.stringify(detail) : ''); }
}

// ---------- 1. ESTRUCTURA ----------
const secciones = [...html.matchAll(/id="sec-([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
const ESPERADAS = ['banco', 'contratistas', 'dashboard', 'documentos', 'financiamiento', 'graficas', 'historial', 'registrar', 'resumen', 'roi', 'servicios', 'timeline', 'viajes'];
test('las 13 secciones esperadas existen', ESPERADAS.every((s) => secciones.includes(s)), secciones);
test('no hay secciones inesperadas (nada a medias)', secciones.every((s) => ESPERADAS.includes(s)), secciones.filter((s) => !ESPERADAS.includes(s)));
test('sin marcadores de trabajo pendiente (TODO/FIXME/XXX/stub)', !/\b(TODO|FIXME|XXX|PLACEHOLDER)\b/.test(html));

// ---------- 2. INTEGRACIONES REALES ----------
test('la IA está wireada de verdad (llama a /api/analyze-invoice)', /\/api\/analyze-invoice/.test(html));
test('la app NO tiene claves hardcodeadas (usa el endpoint, no la key)', !/sk-ant-[A-Za-z0-9]/.test(html) && !/ANTHROPIC_API_KEY\s*=\s*['"]/.test(html));
test('backup/restauración a Google Drive presente', /backupToDrive|restaurarDesdeDrive|restoreFromDrive/.test(html));
test('banner de instalación PWA presente', /beforeinstallprompt/.test(html));
test('exportación CSV del reporte presente', /text\/csv|toCSV|Blob\(/.test(html));
test('PIN con bloqueo por intentos presente', /pinKey|intentosFallidos|bloqueado/i.test(html));

// ---------- 3. ARCHIVOS DE CONFIGURACIÓN ----------
function jsonOk(rel) { try { JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8')); return true; } catch { return false; } }
test('manifest.json es JSON válido', jsonOk('manifest.json'));
test('vercel.json es JSON válido', jsonOk('vercel.json'));
let apiOk = true, apiSrc = '';
try { apiSrc = fs.readFileSync(path.join(REPO, 'api/analyze-invoice.js'), 'utf8'); execSync('node --check api/analyze-invoice.js', { cwd: REPO, stdio: 'pipe' }); } catch { apiOk = false; }
test('api/analyze-invoice.js compila (node --check)', apiOk);
test('el endpoint usa process.env (no claves embebidas)', /process\.env\.ANTHROPIC_API_KEY/.test(apiSrc) && !/sk-ant-[A-Za-z0-9]/.test(apiSrc));

// ---------- 4. COMPORTAMIENTO (script real de main, en sandbox) ----------
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
test('se puede extraer el bloque <script> real', !!scriptMatch);
if (scriptMatch) {
  const elValues = { 'f-fecha': '2026-10-08', 'f-monto': '123.45', 'f-cont': 'Proveedor de Prueba', 'f-cat': '', 'f-lote': '132A', 'f-metodo': 'efectivo', 'f-desc': 'verificacion automatica' };
  const elRegistry = {};
  function mkEl(id) {
    if (elRegistry[id]) return elRegistry[id];
    const el = {
      checked: false, disabled: false, style: {}, _text: '',
      classList: { add() {}, remove() {}, contains() { return false; } },
      querySelector() { return { style: {} }; }, addEventListener() {},
    };
    Object.defineProperty(el, 'value', { get() { return id in elValues ? elValues[id] : ''; }, set(v) { elValues[id] = v; } });
    Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = v; } });
    el.trim = () => (el.value || '').trim();
    elRegistry[id] = el;
    return el;
  }
  const store = {};
  const sandbox = {
    console,
    document: {
      getElementById: (id) => mkEl(id),
      querySelectorAll: () => [],
      querySelector: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {} }),
      addEventListener() {},
      body: { classList: { add() {}, remove() {} } },
      createElement: () => ({ getContext: () => ({ drawImage() {} }), width: 0, height: 0, toDataURL: () => 'data:image/jpeg;base64,' }),
      visibilityState: 'visible',
    },
    window: { addEventListener() {}, location: { search: '', href: '' }, innerWidth: 1024, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    navigator: { onLine: true },
    // El navegador provee el global `event` dentro de un manejador inline; showSection() lo usa.
    event: { target: { classList: { add() {}, remove() {}, contains() { return false; } }, parentElement: null } },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    alert() {}, confirm: () => true,
    localStorage: { setItem(k, v) { store[k] = String(v); }, getItem(k) { return k in store ? store[k] : null; }, removeItem(k) { delete store[k]; } },
    fetch: () => Promise.reject(new Error('sin red en pruebas')),
    Date, Math, JSON, parseFloat, parseInt, String, Object, Array, Map, Promise,
    results, test,
  };
  vm.createContext(sandbox);
  // Las declaraciones `let`/`const` de nivel superior NO se cuelgan del objeto de contexto en `vm`
  // (solo las funciones). Por eso las aserciones de comportamiento se ejecutan EN EL MISMO ÁMBITO
  // LÉXICO que el script real, concatenadas -- misma técnica ya probada en el test del port.
  elValues['btn-guardar-gasto'] = 'btn-guardar-gasto';
  const probe = `
;
(() => {
  test('el script real de main declara el estado de gastos como arreglo', Array.isArray(gastos), typeof gastos);
  test('declara la función de guardado', typeof guardarGasto === 'function', typeof guardarGasto);
  test('declara el manejo de PIN', typeof pinKey === 'function', typeof pinKey);
  const antes = gastos.length;
  try { guardarGasto(document.getElementById('btn-guardar-gasto')); } catch (e) { test('guardarGasto no lanza excepción', false, e.message); }
  test('guardar un gasto válido lo agrega al estado', gastos.length === antes + 1, { antes, despues: gastos.length });

  // ---- Cobertura por FLUJO: las funciones que cada area requiere existen de verdad ----
  const FLUJOS = {
    'navegacion/secciones': ['showSection', 'showSectionDirect', 'bnav', 'updateDots'],
    'gastos': ['guardarGasto', 'eliminarGasto', 'showGastoDetail', 'resetRegistrar'],
    'servicios publicos': ['addServicio', 'saveServicio', 'renderServicios', 'totalesServicios'],
    'documentos': ['addDoc', 'updateDoc', 'eliminarDoc', 'renderDocs'],
    'contratistas': ['addContratista', 'registrarPagoCont', 'renderContratistas', 'eliminarContratista'],
    'timeline': ['addTimeline', 'renderTimeline'],
    'viajes': ['guardarViaje', 'eliminarViaje', 'renderViajes', 'calcViaje'],
    'financiero/ROI': ['calcROI', 'calcTuCoop', 'renderBanco', 'exportCSV', 'exportarBanco', 'compartirReporte'],
    'Google Drive': ['initDriveClient', 'backupToDrive', 'restaurarDesdeDrive', 'driveTokenValid'],
    'PIN/seguridad': ['hashPin', 'processPin', 'pinKey', 'changePinFlow', 'lockApp', 'unlockApp', 'checkLockout'],
    'graficas': ['renderCharts', 'destroyChart'],
    'PWA': ['installPWA'],
    'persistencia': ['save'],
  };
  for (const [area, fns] of Object.entries(FLUJOS)) {
    // Las declaraciones de funcion de nivel superior SI se cuelgan del global del contexto en vm
    // (a diferencia de let/const), asi que basta con mirar globalThis.
    const faltan = fns.filter((f) => typeof globalThis[f] !== 'function');
    test('flujo "' + area + '" (' + fns.length + ' funciones)', faltan.length === 0, faltan);
  }

  // ---- Comportamiento real en los puntos que el sandbox puede ejercer con honestidad ----
  try { save(); test('save() persiste el estado en localStorage', !!localStorage.getItem('a132_gastos'), Object.keys(localStorage)); }
  catch (e) { test('save() no lanza excepcion', false, e.message); }
  try {
    const n0 = gastos.length;
    if (n0 > 0) { eliminarGasto(gastos[n0 - 1].id); test('eliminarGasto() quita exactamente un registro', gastos.length === n0 - 1, { n0, n1: gastos.length }); }
    else test('eliminarGasto() quita exactamente un registro', false, 'no hay gastos que eliminar');
  } catch (e) { test('eliminarGasto() no lanza excepcion', false, e.message); }
  try {
    const h = hashPin('1234');
    test('hashPin() produce un valor no trivial (no guarda el PIN en claro)', typeof h === 'string' && h.length >= 16 && !h.includes('1234'), typeof h === 'string' ? h.slice(0, 10) + '…' : typeof h);
  } catch (e) { test('hashPin() no lanza excepcion', false, e.message); }
  try { showSection('historial'); test('showSection() acepta una seccion real sin lanzar', true); }
  catch (e) { test('showSection() acepta una seccion real sin lanzar', false, e.message); }
})();
`;
  let cargaOk = true, errCarga = null;
  try { vm.runInContext(scriptMatch[1] + probe, sandbox, { timeout: 20000 }); } catch (e) { cargaOk = false; errCarga = e.message; }
  test('el script real de main se ejecuta sin excepciones', cargaOk, errCarga);
}

console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
process.exit(results.fail ? 1 : 0);
