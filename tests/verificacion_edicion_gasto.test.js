// Editar gasto: guardar sin cambios deja el gasto IDENTICO campo por campo; metodo/categoria/lote desconocidos se conservan (2026-11-01).
// Funciones REALES (editarGasto, guardarEdicionGasto, asegurarOpcionSelect, escHtml, openModal) extraidas de index.html; DOM minimo simulado
// con la semantica de <select> del navegador (valor inexistente => ninguna opcion seleccionada => value ''). Solo lectura de la copia respaldada.
// Uso: node tests/verificacion_edicion_gasto.test.js   (incluye mutaciones sobre copias temporales)
//      A132_HTML=<ruta> node tests/...                  (usado por las mutaciones)
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const HTML = process.env.A132_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }
function extraer(nombre) {
  const ini = script.indexOf('function ' + nombre + '(');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '{') n++; else if (script[k] === '}') { n--; if (!n) break; } }
  return script.slice(ini, k + 1);
}
const COPIA = 'C:\\Users\\Owner\\JGarcia Realty Aplicacion\\council_runtime\\private_admin_data\\arroyo132_respaldos_20261101\\arroyo132-datos-movil-mvxfu8rr-k3fozr__copia_20261101-023947.json';
const REAL = JSON.parse(fs.readFileSync(COPIA, 'utf8')).gastos;
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// -- DOM minimo --------------------------------------------------------------
function crearSelect(optsHtml) {
  const s = { options: [], selectedIndex: -1 };
  const re = /<option([^>]*)>([^<]*)<\/option>/g; let m;
  while ((m = re.exec(optsHtml))) {   // sin atributo value, el valor es el texto (como en el navegador)
    const v = m[1].match(/\bvalue="([^"]*)"/);
    s.options.push({ value: v ? unesc(v[1]) : unesc(m[2]).trim(), selected: /\bselected\b/.test(m[1].replace(/value="[^"]*"/, '')), textContent: m[2] });
  }
  const i = s.options.findIndex(o => o.selected);
  s.selectedIndex = i >= 0 ? i : (s.options.length ? 0 : -1);   // el navegador elige la primera si ninguna esta marcada
  Object.defineProperty(s, 'value', {
    get() { return s.selectedIndex >= 0 ? s.options[s.selectedIndex].value : ''; },
    set(v) { s.selectedIndex = s.options.findIndex(o => o.value === v); }
  });
  s.appendChild = o => { s.options.push(o); };
  return s;
}
function montar() {
  const els = {};
  const fcat = html.match(/<select id="f-cat">([\s\S]*?)<\/select>/)[1];
  els['f-cat'] = Object.assign(crearSelect(fcat), { innerHTML: fcat });
  els['modal-title'] = { textContent: '' };
  els['modal'] = { classList: { add() {} } };
  const body = {};
  Object.defineProperty(body, 'innerHTML', { set(h) {
    for (const k of Object.keys(els)) if (k.startsWith('e-')) delete els[k];
    for (const m of h.matchAll(/<input[^>]*?id="(e-[a-z]+)"[^>]*?value="([^"]*)"[^>]*>/g)) els[m[1]] = { value: unesc(m[2]) };
    for (const m of h.matchAll(/<textarea id="(e-[a-z]+)">([\s\S]*?)<\/textarea>/g)) els[m[1]] = { value: unesc(m[2]) };
    for (const m of h.matchAll(/<select id="(e-[a-z]+)">([\s\S]*?)<\/select>/g)) els[m[1]] = crearSelect(m[2]);
  } });
  els['modal-body'] = body;
  return { document: { getElementById: id => els[id] || null, createElement: () => ({ value: '', textContent: '' }) } };
}
function crearSandbox() {
  const dom = montar();
  const ctx = { document: dom.document, gastos: [], saved: 0, alert() {}, save() { ctx.saved++; return true; }, closeModal() {}, renderHistorial() {}, renderDashboard() {}, showGastoDetail() {} };
  vm.createContext(ctx);
  vm.runInContext(['escHtml', 'jsArg', 'valorNumero', 'openModal', 'asegurarOpcionSelect', 'editarGasto', 'guardarEdicionGasto', 'guardarConAviso'].map(n => { try { return extraer(n); } catch (e) { return ''; } }).join('\n'), ctx);
  return ctx;
}
// Abre el formulario Editar y guarda, aplicando `cambios` (id de campo -> valor) entre ambos pasos.
function editar(g, cambios = {}) {
  const ctx = crearSandbox();
  ctx.gastos.push(g);
  vm.runInContext(`editarGasto(${g.id})`, ctx);
  for (const [k, v] of Object.entries(cambios)) ctx.document.getElementById(k).value = v;
  vm.runInContext(`guardarEdicionGasto(${g.id})`, ctx);
  return ctx;
}
const clon = o => JSON.parse(JSON.stringify(o));
const sinSello = (o) => { if (o === undefined || o === null) return o; const c = JSON.parse(JSON.stringify(o)); if (c && typeof c === 'object') delete c.modificado; return c; };
const iguales = (a, b) => JSON.stringify(sinSello(a)) === JSON.stringify(sinSello(b));   // incluye el orden de claves (sin el sello O1)

// -- 1. ida y vuelta sin cambios de TODOS los gastos reales -------------------
const cuentaM = {}; REAL.forEach(g => cuentaM[g.metodo] = (cuentaM[g.metodo] || 0) + 1);
test('datos reales: 61 gastos (efectivo 39, tarjeta 21, cheque 1)', REAL.length === 61 && cuentaM.efectivo === 39 && cuentaM.tarjeta === 21 && cuentaM.cheque === 1, cuentaM);
const difs = [];
for (const g0 of REAL) { const g = clon(g0); editar(g); if (!iguales(g, g0)) difs.push({ id: g0.id, antes: g0, despues: g }); }
test('guardar sin cambios deja los 61 gastos reales identicos campo por campo', difs.length === 0, difs.slice(0, 2));
test('hay lote atipico real (132-B) y categorias con " / " cubiertos', REAL.some(g => g.lote === '132-B') && REAL.some(g => g.categoria.includes(' / ')));

// -- 2. QUALITY iS: editar solo la descripcion conserva la tarjeta -----------
const q = REAL.find(g => /quality/i.test(g.contratista) && Math.abs(g.monto - 25.06) < 0.001);
test('existe el gasto QUALITY iS $25.06 con tarjeta', !!q && q.metodo === 'tarjeta', q && q.metodo);
if (q) {
  const g = clon(q); editar(g, { 'e-desc': q.descripcion + ' (nota)' });
  const esp = clon(q); esp.descripcion = q.descripcion + ' (nota)';
  test('QUALITY iS: editar solo la descripcion conserva metodo tarjeta y el resto identico', g.metodo === 'tarjeta' && iguales(g, esp), g);
}
const tarj = REAL.filter(g => g.metodo === 'tarjeta');
test('los 21 gastos con tarjeta conservan tarjeta al editar la descripcion', tarj.length === 21 && tarj.every(g0 => { const g = clon(g0); editar(g, { 'e-desc': 'x' }); return g.metodo === 'tarjeta'; }));
{ const g = clon(REAL[0]); editar(g, { 'e-metodo': 'ath' }); test('cambiar el metodo a ath funciona', g.metodo === 'ath'); }
{ const g = clon(REAL[0]); editar(g, { 'e-metodo': 'tarjeta' }); test('cambiar el metodo a tarjeta funciona', g.metodo === 'tarjeta'); }

// -- 3. valores desconocidos se conservan ------------------------------------
{ const g = { ...clon(REAL[0]), metodo: 'zelle' }; editar(g); test('metodo desconocido se conserva', g.metodo === 'zelle', g.metodo); }
{ const g = { ...clon(REAL[0]), categoria: 'Categoria Antigua / X' }; editar(g); test('categoria desconocida se conserva', g.categoria === 'Categoria Antigua / X', g.categoria); }
{ const g = { ...clon(REAL[0]), lote: '132-C' }; editar(g); test('lote desconocido se conserva', g.lote === '132-C', g.lote); }
{ const g = { ...clon(REAL[0]), lote: '132-B' }; editar(g, { 'e-lote': '132A' }); test('un valor desconocido se puede cambiar a proposito', g.lote === '132A', g.lote); }

// -- 4. otros campos que el formulario podia reescribir ----------------------
{ const g = clon(REAL[0]); delete g.descripcion; const a = clon(g); editar(g); test('descripcion ausente sigue ausente', iguales(g, a), g); }
{ const g = { ...clon(REAL[0]), contratista: '' }; const a = clon(g); editar(g); test('proveedor vacio NO pasa a "Sin especificar" si no se toca', iguales(g, a), g.contratista); }
{ const g = { ...clon(REAL[0]), descripcion: '  con espacios  ' }; const a = clon(g); editar(g); test('descripcion con espacios en los bordes no se recorta si no se toca', iguales(g, a), g.descripcion); }
{ const g = { ...clon(REAL[0]), contratista: '' }; editar(g, { 'e-cont': 'Nuevo' }); test('proveedor vacio editado a proposito si se guarda', g.contratista === 'Nuevo'); }
{ const g = clon(REAL[0]); editar(g, { 'e-cont': '' }); test('vaciar el proveedor a proposito da "Sin especificar" (comportamiento previo)', g.contratista === 'Sin especificar'); }
{ const g = clon(REAL[0]); editar(g, { 'e-monto': '999.5' }); test('cambiar el monto funciona y no toca archivos/tipo/cheque', g.monto === 999.5 && iguales(g.archivos, REAL[0].archivos) && g.tipo === REAL[0].tipo && iguales(g.cheque, REAL[0].cheque)); }
{ const g = clon(REAL[0]); const ctx = editar(g, { 'e-monto': '0' }); test('monto 0 se rechaza sin guardar (previo)', iguales(g, REAL[0]) && ctx.saved === 0); }
{ const cat = REAL.find(x => x.categoria.includes(' / ')); const g = clon(cat); editar(g, { 'e-cat': 'Materiales' }); test('cambiar categoria a una conocida funciona', g.categoria === 'Materiales'); }

// -- 5. el HTML trae las opciones que faltaban --------------------------------
const em = html.match(/id="e-metodo">([\s\S]*?)<\/select>/)[1];
test('e-metodo ofrece efectivo, ath, cheque, tarjeta y transferencia', ['efectivo', 'ath', 'cheque', 'tarjeta', 'transferencia'].every(v => em.includes(`value="${v}"`)));

// -- 6. mutaciones (copias temporales; deben hacer fallar esta suite) ---------
if (!process.env.A132_HTML) {
  const raiz = html;
  const muts = [
    ['quitar tarjeta de e-metodo', h => h.replace(/<option value="tarjeta" \$\{g\.metodo==='tarjeta'[^\n]*\n/, '')],
    ['quitar ath de e-metodo', h => h.replace(/<option value="ath" \$\{g\.metodo==='ath'[^\n]*\n/, '')],
    ['quitar la salvaguarda de metodo', h => h.replace("asegurarOpcionSelect('e-metodo',g.metodo);", '')],
    // La proteccion es en dos capas (opcion anadida al abrir + no aceptar '' al guardar): se quitan ambas para que la mutacion sea efectiva.
    ['quitar la salvaguarda de categoria (ambas capas)', h => h.replace("asegurarOpcionSelect('e-cat',g.categoria);", '').replace("if(catNueva!==''||!g.categoria) g.categoria=catNueva;", 'g.categoria=catNueva;')],
    ['quitar la salvaguarda de lote', h => h.replace("asegurarOpcionSelect('e-lote',g.lote);", '').replace("if(loteNuevo!==''||!g.lote) g.lote=loteNuevo;", 'g.lote=loteNuevo;')],
    ['salvaguarda que no agrega la opcion (ambas capas)', h => h.replace('sel.appendChild(o);', '').replace("if(catNueva!==''||!g.categoria) g.categoria=catNueva;", 'g.categoria=catNueva;')],
    ['guardar acepta valor vacio de select (sin capa de apertura)', h => h.replace("asegurarOpcionSelect('e-cat',g.categoria);", '').replace("if(catNueva!==''||!g.categoria) g.categoria=catNueva;", 'g.categoria=catNueva;')],
    ['proveedor siempre reescrito', h => h.replace("if(contNuevo!==String(g.contratista||'').trim()) g.contratista", 'g.contratista')],
    ['descripcion siempre reescrita', h => h.replace("if(descNueva!==String(g.descripcion||'').trim()) g.descripcion", 'g.descripcion')],
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a132-mut-'));
  muts.forEach(([n, f], i) => {
    const m = f(raiz);
    if (m === raiz) { test('mutacion aplicable: ' + n, false); return; }
    const p = path.join(dir, `m${i}.html`); fs.writeFileSync(p, m);
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, A132_HTML: p }, encoding: 'utf8' });
    test('mutacion detectada: ' + n, r.status !== 0);
  });
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);


