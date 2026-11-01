// Drive simulado como servidor HTTP local (CORS) para pruebas en navegador con dos dispositivos reales (orígenes distintos).
// Uso: node tests/helpers/servidor_drive_simulado.js [puerto]   (solo localhost; nunca toca Drive real)
'use strict';
const http = require('http');
const { driveSimulado } = require('./drive_simulado.js');
const s = driveSimulado();
const puerto = Number(process.argv[2] || 8133);
http.createServer((req, res) => {
  const cab = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cab); return res.end(); }
  if (req.url === '/__control') {   // control de la prueba: ?caido=1 / ?caido=0 / estado
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = b ? JSON.parse(b) : {}; if (j.caido !== undefined) s.caido = !!j.caido; res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cab)); res.end(JSON.stringify({ caido: s.caido, archivos: [...s.archivos.values()].map((f) => ({ name: f.name, revs: f.revs.length })), estado: s.estado() ? { rev: s.estado().rev, gastos: Object.keys(s.estado().gastos).length } : null })); });
    return;
  }
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', async () => {
    try {
      const r = await s.fetch('https://www.googleapis.com' + req.url, { method: req.method, headers: req.headers, body: body || undefined });
      const t = await r.text(); res.writeHead(r.status, Object.assign({ 'Content-Type': 'application/json' }, cab)); res.end(t);
    } catch (e) { res.writeHead(503, cab); res.end('{"error":"caido"}'); }
  });
}).listen(puerto, '127.0.0.1', () => console.log('Drive simulado en', puerto));
