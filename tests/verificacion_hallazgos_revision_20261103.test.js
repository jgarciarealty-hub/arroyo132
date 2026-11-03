// Regresiones de los 10 hallazgos de la revisión independiente (2026-11-03).
// Funciones REALES extraídas de index.html y de central/*; sin red, sin Drive real, sin datos reales.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../central/estado_central.js');
const D = require('../central/almacen_drive.js');
const { driveSimulado } = require('./helpers/drive_simulado.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const driveCode = fs.readFileSync(path.join(__dirname, '..', 'central', 'almacen_drive.js'), 'utf8');
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
const mk = (id, c, f, m) => ({ id, contratista: c, fecha: f, monto: m, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', tipo: 'manual' });

(async () => {
  // ── 1. save() falso: guardarEdicionGasto revierte y NO anuncia éxito ─────────────────────
  {
    const alertas = []; let cerrado = false;
    const valores = { 'e-fecha': '2026-11-03', 'e-monto': '99', 'e-cont': 'Proveedor', 'e-cat': 'Otros', 'e-lote': 'Compartido', 'e-metodo': 'efectivo', 'e-desc': 'descripcion editada' };
    const ctx = vm.createContext({
      gastos: [{ id: 1, fecha: '2026-11-01', monto: 10, contratista: 'Viejo', categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', descripcion: 'descripcion vieja' }],
      document: { getElementById: (id) => ({ value: valores[id] !== undefined ? valores[id] : '' }) },
      save: () => false,
      alert: (m) => alertas.push(String(m)),
      closeModal: () => { cerrado = true; },
      renderHistorial: () => {}, renderDashboard: () => {},
      Object, String, parseFloat, JSON, console,
    });
    vm.runInContext(extraer('guardarConAviso') + '\n' + extraer('guardarEdicionGasto'), ctx);
    vm.runInContext('guardarEdicionGasto(1)', ctx);
    const g = ctx.gastos[0];
    test('1: con save() false, la edición se revierte en memoria', g.monto === 10 && g.descripcion === 'descripcion vieja' && g.contratista === 'Viejo', g);
    test('1: no se cierra el modal ni se anuncia «Gasto actualizado»', !cerrado && !alertas.some((a) => /Gasto actualizado/.test(a)) && alertas.some((a) => /No se pudo guardar/.test(a)), alertas);
  }
  {
    const funciones = ['guardarEdicionGasto', 'eliminarGasto', 'saveServicio', 'addServicio', 'addContratista', 'eliminarContratista', 'guardarEdicionCont', 'confirmarPagoCont', 'addTimeline', 'updateDoc', 'eliminarDoc', 'saveDriveId', 'addDoc', 'guardarViaje', 'restaurarDesdeDrive', 'importarBackup'];
    const sinComprobar = funciones.filter((n) => { const f = extraer(n); return !/guardarConAviso\(\)/.test(f) || /\bsave\(\)\s*;/.test(f); });
    test('1: todos los flujos de usuario comprueban guardarConAviso() y no llaman save(); a ciegas', sinComprobar.length === 0, sinComprobar);
  }

  // ── 1b/H1. save() transaccional: si falla a132_gastos, restaura las claves ya escritas ─────
  {
    const prev = {
      a132_servicios: JSON.stringify(['servicio-viejo']),
      a132_cont: JSON.stringify(['contratista-viejo']),
      a132_tl: JSON.stringify(['timeline-viejo']),
      a132_docs: JSON.stringify(['doc-viejo']),
      a132_gastos: JSON.stringify([{ id: 1, monto: 10 }]),
    };
    const actual = new Map(Object.entries(prev));
    const ctx = vm.createContext({
      localStorage: {
        getItem: (k) => (actual.has(k) ? actual.get(k) : null),
        setItem: (k, v) => { if (k === 'a132_gastos') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } actual.set(k, String(v)); },
        removeItem: (k) => actual.delete(k),
      },
      gastos: [{ id: 2, monto: 20 }], servicios: ['servicio-nuevo'], contratistas: ['contratista-nuevo'], timeline: ['timeline-nuevo'], docs: ['doc-nuevo'], fotos: {},
      JSON, console: { warn: () => {} },
    });
    vm.runInContext(extraer('save'), ctx);
    const r = vm.runInContext('save()', ctx);
    test('1b/H1: si falla a132_gastos, save() restaura servicios/cont/tl/docs a su valor anterior', r === false && actual.get('a132_servicios') === prev.a132_servicios && actual.get('a132_cont') === prev.a132_cont && actual.get('a132_tl') === prev.a132_tl && actual.get('a132_docs') === prev.a132_docs && actual.get('a132_gastos') === prev.a132_gastos, { r, actual: Object.fromEntries(actual) });
  }

  // ── 2. La cola en memoria representa borrados cuando localStorage falla ──────────────────
  {
    const alm = new Map([['a132_recibos_pend', JSON.stringify({ 9: { estado: 'pendiente' } })]]);
    const ctx = vm.createContext({
      localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => { if (k === 'a132_recibos_pend') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } alm.set(k, String(v)); }, removeItem: (k) => alm.delete(k) },
      JSON, Object, String, console,
    });
    vm.runInContext("const RECIBOS_PEND_KEY='a132_recibos_pend'; let _pendMemoria={}, _pendMemoriaAutoritativa=false;\n" + extraer('leerRecibosPend') + '\n' + extraer('escribirVerificado') + '\n' + extraer('guardarRecibosPend') + '\n' + extraer('actualizarPend'), ctx);
    const F = (n) => vm.runInContext(n, ctx);
    const ok1 = F('guardarRecibosPend')({ 9: { estado: 'error' }, 10: { estado: 'pendiente' } });
    const ok2 = F('actualizarPend')(9, null);
    const p = F('leerRecibosPend')();
    test('2: un borrado no persistido no reaparece desde localStorage', ok1 === false && ok2 === false && !p[9] && !!p[10], p);
  }

  // ── 3. Serialización y timeout de las peticiones de token de Drive ───────────────────────
  {
    const llamadas = [];
    const alm = new Map();
    const ctx = vm.createContext({
      localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k) },
      DRIVE_CLIENT_ID: 'x', google: { accounts: { oauth2: { initTokenClient: () => ({}) } } },
      driveTokenClient: { requestAccessToken: (o) => llamadas.push(o) }, initDriveClient: () => {},
      setTimeout, clearTimeout, JSON, Object, String, Date, Math, Promise, console,
    });
    vm.runInContext("let driveOkCallback=null, driveErrCallback=null, driveTokenTimer=null, _pedirTokenEnCurso=null, _driveClientGen=0;\n" + extraer('pedirTokenDrive'), ctx);
    const F = (n) => vm.runInContext(n, ctx);
    const p1 = F('pedirTokenDrive')(false), p2 = F('pedirTokenDrive')(false);
    test('3: dos peticiones concurrentes usan un solo callback de Google', llamadas.length === 1, llamadas.length);
    F('driveOkCallback')('T');
    const [t1, t2] = await Promise.all([p1, p2]);
    test('3: ambas promesas se resuelven con el mismo token', t1 === 'T' && t2 === 'T', { t1, t2 });
  }
  {
    const llamadas = [];
    const alm = new Map();
    const ctx = vm.createContext({
      localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k) },
      DRIVE_CLIENT_ID: 'x', google: { accounts: { oauth2: { initTokenClient: () => ({}) } } },
      driveTokenClient: { requestAccessToken: (o) => llamadas.push(o) },
      initDriveClient: () => { ctx.driveTokenClient = { requestAccessToken: (o) => llamadas.push(o) }; },
      setTimeout: (fn) => setTimeout(fn, 5), clearTimeout, JSON, Object, String, Date, Math, Promise, console,
    });
    vm.runInContext("let driveOkCallback=null, driveErrCallback=null, driveTokenTimer=null, _pedirTokenEnCurso=null, _driveClientGen=0;\n" + extraer('pedirTokenDrive'), ctx);
    const F = (n) => vm.runInContext(n, ctx);
    const p = F('pedirTokenDrive')(false);
    const t = await p;
    const p2 = F('pedirTokenDrive')(false);
    test('3: sin callback, la petición se resuelve por timeout y no queda colgada', t === null && llamadas.length === 2, { t, llamadas: llamadas.length });
    await p2;
  }

  // ── 5. Huella de miniatura: detecta duplicados tras recargar sin almacén de imágenes ────
  {
    const alm = new Map([['a132_foto_hashes', JSON.stringify({ 1: 'huella-abc' })]]);
    const ctx = vm.createContext({
      localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k) },
      gastos: [{ id: 1 }, { id: 2 }], fotos: {}, huellaImagen: () => 'huella-abc', JSON, Object, String,
    });
    vm.runInContext(extraer('fotoHashLeer') + '\n' + extraer('fotoYaExiste'), ctx);
    const g = vm.runInContext("fotoYaExiste('datos-de-la-foto')", ctx);
    test('5: la huella persistida detecta la misma foto tras recargar', g && g.id === 1, g);
    const ctxStale = vm.createContext({
      localStorage: { getItem: (k) => (k === 'a132_foto_hashes' ? JSON.stringify({ 1: 'huella-abc', 2: 'huella-abc' }) : null), setItem: () => {}, removeItem: () => {} },
      gastos: [{ id: 2 }], fotos: {}, huellaImagen: () => 'huella-abc', JSON, Object, String,
    });
    vm.runInContext(extraer('fotoHashLeer') + '\n' + extraer('fotoYaExiste'), ctxStale);
    const gStale = vm.runInContext("fotoYaExiste('datos-de-la-foto')", ctxStale);
    test('5: si la primera huella apunta a un gasto borrado, busca otra coincidencia válida', gStale && gStale.id === 2, gStale);
    test('5: el historial marca 📷 por referencia/pendiente, no solo por la miniatura', /idsConRecibo/.test(extraer('renderHistorial')) && /leerRecibosPend\(\)/.test(extraer('renderHistorial')) && /fotos\[g\.id\]\|\|idsConRecibo\.has/.test(extraer('renderHistorial')));
    test('5: save() no escribe miniaturas y el almacén de miniaturas sigue inactivo', !/setItem\('a132_fotos'/.test(extraer('save')) && /const FOTOS_IDB_ACTIVO=false/.test(script));
  }

  // ── 6. Unión de referencias de recibos entre dispositivos ───────────────────────────────
  {
    const ctx = vm.createContext({ A132Central: C, JSON, Object, Array, String, console });
    vm.runInContext(extraer('docRefValido') + '\n' + extraer('limpiarRecibos') + '\n' + extraer('listarDocumentos') + '\n' + extraer('unirRecibosFusion'), ctx);
    const F = (n) => vm.runInContext(n, ctx);
    const local = { 5: { driveId: 'A', sha256: 'a', fecha: '2026-01-01T00:00:00Z' } };
    const remoto = { 5: { driveId: 'A', sha256: 'a', fecha: '2026-01-01T00:00:00Z', adicionales: [{ driveId: 'B', sha256: 'b' }] } };
    const u = F('unirRecibosFusion')(local, remoto);
    test('6: el adicional del otro dispositivo se conserva en la unión', u[5] && Array.isArray(u[5].adicionales) && u[5].adicionales.some((d) => d.driveId === 'B'), u[5]);
    const local2 = { 5: { driveId: 'A', sha256: 'a', fecha: '2026-01-01T00:00:00Z', adicionales: [{ driveId: 'B', sha256: 'b' }] } };
    const remoto2 = { 5: { driveId: 'A', sha256: 'a', fecha: '2026-01-01T00:00:00Z' } };
    const u2 = F('unirRecibosFusion')(local2, remoto2);
    test('6: el adicional local tampoco se pierde al fusionar con el otro lado', u2[5] && Array.isArray(u2[5].adicionales) && u2[5].adicionales.some((d) => d.driveId === 'B'), u2[5]);
  }

  // ── 7. La caché de IA pasa los datos, no el envoltorio ───────────────────────────────────
  test('7: la reutilización de caché usa cacheIA.datos', script.includes('precrellenarConIA(cacheIA.datos)') && script.includes('buscarGastoCoincidente(cacheIA.datos,gastos)') && !/precrellenarConIA\(cacheIA\)/.test(script));

  // ── 8. Drive devuelve las revisiones en orden inverso: se ordena antes de fusionar ─────
  {
    const d = driveSimulado();
    const real = d.fetch;
    d.fetch = async (u, o = {}) => {
      const r = await real(u, o);
      if ((o.method || 'GET') === 'GET' && /\/revisions\?/.test(u)) {
        const j = r.json;
        r.json = async () => { const body = await j(); if (Array.isArray(body.revisions)) body.revisions = body.revisions.slice().reverse(); return body; };
      }
      return r;
    };
    const A = d.dispositivo(), B = d.dispositivo();
    const base = C.migrarAV5({ version: 4, gastos: [mk(1, 'Base', '2026-01-01', 10)] }, { origen: 'base' });
    await C.actualizar(A, () => base);
    d.antesDeSubir = async () => { await C.actualizar(A, (e) => C.guardarGasto(e, mk(5, 'A-carrera', '2026-02-01', 3), 'a')); };
    await C.actualizar(B, (e) => C.guardarGasto(e, mk(6, 'B-carrera', '2026-02-02', 4), 'b'));
    const fin = d.estado();
    test('8: con revisiones invertidas, la carrera se fusiona y no se pierde ningún gasto', !!fin.gastos['5'] && !!fin.gastos['6'], C.resumen(fin));
    test('8: el orden usa Date.parse, no localeCompare de modifiedTime', /Date\.parse\(r && r\.modifiedTime\)/.test(driveCode) && !/String\(a\.modifiedTime\)\.localeCompare/.test(driveCode));
  }

  // ── 9. Revisión esperada ausente: ok:false (no throw) para que actualizar reintente ─────
  {
    const d = driveSimulado();
    const A = d.dispositivo();
    const base = C.migrarAV5({ version: 4, gastos: [mk(1, 'Base', '2026-01-01', 10)] }, { origen: 'base' });
    await C.actualizar(A, () => base);
    const real = d.fetch; let forzar = true;
    d.fetch = async (u, o = {}) => {
      const r = await real(u, o);
      if (forzar && new URL(u).pathname === '/drive/v3/files') {
        const j = r.json;
        r.json = async () => { const body = await j(); if (Array.isArray(body.files) && body.files[0]) body.files[0] = Object.assign({}, body.files[0], { headRevisionId: 'revFantasma' }); return body; };
      }
      return r;
    };
    const W = D.crearAlmacenDrive({ fetchFn: d.fetch, token: 'T', fusionar: C.fusionar });
    let lanzo = false, res = null;
    try { res = await W.escribir(base, 'revFantasma'); } catch (e) { lanzo = true; }
    test('9: revisión esperada ausente → ok:false sin lanzar (permite el reintento)', !lanzo && res && res.ok === false, { lanzo, res });
    let n = 0;
    const al = { leer: async () => ({ estado: base, token: 't' }), escribir: async () => { n++; return n === 1 ? { ok: false } : { ok: true, token: 't2', estado: base }; } };
    const r = await C.actualizar(al, (e) => e);
    test('9: actualizar reintenta cuando escribir devuelve ok:false', r.intentos === 2 && n === 2, { intentos: r.intentos, n });
  }

  // ── 10. Mismo id con contenido de otro id: conflicto visible, no duplicado silencioso ───
  {
    const central = C.migrarAV5({ version: 4, gastos: [mk(5, 'A', '2026-01-01', 10), mk(9, 'B', '2026-01-02', 20)] }, { origen: 'x' });
    const local = { gastos: [mk(5, 'B', '2026-01-02', 20)] };
    const { informe } = C.incorporarPerfilLocal(central, local, { origen: 'local' });
    test('10: el mismo id con contenido de otro id queda como conflicto visible', informe.conflictosMismoId.some((c) => c.id === '5') && !informe.duplicadosOtroId.some((d) => d.idLocal === '5'), informe);

    // H5: el conflicto de id no debe hacer que otro registro local idéntico se descarte.
    const central2 = C.migrarAV5({ version: 4, gastos: [mk(5, 'A', '2026-01-01', 10), mk(9, 'B', '2026-01-02', 20)] }, { origen: 'x' });
    const local2 = { gastos: [mk(5, 'B', '2026-01-02', 20), mk(3, 'B', '2026-01-02', 20)] };
    const r2 = C.incorporarPerfilLocal(central2, local2, { origen: 'local' });
    const bVigentes = Object.values(r2.estado.gastos).filter((g) => !g._del && g.contratista === 'B').length;
    test('10b/H5: el conflicto de id no hace perder el segundo gasto local idéntico', r2.informe.conflictosMismoId.some((c) => c.id === '5') && r2.informe.anadidos.includes('3') && bVigentes === 2, { informe: r2.informe, bVigentes });
  }

  // ── H2. Liberación manual de miniaturas: protege las que no tienen original ─────────────
  {
    const alm = new Map([['a132_fotos', JSON.stringify({ 1: 'AAA', 2: 'BBB' })], ['a132_recibos', JSON.stringify({ 1: { driveId: 'F1', sha256: 'x' } })]]);
    const alertas = [];
    const base = {
      localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k) },
      fotos: { 1: 'AAA', 2: 'BBB' }, confirm: () => true, alert: (m) => alertas.push(String(m)),
      refrescarPanelRespaldo: () => {}, renderHistorial: () => {}, leerRecibos: () => ({ 1: { driveId: 'F1', sha256: 'x' } }),
      origClaves: async () => [], gastoDeClave: (k) => String(k).split('~')[0], Object, JSON, String,
    };
    const ctx = vm.createContext(Object.assign({}, base));
    vm.runInContext(extraer('liberarMiniaturasHistoricas'), ctx);
    await vm.runInContext('liberarMiniaturasHistoricas()', ctx);
    const restantes = JSON.parse(alm.get('a132_fotos') || '{}');
    test('H2: solo borra la miniatura con original y conserva la que es única copia', Object.keys(restantes).join() === '2' && Object.keys(ctx.fotos).join() === '2' && !!alm.get('a132_recibos') && alertas.some((a) => /liberaron 1/.test(a)) && alertas.some((a) => /conservaron 1/.test(a)), { restantes, fotos: Object.keys(ctx.fotos), alertas });

    const alm2 = new Map([['a132_fotos', JSON.stringify({ 2: 'BBB' })]]);
    const alertas2 = [];
    const ctx2 = vm.createContext(Object.assign({}, base, {
      localStorage: { getItem: (k) => (alm2.has(k) ? alm2.get(k) : null), setItem: (k, v) => alm2.set(k, String(v)), removeItem: (k) => alm2.delete(k) },
      fotos: { 2: 'BBB' }, alert: (m) => alertas2.push(String(m)), leerRecibos: () => ({}), origClaves: async () => [],
    }));
    vm.runInContext(extraer('liberarMiniaturasHistoricas'), ctx2);
    await vm.runInContext('liberarMiniaturasHistoricas()', ctx2);
    test('H2: sin ninguna miniatura con original, no borra nada y avisa', !!alm2.get('a132_fotos') && alertas2.some((a) => /No se liberó nada/.test(a)), { claves: [...alm2.keys()], alertas2 });
  }

  // ── H3/H10. Viajes y presupuesto: guardados honestos y persistidos tras restaurar/importar ─
  {
    const ctx = vm.createContext({
      localStorage: { getItem: () => null, setItem: () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }, removeItem: () => {} },
      viajes: [{ id: 1 }], presupuesto: { Otros: 10 }, alert: () => {}, JSON, String, console: { warn: () => {} },
    });
    vm.runInContext(extraer('saveViajes') + '\n' + extraer('guardarPresupuesto'), ctx);
    const F = (n) => vm.runInContext(n, ctx);
    test('H3: saveViajes() devuelve false con cuota llena', F('saveViajes')() === false);
    test('H3: guardarPresupuesto(false) devuelve false con cuota llena', F('guardarPresupuesto')(false) === false);
    const rest = extraer('restaurarDesdeDrive'), imp = extraer('importarBackup');
    test('H3: restaurar e importar persisten viajes y presupuesto tras guardar los gastos', /saveViajes\(\)/.test(rest) && /guardarPresupuesto\(true\)/.test(rest) && /saveViajes\(\)/.test(imp) && /guardarPresupuesto\(true\)/.test(imp));
  }

  // ── H7. El marcador del historial no cuenta entradas «sin_copia» ────────────────────────
  test('H7: el marcador 📷 excluye las entradas sin_copia de la cola', /q\.estado!=='sin_copia'/.test(extraer('renderHistorial')) && /idsConRecibo/.test(extraer('renderHistorial')));

  // ── H4/H8/H9. Cierres de bajo riesgo ─────────────────────────────────────────────────────
  {
    const rest = extraer('restaurarDesdeDrive'), imp = extraer('importarBackup'), panel = extraer('estadoRespaldoTexto');
    test('H4: restaurar/importar y el panel avisan que las miniaturas son solo vista previa', /Las miniaturas son solo vista previa/.test(rest) && /Las miniaturas son solo vista previa/.test(imp) && /solo como vista previa/.test(panel));
    test('H8: un callback de token de un cliente invalidado se ignora', /gen!==_driveClientGen/.test(script) && /_driveClientGen\+\+/.test(script) && /driveTokenClient=null/.test(script));
    test('H9: el sembrado revierte si save() falla y no queda solo en memoria', /if\(!save\(\)\)\s*gastos\.pop\(\)/.test(script));
  }

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  process.exit(fail ? 1 : 0);
})();
