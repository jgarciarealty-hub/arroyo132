// Verifica central/recorte_recibo.js con imágenes SINTÉTICAS en memoria (sin red, sin canvas).
// Uso: node tests/verificacion_recorte_recibo.test.js
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const RUTA = path.join(__dirname, '..', 'central', 'recorte_recibo.js');

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const hash = (buf) => crypto.createHash('sha256').update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)).digest('hex');

// Fondo oscuro con ruido y textura + papel claro rotado con líneas de texto oscuras.
function escena(W, H, { cx, cy, pw, ph, angDeg, fondo = 40, ruido = 25, papel = 235, texto = 45 }) {
  seed = 777;
  const img = new Uint8ClampedArray(W * H * 4), th = angDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, u = dx * c + dy * s, v = -dx * s + dy * c; // coords del papel
    let val;
    if (Math.abs(u) <= pw / 2 && Math.abs(v) <= ph / 2) {
      const fila = Math.floor((v + ph / 2) / 9), mg = 0.1 * pw;
      val = (fila % 2 === 0 && Math.abs(u) < pw / 2 - mg && Math.abs(v) < ph / 2 - mg) ? texto : papel;
      val += (rnd() - 0.5) * 8;
    } else val = fondo + (rnd() - 0.5) * 2 * ruido + 10 * Math.sin(x / 7) * Math.cos(y / 5);
    const p = (y * W + x) * 4; img[p] = img[p + 1] = img[p + 2] = val; img[p + 3] = 255;
  }
  const rad = [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
  return { img, W, H, esquinas: rad };
}
function plano(W, H, f) { const img = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { const v = f(i); img[i * 4] = img[i * 4 + 1] = img[i * 4 + 2] = v; img[i * 4 + 3] = 255; } return img; }
const lumMedia = (a) => { let s = 0, s2 = 0; const n = a.length / 4; for (let i = 0; i < n; i++) { const v = a[i * 4]; s += v; s2 += v * v; } const m = s / n; return { media: m, desv: Math.sqrt(Math.max(0, s2 / n - m * m)) }; };

function suite(mod, log) {
  const r = { pass: 0, fail: 0 };
  const test = (n, c, d) => { if (c) { r.pass++; if (log) console.log('PASS:', n); } else { r.fail++; if (log) console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const areaFirmada = (q) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

  const casos = [
    { nombre: '0 grados centrado', W: 800, H: 600, cx: 400, cy: 300, pw: 200, ph: 480, angDeg: 0 },
    { nombre: '10 grados descentrado', W: 800, H: 600, cx: 300, cy: 280, pw: 170, ph: 450, angDeg: 10 },
    { nombre: '25 grados', W: 800, H: 600, cx: 450, cy: 320, pw: 190, ph: 430, angDeg: 25 },
    { nombre: '90 grados (acostado)', W: 800, H: 600, cx: 400, cy: 300, pw: 200, ph: 480, angDeg: 90 },
    { nombre: '-15 grados, pequeno', W: 640, H: 480, cx: 200, cy: 250, pw: 110, ph: 300, angDeg: -15 },
    { nombre: '60 grados', W: 800, H: 600, cx: 400, cy: 300, pw: 160, ph: 420, angDeg: 60 },
    { nombre: '-40 grados', W: 800, H: 600, cx: 380, cy: 310, pw: 160, ph: 400, angDeg: -40 },
    { nombre: '170 grados (boca abajo)', W: 800, H: 600, cx: 400, cy: 300, pw: 180, ph: 450, angDeg: 170 },
    { nombre: 'vertical 1000x1400', W: 1000, H: 1400, cx: 520, cy: 700, pw: 380, ph: 1000, angDeg: 5 },
  ];
  for (const k of casos) {
    const e = escena(k.W, k.H, k);
    const antes = hash(e.img);
    const d = mod.detectarRecibo(e.img, e.W, e.H);
    test(k.nombre + ': detecta ok', d.ok === true, d.motivo);
    if (!d.ok) continue;
    const diag = Math.hypot(e.W, e.H);
    let maxErr = 0;
    for (const real of e.esquinas) maxErr = Math.max(maxErr, Math.min(...d.cuadrilatero.map((q) => dist(q, real))));
    test(k.nombre + ': esquinas <=3% de la diagonal (' + (100 * maxErr / diag).toFixed(2) + '%)', maxErr / diag <= 0.03, maxErr / diag);
    const q = d.cuadrilatero;
    test(k.nombre + ': orden TL,TR,BR,BL (horario, TL = min x+y)', areaFirmada(q) > 0 && q.every((p) => q[0][0] + q[0][1] <= p[0] + p[1] + 1e-9), q);
    const p = mod.prepararRecibo(e.img, e.W, e.H);
    test(k.nombre + ': preparar ok y recortado', p.ok === true && p.recortado && p.recortado.w > 0, p.detalle && p.detalle.motivo);
    test(k.nombre + ': buffer original intacto (hash)', hash(e.img) === antes);
    if (p.ok) {
      const o = p.recortado;
      test(k.nombre + ': lado mayor vertical (' + o.w + 'x' + o.h + ')', o.h >= o.w, [o.w, o.h]);
      const d = Math.round(0.05 * o.w), px = (x, y) => o.rgba[(y * o.w + x) * 4];
      const cs = [px(d, d), px(o.w - 1 - d, d), px(o.w - 1 - d, o.h - 1 - d), px(d, o.h - 1 - d)];
      test(k.nombre + ': esquinas de la salida son papel (sin fondo oscuro)', cs.every((v) => v > 150), cs);
      // proporcion: la salida debe parecerse a pw x ph (lado menor/lado mayor)
      const rReal = Math.min(k.pw, k.ph) / Math.max(k.pw, k.ph), rSal = o.w / o.h;
      test(k.nombre + ': proporcion conservada (' + rSal.toFixed(2) + ' vs ' + rReal.toFixed(2) + ')', Math.abs(rSal - rReal) < 0.06, [rSal, rReal]);
    }
  }

  // limite de salida
  { const e = escena(800, 600, casos[0]); const w = mod.corregirPerspectiva(e.img, e.W, e.H, mod.detectarRecibo(e.img, e.W, e.H).cuadrilatero, 300);
    test('maxLado respetado (300)', w && Math.max(w.w, w.h) <= 300 && w.h >= w.w, w && [w.w, w.h]); }

  // contraste: imagen de bajo contraste (80..160) -> desviacion aumenta, sin binarizar
  { const W = 200, H = 100; const base = plano(W, H, (i) => 80 + (i % 200) * 0.4 + ((i * 7) % 13)); const h0 = hash(base), d0 = lumMedia(base).desv;
    const m = mod.mejorarContraste(base, W, H), d1 = lumMedia(m).desv;
    test('contraste aumenta (' + d0.toFixed(1) + ' -> ' + d1.toFixed(1) + ')', d1 > d0 * 1.5, [d0, d1]);
    test('mejorarContraste no modifica la entrada', hash(base) === h0);
    const vals = new Set(); for (let i = 0; i < W * H; i++) vals.add(m[i * 4]);
    test('no binariza (muchos niveles de gris)', vals.size > 40, vals.size); }

  // negativos
  const negs = {
    'solo fondo oscuro': plano(600, 450, (i) => 40 + ((i * 2654435761) >>> 0) % 20),
    'todo blanco': plano(600, 450, () => 255),
    'ruido puro': plano(600, 450, () => Math.floor(rnd() * 256)),
    'degradado suave': plano(600, 450, (i) => 40 + 100 * ((i % 600) / 600)),
  };
  for (const [n, img] of Object.entries(negs)) {
    const a = hash(img);
    const d = mod.detectarRecibo(img, 600, 450), p = mod.prepararRecibo(img, 600, 450);
    test('negativo "' + n + '": ok:false (' + d.motivo + ')', d.ok === false && d.cuadrilatero === null, d);
    test('negativo "' + n + '": preparar -> ok:false, recortado:null', p.ok === false && p.recortado === null);
    test('negativo "' + n + '": buffer intacto', hash(img) === a);
  }
  // recibo diminuto (<8%) y papel que llena todo el cuadro (>97%)
  { const e = escena(800, 600, { cx: 400, cy: 300, pw: 60, ph: 110, angDeg: 0 }); const d = mod.detectarRecibo(e.img, e.W, e.H); test('recibo diminuto (<8%): ok:false', d.ok === false, d.motivo); }
  { const e = escena(800, 600, { cx: 400, cy: 300, pw: 1600, ph: 1600, angDeg: 0 }); const d = mod.detectarRecibo(e.img, e.W, e.H); test('papel llena todo el cuadro: ok:false', d.ok === false, d.motivo); }

  return r;
}

// ---- ejecución real ----
const mod = require(RUTA);
const real = suite(mod, true);

// rendimiento: foto 4000x3000
{
  const e = escena(4000, 3000, { cx: 2000, cy: 1500, pw: 1100, ph: 2500, angDeg: 12 });
  const t0 = process.hrtime.bigint();
  const p = mod.prepararRecibo(e.img, 4000, 3000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const t = (n, c, d) => { if (c) { real.pass++; console.log('PASS:', n); } else { real.fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };
  t('rendimiento 4000x3000 en <3 s (' + ms.toFixed(0) + ' ms)', ms < 3000 && p.ok === true, { ms, motivo: p.detalle && p.detalle.motivo });
}

// ---- mutaciones sobre copia temporal: las pruebas deben detectarlas ----
const fuente = fs.readFileSync(RUTA, 'utf8');
const mutaciones = [
  ['invertir umbral', 'if (lum[i] > t) {', 'if (lum[i] <= t) {'],
  ['saltarse el ordenado de esquinas (esquina inicial TL)', 'if (out[i].p[0] + out[i].p[1] < out[k].p[0] + out[k].p[1]) k = i;', 'if (false) k = i;'],
  ['no orientar lado mayor vertical', 'if (ancho0 > alto0)', 'if (false)'],
  ['sin estiramiento de contraste', '(v - lo) / (hi - lo)', 'v / 255'],
  ['mejorarContraste escribe sobre la entrada', 'const out = new Uint8ClampedArray(rgba); // copia', 'const out = rgba; // copia'],
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorte_mut_'));
for (const [nombre, de, a] of mutaciones) {
  const ok = fuente.includes(de);
  let detectada = false;
  if (ok) {
    const f = path.join(dir, 'mut.js');
    fs.writeFileSync(f, fuente.replace(de, a));
    delete require.cache[require.resolve(f)];
    try { detectada = suite(require(f), false).fail > 0; } catch (e) { detectada = true; }
  }
  const msg = 'mutacion detectada: ' + nombre;
  if (ok && detectada) { real.pass++; console.log('PASS:', msg); } else { real.fail++; console.log('FAIL:', msg, ok ? '(las pruebas no la detectaron)' : '(texto a mutar no encontrado)'); }
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${real.pass} pasaron / ${real.fail} fallaron`);
process.exit(real.fail ? 1 : 0);
