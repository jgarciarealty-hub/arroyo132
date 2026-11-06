// cargarImagenConTiempo: una imagen que no dispara onload ni onerror debe resolverse como
// error en tiempo acotado. Sin esto, la app quedaba en «Analizando…» y nunca llamaba a la IA.
// Función REAL extraída de index.html; Image simulado.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const HTML = process.env.A132_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
function test(n, c, d) { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } }
function extraer(nombre) {
  const ini = script.indexOf('function ' + nombre + '(');
  if (ini < 0) throw new Error('no existe ' + nombre);
  let k = script.indexOf('{', ini), n = 0;
  for (; k < script.length; k++) { if (script[k] === '{') n++; else if (script[k] === '}') { n--; if (!n) break; } }
  return script.slice(ini, k + 1);
}
function conImagen(comportamiento, ms) {
  return new Promise((res) => {
    const ctx = {
      setTimeout, clearTimeout, Promise, Error,
      Image: function () { const self = this; setTimeout(() => comportamiento(self), 5); },
    };
    vm.createContext(ctx);
    vm.runInContext(extraer('cargarImagenConTiempo'), ctx);
    const t0 = Date.now();
    const vigilante = setTimeout(() => res({ fin: 'colgado', ms: Date.now() - t0 }), 2000);
    vm.runInContext(`cargarImagenConTiempo('data:x', ${ms || 200}).then(()=>{__r({fin:'ok'})},(e)=>{__r({fin:'error',motivo:String(e&&e.message||e)})})`, Object.assign(ctx, { __r: (v) => { clearTimeout(vigilante); res(Object.assign({ ms: Date.now() - t0 }, v)); } }));
  });
}

test('la función existe en el HTML', script.includes('function cargarImagenConTiempo('));

(async () => {
  const ok = await conImagen((img) => { img.onload && img.onload(); }, 200);
  test('imagen que carga: resuelve', ok.fin === 'ok', ok);

  const err = await conImagen((img) => { img.onerror && img.onerror(); }, 200);
  test('imagen que falla: rechaza', err.fin === 'error', err);

  const colgada = await conImagen(() => { /* nunca dispara */ }, 150);
  test('imagen que no dispara nada: rechaza por tiempo (no se cuelga)', colgada.fin === 'error' && /tiempo de espera/.test(colgada.motivo || '') && colgada.ms < 1500, colgada);

  // Mutación: quitar el temporizador debe colgar el caso silencioso.
  if (!process.env.A132_HTML) {
    const mut = html.replace(/t=setTimeout\(\(\)=>\{ limpiar\(\); rej\(new Error\('tiempo de espera al decodificar la imagen'\)\); \}, ms\|\|8000\);\n/, '');
    test('mutación aplicable (quitar el temporizador)', mut !== html);
    if (mut !== html) {
      const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'a132-timg-'));
      const p = path.join(dir, 'm.html'); fs.writeFileSync(p, mut);
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, A132_HTML: p }, encoding: 'utf8' });
      test('la mutación hace fallar la suite', r.status !== 0);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
