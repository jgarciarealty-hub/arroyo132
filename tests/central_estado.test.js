// Pruebas de la fuente central (prototipo): migración sin pérdida, perfil antiguo sin duplicar, concurrencia, lápidas, guardas.
// Usa COPIAS respaldadas de los datos reales si existen (solo lectura); si no, sintéticos. Uso: node tests/central_estado.test.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require('../central/estado_central.js');
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };
const RESP = process.env.ARROYO_RESPALDOS || 'C:/Users/Owner/JGarcia Realty Aplicacion/council_runtime/private_admin_data/arroyo132_respaldos_20261101';
const leer = (n) => { try { return fs.readFileSync(path.join(RESP, n)); } catch (e) { return null; } };
const bufCel = leer('arroyo132-datos-movil-mvxfu8rr-k3fozr__copia_20261101-023947.json');
const bufPC = leer('Downloads__arroyo132-datos__copia.json');

(async () => {
  // ── Datos reales (copias) o sintéticos equivalentes ──
  let celular, pc;
  if (bufCel && bufPC) { celular = JSON.parse(bufCel.toString('utf8')); pc = JSON.parse(bufPC.toString('utf8')); console.log('(usando copias respaldadas de los datos reales)'); }
  else {
    const mk = (id, c, f, m) => ({ id, contratista: c, fecha: f, monto: m, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', tipo: 'manual' });
    const sem = [mk(700001, 'A', '2026-04-15', 10), mk(700002, 'B', '2026-04-13', 30.22), mk(700010, 'Excavadora', '2025-04-20', 1500)];
    celular = { version: 4, fecha: '2026-11-01T06:17:00Z', gastos: [mk(700001, 'A', '2026-04-15', 10), mk(700002, 'B', '2026-04-13', 33.69), mk(1781664550113, 'Excavadora', '2025-04-20', 1500), mk(700010, 'Cosme', '2026-04-28', 232.48)] };
    pc = { version: 3, gastos: sem };
    console.log('(sintéticos: no hay copias reales en esta máquina)');
  }
  const nCel = celular.gastos.length, sumaCel = C.resumen({ gastos: Object.fromEntries(celular.gastos.map((g) => [String(g.id), g])) }).suma;

  // 1. Migración v4 → v5 sin pérdida, sin tocar la entrada
  const hashAntes = crypto.createHash('sha256').update(JSON.stringify(celular)).digest('hex');
  const central = C.migrarAV5(celular, { origen: 'movil', ahora: '2026-11-01T12:00:00Z' });
  const r1 = C.resumen(central);
  test('migración: mismos gastos e importes que el celular (' + nCel + ' / $' + sumaCel + ')', r1.gastos === nCel && r1.suma === sumaCel && r1.idsUnicos === nCel && r1.lapidas === 0, r1);
  test('migración: la entrada v4 no se modifica (reversible: el original sigue intacto)', crypto.createHash('sha256').update(JSON.stringify(celular)).digest('hex') === hashAntes);
  test('migración: idempotente', JSON.stringify(C.migrarAV5(celular, { origen: 'movil', ahora: '2026-11-01T12:00:00Z' })) === JSON.stringify(central));
  if (bufCel) test('migración real: 61 gastos por $8,808.37 exactos', r1.gastos === 61 && r1.suma === 8808.37, r1);

  // 2. Perfil antiguo de la computadora (solo semilla) → NO duplica, NO pierde, NO cambia importes del central
  const { estado: trasPC, informe } = C.incorporarPerfilLocal(central, pc, { origen: 'computadora' });
  const r2 = C.resumen(trasPC);
  test('perfil antiguo: el total sigue siendo el del celular (sin duplicar ni perder)', r2.gastos === r1.gastos && r2.suma === r1.suma, { r1, r2 });
  test('perfil antiguo: ningún importe del central cambió', Object.keys(central.gastos).every((id) => trasPC.gastos[id].monto === central.gastos[id].monto));
  test('perfil antiguo: las semillas con otro id se reconocen como duplicados (no se añaden)', informe.anadidos.length === 0, informe);
  test('perfil antiguo: cada diferencia de importe queda registrada para revisión documental', informe.conflictosMismoId.every((c) => trasPC.conflictos.some((x) => x.id === c.id)), informe.conflictosMismoId);
  if (bufPC) {
    const aig = informe.conflictosMismoId.find((c) => c.id === '700002');
    test('real: AIG se registra (central 33.69 vs semilla 30.22) sin modificar el importe', !!aig && aig.central === 33.69 && aig.local === 30.22 && trasPC.gastos['700002'].monto === 33.69, aig);
    test('real: 700010/700011 de la semilla se reconocen como duplicados de otros ids del celular', informe.duplicadosOtroId.some((d) => d.idLocal === '700010') && informe.duplicadosOtroId.some((d) => d.idLocal === '700011'), informe.duplicadosOtroId);
  }
  const trasPC2 = C.incorporarPerfilLocal(trasPC, pc, { origen: 'computadora' });
  test('perfil antiguo: repetir la incorporación no cambia nada (idempotente)', JSON.stringify(C.resumen(trasPC2.estado)) === JSON.stringify(r2) && trasPC2.informe.anadidos.length === 0);

  // 3. Concurrencia: dos dispositivos escriben a la vez en registros distintos → ambos se conservan (CAS + reintento)
  const base = C.migrarAV5({ version: 4, fecha: 'x', gastos: [{ id: 1, contratista: 'A', fecha: '2026-01-01', monto: 10 }, { id: 2, contratista: 'B', fecha: '2026-01-02', monto: 20 }] }, { origen: 'base' });
  const alm = C.almacenMemoria(base);
  alm.antesDeEscribir = async () => { await C.actualizar(alm, (e) => C.guardarGasto(e, { id: 3, contratista: 'Celular', fecha: '2026-02-01', monto: 5 }, 'movil')); };   // el celular se cuela
  const resPC = await C.actualizar(alm, (e) => C.guardarGasto(e, { id: 4, contratista: 'PC', fecha: '2026-02-02', monto: 7 }, 'computadora'));
  const fin = C.resumen(alm.actual());
  test('concurrencia: la escritura obsoleta se rechaza y se reintenta (1 rechazo, 2 intentos)', alm.rechazos === 1 && resPC.intentos === 2, { rechazos: alm.rechazos, intentos: resPC.intentos });
  test('concurrencia: no se pierde ninguna de las dos altas (4 gastos, $42)', fin.gastos === 4 && fin.suma === 42, fin);

  // 4. Edición concurrente del MISMO registro: gana la versión mayor y el perdedor queda registrado
  const A = C.guardarGasto(JSON.parse(JSON.stringify(base)), { id: 1, contratista: 'A', fecha: '2026-01-01', monto: 11 }, 'movil', '2026-11-02T10:00:00Z');
  const B = C.guardarGasto(JSON.parse(JSON.stringify(base)), { id: 1, contratista: 'A', fecha: '2026-01-01', monto: 12 }, 'computadora', '2026-11-02T10:05:00Z');
  const F = C.fusionar(A, B), F2 = C.fusionar(B, A);
  test('mismo registro: resultado determinista sin importar el orden', F.gastos['1'].monto === 12 && F2.gastos['1'].monto === 12);
  test('mismo registro: la versión perdedora no se pierde (queda en conflictos)', F.conflictos.some((c) => c.id === '1' && c.perdedor.monto === 11));

  // 5. Lápidas: borrar se propaga y nunca elimina físicamente
  const conBorrado = C.borrarGasto(JSON.parse(JSON.stringify(base)), 2, 'movil', '2026-11-03T09:00:00Z');
  const otro = C.fusionar(base, conBorrado);
  test('lápida: el borrado se propaga al otro dispositivo', C.resumen(otro).gastos === 1 && otro.gastos['2']._del === true);
  test('lápida: el registro sigue existiendo (recuperable)', !!otro.gastos['2'] && otro.gastos['2'].monto === 20);
  const reviveViejo = C.fusionar(conBorrado, base);
  test('lápida: un dispositivo atrasado NO resucita lo borrado', C.resumen(reviveViejo).gastos === 1);

  // 6. Guarda de no-regresión
  let rechazo = null; try { await C.actualizar(C.almacenMemoria(base), (e) => { delete e.gastos['1']; return e; }); } catch (e) { rechazo = e.message; }
  test('guarda: una escritura que perdería registros se rechaza y no escribe', /perdería 1 registro/.test(rechazo || ''), rechazo);
  const almG = C.almacenMemoria(base); try { await C.actualizar(almG, (e) => { delete e.gastos['1']; return e; }); } catch (e) { /* esperado */ }
  test('guarda: el almacén queda intacto tras el rechazo', JSON.stringify(C.resumen(almG.actual())) === JSON.stringify(C.resumen(base)) && almG.escrituras === 0);

  // 7. Instantánea inmutable
  const snaps = new Map(); const almSnap = { existe: async (n) => snaps.has(n), crear: async (n, t) => { snaps.set(n, t); } };
  const s1 = await C.instantaneaDiaria(almSnap, base, '20261101'); const primero = snaps.get('arroyo132-snap-20261101.json');
  const s2 = await C.instantaneaDiaria(almSnap, C.guardarGasto(JSON.parse(JSON.stringify(base)), { id: 9, contratista: 'Z', fecha: '2026-01-01', monto: 1 }, 'x'), '20261101');
  test('instantánea: se crea una vez y nunca se sobrescribe', s1.creada && !s2.creada && snaps.get('arroyo132-snap-20261101.json') === primero);

  // 8. Compras legítimas idénticas (peajes de ida y vuelta): se cuentan por multiplicidad, no se fusionan por error
  const peaje = (id) => ({ id, contratista: 'Autoexpreso', fecha: '2026-06-24', monto: 28.13, categoria: 'Transportación', lote: 'Compartido', metodo: 'tarjeta', tipo: 'viaje' });
  const cen2 = C.migrarAV5({ version: 4, fecha: 'x', gastos: [peaje(1), peaje(2)] }, { origen: 'celular' });
  const r2x = C.incorporarPerfilLocal(cen2, { gastos: [peaje(11), peaje(12)] }, { origen: 'pc' });
  test('multiplicidad: 2 peajes idénticos en el central y 2 locales con otros ids → ambos son duplicados (no se añaden)', r2x.informe.duplicadosOtroId.length === 2 && r2x.informe.anadidos.length === 0 && C.resumen(r2x.estado).gastos === 2, r2x.informe);
  const r3x = C.incorporarPerfilLocal(cen2, { gastos: [peaje(11), peaje(12), peaje(13)] }, { origen: 'pc' });
  test('multiplicidad: un tercer peaje idéntico SÍ se añade (compra legítima distinta)', r3x.informe.anadidos.length === 1 && C.resumen(r3x.estado).gastos === 3, r3x.informe);
  const r1x = C.incorporarPerfilLocal(cen2, { gastos: [peaje(1), peaje(2)] }, { origen: 'pc' });
  test('multiplicidad: mismos ids e idénticos → no cambia nada', r1x.informe.identicos.length === 2 && C.resumen(r1x.estado).gastos === 2);
  const r0x = C.incorporarPerfilLocal(cen2, { gastos: [peaje(1), peaje(12)] }, { origen: 'pc' });
  test('multiplicidad: uno idéntico por id y otro con otro id → ninguno se añade', r0x.informe.identicos.length === 1 && r0x.informe.duplicadosOtroId.length === 1 && C.resumen(r0x.estado).gastos === 2, r0x.informe);

  // 9. Cobertura adicional pedida por la revisión independiente
  const refP = { driveId: 'ABCDEFGHIJ1', sha256: 'a'.repeat(64) }, refQ = { driveId: 'QRSTUVWXYZ2', sha256: 'b'.repeat(64) };
  const fa = Object.assign(C.nuevoEstado(), { recibos: { 1: refP } }), fb = Object.assign(C.nuevoEstado(), { recibos: { 2: refQ } });
  test('fusionar: las referencias de recibos de ambos lados se unen', Object.keys(C.fusionar(fa, fb).recibos).sort().join() === '1,2');
  const verBase = C.migrarAV5({ version: 4, fecha: 'x', gastos: [{ id: 1, contratista: 'A', fecha: '2026-01-01', monto: 1 }] }, { origen: 'a' });
  const verDos = C.guardarGasto(C.clon(verBase), { id: 1, contratista: 'A', fecha: '2026-01-01', monto: 2 }, 'a');
  test('verificarCentral: una versión MENOR de un registro esperado se rechaza', C.verificarCentral(verBase, { esperado: verDos }).ok === false);
  test('verificarCentral: acepta un estado válido y detecta un registro faltante', C.verificarCentral(verDos, { esperado: verBase }).ok === true && C.verificarCentral(C.nuevoEstado(), { esperado: verBase }).ok === false);
  const borrado = C.borrarGasto(C.clon(verBase), 1, 'a'); const revivido = C.guardarGasto(C.clon(borrado), { id: 1, contratista: 'A', fecha: '2026-01-01', monto: 1 }, 'b');
  test('guardarGasto sobre una lápida la revive con versión mayor (no hereda _del)', !revivido.gastos['1']._del && revivido.gastos['1']._v === borrado.gastos['1']._v + 1);
  test('unirListas: no descarta elementos y no duplica por id', C.unirListas([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((x) => x.id).join() === '1,2,3');
  const muchos = []; for (let i = 0; i < 300; i++) muchos.push({ tipo: 'x', id: i });
  test('conflictos: se acotan a 200 y no se repiten', C.acotarConflictos(muchos).length === 200 && C.acotarConflictos([{ tipo: 'x', id: 1 }, { tipo: 'x', id: 1 }]).length === 1);

  // Unión de secciones al incorporar un perfil local (M-5) y lápida de viajes (I-B)
  const cU = Object.assign(C.nuevoEstado(), { viajes: [{ id: 'v1', monto: 1 }], contratistas: [{ id: 'c1' }] });
  const uni = C.incorporarPerfilLocal(cU, { gastos: [], viajes: [{ id: 'v1', monto: 1 }, { id: 'v2', monto: 2 }], contratistas: [{ id: 'c1' }, { id: 'c2' }] }).estado;
  test('incorporarPerfilLocal: une las secciones por id (viajes y contratistas), sin duplicar ni descartar', uni.viajes.map((v) => v.id).join() === 'v1,v2' && uni.contratistas.map((v) => v.id).join() === 'c1,c2', { v: uni.viajes, c: uni.contratistas });
  const cB = Object.assign(C.nuevoEstado(), { viajes: [], viajesBorrados: ['v1'] });
  test('incorporarPerfilLocal: un viaje borrado en el central no resucita desde un perfil local antiguo', C.incorporarPerfilLocal(cB, { gastos: [], viajes: [{ id: 'v1' }, { id: 'v9' }] }).estado.viajes.map((v) => v.id).join() === 'v9');
  const fu = C.fusionar(Object.assign(C.nuevoEstado(), { viajes: [{ id: 'v1' }, { id: 'v2' }] }), Object.assign(C.nuevoEstado(), { viajes: [{ id: 'v2' }], viajesBorrados: ['v1'] }));
  test('fusionar: la lista viajesBorrados se une y quita el viaje de la unión por id', fu.viajes.map((v) => v.id).join() === 'v2' && fu.viajesBorrados.join() === 'v1', fu);
  const fu2 = C.fusionar(Object.assign(C.nuevoEstado(), { viajes: [], viajesBorrados: ['v1'] }), Object.assign(C.nuevoEstado(), { viajes: [{ id: 'v1' }] }));
  test('fusionar: simétrico — el viaje borrado en A no vuelve desde B', fu2.viajes.length === 0 && fu2.viajesBorrados.join() === 'v1');

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
