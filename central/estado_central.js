// Fuente central única de Arroyo 132 — núcleo puro (sin red, sin DOM). UMD: Node (pruebas) y navegador (window.A132Central).
// UN documento canónico (estado v5) que cada dispositivo LEE al abrir y MODIFICA con escritura condicional (compare-and-swap)
// + fusión por registro con versión. El almacén es un adaptador intercambiable (ver almacen_drive.js).
// Reglas que no se rompen: nunca se borra un registro (se marca _del), nunca se escribe un estado con menos registros que el leído,
// una escritura obsoleta se rechaza y se reintenta, los conflictos se registran y los importes NO se corrigen solos.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.A132Central = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const r2 = (n) => Math.round(n * 100) / 100;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const claveContenido = (g) => norm(g.contratista) + '|' + g.fecha + '|' + Math.round((Number(g.monto) || 0) * 100);
  const clon = (x) => JSON.parse(JSON.stringify(x));
  const SECCIONES = ['viajes', 'servicios', 'contratistas', 'docs', 'timeline', 'presupuesto', 'tucoop', 'fin'];

  function nuevoEstado() { return { version: 5, rev: 0, actualizado: null, gastos: {}, recibos: {}, conflictos: [], migracion: null, viajesBorrados: [] }; }
  const strip = (r) => { const c = Object.assign({}, r); delete c._v; delete c._t; delete c._o; delete c._del; return c; };
  const estable = (x) => (Array.isArray(x) ? x.map(estable) : (x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (o[k] = estable(x[k]), o), {}) : x));
  const igualContenido = (a, b) => JSON.stringify(estable(strip(a))) === JSON.stringify(estable(strip(b)));

  // Lista de ids de viajes borrados (lápida): evita que la unión por id resucite un viaje borrado en otro dispositivo.
  function aplicarViajesBorrados(e, extra) {
    const vb = new Set((e.viajesBorrados || []).concat(extra || []).map(String)); e.viajesBorrados = [...vb];
    if (Array.isArray(e.viajes)) e.viajes = e.viajes.filter((v) => !(v && typeof v === 'object' && v.id !== undefined && vb.has(String(v.id))));
    return e;
  }

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
    for (const k of SECCIONES) if (v4[k] !== undefined) e[k] = clon(v4[k]);
    if (v4.recibos && typeof v4.recibos === 'object') e.recibos = clon(v4.recibos);
    e.migracion = { desde: 'v4', fecha: ahora, gastosOrigen: lista.length };
    return e;
  }

  // --- Incorporar un perfil LOCAL antiguo (sin versiones) a un estado central, sin perder nada y sin duplicar.
  function incorporarPerfilLocal(central, local, { origen = 'local', ahora = new Date().toISOString() } = {}) {
    const sal = clon(central);
    // Multiconjunto por contenido: dos compras legítimas idénticas (p. ej. peajes de ida y vuelta el mismo día) cuentan DOS veces.
    const cuenta = new Map(); const usados = new Map();
    for (const g of Object.values(sal.gastos)) if (!g._del) { const k = claveContenido(g); cuenta.set(k, (cuenta.get(k) || 0) + 1); }
    const quedan = (k) => (cuenta.get(k) || 0) - (usados.get(k) || 0);
    const usar = (k) => usados.set(k, (usados.get(k) || 0) + 1);
    const idCentral = (k) => (Object.values(sal.gastos).find((g) => !g._del && claveContenido(g) === k) || {}).id;
    const informe = { anadidos: [], duplicadosOtroId: [], conflictosMismoId: [], identicos: [] };
    const lista = ((local && local.gastos) || []).filter((g) => g != null && typeof g === 'object');
    // Pasada 1: mismo id y mismo contenido → idéntico (consume una unidad del contenido).
    const pendientes = [];
    for (const g of lista) {
      const id = String(g.id), existente = sal.gastos[id], k = claveContenido(g);
      if (existente && !existente._del && claveContenido(existente) === k && Math.abs(Number(existente.monto) - Number(g.monto)) < 0.005) { informe.identicos.push(id); usar(k); }
      else pendientes.push(g);
    }
    // Pasada 2: el resto.
    for (const g of pendientes) {
      const id = String(g.id), existente = sal.gastos[id], k = claveContenido(g);
      if (quedan(k) > 0) { usar(k); informe.duplicadosOtroId.push({ idLocal: id, idCentral: String(idCentral(k)) }); continue; }
      if (existente) {
        sal.conflictos.push({ tipo: 'mismo_id_distinto_contenido', id, central: existente, local: g, fecha: ahora });
        informe.conflictosMismoId.push({ id, central: Number(existente.monto), local: Number(g.monto) });
        continue;
      }
      sal.gastos[id] = Object.assign({}, g, { _v: 1, _t: ahora, _o: origen });
      informe.anadidos.push(id);
    }
    for (const k of SECCIONES) if (sal[k] === undefined && local && local[k] !== undefined) sal[k] = clon(local[k]);
    if (local && local.recibos && typeof local.recibos === 'object') sal.recibos = Object.assign({}, limpiarRecibos(local.recibos), sal.recibos || {});
    for (const k of SECCIONES) if (Array.isArray(sal[k]) && local && Array.isArray(local[k])) sal[k] = unirListas(sal[k], local[k]);
    sal.conflictos = acotarConflictos(sal.conflictos);
    aplicarViajesBorrados(sal);
    return { estado: sal, informe };
  }

  function limpiarRecibos(o) {
    const s = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) Object.keys(o).forEach((k) => {
      const v = o[k];
      if (v && typeof v === 'object' && ((typeof v.driveId === 'string' && typeof v.sha256 === 'string') || (v.origen === 'externo' && Array.isArray(v.docs)))) s[k] = v;
    });
    return s;
  }

  // --- Fusión por registro con versión: gana la versión mayor; a igualdad, la marca de tiempo; a igualdad, el origen (determinista).
  function fusionar(a, b) {
    const sal = clon(a);
    sal.conflictos = (a.conflictos || []).slice();
    sal.recibos = Object.assign({}, limpiarRecibos(b.recibos), limpiarRecibos(a.recibos));
    for (const [id, rb] of Object.entries(b.gastos || {})) {
      const ra = sal.gastos[id];
      if (!ra) { sal.gastos[id] = clon(rb); continue; }
      const va = ra._v || 0, vb = rb._v || 0;
      const gana = vb > va || (vb === va && (String(rb._t) > String(ra._t) || (String(rb._t) === String(ra._t) && String(rb._o) > String(ra._o))));
      if (!(igualContenido(ra, rb) && !!ra._del === !!rb._del)) sal.conflictos.push({ tipo: 'edicion_concurrente', id, ganador: gana ? rb._o : ra._o, perdedor: gana ? strip(ra) : strip(rb), fecha: new Date().toISOString() });
      if (gana) sal.gastos[id] = clon(rb);
    }
    for (const k of SECCIONES) {
      if (sal[k] === undefined && b[k] !== undefined) sal[k] = clon(b[k]);
      else if (Array.isArray(sal[k]) && Array.isArray(b[k])) sal[k] = unirListas(sal[k], b[k]);   // viajes, contratistas, docs, timeline: unión por id
    }
    sal.conflictos = acotarConflictos(sal.conflictos);
    aplicarViajesBorrados(sal, b.viajesBorrados);
    sal.rev = Math.max(a.rev || 0, b.rev || 0);
    return sal;
  }

  // Unión de listas de objetos: por id si lo tienen; si no, por contenido. Nunca descarta un elemento.
  function unirListas(a, b) {
    const sal = a.slice(); const vistos = new Set(a.map((x) => (x && typeof x === 'object' && x.id !== undefined ? 'id:' + x.id : 'j:' + JSON.stringify(estable(x)))));
    for (const x of b) { const k = x && typeof x === 'object' && x.id !== undefined ? 'id:' + x.id : 'j:' + JSON.stringify(estable(x)); if (!vistos.has(k)) { vistos.add(k); sal.push(clon(x)); } }
    return sal;
  }
  // El registro de conflictos no crece sin límite ni repite el mismo conflicto.
  function acotarConflictos(lista) {
    const vistos = new Set(); const sal = [];
    for (const c of lista || []) { const k = JSON.stringify(estable({ t: c.tipo, i: c.id, l: c.local && c.local.monto, c: c.central && c.central.monto, p: c.perdedor })); if (vistos.has(k)) continue; vistos.add(k); sal.push(c); }
    return sal.slice(-200);
  }

  // --- Operaciones sobre registros (siempre suben la versión; borrar = lápida, nunca eliminación física)
  function guardarGasto(estado, gasto, origen, ahora = new Date().toISOString()) {
    const id = String(gasto.id); const prev = estado.gastos[id];
    const limpio = Object.assign({}, gasto); delete limpio._del;
    estado.gastos[id] = Object.assign(limpio, { _v: (prev ? prev._v || 0 : 0) + 1, _t: ahora, _o: origen });
    return estado;
  }
  function borrarGasto(estado, id, origen, ahora = new Date().toISOString()) {
    const prev = estado.gastos[String(id)]; if (!prev || prev._del) return estado;
    estado.gastos[String(id)] = Object.assign({}, prev, { _del: true, _v: (prev._v || 0) + 1, _t: ahora, _o: origen });
    return estado;
  }
  const vigentes = (estado) => Object.values(estado.gastos).filter((g) => !g._del);
  function resumen(estado) { const v = vigentes(estado); return { gastos: v.length, suma: r2(v.reduce((s, g) => s + (Number(g.monto) || 0), 0)), idsUnicos: new Set(v.map((g) => String(g.id))).size, lapidas: Object.keys(estado.gastos).length - v.length }; }

  // Verifica invariantes de un estado leído/escrito (usado tras cada escritura y en la vigilancia).
  function verificarCentral(estado, { esperado = null } = {}) {
    if (!estado || typeof estado !== 'object' || estado.version !== 5 || !estado.gastos || typeof estado.gastos !== 'object') return { ok: false, motivo: 'no es un estado v5' };
    const claves = Object.keys(estado.gastos);
    for (const k of claves) { const g = estado.gastos[k]; if (!g || String(g.id) !== k) return { ok: false, motivo: 'registro con id inconsistente: ' + k }; if (!Number.isFinite(Number(g.monto))) return { ok: false, motivo: 'importe inválido en ' + k }; }
    if (esperado) {
      for (const [id, g] of Object.entries(esperado.gastos)) { const e = estado.gastos[id]; if (!e) return { ok: false, motivo: 'falta el registro ' + id }; if ((e._v || 0) < (g._v || 0)) return { ok: false, motivo: 'versión menor en ' + id }; }
    }
    return { ok: true, ...resumen(estado) };
  }

  // --- Incorporar un mapa verificado gasto → documentos EXISTENTES en Drive (aditivo; no sobrescribe referencias propias).
  function importarMapaRecibos(estado, mapa, { ahora = new Date().toISOString() } = {}) {
    const sal = clon(estado); const informe = { anadidos: [], yaExistian: [], sinGasto: [] };
    for (const [id, docs] of Object.entries(mapa || {})) {
      if (!sal.gastos[id] || sal.gastos[id]._del) { informe.sinGasto.push(id); continue; }
      if (sal.recibos[id]) { informe.yaExistian.push(id); continue; }
      sal.recibos[id] = { origen: 'externo', docs: docs.map((d) => ({ driveId: d.driveId, nombre: d.nombre, enlace: 'https://drive.google.com/file/d/' + d.driveId + '/view', rec: d.rec || null })), verificadoPorApp: false, fecha: ahora };
      informe.anadidos.push(id);
    }
    return { estado: sal, informe };
  }

  // --- Escritura condicional con reintento. `almacen`: { leer() → {estado, token}, escribir(estado, tokenEsperado) → {ok, token?, estado?} }
  async function actualizar(almacen, mutador, { intentos = 5, maxEsperaMs = 0 } = {}) {
    for (let i = 0; i < intentos; i++) {
      const { estado: leido, token } = await almacen.leer();
      const base = leido ? clon(leido) : nuevoEstado();
      const antes = Object.keys(base.gastos).length;
      const nuevo = mutador(clon(base));
      if (Object.keys(nuevo.gastos).length < antes) throw new Error('rechazado: la escritura perdería ' + (antes - Object.keys(nuevo.gastos).length) + ' registro(s)');
      nuevo.rev = (base.rev || 0) + 1; nuevo.actualizado = new Date().toISOString();
      const r = await almacen.escribir(nuevo, token);
      if (r && r.ok) return { estado: r.estado || nuevo, token: r.token, intentos: i + 1 };
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
    let doc = inicial ? clon(inicial) : null; let ver = 0; const a = { escrituras: 0, rechazos: 0, antesDeEscribir: null };
    a.leer = async () => ({ estado: doc ? clon(doc) : null, token: String(ver) });
    a.escribir = async (estado, tokenEsperado) => {
      if (a.antesDeEscribir) { const f = a.antesDeEscribir; a.antesDeEscribir = null; await f(); }
      if (String(ver) !== String(tokenEsperado)) { a.rechazos++; return { ok: false }; }
      doc = clon(estado); ver++; a.escrituras++; return { ok: true, token: String(ver) };
    };
    a.actual = () => (doc ? clon(doc) : null);
    return a;
  }

  return { unirListas, aplicarViajesBorrados, acotarConflictos, nuevoEstado, migrarAV5, incorporarPerfilLocal, fusionar, guardarGasto, borrarGasto, vigentes, resumen, verificarCentral, importarMapaRecibos, limpiarRecibos, actualizar, instantaneaDiaria, almacenMemoria, claveContenido, strip, igualContenido, clon };
});
