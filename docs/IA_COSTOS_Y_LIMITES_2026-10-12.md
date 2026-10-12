# Arroyo 132 — Costo de la IA, modelo recomendado y límites reales (2026-10-12)

**Procedencia:** encargo de Jesvan (§7 "Agente económico para recibos", §8 "Control de costos").
**Naturaleza:** análisis + cambios de código local, **sin desplegar y sin ejecutar ninguna prueba facturable**. No se activó ningún servicio pagado.

---

## 1. Lo que hay hoy

`/api/analyze-invoice` usa `claude-haiku-4-5-20251001` con `max_tokens: 600`. Se llama **una vez por recibo escaneado** y solo para *precrellenar* el formulario: la IA no guarda nada, la persona confirma.

## 2. Comparación de modelos (precios verificados, no de memoria)

Precios de la tabla oficial de Anthropic (por millón de tokens). **Las capacidades se verificaron EN VIVO** contra `GET /v1/models/…` el 2026-10-12 (llamada de solo lectura, sin costo):

| Modelo | Entrada /1M | Salida /1M | Imágenes | PDF | Contexto | ¿Sirve? |
|---|---|---|---|---|---|---|
| **`claude-haiku-5-5`** (recomendado) | **$0.10** | **$0.50** | **Sí** | **Sí** | 1M | **Sí — 10× más barato que el actual** |
| `claude-haiku-4-5` (el que usa hoy) | $1.00 | $5.00 | Sí | Sí | 200K | Sí, pero 10× más caro |
| `claude-sonnet-5-5` | $2.00 | $10.00 | Sí | Sí | 1M | Sobrecualificado para leer un recibo |
| `claude-opus-5-5` | $4.00 | $20.00 | Sí | Sí | 1M | No: 40× el costo para la misma tarea |

**Decisión: `claude-haiku-5-5`.** Es el mismo nivel (Haiku) que ya está en uso, con las mismas capacidades verificadas (imágenes **y** PDF), a **una décima parte del precio**. No es "bajar de nivel": es el Haiku actual.

**Salvedad honesta:** Haiku 5.5 estrena tokenizador (cuenta el mismo texto ~30 % más de tokens) y trae pensamiento adaptativo activado por defecto. Aun contando eso, la ventaja de 10× no se pierde. **Antes de confiar en él para datos financieros hay que validarlo con un recibo real** (§4).

## 3. Costo estimado por recibo

Un recibo fotografiado a 1600 px ≈ **1,600 tokens de imagen** + ~250 de instrucción + ~150 de respuesta:

| | Tokens aprox. | Costo por recibo |
|---|---|---|
| **Con `claude-haiku-5-5`** | ~2,000 | **≈ $0.0003** (tres diezmilésimas de dólar) |
| Con `claude-haiku-4-5` (actual) | ~2,000 | ≈ $0.003 |

**100 recibos al mes cuestan ~3 centavos con el modelo nuevo** (frente a ~30 centavos hoy). El costo de la IA deja de ser un problema de dinero y pasa a ser uno de configuración.

## 4. Cómo se cambia (sin tocar código)

El modelo es una **variable de entorno**, no una constante enterrada:

- `A132_MODEL` — por defecto `claude-haiku-5-5`. Para volver al anterior: `A132_MODEL=claude-haiku-4-5-20251001`.
- `A132_EFFORT` — opcional (`low`). Solo lo entienden los modelos nuevos; si no se pone, no se envía y el código funciona igual con cualquier modelo.
- `A132_MAX_TOKENS` — por defecto 600.
- `A132_RATE_PER_MIN` — 6 por minuto por IP.
- `A132_DAILY_BUDGET` — 200 llamadas al día en total.

**Pasos para cambiarlo con seguridad:** poner `A132_MODEL=claude-haiku-5-5` en Vercel → escanear **un** recibo real → comparar lo que leyó con el papel → si coincide, dejarlo; si no, volver al anterior (una variable, sin desplegar código).

## 5. Ahorros que no dependen del modelo (ya implementados)

| Medida | Qué evita | ¿Probado? |
|---|---|---|
| **Reducción de la foto a 1600 px antes de enviarla** | Subidas de varios MB que el servicio no aprovecha igual; el rechazo por tamaño | Sí |
| **Caché por huella de imagen** | Volver a pagar por el mismo recibo si se reintenta o se re-sube | Sí (2 pruebas) |
| **Si la foto ya está guardada en otro gasto, NO se llama a la IA** | Una lectura pagada solo para descubrir que era un duplicado | Sí |
| **Un solo modelo, no una cascada** | El brief prohíbe explícitamente reprocesar el mismo recibo en varios modelos | Por diseño |
| **Sin reintentos automáticos de IA** | Bucles de reintento costosos: un fallo de IA cae a entrada manual, no reintenta | Sí (4 pruebas adversarias) |

**Ahorro combinado estimado:** el modelo nuevo (10×) + no repetir lecturas. Con el volumen real del proyecto, el gasto de IA pasa a ser del orden de **centavos al mes**.

## 6. Límites reales del control de consumo — declaración expresa

**Lo que sí está garantizado:**

- **Solo entra quien está autorizado.** El endpoint exige una credencial de Google verificada **en el servidor** contra Google, y el correo debe estar en la lista blanca (`A132_ALLOWED_EMAILS`). Sin ella: 401. Es la barrera real, y es fuerte.
- **Falla cerrado:** si la lista blanca no está configurada, el endpoint responde 503 y no llama a la IA.
- **Techo por petición:** el tamaño del archivo, el largo del texto, el `max_tokens` y el modelo los fija el servidor; el cliente no los puede subir.
- **Barrera por minuto y por día** (por IP y global del proceso).

**La limitación, dicha claramente:** los contadores de "por minuto" y "por día" viven **en la memoria del proceso**. Vercel puede tener varias instancias a la vez y las apaga cuando quiere, así que **no son un límite global garantizado**. Un atacante con una credencial válida podría, en teoría, superar el contador del día repartiendo peticiones entre instancias.

En la práctica el riesgo es bajo porque **solo hay un usuario autorizado**: la lista blanca es de Jesvan. Pero no se puede afirmar que exista una cuota global dura, y no la voy a vender como si existiera.

**Si se quiere un límite global de verdad** (recomendado solo si algún día hay más de un usuario o se abre el endpoint), hace falta un contador compartido entre instancias. Opciones proporcionales, de menor a mayor coste:

1. **Contador diario en el respaldo de Google Drive** — viaja con la app a todos los dispositivos y no cuesta nada nuevo. Límite: quien llame al endpoint directamente sin la app lo esquiva. Con un solo usuario autorizado, cubre el caso real.
2. **Supabase** — el ecosistema ya lo paga y ya se usa para gobernanza. Daría un contador atómico y global de verdad. **Implica conectar Arroyo 132 a un servicio de otro proyecto: es una decisión de Jesvan, no la tomo yo.**
3. Nada más: un servicio nuevo (Redis/KV) sería desproporcionado para este volumen.

**Recomendación:** quedarse con lo que hay (autenticación fuerte + barrera de mejor esfuerzo) mientras haya un solo usuario; si algún día se abre, ir a la opción 2 con autorización explícita.

## 7. Sobre "no usar agentes de programación costosos"

Este proyecto **no usa ningún agente de programación** para leer recibos, ni en producción ni en este trabajo: la lectura es una sola llamada HTTP al modelo económico, con un prompt fijo y una respuesta en JSON. No hay bucle de agente, ni herramientas, ni varios pasos.
