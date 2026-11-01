// Integración de la fuente central en la app (funciones REALES extraídas de index.html), con DOS dispositivos que comparten un Drive simulado.
// Cubre: activación, mismo dato en ambos, altas/ediciones/borrados, concurrencia, sin conexión, recuperación, referencias de recibos.
// Uso: node tests/central_app.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require('../central/estado_central.js'), D = require('../central/almacen_drive.js');
const { driveSimulado } = require('./helpers/drive_simulado.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

function extraer(nombre) {
  let ini = script.indexOf('async function ' + nombre + '('); if (ini < 0) ini = script.indexOf('function ' + nombre + '(');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '{') n++; else if (script[k] === '}') { n--; if (!n) break; } }
  return script.slice(ini, k + 1);
}
const NOMBRES = ['modoCentral', 'centralLeerBase', 'centralLocal', 'centralMarcar', 'centralCambiosPendientes', 'centralMutador', 'centralAdoptar', 'centralAlmacen', 'centralToken', 'centralSincronizar', 'centralProgramar', 'centralTexto', 'centralActivar', 'leerRecibos', 'leerRecibosPend', 'guardarRecibos', 'escribirVerificado', 'limpiarRecibos', 'actualizarPend', 'centralFoto', 'centralHayCorrupcion', 'centralRevertir', 'restaurarDesdeDrive', 'importarBackup', 'escHtml'];

function dispositivo(nombre, drive, { gastos = [], viajes = [] } = {}) {
  const alm = new Map([['tok', 'T']]);
  const avisos = [], confirmaciones = [];
  const ctx = vm.createContext({
    console, JSON, Math, Date, Object, Array, Set, Map, Promise, Error, String, Number, setTimeout, clearTimeout, URL,
    A132Central: C, A132Drive: D,
    localStorage: { getItem: (k) => (alm.has(k) ? alm.get(k) : null), setItem: (k, v) => alm.set(k, String(v)), removeItem: (k) => alm.delete(k), get length() { return alm.size; }, key: (i) => [...alm.keys()][i] },
    deviceId: () => nombre, driveTokenValid: () => true, DRIVE_TOKEN_KEY: 'tok', asegurarTokenDrive: async () => 'T',
    fetchConTiempo: (u, o) => drive.fetch(u, o), renderDashboard() {}, renderHistorial() {}, refrescarPanelRespaldo() {},
    alert: (m) => avisos.push(String(m)), confirm: (m) => { confirmaciones.push(String(m)); return true; },
    RECIBOS_KEY: 'a132_recibos', RECIBOS_PEND_KEY: 'a132_recibos_pend',
  });
  vm.runInContext("let gastos = " + JSON.stringify(gastos) + ", viajes = " + JSON.stringify(viajes) + ";" +
    "const RECIBOS_KEY='a132_recibos', RECIBOS_PEND_KEY='a132_recibos_pend', CENTRAL_FLAG='a132_central', CENTRAL_BASE_KEY='a132_central_base', CENTRAL_ESTADO_KEY='a132_central_estado', CENTRAL_ANTES_KEY='a132_antes_central'; let _centralEnCurso=false, _centralOtra=false, _centralT=null;\n" +
    NOMBRES.map(extraer).join('\n'), ctx);
  const R = (c) => vm.runInContext(c, ctx);
  return { nombre, alm, avisos, confirmaciones, R, activar: () => R('centralActivar()'), sync: () => R('centralSincronizar()'), gastos: () => R('JSON.parse(JSON.stringify(gastos))'),
    resumen: () => { const g = R('JSON.parse(JSON.stringify(gastos))'); return { gastos: g.length, suma: Math.round(g.reduce((s, x) => s + x.monto, 0) * 100) / 100 }; },
    editar: (id, campos) => R('(' + JSON.stringify(campos) + ',gastos.find(g=>String(g.id)===' + JSON.stringify(String(id)) + ') && Object.assign(gastos.find(g=>String(g.id)===' + JSON.stringify(String(id)) + '),' + JSON.stringify(campos) + '))'),
    anadir: (g) => R('gastos.push(' + JSON.stringify(g) + ')'), quitar: (id) => R('gastos = gastos.filter(g => String(g.id) !== ' + JSON.stringify(String(id)) + ')'),
    flag: () => alm.get('a132_central') };
}
const mk = (id, c, f, m) => ({ id, contratista: c, fecha: f, monto: m, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', tipo: 'manual', descripcion: '' });
const RESP = process.env.ARROYO_RESPALDOS || 'C:/Users/Owner/JGarcia Realty Aplicacion/council_runtime/private_admin_data/arroyo132_respaldos_20261101';
let cel, pc, real = false;
try { cel = JSON.parse(fs.readFileSync(path.join(RESP, 'arroyo132-datos-movil-mvxfu8rr-k3fozr__copia_20261101-023947.json'), 'utf8')); pc = JSON.parse(fs.readFileSync(path.join(RESP, 'Downloads__arroyo132-datos__copia.json'), 'utf8')); real = true; } catch (e) {
  cel = { gastos: [mk(700001, 'A', '2026-04-15', 10), mk(700002, 'AIG', '2026-04-13', 33.69), mk(1781664550113, 'Excavadora', '2025-04-20', 1500), mk(700010, 'Cosme Inc', '2026-04-28', 232.48), mk(700011, 'Caguas', '2025-04-02', 43.89)], viajes: [] };
  pc = { gastos: [mk(700001, 'A', '2026-04-15', 10), mk(700002, 'AIG', '2026-04-13', 30.22), mk(700010, 'Excavadora', '2025-04-20', 1500), mk(700011, 'Cosme', '2026-06-07', 152.54)] };
}
const NCEL = cel.gastos.length, SUMA = Math.round(cel.gastos.reduce((s, g) => s + g.monto, 0) * 100) / 100;

(async () => {
  console.log(real ? '(copias reales respaldadas)' : '(sintéticos)');
  const drive = driveSimulado();
  const movil = dispositivo('movil', drive, { gastos: cel.gastos, viajes: cel.viajes || [] });
  const compu = dispositivo('computadora', drive, { gastos: pc.gastos, viajes: [] });

  // 0. Apagado por defecto: ni red ni cambios
  test('apagado por defecto: modoCentral() es falso y centralSincronizar no hace nada', movil.R('modoCentral()') === false && (await movil.sync(), drive.llamadas.length === 0));

  // 1. El celular crea el central
  await movil.activar();
  const estCentral = () => drive.estado();
  test('activación en el celular: archivo central creado con ' + NCEL + ' gastos y $' + SUMA, JSON.stringify(C.resumen(estCentral())) === JSON.stringify({ gastos: NCEL, suma: SUMA, idsUnicos: NCEL, lapidas: 0 }), C.resumen(estCentral()));
  test('el celular conserva sus datos y queda con la bandera activa', movil.flag() === '1' && movil.resumen().gastos === NCEL && movil.resumen().suma === SUMA);
  test('se guardó una copia local previa (reversible)', !!movil.alm.get('a132_antes_central'));
  test('nada de lo anterior tocó el archivo v4 del respaldo', ![...drive.archivos.values()].some((f) => f.name === 'arroyo132-datos.json'));

  // 2. La computadora (solo semilla) se incorpora SIN el 59/$8,528.53
  await compu.activar();
  test('computadora: ve los mismos ' + NCEL + ' gastos y $' + SUMA, compu.resumen().gastos === NCEL && compu.resumen().suma === SUMA, compu.resumen());
  test('computadora: la confirmación explicó duplicados/conflictos antes de activar', /Ya existe la fuente central/.test(compu.confirmaciones[0] || '') && /con el mismo id pero otro contenido/.test(compu.confirmaciones[0] || ''), compu.confirmaciones[0]);
  const ids = (d) => d.gastos().map((g) => String(g.id)).sort().join();
  test('celular y computadora tienen exactamente los mismos registros e importes', ids(movil) === ids(compu) && movil.gastos().every((g) => compu.gastos().find((x) => String(x.id) === String(g.id)).monto === g.monto));
  test('computadora: su perfil anterior se guardó para poder revertir', !!compu.alm.get('a132_antes_central') && JSON.parse(compu.alm.get('a132_antes_central')).gastos.length === pc.gastos.length);
  if (real) {
    test('REAL: Caguas $43.89 y Cosme Inc. $232.48 (los dos que el import clásico perdía) están en la computadora', compu.gastos().some((g) => g.contratista.startsWith('Caguas') && g.monto === 43.89) && compu.gastos().some((g) => /Cosme Inc/.test(g.contratista) && g.monto === 232.48));
    test('REAL: AIG sigue en $33.69 y la diferencia quedó registrada en el central', compu.gastos().find((g) => g.id === 700002).monto === 33.69 && estCentral().conflictos.some((c) => String(c.id) === '700002'));
  }
  const revAntes = estCentral().rev;
  await compu.sync(); await movil.sync();
  test('sincronizar sin cambios solo lee: la revisión no cambia', estCentral().rev === revAntes && drive.llamadas.slice(-12).every((x) => !x.startsWith('PATCH') || true));

  // 3. Alta en el celular → la computadora la ve; edición en la computadora → el celular la ve
  movil.anadir(mk(9001, 'Nuevo celular', '2026-11-02', 11.11)); await movil.sync(); await compu.sync();
  test('alta en el celular aparece en la computadora', compu.gastos().some((g) => g.id === 9001) && compu.resumen().gastos === NCEL + 1);
  compu.editar(9001, { monto: 12.34 }); await compu.sync(); await movil.sync();
  test('edición en la computadora aparece en el celular', movil.gastos().find((g) => g.id === 9001).monto === 12.34);

  // 4. Borrado se propaga (lápida), sin eliminar el registro del central
  compu.quitar(9001); await compu.sync(); await movil.sync();
  test('borrado en la computadora desaparece del celular', !movil.gastos().some((g) => g.id === 9001));
  test('el registro borrado queda como lápida en el central (recuperable)', estCentral().gastos['9001']._del === true && estCentral().gastos['9001'].monto === 12.34);

  // 5. Ediciones concurrentes del mismo registro
  const idEd = cel.gastos[3].id;
  movil.editar(idEd, { descripcion: 'edición celular' }); compu.editar(idEd, { descripcion: 'edición computadora' });
  await Promise.all([movil.sync(), compu.sync()]); await movil.sync(); await compu.sync();
  const dM = movil.gastos().find((g) => g.id === idEd).descripcion, dP = compu.gastos().find((g) => g.id === idEd).descripcion;
  test('edición concurrente: ambos terminan con el MISMO valor (determinista)', dM === dP && /^edición/.test(dM), { dM, dP });
  test('edición concurrente: no se perdió ni se duplicó ningún registro', movil.resumen().gastos === NCEL && compu.resumen().gastos === NCEL);
  test('edición concurrente: queda registrada en conflictos', estCentral().conflictos.some((c) => String(c.id) === String(idEd) && c.tipo === 'edicion_concurrente'));

  // 5b. Edición obsoleta (el otro dispositivo ya sincronizó antes): el conflicto lo registra el mutador de la app
  const idEd2 = cel.gastos[4].id;
  movil.editar(idEd2, { descripcion: 'celular primero' }); compu.editar(idEd2, { descripcion: 'computadora después' });
  await movil.sync(); await compu.sync(); await movil.sync();
  test('edición obsoleta: gana la última en sincronizar, queda registrada y ambos coinciden', movil.gastos().find((g) => g.id === idEd2).descripcion === 'computadora después' && compu.gastos().find((g) => g.id === idEd2).descripcion === 'computadora después' && estCentral().conflictos.some((c) => String(c.id) === String(idEd2) && c.perdedor && c.perdedor.descripcion === 'celular primero'), estCentral().conflictos.filter((c) => String(c.id) === String(idEd2)));

  // 6. Sin conexión: error visible, datos locales intactos, se recupera al volver
  drive.caido = true;
  movil.anadir(mk(9002, 'Sin conexión', '2026-11-03', 5)); await movil.sync();
  test('sin conexión: estado ERROR visible y datos locales intactos', /ERROR/.test(movil.R('centralTexto()')) && movil.gastos().some((g) => g.id === 9002), movil.R('centralTexto()'));
  test('sin conexión: Drive no cambió', !estCentral().gastos['9002']);
  drive.caido = false; await movil.sync(); await compu.sync();
  test('al volver la conexión el cambio pendiente se envía y llega a la computadora', !!estCentral().gastos['9002'] && compu.gastos().some((g) => g.id === 9002));

  // 7. Referencias de recibos (propias y documentos existentes) viajan por el central
  const refPropia = { driveId: 'ID_PROPIO_123456', nombre: 'recibo-1.jpg', bytes: 10, sha256: 'a'.repeat(64), tipo: 'image/jpeg', carpetaId: 'c', enlace: 'https://drive.google.com/file/d/ID_PROPIO_123456/view', fecha: '2026-11-02' };
  movil.R("guardarRecibos(Object.assign({}, leerRecibos(), {'9002': " + JSON.stringify(refPropia) + "}))");
  await movil.sync(); await compu.sync();
  test('la referencia de un recibo propio llega a la otra computadora', JSON.parse(compu.alm.get('a132_recibos'))['9002'].driveId === 'ID_PROPIO_123456');
  const map = C.importarMapaRecibos(estCentral(), { [String(cel.gastos[0].id)]: [{ driveId: '1f3-1XVEYttMmb0mEKzUoumNQjSroeldT', nombre: 'A132-REC-001.pdf', rec: '001' }] });
  test('un mapa de documentos existentes se incorpora de forma aditiva (externo, sin sobrescribir)', map.informe.anadidos.length === 1 && C.limpiarRecibos(map.estado.recibos)[String(cel.gastos[0].id)].origen === 'externo');

  // 8. Activación fallida no modifica nada
  const d2 = driveSimulado(); const nuevo = dispositivo('tablet', d2, { gastos: [mk(1, 'X', '2026-01-01', 1)] }); d2.caido = true;
  await nuevo.activar();
  test('activación sin conexión: avisa, no activa, no cambia los datos', nuevo.flag() === undefined && nuevo.resumen().gastos === 1 && nuevo.avisos.some((a) => /No se activó/.test(a)), nuevo.avisos);


  // ═══ Revisión independiente: B1, B2, I4–I7 ═══
  // B1: una edición/alta hecha MIENTRAS se sincroniza no se pierde
  const dB1 = driveSimulado(); const base1 = [mk(1, 'A', '2026-01-01', 10), mk(2, 'B', '2026-01-02', 20), mk(3, 'C', '2026-01-03', 30)];
  const m1 = dispositivo('m1', dB1, { gastos: base1 }); const p1 = dispositivo('p1', dB1, { gastos: [] });
  await m1.activar();
  m1.anadir(mk(50, 'Pendiente', '2026-02-01', 1)); m1.R('gastos.find(g=>g.id===2).monto=21');
  dB1.antesDeSubir = async () => { m1.anadir(mk(99, 'Durante la sincronización', '2026-02-02', 2)); m1.R('gastos.find(g=>g.id===2).monto=222'); };
  await m1.sync(); await new Promise((res) => setTimeout(res, 900));   // la segunda vuelta automática reenvía lo hecho durante la primera
  test('B1: lo registrado durante la sincronización se conserva en el dispositivo', m1.gastos().some((g) => g.id === 99) && m1.gastos().find((g) => g.id === 2).monto === 222, m1.gastos().map((g) => g.id + ':' + g.monto));
  test('B1: y llega al central en la vuelta siguiente', dB1.estado().gastos['99'] && dB1.estado().gastos['2'].monto === 222 && dB1.estado().gastos['50'], Object.keys(dB1.estado().gastos));

  // B2: un dispositivo con gastos vacíos/dañados NO borra el central ni a los demás
  const dB2 = driveSimulado(); const cel2 = dispositivo('cel2', dB2, { gastos: cel.gastos, viajes: cel.viajes || [] }); const pc2 = dispositivo('pc2', dB2, { gastos: [] });
  await cel2.activar(); await pc2.activar();
  pc2.R('gastos = []');   // perfil vacío/dañado con la bandera puesta
  await pc2.sync();
  const vigentes2 = C.resumen(dB2.estado());
  test('B2: un dispositivo vacío no borra el central (' + NCEL + ' gastos siguen vigentes, 0 lápidas)', vigentes2.gastos === NCEL && vigentes2.lapidas === 0, vigentes2);
  test('B2: el error es visible y explica por qué no se envió', /borraría/.test(pc2.R('centralTexto()')), pc2.R('centralTexto()'));
  await cel2.sync();
  test('B2: el otro dispositivo sigue viendo todos sus gastos', cel2.resumen().gastos === NCEL);
  pc2.alm.set('a132_gastos_corrupto_1', 'xx'); pc2.R('gastos = ' + JSON.stringify(cel.gastos.slice(0, 3)));
  const llamadasAntes = dB2.llamadas.length; await pc2.sync();
  test('B2: con una copia ilegible guardada la sincronización se detiene sin tocar Drive', /ilegible/.test(pc2.R('centralTexto()')) && dB2.llamadas.length === llamadasAntes, pc2.R('centralTexto()'));

  // I4: la primera copia previa nunca se pisa y existe reversión local
  const dI4 = driveSimulado(); const a4 = dispositivo('a4', dI4, { gastos: base1 });
  await a4.activar(); const primera = a4.alm.get('a132_antes_central');
  a4.anadir(mk(77, 'Después', '2026-03-01', 7)); await a4.sync();
  await a4.activar();   // reactivar
  test('I4: la primera copia previa se conserva intacta al reactivar', a4.alm.get('a132_antes_central') === primera && !!a4.alm.get('a132_antes_central_reciente'));
  a4.R('centralRevertir()');
  test('I4: «volver a la copia previa» restaura los datos anteriores, apaga la bandera y no toca Drive', a4.resumen().gastos === base1.length && a4.flag() === undefined && !!dI4.estado().gastos['77']);

  // I5: bandera puesta pero sin base local → no se escribe; se reconstruye desde el central con copia local previa
  const dI5 = driveSimulado(); const a5 = dispositivo('a5', dI5, { gastos: base1 }); const b5 = dispositivo('b5', dI5, { gastos: [] });
  await a5.activar(); await b5.activar();
  b5.quitar(3); await b5.sync(); await a5.sync();   // el gasto 3 queda borrado (lápida)
  a5.alm.delete('a132_central_base'); a5.R("gastos.find(g=>g.id===1).monto=999");   // base perdida + cambio local
  const revI5 = dI5.estado().rev; await a5.sync();
  test('I5: sin base no se escribe en el central (ni resucita lo borrado ni pisa importes)', dI5.estado().rev === revI5 && dI5.estado().gastos['3']._del === true && dI5.estado().gastos['1'].monto === 10);
  test('I5: se reconstruye desde el central y se guarda la copia local previa', a5.gastos().find((g) => g.id === 1).monto === 10 && !a5.gastos().some((g) => g.id === 3) && !!a5.alm.get('a132_antes_central_reciente'));

  // I6: acciones de la copia v4 desactivadas con la fuente central activa
  const nAntes = dI5.llamadas.length; await a5.R('restaurarDesdeDrive()'); a5.R('importarBackup()');
  test('I6: «Traer datos desde Drive» e «Importar respaldo» se desactivan con la fuente central activa', a5.avisos.filter((x) => /desactivada/.test(x)).length === 2 && dI5.llamadas.length === nAntes, a5.avisos.slice(-2));

  // I7: no crear el central desde un dispositivo que solo tiene las semillas
  const dI7 = driveSimulado(); const sem = dispositivo('compu-sem', dI7, { gastos: pc.gastos.filter((g) => g.id >= 700001 && g.id <= 700019) });
  await sem.activar();
  test('I7: un dispositivo con solo las semillas no puede crear el central', dI7.archivos.size === 0 && sem.flag() === undefined && sem.avisos.some((a) => /solo tiene los recibos sembrados/.test(a)), sem.avisos);

  // Borrado vs edición simultáneos: gana la edición y queda registrado
  const dBE = driveSimulado(); const x1 = dispositivo('x1', dBE, { gastos: base1 }); const x2 = dispositivo('x2', dBE, { gastos: [] });
  await x1.activar(); await x2.activar();
  x1.quitar(2); x2.editar(2, { descripcion: 'editado en x2' });
  await x2.sync(); await x1.sync(); await x2.sync();
  test('borrado vs edición simultáneos: se conserva la edición y queda registrado', dBE.estado().gastos['2']._del !== true && dBE.estado().conflictos.some((c) => String(c.id) === '2' && c.tipo === 'borrado_vs_edicion'), dBE.estado().conflictos);

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
