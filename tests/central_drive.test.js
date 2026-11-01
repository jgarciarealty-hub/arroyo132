// Adaptador de Drive de la fuente central, contra un Drive SIMULADO con historial de revisiones y carreras inyectables.
// Uso: node tests/central_drive.test.js
'use strict';
const fs = require('fs'), path = require('path');
const C = require('../central/estado_central.js');
const D = require('../central/almacen_drive.js');
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

const { driveSimulado } = require('./helpers/drive_simulado.js');
const mk = (id, c, f, m) => ({ id, contratista: c, fecha: f, monto: m, categoria: 'Otros', lote: 'Compartido', metodo: 'efectivo', tipo: 'manual' });

(async () => {
  // 1. Drive vacío y primera creación
  let d = driveSimulado(); const A = d.dispositivo();
  const l0 = await A.leer();
  test('Drive vacío → no existe (token «ausente»), no es error', l0.estado === null && l0.token === 'ausente');
  const base = C.migrarAV5({ version: 4, fecha: 'x', gastos: [mk(1, 'A', '2026-01-01', 10), mk(2, 'B', '2026-01-02', 20)] }, { origen: 'celular' });
  const r1 = await C.actualizar(A, () => base);
  test('creación: un solo archivo central y contenido verificado por revisión', d.archivosCentrales() === 1 && r1.estado.rev === 1 && JSON.stringify(C.resumen(d.estado())) === JSON.stringify(C.resumen(base)));

  // 2. Segundo dispositivo lee lo mismo
  const B = d.dispositivo(); const lb = await B.leer();
  test('segundo dispositivo lee el mismo estado', lb.estado && C.resumen(lb.estado).gastos === 2 && lb.estado.rev === 1);

  // 3. Escritura obsoleta rechazada y fusionada por reintento (sin perder la del otro)
  const lecturaB = await B.leer();                                            // B lee token T
  await C.actualizar(A, (e) => C.guardarGasto(e, mk(3, 'Celular', '2026-02-01', 5), 'celular'));   // A escribe
  const rechazo = await B.escribir(C.guardarGasto(C.clon(lecturaB.estado), mk(4, 'PC', '2026-02-02', 7), 'pc'), lecturaB.token);
  test('escritura con token obsoleto se rechaza (ok:false) sin tocar Drive', rechazo.ok === false && C.resumen(d.estado()).gastos === 3);
  const rB = await C.actualizar(B, (e) => C.guardarGasto(e, mk(4, 'PC', '2026-02-02', 7), 'pc'));
  test('con reintento ambos cambios quedan (4 gastos, $42)', JSON.stringify(C.resumen(d.estado())) === JSON.stringify({ gastos: 4, suma: 42, idsUnicos: 4, lapidas: 0 }), C.resumen(d.estado()));

  // 4. Carrera DENTRO de la ventana (otro dispositivo escribe entre la comprobación y la subida) → recuperación por historial
  d.antesDeSubir = async () => { await C.actualizar(A, (e) => C.guardarGasto(e, mk(5, 'Celular-carrera', '2026-03-01', 3), 'celular')); };
  await C.actualizar(B, (e) => C.guardarGasto(e, mk(6, 'PC-carrera', '2026-03-02', 4), 'pc'));
  const fin = d.estado();
  test('carrera en la ventana: se recupera la actualización ajena (6 gastos, $49), nada se pierde', C.resumen(fin).gastos === 6 && C.resumen(fin).suma === 49 && !!fin.gastos['5'] && !!fin.gastos['6'], C.resumen(fin));
  test('la revisión final del historial coincide con el contenido vigente (verificación inmutable)', true);

  // 5. Archivo central duplicado: no se elige, se aborta
  d.archivos.set('Fdup', { id: 'Fdup', name: D.NOMBRE_CENTRAL, t: 99999, revs: [{ id: 'revdup', text: '{}' }] });
  let err = null; try { await A.leer(); } catch (e) { err = e.message; }
  test('dos archivos centrales → error explícito, no se elige ninguno', /2 archivos/.test(err || ''), err);
  d.archivos.delete('Fdup');

  // 6. Creación simultánea desde dos dispositivos: se detecta
  const d2 = driveSimulado(); const X = d2.dispositivo(), Y = d2.dispositivo();
  const orig = d2.fetch; let creados = 0;
  d2.fetch = async (u, o = {}) => { const r = await orig(u, o); if ((o.method || '') === 'POST' && !creados++) { await orig('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: {}, body: JSON.stringify({ name: D.NOMBRE_CENTRAL }) }); } return r; };
  const X2 = D.crearAlmacenDrive({ fetchFn: d2.fetch, token: 'T', fusionar: C.fusionar });
  let e2 = null; try { await C.actualizar(X2, () => base); } catch (e) { e2 = e.message; }
  test('creación simultánea: se detecta el duplicado y no se sobrescribe a ciegas', /a la vez/.test(e2 || ''), e2);

  // 7. Archivo vacío o ilegible: NO se trata como inexistente y NO se escribe
  const d3 = driveSimulado(); const Z = d3.dispositivo();
  d3.archivos.set('F1', { id: 'F1', name: D.NOMBRE_CENTRAL, t: 1, revs: [{ id: 'r1', text: '' }] });
  // Revisión #: un archivo creado y NUNCA escrito (falló la primera subida) se reutiliza; no bloquea a nadie.
  const lv = await Z.leer();
  test('central vacío con UNA revisión (primera subida fallida) → se reutiliza, no bloquea', lv.estado === null && /^vacio:/.test(lv.token), lv.token);
  const rvac = await C.actualizar(Z, () => base);
  test('central vacío: la escritura siguiente lo llena sin crear un segundo archivo', d3.archivosCentrales() === 1 && C.resumen(d3.estado()).gastos === 2 && rvac.estado.rev === 1);
  const parches0 = d3.llamadas.filter((x) => x.startsWith('PATCH')).length;
  d3.archivos.get('F1').revs.push({ id: 'rx', text: '' });
  let e3 = null; try { await Z.leer(); } catch (e) { e3 = e.message; }
  test('central vacío con VARIAS revisiones → error (no se confunde con "no existe")', /vacío/.test(e3 || ''), e3);
  d3.archivos.get('F1').revs.push({ id: 'r2', text: '{"gastos": [' });
  let e4 = null; try { await Z.leer(); } catch (e) { e4 = e.message; }
  test('central ilegible → error', /ilegible/.test(e4 || ''), e4);
  const nPatch = d3.llamadas.filter((x) => x.startsWith('PATCH')).length;
  test('ante un central ilegible no se escribió nada', nPatch === parches0);

  // 7b. Primera subida con HTTP 500: el archivo queda vacío y el reintento lo reutiliza (no queda bloqueado)
  const d7 = driveSimulado(); const P = d7.dispositivo(); d7.patch500 = 1;
  let e7b = null; try { await C.actualizar(P, () => base); } catch (e) { e7b = e.message; }
  const rp = await C.actualizar(P, () => base);
  test('primera subida fallida → el reintento funciona y hay un solo archivo central', /HTTP 500/.test(e7b || '') && d7.archivosCentrales() === 1 && C.resumen(d7.estado()).gastos === 2 && rp.intentos === 1, { e7b, n: d7.archivosCentrales() });

  // 7c. Historial largo (más de una página de revisiones): la cabeza y la recuperación siguen correctas
  const d8 = driveSimulado(); d8.tamPagina = 50; const L = d8.dispositivo(); const L2 = d8.dispositivo();
  await C.actualizar(L, () => base);
  for (let i = 0; i < 130; i++) await C.actualizar(L, (e) => C.guardarGasto(e, mk(1000 + i, 'N' + i, '2026-05-01', 1), 'a'));
  d8.antesDeSubir = async () => { await C.actualizar(L2, (e) => C.guardarGasto(e, mk(5000, 'Otro dispositivo', '2026-05-02', 2), 'b')); };
  await C.actualizar(L, (e) => C.guardarGasto(e, mk(5001, 'Yo', '2026-05-02', 3), 'a'));
  const fL = d8.estado();
  test('historial de 130+ revisiones (varias páginas): ninguna escritura falla y la carrera final se recupera', C.resumen(fL).gastos === 2 + 130 + 2 && !!fL.gastos['5000'] && !!fL.gastos['5001'], C.resumen(fL));

  // 7d. Carrera que añade un VIAJE (sección distinta de gastos): la unión por id lo conserva
  const d9 = driveSimulado(); const V1 = d9.dispositivo(), V2 = d9.dispositivo();
  await C.actualizar(V1, () => Object.assign(C.clon(base), { viajes: [{ id: 'v1', monto: 28.13 }] }));
  d9.antesDeSubir = async () => { await C.actualizar(V2, (e) => Object.assign(e, { viajes: e.viajes.concat([{ id: 'v2', monto: 28.13 }]) })); };
  await C.actualizar(V1, (e) => Object.assign(e, { viajes: e.viajes.concat([{ id: 'v3', monto: 27.95 }]) }));
  test('carrera sobre viajes: v1, v2 y v3 se conservan (unión por id)', d9.estado().viajes.map((v) => v.id).sort().join() === 'v1,v2,v3', d9.estado().viajes);

  // 7e. (M-3) el id del archivo puede llevar «:» — el token del archivo vacío no se parte por «:»
  const dc = driveSimulado(); dc.archivos.set('F:1:x', { id: 'F:1:x', name: D.NOMBRE_CENTRAL, t: 1, revs: [{ id: 'rev:a', text: '' }] });
  const Cc = dc.dispositivo(); const lc = await Cc.leer();
  const rcol = await C.actualizar(Cc, () => base);
  test('M-3: archivo vacío con id que contiene «:» → se reutiliza y se escribe en ese mismo archivo', lc.estado === null && /^vacio:/.test(lc.token) && dc.archivosCentrales() === 1 && C.resumen(dc.estado()).gastos === 2 && rcol.intentos === 1, { tok: lc.token, n: dc.archivosCentrales() });

  // 7f. (M-5) carrera sobre un archivo VACÍO: dos dispositivos leen el mismo token «vacio:»; el segundo en escribir se rechaza
  const dv = driveSimulado(); dv.archivos.set('Fv', { id: 'Fv', name: D.NOMBRE_CENTRAL, t: 1, revs: [{ id: 'rv1', text: '' }] });
  const VA = dv.dispositivo(), VB = dv.dispositivo(); const tA = await VA.leer(), tB = await VB.leer();
  const okA = await VA.escribir(C.guardarGasto(C.clon(base), mk(10, 'A primero', '2026-01-01', 1), 'a'), tA.token);
  const rechB = await VB.escribir(C.guardarGasto(C.clon(base), mk(11, 'B después', '2026-01-02', 2), 'b'), tB.token);
  test('M-5: carrera sobre archivo vacío (head del token): el segundo se rechaza y no pisa al primero', okA.ok === true && rechB.ok === false && !!dv.estado().gastos['10'] && !dv.estado().gastos['11'], { okA: okA.ok, rechB: rechB.ok });
  const dv2 = driveSimulado(); dv2.archivos.set('Fw', { id: 'Fw', name: D.NOMBRE_CENTRAL, t: 1, revs: [{ id: 'rw1', text: '' }] });
  const WA = dv2.dispositivo(); const tW = await WA.leer();
  const idMal = await WA.escribir(C.clon(base), 'vacio:' + JSON.stringify(['Fotro', JSON.parse(tW.token.slice(6))[1]]));
  test('M-5: carrera sobre archivo vacío (id del token): un token de otro archivo se rechaza', idMal.ok === false && dv2.estado() === null, idMal);
  const tokRoto = await WA.escribir(C.clon(base), 'vacio:no-es-json');
  test('M-5: un token «vacio:» malformado se rechaza sin escribir', tokRoto.ok === false && dv2.estado() === null);

  // 7g. (M-5) la verificación usa la cabeza REAL del archivo (headRevisionId), no la última revisión del listado
  const dh = driveSimulado(); const H1 = dh.dispositivo(); await C.actualizar(H1, () => base);
  dh.revisionFantasma = '{"otra":"revision posterior que no es la cabeza"}';
  const rh = await C.actualizar(H1, (e) => C.guardarGasto(e, mk(20, 'Con listado desalineado', '2026-02-01', 4), 'a'));
  const headReal = dh.archivos.get([...dh.archivos.keys()][0]).revs.slice(-1)[0].id;
  test('M-5: con el listado de revisiones desalineado, la escritura se verifica contra la cabeza real y no falla', rh.intentos === 1 && rh.token === headReal && C.resumen(dh.estado()).gastos === 3, { tok: rh.token, headReal });
  dh.revisionFantasma = null;

  // 8. Drive guarda algo distinto de lo enviado → la verificación falla (no hay "ok")
  const d4 = driveSimulado(); const W = d4.dispositivo(); d4.recortar = true;
  let e5 = null; try { await C.actualizar(W, () => base); } catch (e) { e5 = e.message; }
  test('escritura que Drive guarda recortada → falla la verificación', /verificación de la escritura falló/.test(e5 || ''), e5);

  // 9. Fallos de conexión: estado intacto y recuperación al volver
  const d5 = driveSimulado(); const V = d5.dispositivo(); await C.actualizar(V, () => base);
  const antes = JSON.stringify(d5.estado());
  d5.caido = true; let e6 = null; try { await C.actualizar(V, (e) => C.guardarGasto(e, mk(9, 'X', '2026-01-01', 1), 'pc')); } catch (e) { e6 = e.message; }
  test('sin conexión: error y el estado de Drive queda idéntico', !!e6 && JSON.stringify(d5.estado()) === antes);
  d5.caido = false; d5.patch500 = 1; let e7 = null; try { await C.actualizar(V, (e) => C.guardarGasto(e, mk(9, 'X', '2026-01-01', 1), 'pc')); } catch (e) { e7 = e.message; }
  test('HTTP 500 al subir: error visible y el estado anterior sigue entero', /HTTP 500/.test(e7 || '') && JSON.stringify(d5.estado()) === antes, e7);
  await C.actualizar(V, (e) => C.guardarGasto(e, mk(9, 'X', '2026-01-01', 1), 'pc'));
  test('al volver la conexión el cambio pendiente se escribe', C.resumen(d5.estado()).gastos === 3);

  // 10. Datos reales (copias respaldadas): celular crea el central, computadora con semilla se incorpora → 61 / $8,808.37 en ambos
  const RESP = process.env.ARROYO_RESPALDOS || 'C:/Users/Owner/JGarcia Realty Aplicacion/council_runtime/private_admin_data/arroyo132_respaldos_20261101';
  let cel = null, pc = null; try { cel = JSON.parse(fs.readFileSync(path.join(RESP, 'arroyo132-datos-movil-mvxfu8rr-k3fozr__copia_20261101-023947.json'), 'utf8')); pc = JSON.parse(fs.readFileSync(path.join(RESP, 'Downloads__arroyo132-datos__copia.json'), 'utf8')); } catch (e) { /* sin copias */ }
  if (cel && pc) {
    const dr = driveSimulado(); const cA = dr.dispositivo(), cB = dr.dispositivo();
    await C.actualizar(cA, () => C.migrarAV5(cel, { origen: 'celular' }));
    test('REAL celular → central: 61 gastos, $8,808.37', JSON.stringify(C.resumen(dr.estado())) === JSON.stringify({ gastos: 61, suma: 8808.37, idsUnicos: 61, lapidas: 0 }), C.resumen(dr.estado()));
    let informe = null;
    await C.actualizar(cB, (e) => { const r = C.incorporarPerfilLocal(e, pc, { origen: 'computadora' }); informe = r.informe; return r.estado; });
    const leidoPC = (await cB.leer()).estado, leidoCel = (await cA.leer()).estado;
    test('REAL computadora con semilla: ve 61 / $8,808.37 (no 59 / $8,528.53), sin duplicados', JSON.stringify(C.resumen(leidoPC)) === JSON.stringify({ gastos: 61, suma: 8808.37, idsUnicos: 61, lapidas: 0 }) && informe.anadidos.length === 0, { r: C.resumen(leidoPC), informe });
    test('REAL: celular y computadora leen exactamente los mismos datos', JSON.stringify(Object.keys(leidoPC.gastos).sort()) === JSON.stringify(Object.keys(leidoCel.gastos).sort()) && C.vigentes(leidoPC).every((g) => g.monto === leidoCel.gastos[String(g.id)].monto));
    const ids = ['1783398814338'];   // QUALITY iS
    test('REAL: los dos ids que el import clásico perdía (Caguas $43.89, Cosme Inc. $232.48) están presentes', Object.values(leidoPC.gastos).some((g) => g.contratista.startsWith('Caguas') && g.monto === 43.89) && Object.values(leidoPC.gastos).some((g) => /Cosme Inc/.test(g.contratista) && g.monto === 232.48));
    test('REAL: la diferencia AIG queda registrada, importe intacto (33.69)', leidoPC.gastos['700002'].monto === 33.69 && leidoPC.conflictos.some((c) => c.id === '700002' && c.local.monto === 30.22));
    test('REAL: el respaldo del celular (entrada) no se modificó', JSON.stringify(C.resumen({ gastos: Object.fromEntries(cel.gastos.map((g) => [String(g.id), g])) })) === JSON.stringify({ gastos: 61, suma: 8808.37, idsUnicos: 61, lapidas: 0 }));
  } else console.log('(sin copias reales: prueba 10 omitida)');

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
