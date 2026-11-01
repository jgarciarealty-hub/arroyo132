// Vercel Serverless Function — Proxy para Anthropic API (CommonJS).
//
// PARCHE MÍNIMO P0 (2026-11-01). La versión anterior devolvía `error.message` al cliente. Con la
// variable ANTHROPIC_API_KEY mal guardada (valor repetido con saltos de línea) Node lanzaba
// «Headers.append: "<clave>" is an invalid header value» y esa frase, con la clave dentro, salía en la
// respuesta HTTP 500 a cualquiera. Este parche NO añade autenticación (eso está en la rama
// feat/seguridad-y-sincronizacion-recibos y exige A132_ALLOWED_EMAILS); solo cierra la fuga:
//   · NUNCA se devuelve el texto de una excepción ni el cuerpo de un error del proveedor: solo mensajes
//     genéricos fijos. El detalle técnico va a los registros del servidor SIN el valor de la clave.
//   · La petición debe tener forma de «analizar un recibo» (messages = exactamente 1 mensaje de usuario,
//     cuerpo ≤ 4,2 MB) ANTES de tocar la clave: un POST vacío ya no llega a ningún código que use la clave.
//   · CORS deja de ser «*»: solo el origen de la app (configurable con A132_ALLOWED_ORIGIN si se usa otro dominio).
'use strict';

const ORIGEN_APP = process.env.A132_ALLOWED_ORIGIN || 'https://arroyo132.vercel.app';
const MODELO = process.env.A132_MODEL || 'claude-haiku-4-5-20251001';
const MAX_BYTES = 4_200_000;

// Registra sin filtrar secretos: solo el tipo de error, nunca el mensaje (que podría contener la clave).
function registrarError(etiqueta, error) {
  try { console.error('[analyze-invoice] ' + etiqueta + ': ' + ((error && error.name) || 'Error')); } catch (e) { /* sin registro */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGEN_APP);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Validación de forma ANTES de leer o usar la clave.
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    if (cuerpo.length > MAX_BYTES) return res.status(413).json({ error: 'Solicitud demasiado grande' });
    try { cuerpo = JSON.parse(cuerpo); } catch (e) { return res.status(400).json({ error: 'Solicitud inválida' }); }
  }
  if (!cuerpo || typeof cuerpo !== 'object' || !Array.isArray(cuerpo.messages) ||
      cuerpo.messages.length !== 1 || !cuerpo.messages[0] || cuerpo.messages[0].role !== 'user') {
    return res.status(400).json({ error: 'Solicitud inválida' });
  }
  // Forma del contenido: 1–2 bloques de tipo image/document/text (lo que envía la app: el recibo + una instrucción).
  const contenido = cuerpo.messages[0].content;
  const tiposOk = new Set(['image', 'document', 'text']);
  if (!Array.isArray(contenido) || contenido.length < 1 || contenido.length > 2 ||
      !contenido.every(function (b) { return b && typeof b === 'object' && tiposOk.has(b.type); })) {
    return res.status(400).json({ error: 'Solicitud inválida' });
  }
  let largo = 0;
  try { largo = JSON.stringify(cuerpo).length; } catch (e) { return res.status(400).json({ error: 'Solicitud inválida' }); }
  if (largo > MAX_BYTES) return res.status(413).json({ error: 'Solicitud demasiado grande' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'Servicio de lectura de recibos no disponible' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODELO, max_tokens: 600, messages: cuerpo.messages }),
    });
    if (!response.ok) {
      registrarError('proveedor respondió ' + response.status, null);
      return res.status(502).json({ error: 'La IA no pudo procesar el recibo' });
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    registrarError('excepción', error);
    return res.status(500).json({ error: 'Error procesando la solicitud' });
  }
};
