// Fuente central única de Arroyo 132 — PROTOTIPO LOCAL (2026-11-01). No está conectado a la app ni a datos reales.
// Idea: UN documento canónico (estado v5) que cada dispositivo LEE al abrir y MODIFICA con escritura condicional
// (compare-and-swap) + fusión por registro con versión. El almacén es un adaptador intercambiable:
//   · Drive (reutiliza la integración existente; token = headRevisionId)  · Vercel Blob (ifMatch/ETag)  · memoria (pruebas).
// Reglas que no se rompen: nunca se borra un registro (se marca _del), nunca se escribe si el resultado tiene menos
// registros que el estado leído, una escritura obsoleta se rechaza y se reintenta, los conflictos se registran.
'use strict';

const r2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const claveContenido = (g) => norm(g.contratista) + '|' + g.fecha + '|' + Math.round((Number(g.monto) || 0) * 100);

function nuevoEstado() { return { version: 5, rev: 0, actualizado: null, gastos: {}, conflictos: [], migracion: null }; }

// --- migración v4 (lista de gastos del respaldo del celular) → v5 (mapa por id con versión). No modifica la entrada.
function migrarAV5(v4, { origen = 'migracion', ahora = new Date().toISOString() } = {}) {
  const e = nuevoEstado();
  const lista = Array.isArray(v4 && v4.gastos) ? v4.gastos : [];
  for (const g of lista) {
    if (g == null || typeof g !== 'object') continue;
    const id = String(g.id);
    if (e.gastos[id]) { e.conflictos.push({ tipo: 'id_repetido_en_origen', id, descartado: g }); continue; }
    e.gastos[id] = Object.assign({}, g, { id: g.id, _v: 1, _t: g.modificado || (v4.fecha || ahora), _o: origen });
  }
  for (const k of ['viajes', 'servicios', 'contratistas', 'docs', 'timeline', 'presupuesto', 'recibos', 'fotos', 'tucoop', 'fin']) if (v4[k] !== undefined) e[k] = JSON.parse(JSON.stringify(v4[k]));
  e.migracion = { desde: 'v4', fecha: ahora, gastosOrigen: lista.length };
  return e;
}

// --- Incorporar un perfil LOCAL antiguo (sin versiones) a un estado central, sin perder nada y sin duplicar.
// Un registro local sin _v que ya existe en el central (mismo id y mismo contenido, o mismo contenido bajo otro id) NO se añade;
// si coincide el id pero el contenido difiere, gana el central y la diferencia queda en `conflictos` para revisión documental.
function incorporarPerfilLocal(central, local, { origen = 'local', ahora = new Date().toISOString() } = {}) {
  const sal = JSON.parse(JSON.stringify(central));
  const porClave = new Map(Object.values(sal.gastos).map((g) => [claveContenido(g), g]));
  const informe = { anadidos: [], duplicadosOtroId: [], conflictosMismoId: [], identicos: [] };
  for (const g of (local && local.gastos) || []) {
    if (g == null || typeof g !== 'object') continue;
    const id = String(g.id);
    const existente = sal.gastos[id];
    const k = claveContenido(g);
    if (existente) {
      if (claveContenido(existente) === k && Math.abs(Number(existente.monto) - Number(g.monto)) < 0.005) { informe.identicos.push(id); continue; }
      if (porClave.has(k)) { informe.duplicadosOtroId.push({ idLocal: id, idCentral: String(porClave.get(k).id) }); continue; }
      sal.conflictos.push({ tipo: 'mismo_id_distinto_contenido', id, central: existente, local: g, fecha: ahora });
      informe.conflictosMismoId.push({ id, central: Number(existente.monto), local: Number(g.monto) });
      continue;
    }
    if (porClave.has(k)) { informe.duplicadosOtroId.push({ idLocal: id, idCentral: String(porClave.get(k).id) }); continue; }
    sal.gastos[id] = Object.assign({}, g, { _v: 1, _t: ahora, _o: origen });
    porClave.set(k, sal.gastos[id]);
    informe.anadidos.push(id);
  }
  return { estado: sal, informe };
}

// --- Fusión por registro con versión: gana la versión mayor; a igualdad, la marca de tiempo; a igualdad, el origen (determinista).
function fusionar(a, b) {
  const sal = JSON.parse(JSON.stringify(a));
  sal.conflictos = (a.conflictos || []).slice();
  for (const [id, rb] of Object.entries(b.gastos || {})) {
    const ra = sal.gastos[id];
    if (!ra) { sal.gastos[id] = JSON.parse(JSON.stringify(rb)); continue; }
    const va = ra._v || 0, vb = rb._v || 0;
    const gana = vb > va || (vb === va && (String(rb._t) > String(ra._t) || (String(rb._t) === String(ra._t) && String(rb._o) > String(ra._o))));
    const mismoContenido = JSON.stringify(strip(ra)) === JSON.stringify(strip(rb));
    if (!mismoContenido) sal.conflictos.push({ tipo: 'edicion_concurrente', id, ganador: gana ? rb._o : ra._o, perdedor: gana ? strip(ra) : strip(rb), fecha: new Date().toISOString() });
    if (gana) sal.gastos[id] = JSON.parse(JSON.stringify(rb));
  }
  for (const k of ['viajes', 'servicios', 'contratistas', 'docs', 'timeline', 'presupuesto', 'recibos', 'fotos', 'tucoop', 'fin']) {
    if (k === 'recibos' || k === 'fotos') sal[k] = Object.assign({}, b[k] || {}, a[k] || {});
    else if (sal[k] === undefined && b[k] !== undefined) sal[k] = JSON.parse(JSON.stringify(b[k]));
  }
  sal.rev = Math.max(a.rev || 0, b.rev || 0);
  return sal;
}
const strip = (r) => { const c = Object.assign({}, r); delete c._v; delete c._t; delete c._o; return c; };

// --- Operaciones sobre registros (siempre suben la versión; borrar = lápida, nunca eliminación física)
function guardarGasto(estado, gasto, origen, ahora = new Date().toISOString()) {
  const id = String(gasto.id); const prev = estado.gastos[id];
  estado.gastos[id] = Object.assign({}, gasto, { _v: (prev ? prev._v || 0 : 0) + 1, _t: ahora, _o: origen });
  return estado;
}
function borrarGasto(estado, id, origen, ahora = new Date().toISOString()) {
  const prev = estado.gastos[String(id)]; if (!prev) return estado;
  estado.gastos[String(id)] = Object.assign({}, prev, { _del: true, _v: (prev._v || 0) + 1, _t: ahora, _o: origen });
  return estado;
}
const vigentes = (estado) => Object.values(estado.gastos).filter((g) => !g._del);
function resumen(estado) { const v = vigentes(estado); return { gastos: v.length, suma: r2(v.reduce((s, g) => s + (Number(g.monto) || 0), 0)), idsUnicos: new Set(v.map((g) => String(g.id))).size, lapidas: Object.keys(estado.gastos).length - v.length }; }

// --- Escritura condicional con reintento. `almacen`: { leer() → {estado, token}, escribir(estado, tokenEsperado) → {ok, token?} }
async function actualizar(almacen, mutador, { intentos = 5, maxEsperaMs = 0 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const { estado: leido, token } = await almacen.leer();
    const base = leido ? JSON.parse(JSON.stringify(leido)) : nuevoEstado();
    const antes = Object.keys(base.gastos).length;
    const nuevo = mutador(JSON.parse(JSON.stringify(base)));
    // Guarda de no-regresión: el estado nunca pierde registros (los borrados son lápidas).
    if (Object.keys(nuevo.gastos).length < antes) throw new Error('rechazado: la escritura perdería ' + (antes - Object.keys(nuevo.gastos).length) + ' registro(s)');
    nuevo.rev = (base.rev || 0) + 1; nuevo.actualizado = new Date().toISOString();
    const r = await almacen.escribir(nuevo, token);
    if (r && r.ok) return { estado: nuevo, token: r.token, intentos: i + 1 };
    if (maxEsperaMs) await new Promise((res) => setTimeout(res, Math.random() * maxEsperaMs));
  }
  throw new Error('no se pudo escribir: conflicto de versión persistente');
}

// --- Instantánea diaria inmutable: nunca sobrescribe una existente.
async function instantaneaDiaria(almacenSnap, estado, dia) {
  const nombre = 'arroyo132-snap-' + dia + '.json';
  if (await almacenSnap.existe(nombre)) return { creada: false, nombre };
  await almacenSnap.crear(nombre, JSON.stringify(estado));
  return { creada: true, nombre };
}

// --- Almacén en memoria (pruebas) con token de versión y posibilidad de inyectar carreras
function almacenMemoria(inicial = null) {
  let doc = inicial ? JSON.parse(JSON.stringify(inicial)) : null; let ver = 0; const a = { escrituras: 0, rechazos: 0, antesDeEscribir: null };
  a.leer = async () => ({ estado: doc ? JSON.parse(JSON.stringify(doc)) : null, token: String(ver) });
  a.escribir = async (estado, tokenEsperado) => {
    if (a.antesDeEscribir) { const f = a.antesDeEscribir; a.antesDeEscribir = null; await f(); }
    if (String(ver) !== String(tokenEsperado)) { a.rechazos++; return { ok: false }; }
    doc = JSON.parse(JSON.stringify(estado)); ver++; a.escrituras++; return { ok: true, token: String(ver) };
  };
  a.actual = () => (doc ? JSON.parse(JSON.stringify(doc)) : null);
  return a;
}

module.exports = { nuevoEstado, migrarAV5, incorporarPerfilLocal, fusionar, guardarGasto, borrarGasto, vigentes, resumen, actualizar, instantaneaDiaria, almacenMemoria, claveContenido };
