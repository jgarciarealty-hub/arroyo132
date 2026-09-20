// Full integration test across ALL 5 patches recovered 2026-09-20 on the
// port/recuperar-recibos-y-pagos-parciales branch, run TOGETHER against the real
// extracted script in the SAME lexical scope (so `let gastos`/`fotos` etc. declared
// by the real file are directly visible to the test logic below -- not proxied
// through a separate sandbox object, which `let`/`const` top-level declarations
// do not attach to under Node's vm module).
//
// Dev-only verification script -- not part of the deployed PWA bundle (index.html
// is the only file Vercel serves). Run with: node tests/integration_port_branch.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: could not extract the real script block'); process.exit(1); }
const realScript = scriptMatch[1];

const results = { pass: 0, fail: 0 };
function test(name, cond, detail) {
  if (cond) { results.pass++; console.log('PASS:', name); }
  else { results.fail++; console.log('FAIL:', name, detail !== undefined ? '-- ' + JSON.stringify(detail) : ''); }
}

const elValues = {
  'f-fecha': '2026-09-10', 'f-monto': '300', 'f-cont': 'Ferreteria Real',
  'f-tel': '', 'f-cat': 'Techo', 'f-lote': '132A', 'f-metodo': 'efectivo', 'f-desc': '',
  'f-cuenta': '', 'f-total': '',
};
let modalBodyHtml = '', modalShown = false, lastAlert = null, confirmResult = true;
const fakeSelectCat = { innerHTML: '<option>Techo</option><option>Electricidad</option>', value: 'Techo' };
const elRegistry = {};
function mkEl(id) {
  if (elRegistry[id]) return elRegistry[id];
  const el = {
    checked: false, disabled: false, style: {},
    classList: { add(){}, remove(){}, contains(){return false;} },
    querySelector() { return { style: {} }; },
    addEventListener() {},
    _text: '',
  };
  Object.defineProperty(el, 'value', {
    get() { return id in elValues ? elValues[id] : ''; },
    set(v) { elValues[id] = v; },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; }, set(v) { el._text = v; },
  });
  el.trim = () => (el.value || '').trim();
  elRegistry[id] = el;
  return el;
}

const sandbox = {
  console,
  document: {
    getElementById(id) {
      if (id === 'f-cat' || id === 'e-cat') return fakeSelectCat;
      if (id === 'modal-title') return mkEl('modal-title');
      if (id === 'modal-body') { const el = mkEl('modal-body'); Object.defineProperty(el, 'innerHTML', { get: () => modalBodyHtml, set: (v) => { modalBodyHtml = v; } }); return el; }
      if (id === 'modal') return { classList: { add: () => { modalShown = true; }, remove: () => { modalShown = false; } } };
      return mkEl(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return { style:{}, classList:{add(){},remove(){},contains(){return false;}}, addEventListener(){} }; },
    addEventListener() {},
    body: { classList: { add(){}, remove(){} } },
    createElement() { return { getContext(){ return { drawImage(){} }; }, width:0, height:0, toDataURL(){ return 'data:image/jpeg;base64,X'; } }; },
    visibilityState: 'visible',
  },
  window: { addEventListener(){}, location: { search:'', href:'' }, innerWidth: 1024, matchMedia() { return { matches:false, addListener(){} }; } },
  navigator: { onLine: true },
  setInterval(){ return 0; }, clearInterval(){},
  setTimeout(fn){ return 0; }, clearTimeout(){},
  alert(m) { sandbox.lastAlert = m; },
  confirm() { return sandbox.confirmResult; },
  localStorage: { setItem() {}, getItem() { return null; } },
  Date, Math, JSON, parseFloat, String, Object, Map,
  test, results, elValues,
};
Object.defineProperty(sandbox, 'lastAlert', { get: () => lastAlert, set: (v) => { lastAlert = v; } });
Object.defineProperty(sandbox, 'confirmResult', { get: () => confirmResult, set: (v) => { confirmResult = v; } });
Object.defineProperty(sandbox, 'modalShownFlag', { get: () => modalShown });
vm.createContext(sandbox);

// Run the real script AND the test scenarios in ONE shared lexical scope.
const combined = realScript + `
;
// ===================== INTEGRATION SCENARIOS (same scope as the real app) =====================
// Note: recuperarRecibos() already ran during real app init (top-level IIFE in the real
// script) and seeded 9 real historical expenses (700001-700009) -- this IS the recuperarRecibos
// patch from 2026-09-13 working correctly alongside the 5 patches recovered 2026-09-20.
const baseCount = gastos.length;
test('recuperarRecibos() seeded its 9 historical expenses (cross-patch: still works alongside the newer patches)', baseCount === 9, baseCount);

// Must be the SAME object document.getElementById('btn-guardar-gasto') returns, since
// resetRegistrar() looks it up by ID independently of the argument passed to guardarGasto()
// -- in the real DOM these are the same element; the mock must match that.
const fakeBtn = document.getElementById('btn-guardar-gasto');

guardarGasto(fakeBtn);
test('expense saved on top of the 9 seeded ones', gastos.length === baseCount + 1, gastos.length);
test('button re-enabled after a successful save (resetRegistrar re-enables it)', fakeBtn.disabled === false);
const id1 = gastos[gastos.length - 1].id;

// resetRegistrar() (called after every successful save) clears the form fields, matching
// real UX -- a real user re-typing the same values into the now-blank form is what actually
// exercises the duplicate-detection path, so re-populate before each attempt below.
elValues['f-fecha'] = '2026-09-10'; elValues['f-monto'] = '300'; elValues['f-cont'] = 'Ferreteria Real';
guardarGasto(fakeBtn); // exact duplicate, confirm()=true by default -> saved anyway
test('duplicate confirmed by user IS saved', gastos.length === baseCount + 2, gastos.length);

confirmResult = false;
elValues['f-fecha'] = '2026-09-10'; elValues['f-monto'] = '300'; elValues['f-cont'] = 'Ferreteria Real';
guardarGasto(fakeBtn); // exact duplicate again, this time user declines
test('duplicate declined by user is NOT saved', gastos.length === baseCount + 2, gastos.length);
test('button re-enabled after a cancelled duplicate confirm (not stuck disabled)', fakeBtn.disabled === false);
confirmResult = true;

elValues['e-fecha'] = '2026-09-01';
elValues['e-cont'] = 'Contratista Distinto';
elValues['e-cat'] = 'Techo';
elValues['e-lote'] = '132B';
elValues['e-metodo'] = 'cheque';
elValues['e-monto'] = '999.99';
elValues['e-desc'] = 'editado en integracion';
editarGasto(id1);
test('editarGasto() opened the modal', modalShownFlag === true);
guardarEdicionGasto(id1);
const edited = gastos.find(g => g.id === id1);
test('edit persisted correctly (cross-patch: edit does not corrupt array state from guardarGasto)', edited && edited.monto === 999.99 && edited.contratista === 'Contratista Distinto', edited);

// Note: the "duplicate confirmed by user IS saved" step above deliberately kept a real
// second Ferreteria Real/300/09-10 record alongside the (now-edited-away) id1 -- so this
// next save attempt with the same values correctly SHOULD flag a duplicate (against that
// surviving record), proving dedup reads live array state rather than some stale snapshot
// that might still (incorrectly) think id1 -- now "Contratista Distinto" -- is the match.
elValues['f-fecha'] = '2026-09-10'; elValues['f-cont'] = 'Ferreteria Real'; elValues['f-monto'] = '300';
let dupPromptTriggered = false;
globalThis.confirm = function(){ dupPromptTriggered = true; return true; };
guardarGasto(fakeBtn);
test('dedup check correctly still flags the surviving real duplicate (live state, not a stale snapshot from before the edit)', dupPromptTriggered === true);
test('3 new expenses now exist on top of the 9 seeded (2 confirmed saves + this one; the declined one correctly never persisted)', gastos.length === baseCount + 3, gastos.length);

test('PDF_MAX_BYTES still correct after all prior operations', PDF_MAX_BYTES === 5 * 1024 * 1024);

const idToDelete = gastos[gastos.length - 1].id; // delete the very last one added, unrelated to id1
globalThis.confirm = function(){ return true; };
eliminarGasto(idToDelete);
test('deletion removes exactly one record', gastos.length === baseCount + 2, gastos.length);
test('the edited record (id1) survived an unrelated deletion', gastos.some(g => g.id === id1 && g.monto === 999.99));
test('the 9 seeded historical expenses survived unrelated deletion (cross-patch integrity)', gastos.filter(g => g.id >= 700001 && g.id <= 700009).length === 9);

console.log('\\n' + results.pass + ' passed, ' + results.fail + ' failed');
`;

try {
  vm.runInContext(combined, sandbox);
} catch (e) {
  console.error('FATAL during combined script execution:', e.message);
  console.error(e.stack);
  process.exit(1);
}
process.exit(results.fail > 0 ? 1 : 0);
