// Recorte de recibos — funciones PURAS sobre píxeles RGBA (Uint8ClampedArray), sin canvas ni DOM.
// UMD: Node (pruebas) y navegador (window.A132Recorte). Prepara una foto de recibo antes de enviarla a una IA de lectura.
// Reglas: nunca se modifica el buffer de entrada; si no hay un recibo claro NO se inventa un recorte (ok:false).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.A132Recorte = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LADO_ANALISIS = 400;

  // Copia reducida en luminancia (promedio de hasta 4x4 muestras por bloque) + suavizado 3x3.
  function reducirLuminancia(rgba, w, h) {
    const esc = Math.max(1, Math.max(w, h) / LADO_ANALISIS);
    const sw = Math.max(1, Math.round(w / esc)), sh = Math.max(1, Math.round(h / esc));
    const sx = w / sw, sy = h / sh;
    const n = Math.max(1, Math.min(4, Math.floor(Math.min(sx, sy))));
    const lum = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      let acc = 0;
      for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
        const x = Math.min(w - 1, Math.floor(i * sx + (a + 0.5) * sx / n));
        const y = Math.min(h - 1, Math.floor(j * sy + (b + 0.5) * sy / n));
        const p = (y * w + x) * 4;
        acc += 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      }
      lum[j * sw + i] = acc / (n * n);
    }
    const out = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if (x >= 0 && y >= 0 && x < sw && y < sh) { s += lum[y * sw + x]; c++; }
      }
      out[j * sw + i] = s / c;
    }
    return { lum: out, sw, sh, sx, sy };
  }

  function otsu(lum) {
    const hist = new Float64Array(256);
    for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, Math.round(lum[i])))]++;
    const tot = lum.length; let sumAll = 0;
    for (let k = 0; k < 256; k++) sumAll += k * hist[k];
    let wB = 0, sumB = 0, best = -1, t = 127;
    for (let k = 0; k < 256; k++) {
      wB += hist[k]; if (wB === 0) continue;
      const wF = tot - wB; if (wF === 0) break;
      sumB += k * hist[k];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = k; }
    }
    return { t, varianza: best };
  }

  function mayorComponente(mask, sw, sh) {
    const etiqueta = new Int32Array(sw * sh); // 0 = sin visitar
    const cola = new Int32Array(sw * sh);
    let mejor = null, id = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || etiqueta[s]) continue;
      id++; let ini = 0, fin = 0; cola[fin++] = s; etiqueta[s] = id;
      while (ini < fin) {
        const p = cola[ini++]; const x = p % sw, y = (p - x) / sw;
        if (x > 0 && mask[p - 1] && !etiqueta[p - 1]) { etiqueta[p - 1] = id; cola[fin++] = p - 1; }
        if (x < sw - 1 && mask[p + 1] && !etiqueta[p + 1]) { etiqueta[p + 1] = id; cola[fin++] = p + 1; }
        if (y > 0 && mask[p - sw] && !etiqueta[p - sw]) { etiqueta[p - sw] = id; cola[fin++] = p - sw; }
        if (y < sh - 1 && mask[p + sw] && !etiqueta[p + sw]) { etiqueta[p + sw] = id; cola[fin++] = p + sw; }
      }
      if (!mejor || fin > mejor.n) mejor = { id, n: fin };
    }
    if (!mejor) return null;
    return { etiqueta, id: mejor.id, n: mejor.n };
  }

  function envolventeConvexa(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const bajo = [], alto = [];
    for (const p of pts) { while (bajo.length >= 2 && cruz(bajo[bajo.length - 2], bajo[bajo.length - 1], p) <= 0) bajo.pop(); bajo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (alto.length >= 2 && cruz(alto[alto.length - 2], alto[alto.length - 1], p) <= 0) alto.pop(); alto.push(p); }
    bajo.pop(); alto.pop();
    return bajo.concat(alto);
  }
  function areaPoligono(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }

  // Rectángulo de área mínima (giro de 0 a 90° en pasos de 0.5°) sobre la envolvente. Cada punto es el centro de un píxel: se expande 0.5.
  function rectanguloMinimo(hull) {
    let mejor = null;
    for (let g = 0; g < 90; g += 0.5) {
      const th = g * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of hull) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      u0 -= 0.5; u1 += 0.5; v0 -= 0.5; v1 += 0.5;
      const area = (u1 - u0) * (v1 - v0);
      if (!mejor || area < mejor.area) mejor = { area, c, s, u0, u1, v0, v1 };
    }
    const { c, s, u0, u1, v0, v1 } = mejor;
    const esq = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
    return { area: mejor.area, esquinas: esq };
  }

  // Ordena TL, TR, BR, BL: sentido horario (y hacia abajo) empezando por la esquina más arriba-izquierda (min x+y).
  function ordenarEsquinas(q) {
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    const out = q.map((p) => ({ p, a: Math.atan2(p[1] - cy, p[0] - cx) }));
    out.sort((a, b) => a.a - b.a);
    let k = 0;
    for (let i = 1; i < 4; i++) if (out[i].p[0] + out[i].p[1] < out[k].p[0] + out[k].p[1]) k = i;
    return [0, 1, 2, 3].map((i) => out[(k + i) % 4].p);
  }

  function detectarRecibo(rgba, w, h) {
    if (!rgba || !(w > 0) || !(h > 0) || rgba.length < w * h * 4) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'imagen invalida' };
    const { lum, sw, sh, sx, sy } = reducirLuminancia(rgba, w, h);
    const { t, varianza } = otsu(lum);
    if (!(varianza > 0)) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'sin contraste (imagen uniforme)' };
    const mask = new Uint8Array(sw * sh); let sumC = 0, nC = 0, sumO = 0, nO = 0;
    for (let i = 0; i < lum.length; i++) { if (lum[i] > t) { mask[i] = 1; sumC += lum[i]; nC++; } else { sumO += lum[i]; nO++; } }
    if (!nC || !nO) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'sin contraste (una sola clase)' };
    const contraste = sumC / nC - sumO / nO;
    if (contraste < 40) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'contraste insuficiente entre papel y fondo' };
    const comp = mayorComponente(mask, sw, sh);
    if (!comp) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'no hay region clara' };
    const pts = []; let difBorde = 0, nBorde = 0;
    for (let p = 0; p < mask.length; p++) {
      if (comp.etiqueta[p] !== comp.id) continue;
      const x = p % sw, y = (p - x) / sw;
      // nitidez del borde: salto de luminancia hacia vecinos que no son del papel (un degradado suave no es un borde de papel)
      for (const q of [x > 0 ? p - 1 : -1, x < sw - 1 ? p + 1 : -1, y > 0 ? p - sw : -1, y < sh - 1 ? p + sw : -1]) if (q >= 0 && comp.etiqueta[q] !== comp.id) { difBorde += Math.abs(lum[p] - lum[q]); nBorde++; }
      const borde = x === 0 || y === 0 || x === sw - 1 || y === sh - 1 ||
        comp.etiqueta[p - 1] !== comp.id || comp.etiqueta[p + 1] !== comp.id || comp.etiqueta[p - sw] !== comp.id || comp.etiqueta[p + sw] !== comp.id;
      if (borde) pts.push([x + 0.5, y + 0.5]);
    }
    if (pts.length < 3) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'region demasiado pequena' };
    const hull = envolventeConvexa(pts);
    if (hull.length < 3) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'region degenerada' };
    if (nBorde && difBorde / nBorde < 8) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'borde difuso (sin salto papel/fondo)' };
    const rect = rectanguloMinimo(hull);
    const total = sw * sh, frac = rect.area / total, solidez = comp.n / Math.max(1, areaPoligono(hull)), ajuste = areaPoligono(hull) / rect.area;
    if (frac < 0.08) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'region clara demasiado pequena (<8% del cuadro)' };
    if (frac > 0.97) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'region clara ocupa casi todo el cuadro (>97%)' };
    if (ajuste < 0.8) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'forma no rectangular (ajuste ' + ajuste.toFixed(2) + ')' };
    if (solidez < 0.5) return { ok: false, cuadrilatero: null, confianza: 0, motivo: 'region fragmentada (solidez ' + solidez.toFixed(2) + ')' };
    const cuad = ordenarEsquinas(rect.esquinas).map(([x, y]) => [Math.max(0, Math.min(w, x * sx)), Math.max(0, Math.min(h, y * sy))]);
    const confianza = Math.max(0, Math.min(1, ajuste * Math.min(1, solidez / 0.8) * Math.min(1, contraste / 100)));
    return { ok: true, cuadrilatero: cuad, confianza: Math.round(confianza * 100) / 100, motivo: 'ok', umbral: t, contraste: Math.round(contraste) };
  }

  function resolver8(A, b) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      if (Math.abs(A[p][i]) < 1e-12) return null;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
    return x;
  }

  // Homografía destino->origen y remuestreo bilineal. cuad = [TL,TR,BR,BL] en píxeles del origen.
  function corregirPerspectiva(rgba, w, h, cuad, maxLado) {
    if (!cuad || cuad.length !== 4) return null;
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let q = cuad;
    const ancho0 = (d(q[0], q[1]) + d(q[3], q[2])) / 2, alto0 = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
    if (ancho0 > alto0) q = [q[3], q[0], q[1], q[2]]; // girar 90°: el lado mayor queda vertical
    let W = (d(q[0], q[1]) + d(q[3], q[2])) / 2, H = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
    const lim = maxLado > 0 ? maxLado : 1600, esc = Math.min(1, lim / Math.max(W, H));
    W = Math.max(1, Math.round(W * esc)); H = Math.max(1, Math.round(H * esc));
    const dst = [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]];
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [X, Y] = q[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
    }
    const m = resolver8(A, b);
    if (!m) return null;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const den = m[6] * x + m[7] * y + 1;
      let X = (m[0] * x + m[1] * y + m[2]) / den, Y = (m[3] * x + m[4] * y + m[5]) / den;
      X = Math.max(0, Math.min(w - 1, X)); Y = Math.max(0, Math.min(h - 1, Y));
      const x0 = Math.floor(X), y0 = Math.floor(Y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = X - x0, fy = Y - y0;
      const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4, o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = rgba[p00 + c] * (1 - fx) * (1 - fy) + rgba[p10 + c] * fx * (1 - fy) + rgba[p01 + c] * (1 - fx) * fy + rgba[p11 + c] * fx * fy;
      out[o + 3] = 255;
    }
    return { rgba: out, w: W, h: H };
  }

  // Estiramiento de histograma por percentiles 2–98 (sobre luminancia, mismo mapa en R,G,B) + gamma suave. No binariza.
  function mejorarContraste(rgba, w, h) {
    const out = new Uint8ClampedArray(rgba); // copia: la entrada no se toca
    const hist = new Uint32Array(256), n = w * h;
    for (let i = 0; i < n; i++) hist[Math.round(0.299 * out[i * 4] + 0.587 * out[i * 4 + 1] + 0.114 * out[i * 4 + 2])]++;
    const pct = (f) => { let acc = 0; const objetivo = f * n; for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= objetivo) return k; } return 255; };
    const lo = pct(0.02), hi = pct(0.98);
    if (hi - lo < 8) return out; // casi uniforme: no amplificar ruido
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 0.9);
    for (let i = 0; i < n; i++) { out[i * 4] = lut[out[i * 4]]; out[i * 4 + 1] = lut[out[i * 4 + 1]]; out[i * 4 + 2] = lut[out[i * 4 + 2]]; }
    return out;
  }

  function prepararRecibo(rgba, w, h, opts) {
    const o = opts || {};
    const det = detectarRecibo(rgba, w, h);
    const base = { original: { w, h }, detalle: det };
    if (!det.ok) return Object.assign({ ok: false, recortado: null }, base);
    const warp = corregirPerspectiva(rgba, w, h, det.cuadrilatero, o.maxLado || 1600);
    if (!warp) return Object.assign({ ok: false, recortado: null }, base, { detalle: Object.assign({}, det, { ok: false, motivo: 'homografia singular' }) });
    const fin = o.mejorar === false ? warp.rgba : mejorarContraste(warp.rgba, warp.w, warp.h);
    return Object.assign({ ok: true, recortado: { rgba: fin, w: warp.w, h: warp.h } }, base);
  }

  return { detectarRecibo, corregirPerspectiva, mejorarContraste, prepararRecibo };
});
