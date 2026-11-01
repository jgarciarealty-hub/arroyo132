'use strict';
// Drive SIMULADO con historial de revisiones, carreras inyectables y fallos (solo para pruebas).
const C = require('../../central/estado_central.js');
const D = require('../../central/almacen_drive.js');
function driveSimulado() {
  const s = { archivos: new Map(), n: 1, caido: false, antesDeSubir: null, recortar: false, patch500: 0, llamadas: [] };
  const rid = () => 'rev' + (s.n++);
  s.fetch = async (u, o = {}) => {
    if (s.caido) throw new TypeError('Failed to fetch');
    const m = o.method || 'GET'; const url = new URL(u); s.llamadas.push(m + ' ' + url.pathname);
    const R = (st, body) => ({ ok: st >= 200 && st < 300, status: st, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (m === 'GET' && url.pathname === '/drive/v3/files') {
      const nombre = (url.searchParams.get('q').match(/name='([^']+)'/) || [])[1];
      const fs_ = [...s.archivos.values()].filter((f) => f.name === nombre).sort((a, b) => a.t - b.t);
      return R(200, { files: fs_.map((f) => ({ id: f.id, createdTime: f.t, headRevisionId: f.revs[f.revs.length - 1].id })) });
    }
    if (m === 'POST' && url.pathname === '/drive/v3/files') { const b = JSON.parse(o.body); const id = 'F' + (s.n++); s.archivos.set(id, { id, name: b.name, t: s.n, revs: [{ id: rid(), text: '' }] }); return R(200, { id }); }
    let mm;
    if (m === 'PATCH' && (mm = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/))) {
      if (s.antesDeSubir) { const f = s.antesDeSubir; s.antesDeSubir = null; await f(); }
      if (s.patch500 > 0) { s.patch500--; return R(500, {}); }
      const f = s.archivos.get(mm[1]); let t = o.body; if (s.recortar) t = t.slice(0, t.length - 5);
      f.revs.push({ id: rid(), text: t }); return R(200, { id: f.id });
    }
    if (m === 'GET' && (mm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/revisions$/))) return R(200, { revisions: s.archivos.get(mm[1]).revs.map((r) => ({ id: r.id })) });
    if (m === 'GET' && (mm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/))) return R(200, s.archivos.get(mm[1]).revs.find((r) => r.id === mm[2]).text);
    if (m === 'GET' && (mm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)) && url.searchParams.get('alt') === 'media') { const f = s.archivos.get(mm[1]); return R(200, f.revs[f.revs.length - 1].text); }
    return R(404, {});
  };
  s.dispositivo = () => D.crearAlmacenDrive({ fetchFn: s.fetch, token: 'T', fusionar: C.fusionar });
  s.estado = () => { const f = [...s.archivos.values()].find((x) => x.name === D.NOMBRE_CENTRAL); const t = f && f.revs[f.revs.length - 1].text; return t ? JSON.parse(t) : null; };
  s.archivosCentrales = () => [...s.archivos.values()].filter((x) => x.name === D.NOMBRE_CENTRAL).length;
  return s;
}
module.exports = { driveSimulado };
