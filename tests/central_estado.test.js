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

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
