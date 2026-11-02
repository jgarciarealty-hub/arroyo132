// Vercel Serverless Function — Proxy AUTENTICADO para la API de Anthropic (CommonJS).
//
// ─────────────────────────────────────────────────────────────────────────────
// SEGURIDAD (2026-10-12). Hasta esta versión el endpoint era un proxy ABIERTO a una API de
// pago: `Access-Control-Allow-Origin: *`, sin autenticación y sin límite de peticiones.
// Cualquiera que conociera la URL podía llamarlo indefinidamente y gastar el crédito de
// Anthropic de Jesvan (hallazgo de la verificación del 2026-10-12).
//
// Capas de defensa, TODAS obligatorias (CORS NO sustituye a la autenticación):
//   1. Origen permitido (lista blanca). NO es autenticación: solo evita que una web ajena
//      use el endpoint desde el navegador de un visitante.
//   2. AUTENTICACIÓN REAL DEL LADO DEL SERVIDOR: la app envía la credencial de Google del
//      usuario y el servidor la verifica ÉL MISMO contra Google — nunca la acepta porque el
//      cliente diga que es válida. Se aceptan las dos formas y cada una se verifica como
//      corresponde (ver `verificarCredencial`):
//        · JWT de 3 segmentos → ID token: firma RS256 contra las llaves públicas de Google
//          (JWKS), más emisor, audiencia, caducidad y correo en lista blanca.
//        · cualquier otra cosa → token de acceso: se pregunta a Google (`tokeninfo`), que es
//          quien lo emitió, y se comprueba audiencia, vigencia y correo verificado.
//      Sin esto → 401. Es la capa que realmente protege la credencial de Anthropic.
//   3. Límite de peticiones por IP + presupuesto diario global (control de consumo).
//   4. Validación estricta del cuerpo: la petición tiene que tener forma de "analizar UN
//      recibo" (una imagen o PDF + un texto corto). No se reenvía un prompt arbitrario.
//
// FALLA CERRADO: si la autenticación no está configurada (falta A132_ALLOWED_EMAILS), el
// endpoint responde 503 y NO llama a Anthropic. Nunca queda abierto por descuido.
//
// Variables de entorno (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY        (ya existía) — la credencial que hay que proteger.
//   A132_ALLOWED_EMAILS      OBLIGATORIA. Correos de Google autorizados, separados por coma.
//   A132_CLIENT_ID           Client ID de OAuth con el que la app pide el token (aud).
//   A132_ALLOWED_ORIGINS     Orígenes web permitidos, separados por coma.
//   A132_RATE_PER_MIN        Peticiones por minuto por IP (por defecto 6).
//   A132_DAILY_BUDGET        Máximo de llamadas al día en total (por defecto 200).
//   A132_MAX_BODY_BYTES      Tamaño máximo del cuerpo en bytes (por defecto 4.2 MB: el límite
//                            real de cuerpo de una función serverless de Vercel es 4.5 MB).
//   A132_MAX_TOKENS          max_tokens hacia Anthropic (por defecto 1500; nunca menos de 1000, ver MIN_TOKENS_LECTURA).
//   A132_MODEL               Modelo de lectura de recibos. Por defecto `claude-haiku-5-5`
//                            ($0.10/$0.50 por millón de tokens, 10x más barato que
//                            `claude-haiku-4-5`; ambos soportan imágenes y PDF, verificado).
//   A132_EFFORT              `low`/`medium`/`high`. Con el modelo por defecto (Haiku 5.5) se envía `low`
//                            si no se configura (ver MIN_TOKENS_LECTURA); con otro modelo solo se envía si se pone.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const crypto = require('node:crypto');

// Client ID público de la app (el mismo que usa index.html para Google Drive). No es un
// secreto: el secreto aquí es la API key de Anthropic, que vive solo en el servidor.
const CLIENT_ID_DEFECTO = '797904134164-ldgbl8bj4b79tqc3g7j6rfbq0au0h949.apps.googleusercontent.com';
const ORIGENES_DEFECTO = 'https://arroyo132.vercel.app';
// Modelo para leer recibos. Cambiado el 2026-10-12 tras verificar EN VIVO contra la API de
// modelos: `claude-haiku-5-5` soporta imágenes y PDF y cuesta $0.10/$0.50 por millón de tokens,
// frente a los $1.00/$5.00 de `claude-haiku-4-5` — **10 veces menos** por el mismo trabajo.
// La app NUNCA guarda sola: la IA solo precrellena y una persona confirma, así que un cambio de
// modelo no puede meter un dato malo sin que alguien lo vea. Se puede volver al anterior (o
// probar otro) sin tocar código: variable de entorno `A132_MODEL`.
const MODELO_DEFECTO = 'claude-haiku-5-5';
// CORRECCIÓN 2026-11-02 (hipótesis a confirmar con una lectura real). Claude Haiku 5.5 usa pensamiento
// adaptativo ACTIVADO por defecto (esfuerzo por defecto `medium`) y los tokens de pensamiento cuentan
// contra `max_tokens`. Con max_tokens=600 una foto difícil puede gastar los 600 pensando y devolver
// `stop_reason: max_tokens` con texto vacío: HTTP 200, sin datos — exactamente el síntoma de «No se pudo
// leer el recibo». Un PDF limpio necesita poco pensamiento y cabía. Leer un recibo no necesita razonar
// largo: esfuerzo `low` y más margen de tokens. El piso evita que una variable de entorno vieja (600)
// reintroduzca el problema.
const MIN_TOKENS_LECTURA = 1000;
const TOKENS_DEFECTO = 1500;
const TIPOS_MEDIA_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES_VALIDOS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// ─────────────────────────── configuración ───────────────────────────

function listaEnv(nombre, porDefecto) {
  const bruto = process.env[nombre];
  if (bruto === undefined || String(bruto).trim() === '') return porDefecto;
  return String(bruto).split(',').map(s => s.trim()).filter(Boolean);
}

function emailsPermitidos() {
  return listaEnv('A132_ALLOWED_EMAILS', []).map(e => e.toLowerCase());
}

function origenesPermitidos() {
  return listaEnv('A132_ALLOWED_ORIGINS', [ORIGENES_DEFECTO]);
}

function enteroEnv(nombre, porDefecto) {
  const n = parseInt(process.env[nombre] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

// ─────────────────────────── utilidades JWT/JWKS ───────────────────────────

function b64urlABuffer(s) {
  // base64url -> Buffer. Node acepta base64url de forma nativa, pero se normaliza para
  // no depender de la versión.
  const normalizado = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalizado, 'base64');
}

let _jwks = null;
let _jwksExpira = 0;

async function obtenerJwks() {
  const ahora = Date.now();
  if (_jwks && ahora < _jwksExpira) return _jwks;
  const r = await fetch(GOOGLE_JWKS_URL);
  if (!r.ok) throw new Error('No se pudieron obtener las llaves públicas de Google');
  const datos = await r.json();
  _jwks = Array.isArray(datos.keys) ? datos.keys : [];
  _jwksExpira = ahora + 3600 * 1000; // Google rota las llaves; 1 h de caché es seguro.
  return _jwks;
}

/**
 * Verifica un ID token de Google. Devuelve {ok:true,email} o {ok:false,motivo}.
 * `opts` permite inyectar jwks/clientId/emails en las pruebas (sin red).
 */
async function verificarIdTokenGoogle(token, opts) {
  const o = opts || {};
  const clientId = o.clientId || process.env.A132_CLIENT_ID || CLIENT_ID_DEFECTO;
  const emails = o.emails || emailsPermitidos();

  const partes = String(token || '').split('.');
  if (partes.length !== 3) return { ok: false, motivo: 'formato' };

  let header, payload;
  try {
    header = JSON.parse(b64urlABuffer(partes[0]).toString('utf8'));
    payload = JSON.parse(b64urlABuffer(partes[1]).toString('utf8'));
  } catch (e) {
    return { ok: false, motivo: 'json' };
  }

  if (header.alg !== 'RS256') return { ok: false, motivo: 'alg' };

  let llaves;
  try {
    llaves = o.jwks || await obtenerJwks();
  } catch (e) {
    return { ok: false, motivo: 'jwks' };
  }

  const jwk = llaves.find(k => k.kid === header.kid);
  if (!jwk) return { ok: false, motivo: 'kid' };

  let firmaValida = false;
  try {
    const llave = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    firmaValida = crypto.verify(
      'RSA-SHA256',
      Buffer.from(partes[0] + '.' + partes[1]),
      llave,
      b64urlABuffer(partes[2])
    );
  } catch (e) {
    return { ok: false, motivo: 'llave' };
  }
  if (!firmaValida) return { ok: false, motivo: 'firma' };

  const ahora = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) return { ok: false, motivo: 'aud' };
  if (!EMISORES_VALIDOS.has(payload.iss)) return { ok: false, motivo: 'iss' };
  if (!(typeof payload.exp === 'number' && payload.exp > ahora - 60)) return { ok: false, motivo: 'exp' };
  if (typeof payload.iat === 'number' && payload.iat > ahora + 300) return { ok: false, motivo: 'iat' };
  if (payload.email_verified === false) return { ok: false, motivo: 'email_verified' };

  const email = String(payload.email || '').toLowerCase();
  if (!email || !emails.includes(email)) return { ok: false, motivo: 'email' };

  return { ok: true, email };
}

// ─────────────────────────── verificación del token de ACCESO ───────────────────────────
// CORRECCIÓN 2026-10-12 (segunda pasada). La primera versión de este archivo esperaba un ID
// token (`resp.id_token`) del flujo `google.accounts.oauth2.initTokenClient`. Eso es un ERROR:
// ese flujo devuelve un **token de acceso** (opaco), NO un ID token — la referencia oficial de
// Google para `TokenResponse` no incluye `id_token`. Con ese error, la app nunca habría
// obtenido credencial y el escaneo con IA habría caído siempre a entrada manual.
//
// Mecanismo válido, sin credenciales nuevas y sin servicios nuevos: el token de acceso se
// verifica **preguntándole a Google** (endpoint `tokeninfo`), que es quien lo emitió. Se
// comprueba que sea de esta aplicación (`audience`) y que no esté vencido (`expires_in`), y se
// toma el correo verificado de ahí (`email`, presente porque la app pide el alcance `email`).
// Un token falso o vencido hace que Google responda 400 `invalid_token`.
const GOOGLE_TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v1/tokeninfo';

// Caché corta por token (evita golpear a Google en cada recibo). Se guarda solo un hash, nunca
// el token en claro. TTL acotado a 5 min o a lo que le quede de vida al token, lo que sea menor.
const _tokensVistos = new Map();
const TTL_CACHE_TOKEN_MS = 5 * 60 * 1000;

function huella(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function verificarTokenDeAccesoGoogle(token, opts) {
  const o = opts || {};
  const clientId = o.clientId || process.env.A132_CLIENT_ID || CLIENT_ID_DEFECTO;
  const emails = o.emails || emailsPermitidos();
  const ahora = Date.now();

  const h = huella(token);
  const guardado = _tokensVistos.get(h);
  if (guardado && ahora < guardado.hasta) {
    return guardado.resultado;
  }

  let datos;
  try {
    // El token va en el cuerpo del POST para que no quede en los registros de la URL.
    const r = await fetch(GOOGLE_TOKENINFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'access_token=' + encodeURIComponent(token),
    });
    if (!r.ok) {
      const fallo = { ok: false, motivo: 'token_rechazado_por_google' };
      _tokensVistos.set(h, { resultado: fallo, hasta: ahora + 60000 });
      return fallo;
    }
    datos = await r.json();
  } catch (e) {
    return { ok: false, motivo: 'sin_respuesta_de_google' };
  }

  if (Number(datos.expires_in) <= 0) return { ok: false, motivo: 'vencido' };
  if (datos.audience !== clientId && datos.issued_to !== clientId) return { ok: false, motivo: 'aud' };

  const email = String(datos.email || '').toLowerCase();
  if (!email) return { ok: false, motivo: 'sin_correo' };
  if (datos.verified_email === false || datos.email_verified === 'false') return { ok: false, motivo: 'correo_no_verificado' };
  if (!emails.includes(email)) return { ok: false, motivo: 'email' };

  const resultado = { ok: true, email };
  const ttl = Math.min(TTL_CACHE_TOKEN_MS, Math.max(0, (Number(datos.expires_in) - 30) * 1000));
  _tokensVistos.set(h, { resultado, hasta: ahora + ttl });
  if (_tokensVistos.size > 2000) _tokensVistos.clear();
  return resultado;
}

/**
 * Decide qué tipo de credencial llegó y la verifica en consecuencia.
 * - Tres segmentos separados por punto → es un JWT: se verifica como ID token de Google.
 * - Cualquier otra cosa → token de acceso opaco: se verifica contra Google (tokeninfo).
 * En ambos casos la verificación es del lado del servidor y falla cerrado.
 */
async function verificarCredencial(token, opts) {
  const t = String(token || '');
  if (t.split('.').length === 3) return verificarIdTokenGoogle(t, opts);
  if (!t) return { ok: false, motivo: 'vacio' };
  return verificarTokenDeAccesoGoogle(t, opts);
}

// ─────────────────────────── CORS ───────────────────────────
// Lista blanca. Se devuelve el origen solo si está permitido; nunca '*'.
// Nota explícita: esto NO autentica a nadie — un cliente que no sea un navegador (curl,
// un script) ignora CORS por completo. La autenticación real es el ID token de arriba.

function origenPermitido(origin) {
  if (!origin) return null;
  return origenesPermitidos().includes(origin) ? origin : null;
}

function aplicarCors(req, res) {
  const permitido = origenPermitido(req.headers && req.headers.origin);
  if (permitido) {
    res.setHeader('Access-Control-Allow-Origin', permitido);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  return permitido;
}

// ─────────────────────────── control de consumo ───────────────────────────
// En memoria del proceso. En serverless cada instancia es efímera, así que esto es una
// barrera de mejor esfuerzo, no una cuota exacta. La protección fuerte es la autenticación.
// Se documenta así a propósito para no vender una garantía que no existe.

const _ventanas = new Map(); // ip -> timestamps
let _presupuesto = { dia: '', usadas: 0 };

function ipDe(req) {
  const fwd = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  return String(fwd).split(',')[0].trim() || 'desconocida';
}

function dentroDeLimite(ip, maxPorMinuto) {
  const ahora = Date.now();
  const previos = (_ventanas.get(ip) || []).filter(t => ahora - t < 60000);
  if (previos.length >= maxPorMinuto) {
    _ventanas.set(ip, previos);
    return false;
  }
  previos.push(ahora);
  _ventanas.set(ip, previos);
  if (_ventanas.size > 5000) _ventanas.clear(); // techo de memoria
  return true;
}

function dentroDePresupuesto(maxDiario) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (_presupuesto.dia !== hoy) _presupuesto = { dia: hoy, usadas: 0 };
  if (_presupuesto.usadas >= maxDiario) return false;
  _presupuesto.usadas++;
  return true;
}

// ─────────────────────────── validación del cuerpo ───────────────────────────
// Impide que el endpoint se use como "cualquier prompt contra Anthropic": solo pasa una
// petición con forma de análisis de UN recibo.

function validarCuerpo(body, maxTexto) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  const mensajes = body.messages;
  if (!Array.isArray(mensajes) || mensajes.length !== 1) {
    return { ok: false, error: 'Solo se permite un mensaje' };
  }
  const msg = mensajes[0];
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) {
    return { ok: false, error: 'Formato de mensaje no permitido' };
  }
  if (msg.content.length < 1 || msg.content.length > 2) {
    return { ok: false, error: 'Solo se permite una imagen y un texto' };
  }

  const bloques = [];
  let imagenes = 0;
  let textos = 0;

  for (const b of msg.content) {
    if (!b || typeof b !== 'object') return { ok: false, error: 'Bloque inválido' };

    if (b.type === 'image' || b.type === 'document') {
      imagenes++;
      const src = b.source || {};
      if (src.type !== 'base64') return { ok: false, error: 'Fuente no permitida' };
      if (!TIPOS_MEDIA_PERMITIDOS.has(src.media_type)) {
        return { ok: false, error: 'Tipo de archivo no permitido' };
      }
      const datos = String(src.data || '');
      if (!datos) return { ok: false, error: 'Archivo vacío' };
      if (!/^[A-Za-z0-9+/=\s]+$/.test(datos)) return { ok: false, error: 'Archivo mal codificado' };
      bloques.push({ type: b.type, source: { type: 'base64', media_type: src.media_type, data: datos } });
      continue;
    }

    if (b.type === 'text') {
      textos++;
      const t = String(b.text || '');
      if (t.length > maxTexto) return { ok: false, error: 'Texto demasiado largo' };
      bloques.push({ type: 'text', text: t });
      continue;
    }

    return { ok: false, error: 'Tipo de contenido no permitido' };
  }

  if (imagenes !== 1 || textos > 1) return { ok: false, error: 'Se requiere exactamente un recibo' };
  if (!bloques.some(b => b.type === 'text')) bloques.push({ type: 'text', text: 'Analiza este recibo.' });

  return { ok: true, bloque: bloques };
}

// ─────────────────────────── handler ───────────────────────────

async function handler(req, res) {
  const permitido = aplicarCors(req, res);

  if (req.method === 'OPTIONS') {
    // Preflight: se responde solo si el origen está en la lista blanca.
    if (!permitido) return res.status(403).end();
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // (1) Origen (no es autenticación, es higiene del navegador).
  if (!permitido) return res.status(403).json({ error: 'Origen no autorizado' });

  // (0) Falla cerrado si la autenticación no está configurada.
  const emails = emailsPermitidos();
  if (emails.length === 0) {
    return res.status(503).json({
      error: 'Endpoint deshabilitado: falta configurar A132_ALLOWED_EMAILS en Vercel.',
    });
  }

  // (2) AUTENTICACIÓN REAL.
  const cabecera = String((req.headers && req.headers.authorization) || '');
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const verificado = await verificarCredencial(token, { emails });
  if (!verificado.ok) return res.status(401).json({ error: 'No autorizado' });

  // (3) Límites de consumo.
  if (!dentroDeLimite(ipDe(req), enteroEnv('A132_RATE_PER_MIN', 6))) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, intenta en un minuto.' });
  }
  if (!dentroDePresupuesto(enteroEnv('A132_DAILY_BUDGET', 200))) {
    return res.status(429).json({ error: 'Presupuesto diario de IA alcanzado.' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada en Vercel' });

  // (4) Validación del cuerpo (control de consumo: no se acepta un prompt arbitrario).
  const maxBytes = enteroEnv('A132_MAX_BODY_BYTES', 4_200_000);
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    if (cuerpo.length > maxBytes) return res.status(413).json({ error: 'Solicitud demasiado grande' });
    try { cuerpo = JSON.parse(cuerpo); } catch (e) { return res.status(400).json({ error: 'JSON inválido' }); }
  }
  if (cuerpo && typeof cuerpo === 'object' && JSON.stringify(cuerpo).length > maxBytes) {
    return res.status(413).json({ error: 'Solicitud demasiado grande' });
  }

  const validado = validarCuerpo(cuerpo, enteroEnv('A132_MAX_TEXT_CHARS', 2000));
  if (!validado.ok) return res.status(400).json({ error: validado.error });

  try {
    const cuerpoAnthropic = {
      model: process.env.A132_MODEL || MODELO_DEFECTO,
      max_tokens: Math.max(MIN_TOKENS_LECTURA, enteroEnv('A132_MAX_TOKENS', TOKENS_DEFECTO)),
      messages: [{ role: 'user', content: validado.bloque }],
    };
    // `effort` (opcional) solo lo entienden los modelos nuevos. Si no está configurado no se
    // envía nada, para que el mismo código funcione con cualquier modelo.
    const esfuerzo = process.env.A132_EFFORT || (process.env.A132_MODEL ? '' : 'low');
    if (esfuerzo) cuerpoAnthropic.output_config = { effort: esfuerzo };

    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(cuerpoAnthropic),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) {
      // No se reenvía el cuerpo del error de Anthropic (puede filtrar detalles internos).
      return res.status(502).json({ error: 'La IA no pudo procesar el recibo' });
    }
    return res.status(200).json(datos);
  } catch (error) {
    return res.status(500).json({ error: 'Error procesando la solicitud' });
  }
}

module.exports = handler;

// Solo para las pruebas automatizadas (no lo usa Vercel).
module.exports._internals = {
  verificarIdTokenGoogle,
  verificarTokenDeAccesoGoogle,
  verificarCredencial,
  validarCuerpo,
  aplicarCors,
  origenPermitido,
  dentroDeLimite,
  dentroDePresupuesto,
  ipDe,
  _reiniciar: () => { _ventanas.clear(); _presupuesto = { dia: '', usadas: 0 }; _tokensVistos.clear(); },
  _ponerJwks: (llaves) => { _jwks = llaves; _jwksExpira = Date.now() + 3600 * 1000; },
  MODELO_DEFECTO,
  MIN_TOKENS_LECTURA,
  TOKENS_DEFECTO,
  CLIENT_ID_DEFECTO,
  ORIGENES_DEFECTO,
  GOOGLE_TOKENINFO_URL,
};
