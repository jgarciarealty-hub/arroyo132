// Adaptador de Google Drive para la fuente central de Arroyo 132. UMD: Node (pruebas con Drive simulado) y navegador (window.A132Drive).
// Reutiliza la integración existente (mismo permiso drive.file, mismo token). Sin servicios nuevos.
// Concurrencia: Drive no ofrece escritura condicional atómica, así que se combina (1) comprobar headRevisionId antes de escribir,
// (2) tras escribir, mirar el historial de revisiones: si hay una revisión ajena entre la esperada y la nuestra, otro
// dispositivo se coló → se FUSIONA su contenido (que sigue en el historial) y se reescribe. Nunca se pierde una actualización.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.A132Drive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NOMBRE_CENTRAL = 'arroyo132-central-v5.json';

  function crearAlmacenDrive({ fetchFn, token, nombre = NOMBRE_CENTRAL, base = 'https://www.googleapis.com', fusionar, intentosRecuperacion = 3 }) {
    if (typeof fusionar !== 'function') throw new Error('falta la función de fusión');
    const H = { Authorization: 'Bearer ' + token };
    const url = (p) => base + p;
    async function json(r, que) { if (!r.ok) throw new Error(que + ': HTTP ' + r.status); return r.json(); }

    async function listar() {
      const q = "name='" + nombre + "' and trashed=false";
      const r = await fetchFn(url('/drive/v3/files?q=' + encodeURIComponent(q) + '&orderBy=createdTime&fields=files(id,createdTime,headRevisionId,md5Checksum,size)'), { headers: H });
      return ((await json(r, 'búsqueda del archivo central')).files) || [];
    }
    async function buscar() {
      const f = await listar();
      if (f.length > 1) throw new Error('hay ' + f.length + ' archivos «' + nombre + '» en Drive; no se elige ninguno automáticamente: resolver a mano');
      return f[0] || null;
    }
    async function contenido(ruta, que) {
      const r = await fetchFn(url(ruta), { headers: H });
      if (!r.ok) throw new Error(que + ': HTTP ' + r.status);
      return r.text();
    }
    function parsear(texto, que) {
      if (texto == null || String(texto).trim() === '') throw new Error(que + ' existe pero está vacío; no se sobrescribe');
      try { return JSON.parse(texto); } catch (e) { throw new Error(que + ' existe pero no se puede leer (contenido ilegible); no se sobrescribe'); }
    }
    async function revisiones(id) {
      const r = await fetchFn(url('/drive/v3/files/' + id + '/revisions?fields=revisions(id,modifiedTime)&pageSize=200'), { headers: H });
      return ((await json(r, 'historial de revisiones')).revisions) || [];
    }
    async function subir(id, texto) {
      const r = await fetchFn(url('/upload/drive/v3/files/' + id + '?uploadType=media'), { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: texto });
      if (!r.ok) throw new Error('subida del archivo central: HTTP ' + r.status);
    }
    async function crear() {
      const r = await fetchFn(url('/drive/v3/files'), { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ name: nombre, mimeType: 'application/json' }) });
      const j = await json(r, 'creación del archivo central');
      if (!j.id) throw new Error('creación del archivo central: sin id');
      return j.id;
    }

    async function leer() {
      const meta = await buscar();
      if (!meta) return { estado: null, token: 'ausente' };
      const estado = parsear(await contenido('/drive/v3/files/' + meta.id + '?alt=media', 'lectura del archivo central'), 'el archivo central');
      return { estado, token: meta.headRevisionId };
    }

    async function escribir(estado, tokenEsperado) {
      let fileId, esperado = tokenEsperado;
      if (tokenEsperado === 'ausente') {
        if (await buscar()) return { ok: false };
        fileId = await crear();
        if ((await listar()).length > 1) throw new Error('dos dispositivos crearon «' + nombre + '» a la vez; no se elige ninguno automáticamente: resolver a mano');
      } else {
        const meta = await buscar();
        if (!meta || meta.headRevisionId !== tokenEsperado) return { ok: false };
        fileId = meta.id;
      }
      let actual = estado;
      for (let i = 0; i <= intentosRecuperacion; i++) {
        const texto = JSON.stringify(actual);
        await subir(fileId, texto);
        const revs = await revisiones(fileId);
        const cabeza = revs[revs.length - 1];
        if (!cabeza) throw new Error('el archivo central quedó sin revisiones');
        // Verificación inmutable: el contenido de NUESTRA revisión debe ser exactamente lo escrito.
        const guardado = await contenido('/drive/v3/files/' + fileId + '/revisions/' + cabeza.id + '?alt=media', 'verificación de la revisión escrita');
        if (guardado !== texto) throw new Error('la verificación de la escritura falló: Drive no guardó lo enviado');
        // ¿Se coló otro dispositivo entre la comprobación y la escritura?
        const idxEsperado = esperado === 'ausente' ? -1 : revs.findIndex((r) => r.id === esperado);
        if (esperado !== 'ausente' && idxEsperado < 0) throw new Error('la revisión esperada ya no existe en el historial; se reintenta con una lectura nueva');
        const ajenas = revs.slice(idxEsperado + 1, revs.length - 1).filter((r) => esperado !== 'ausente' || r.id !== revs[0].id);
        if (!ajenas.length) return { ok: true, token: cabeza.id, estado: actual };
        // Recuperación: fusionar lo que escribieron otros y reescribir.
        let fusion = actual;
        for (const r of ajenas) {
          const ajeno = parsear(await contenido('/drive/v3/files/' + fileId + '/revisions/' + r.id + '?alt=media', 'revisión intermedia'), 'una revisión intermedia');
          fusion = fusionar(fusion, ajeno);
        }
        fusion.rev = Math.max(fusion.rev || 0, actual.rev || 0) + 1;
        actual = fusion; esperado = cabeza.id;
      }
      throw new Error('no se pudo estabilizar la escritura tras ' + intentosRecuperacion + ' recuperaciones (demasiada concurrencia)');
    }
    return { leer, escribir, _buscar: buscar, nombre };
  }
  return { crearAlmacenDrive, NOMBRE_CENTRAL };
});
