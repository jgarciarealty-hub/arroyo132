// Verifica que el endpoint use la fecha del negocio (Puerto Rico) y no la UTC del servidor
// para el «Hoy» del prompt y el presupuesto diario. Sin red y sin llamar a Anthropic.
// Uso: node tests/verificacion_fecha_api_20261104.test.js
'use strict';
const api = require('../api/analyze-invoice.js');
const I = api._internals;
let pass = 0, fail = 0;
const test = (n, c, d) => { if (c) { pass++; console.log('PASS:', n); } else { fail++; console.log('FAIL:', n, d !== undefined ? '-- ' + JSON.stringify(d) : ''); } };

test('fechaPuertoRico existe y es función', typeof I.fechaPuertoRico === 'function');
test('02:30Z del 4-nov todavía es 3-nov en Puerto Rico (UTC-4)', I.fechaPuertoRico(new Date('2026-11-04T02:30:00Z')) === '2026-11-03', I.fechaPuertoRico(new Date('2026-11-04T02:30:00Z')));
test('03:59Z del 4-nov todavía es 3-nov en Puerto Rico', I.fechaPuertoRico(new Date('2026-11-04T03:59:00Z')) === '2026-11-03', I.fechaPuertoRico(new Date('2026-11-04T03:59:00Z')));
test('04:00Z del 4-nov ya es 4-nov en Puerto Rico', I.fechaPuertoRico(new Date('2026-11-04T04:00:00Z')) === '2026-11-04', I.fechaPuertoRico(new Date('2026-11-04T04:00:00Z')));
test('un instante de diciembre no se desplaza de año', I.fechaPuertoRico(new Date('2026-12-31T03:30:00Z')) === '2026-12-30', I.fechaPuertoRico(new Date('2026-12-31T03:30:00Z')));

const bloque = {
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'recibo' }] }],
};
const val = I.validarCuerpo(bloque, 2000);
test('un recibo válido pasa la validación', val.ok === true, val);
const texto = (val.bloque || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
test('el prompt del servidor incluye la fecha de Puerto Rico', texto.includes(I.fechaPuertoRico()), texto.slice(-80));
test('el prompt del servidor no reenvía el texto del cliente', !texto.includes('recibo') || /Analiza esta factura/.test(texto));

console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
process.exit(fail ? 1 : 0);
