// Estrategia de versiones: la app redirige las URLs antiguas conocidas a la canónica y no toca
// localhost, 127.0.0.1, file:// ni previews. Uso: node tests/verificacion_versiones_20261104.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

const bloque = script.match(/const A132_HOSTS_OBSOLETOS[\s\S]*?\}\)\(\);/);
test('la estrategia de versiones está en el script', !!bloque);

// Extrae solo la función para probar la lista sin ejecutar la redirección.
const fn = script.match(/function esHostObsoleto\(h\)\{[^\n]*\}/);
test('la función esHostObsoleto existe', !!fn);
const ctx = vm.createContext({});
vm.runInContext("const A132_HOSTS_OBSOLETOS=['arroyo132-netlify.vercel.app','jgarciarealty-hub-arroyo132.vercel.app'];" + fn[0], ctx);
const H = (h) => vm.runInContext('esHostObsoleto', ctx)(h);
test('canónica no es obsoleta', H('arroyo132.vercel.app') === false);
test('localhost no es obsoleto', H('localhost') === false && H('127.0.0.1') === false);
test('preview de Vercel no es obsoleta', H('arroyo132-git-main-jgarcia.vercel.app') === false);
test('las dos URLs antiguas son obsoletas', H('arroyo132-netlify.vercel.app') === true && H('jgarciarealty-hub-arroyo132.vercel.app') === true);
test('la comparación no distingue mayúsculas', H('ARROYO132-NETLIFY.VERCEL.APP') === true);

// La redirección conserva ruta, query y hash.
const ctx2 = vm.createContext({ location: { hostname: 'arroyo132-netlify.vercel.app', pathname: '/x', search: '?a=1', hash: '#b', replace: (u) => { ctx2.__destino = u; } } });
vm.runInContext(bloque[0], ctx2);
test('la URL antigua redirige a la canónica conservando ruta/query/hash', ctx2.__destino === 'https://arroyo132.vercel.app/x?a=1#b', ctx2.__destino);
const ctx3 = vm.createContext({ location: { hostname: 'localhost', pathname: '/', search: '', hash: '', replace: (u) => { ctx3.__destino = u; } } });
vm.runInContext(bloque[0], ctx3);
test('localhost no se redirige', ctx3.__destino === undefined);

test('el HTML declara la URL canónica', /<link rel="canonical" href="https:\/\/arroyo132\.vercel\.app\/">/.test(html));

console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
process.exit(fail ? 1 : 0);
