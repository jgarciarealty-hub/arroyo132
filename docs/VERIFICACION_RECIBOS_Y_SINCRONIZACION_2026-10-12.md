# Arroyo 132 — Recibos, sincronización teléfono↔computadora y seguridad del endpoint (2026-10-12)

**Procedencia:** encargo explícito de Jesvan. **Naturaleza:** auditoría de solo lectura + corrección de código **local, en rama, sin fusionar y sin desplegar**. Nada de producción. Ningún recibo real fue borrado, movido ni sobrescrito. Ningún dato financiero existente fue modificado.

**Antecedente leído:** el checkpoint de la verificación del 2026-10-12 (`arroyo132_verificacion_20261012/CHECKPOINT.md`), que dejó 101/101 pruebas pasando y dos hallazgos abiertos: (a) `/api/analyze-invoice` era un proxy abierto a una API de pago, (b) el modelo fijado a un snapshot con fecha. **No se repitieron las 101 pruebas iniciales** salvo como control de no-regresión al final.

**Herramientas de auditoría (solo lectura, quedan en el repo de trabajo de CouncilOS):**
`inventario_recibos.js` · `modelo_fotos.js` · `auditoria_final.js` · `imagenes_en_backups.js` · `contar_imagenes.js` · `duplicados_hash.js` · `que_pesa.js` · `servicios_peso.js`
→ `council_runtime/supervisor/arroyo132_recibos_20261012/`

---

## 1. Cuántos recibos existen y DÓNDE están realmente

**Primero, la corrección de premisa:** los 11 gastos embebidos en el código (`recuperarRecibos()`, ids 700001–700011) **no son todos los recibos**: son 11 registros contables **sin imagen**, sembrados en la app para que no se perdieran. No representan ni el inventario de gastos ni el de imágenes.

### 1a. Imágenes de recibo que existen hoy (verificadas una por una)

| Dónde | Qué es | Cantidad |
|---|---|---|
| `…\Bo Palmas Arroyo\Recibos\` (Google Drive) | PDFs de recibo archivados con nombre normalizado `A132-REC-001…014` | **13** |
| `…\Bo Palmas Arroyo\` (raíz y subcarpetas) | los mismos 13 con su nombre original (`Adobe Scan …`, `Royal Electric.pdf`, `AIG Electrical .pdf`, …) | 13 (copia) |
| `Backup\arroyo132-backup-2026-04-27.json` y `…-06-16.json` | **PDFs completos embebidos en base64** dentro del respaldo | **8** (4.90 MB) |
| `arroyo132-backup-2026-07-06.json` | — | **0** |
| `G:\My Drive\arroyo132-datos.json` (el archivo que la app mantiene) | — | **0** |

Los 8 embebidos son 6 adjuntos a gastos (`gastos[].archivos[].data`) y 2 adjuntos a un ítem de servicio (`servicios.132B.AAA[0]` y `[2]`):

| # | Archivo | Adjunto a | Peso |
|---|---|---|---|
| 1 | Certificación AAA Bo. Palmas.pdf | gasto $125 — Edgardo Rodríguez Plomero (2026-03-20) | 701 KB |
| 2 | Plan de pago acueducto 132B.pdf | gasto $100 — AAA Deuda anterior (2026-03-24) | 989 KB |
| 3 | CONTRATO Y PRIMER PAGO PARCIAL.pdf | gasto $1,600 — Carmelo Sierra Hernández (2025-04-02) | 626 KB |
| 4 | recibo cheque deposito Palmas.pdf | gasto $60,000 — Severa Rosa (2024-08-28) | 452 KB |
| 5 | recibo Caguas Commercial.pdf | gasto $43.89 — Caguas Commercial (2025-04-02) | 393 KB |
| 6 | La ferretería Cataño.pdf | gasto $28.88 — La Ferrería Cataño (2026-04-15) | 556 KB |
| 7 | Plan de pago acueducto 132B.pdf | servicio `132B.AAA[0]` | 989 KB |
| 8 | recibo de pago fianza y plan de pago.pdf | servicio `132B.AAA[2]` | 316 KB |

**Conclusión:** hay **13 documentos de recibo** como archivos en Drive y **8 PDFs de recibo** embebidos en los respaldos de abril y junio. **El archivo que la app usa a diario no tiene ni una sola imagen.**

### 1b. Registros contables (gastos) — las 4 generaciones siguen sin reconciliarse

| Fuente | Fecha de escritura | Gastos | Total | Viajes | Peajes | Imágenes |
|---|---|---|---|---|---|---|
| `arroyo132-datos.json` (Drive, **vivo**) | 2026-06-17 | 2 | $1,652.54 | 0 | $0 | 0 |
| `Backup\…-2026-04-27.json` | 2026-04-27 | 20 | $65,477.31 | 4 | $32.80 | 8 |
| `Backup\…-2026-06-16.json` | 2026-06-16 | 21 | $65,709.79 | 4 | $32.80 | 8 |
| `…-2026-07-06.json` (el más completo en gastos) | 2026-07-06 | 19 | $4,912.70 | 0 | $0 | 0 |
| Embebidos en `index.html` | — | 11 | $3,299.58 | — | — | 0 |

**29 gastos únicos** cruzando las 4 fuentes por `contratista + fecha + monto`.
**Duplicados dentro de cada fuente: 0.** Ninguna de las 4 se repite a sí misma.
Lo que sí existe es **solapamiento entre generaciones** (el mismo gasto en 2–4 archivos) y **gastos que solo viven en una** — sigue siendo la fragmentación ya documentada en §7 y §19 del expediente; esta auditoría no la resuelve (requiere que Jesvan compare contra la app real).

### 1c. Duplicados de archivo, comprobados por CONTENIDO (sha256), no por nombre

67 archivos analizados → 48 contenidos únicos → **19 grupos con el mismo contenido**. De esos, **13 son el mismo recibo guardado dos veces** (nombre original + copia `A132-REC-*`):

```
recibo Caguas Commercial.pdf      =  Recibos\A132-REC-001_CaguasCommercial_2025-04-02.pdf
Plan de pago acueducto 132B.pdf   =  Recibos\A132-REC-005a_AAA_PlanPago_2026-03-25.pdf
recibo de pago fianza y plan…pdf  =  Recibos\A132-REC-005b_AAA_Fianza_2026-03-25.pdf
Royal Electric.pdf                =  Recibos\A132-REC-006_RoyalElectric_2026-04-12.pdf
AIG Electrical .pdf               =  Recibos\A132-REC-007_AIG_Electrical_2026-04-13.pdf
National Lumber.pdf               =  Recibos\A132-REC-008_NationalLumber_2026-04-13.pdf
Toa Alta Hardware.pdf             =  Recibos\A132-REC-009_ToaAltaHardware_2026-04-13.pdf
Madera 3c.pdf                     =  Recibos\A132-REC-010_Ferreterias3C_2026-04-15.pdf
La ferretería Cataño.pdf          =  Recibos\A132-REC-011_LaFerreteriaCatano_2026-04-15.pdf
Steel Services.pdf                =  Recibos\A132-REC-012_SteelServices_2026-04-15.pdf
Correos … AUTORIZACION TARJETA.pdf=  Recibos\A132-REC-012b_SteelServices_Autorizacion….pdf
Adobe Scan 26 abr 2026.pdf        =  Recibos\A132-REC-013_TargetRentalCar_2026-04-15.pdf
Adobe Scan 28 abr 2026.pdf        =  Recibos\A132-REC-014_FerreteriaCosme_2026-04-28.pdf
```

Los otros 6 grupos duplicados son documentos legales (Declaratoria, Escrituras, Catastro, Memorial, escritura, Mapa Catastro — copias en la carpeta `Severa Rosa\` y en `2024-SCE-303832\`). **Ninguno de los 19 duplicados fue creado por esta sesión y ninguno se tocó** (límite explícito: no borrar ni sobrescribir).

### 1d. Qué NO se pudo verificar (y por qué)

- **Los recibos que Jesvan haya fotografiado desde el teléfono y que no estén en Drive**: viven en el `localStorage` del navegador **de ese teléfono**. No hay ningún mecanismo desde esta computadora para leerlos, y no se puede afirmar que existan o que no.
- Evidencia indirecta fuerte de que **no están respaldados**: el archivo que la app mantiene en Drive no se actualiza desde el **2026-06-17** (§3). Cualquier recibo registrado desde entonces solo existe en el navegador donde se registró.
- **Acceso al teléfono / a los datos del navegador móvil: es exactamente lo que falta.** Sin eso no hay forma de contar los recibos "subidos desde el teléfono" que aún no han llegado a Drive.

---

## 2. Gastos de viaje y peajes — SÍ aparecen, pero como registros, no como recibos

| Viaje | Fecha | Propósito | Peajes | Gasolina | Otros | Total |
|---|---|---|---|---|---|---|
| 1 | 2025-04-02 | Supervisión de obra | $8.20 | $19.75 | $44.50 | $72.45 |
| 2 | 2026-03-18 | Gestión AAA / LUMA (Ponce) | $8.20 | $19.75 | $45.00 | $72.95 |
| 3 | 2026-03-19 | Gestión AAA / LUMA (Ponce) | $8.20 | $19.75 | $45.00 | $72.95 |
| 4 | 2026-04-15 | Compra de materiales | $8.20 | $19.75 | $25.00 | $52.95 |

**Total viajes: $271.30 · peajes: $32.80 ($8.20 por viaje, ida y vuelta PR-5 + PR-52).**

- Los 4 viajes existen en los respaldos de **abril y junio**; **desaparecieron del respaldo del 6 de julio y del archivo vivo**. Debe considerarse una pérdida real de registro si la app en el teléfono ya no los tiene.
- Aparte, hay un 5.º gasto de transportación: **Target Rental Car $87.86** (alquiler de la F150, 2026-04-15).
- **No existe ni una sola imagen de recibo de peaje** en ninguna de las fuentes revisadas. Los $8.20 por viaje son la **tarifa calculada** por la app (`PEAJES_IVY`), no un comprobante.
- **Recibos de viaje/peaje con imagen: 0.** Si Jesvan quiere respaldarlos con comprobante (ticket de Metropistas, recibo de gasolina), hoy no existe ninguno — hay que subirlos.

---

## 3. Google Drive — el respaldo automático llevaba ~4 meses caído SIN AVISAR

**Este es el hallazgo más importante de esta auditoría.**

El archivo que la app mantiene (`G:\My Drive\arroyo132-datos.json`) está:

| Dato | Valor real |
|---|---|
| Formato | `version: 2` — la app escribe `version: 3` desde hace meses |
| Escrito | **2026-06-17T03:46:20Z** |
| Gastos | 2 (Operador Excavadora, Ferretería Cosme) |
| Viajes | 0 |
| Imágenes | 0 |

**Causa raíz, verificada en el código:** el token de acceso de Google dura ~58 minutos (`Date.now() + 3500 * 1000`). Pasado ese rato, `driveTokenValid()` devuelve `false` y `backupToDrive()` **salía con `return` en su primera línea, sin avisar a nadie**. La app seguía diciendo que respaldaba; no respaldaba. Exactamente el patrón `DONE` falso que la política del ecosistema obliga a reabrir.

**Respuesta a las preguntas del encargo sobre Drive:**

| Pregunta | Respuesta verificada |
|---|---|
| ¿El respaldo es automático o manual? | **Automático en el diseño** (`save()` llama a `backupToDrive()`), **pero caído en la práctica desde el 2026-06-17** por el token vencido. |
| ¿Incluye imágenes? | **Solo miniaturas de 320 px** (`fotos[id]`, JPEG al 55%) dentro del JSON. **La foto completa del recibo nunca se guarda** — ni en el dispositivo ni en Drive. |
| ¿Incluye registros? | Gastos, servicios, contratistas, viajes y fotos sí. **No incluía** documentos, timeline, presupuesto, Tu Coop ni financiamiento. |
| ¿Permite recuperar y consultar todo desde la computadora? | **No lo permitía**: `restaurarDesdeDrive()` existía en el código **pero no tenía ningún botón en la interfaz** — era inalcanzable para Jesvan. Y al restaurar **reemplazaba** la lista de gastos en vez de unirla. |
| ¿Cada recibo del teléfono tiene su imagen en Drive? | **No.** El archivo vivo tiene 0 imágenes, y las 13 imágenes de recibo que sí están en Drive llegaron por carga manual/script, no por la app. |
| ¿Los datos contables están asociados a su recibo? | **12 de 13 sí** (ver §5). Uno no. |

---

## 4. Lo que se corrigió (local, probado, **sin desplegar**)

Rama `feat/seguridad-y-sincronizacion-recibos`. `main` y producción **no fueron tocados**.

### 4a. Sincronización teléfono↔computadora (`index.html`)

Se usó la infraestructura que ya existía (Google Drive + Google Identity Services). **No se añadió ningún servicio nuevo.**

1. **Renovación silenciosa del token.** Antes de darse por vencido, `backupToDrive()` intenta renovar el token **sin abrir ninguna ventana** (`prompt: ''`). Si Google ya tiene el consentimiento, el respaldo se reanuda solo. Antes moría a la hora.
2. **El fallo deja de ser invisible.** Nuevas marcas `a132_drive_lastok` y `a132_drive_pendiente`: el ícono de la barra superior se queda en **⚠️** (ya no se borra a los 3 segundos), con la fecha del último respaldo correcto en el `title`, y el panel de Documentos muestra el estado textual.
3. **Reintento automático.** Al recuperar conexión (`online`) o al volver la app a primer plano, si hay algo pendiente se reintenta solo. Un `setTimeout` a los 4 s cubre el arranque.
4. **El respaldo guarda el estado completo** (`version: 4`): gastos, servicios, contratistas, viajes, fotos, **documentos, timeline, presupuesto, Tu Coop y financiamiento**. Antes se perdían al abrir en otro dispositivo.
5. **Restaurar ya no borra.** `restaurarDesdeDrive()` **fusiona** (`fusionarGastos`): añade lo que falte, no duplica (por `id` **y** por `contratista+fecha+monto`) y nunca elimina. Antes hacía `gastos = data.gastos`, o sea que un respaldo viejo borraba gastos locales.
6. **Botones que faltaban** en la sección Documentos: **☁️ Traer datos desde Google Drive**, **⬇️ Exportar respaldo**, **⬆️ Importar respaldo**. Sin ellos, "consultar desde la computadora" era imposible por la interfaz.
7. **Red de seguridad local** (`exportarBackup`/`importarBackup`): recupera la capacidad "Importar backup local" que se perdió en el rediseño `7735957`. Es la vía cuando Drive no está disponible: sin conexión, sesión vencida o Drive caído.
8. **Corregido un error de orden real:** el bloque `INIT` (`updateResumen(); renderTimeline(); renderDocs();`) se ejecutaba **antes** de declararse las constantes de Drive. `renderDocs()` ahora lee el estado de respaldo, así que se movió al final del script; dejarlo donde estaba habría lanzado `ReferenceError` y cortado todo el JavaScript al abrir la app.

### 4b. Seguridad de `/api/analyze-invoice` (`api/analyze-invoice.js`)

El endpoint era un **proxy abierto a una API de pago**: `Access-Control-Allow-Origin: *`, sin autenticación, sin límite, y reenviaba `req.body.messages` tal cual (cualquier prompt, a costa de Jesvan).

| Capa | Qué hace | Por qué |
|---|---|---|
| **1. CORS en lista blanca** | Devuelve `Access-Control-Allow-Origin` solo para orígenes permitidos; nunca `*`. El preflight también se rechaza si el origen no está permitido. | Higiene del navegador. **No es autenticación** y así queda escrito en el código: `curl` ignora CORS. |
| **2. AUTENTICACIÓN REAL** | Exige `Authorization: Bearer <ID token de Google>` y lo verifica **en el servidor**: firma RS256 contra las llaves públicas de Google (JWKS, con caché de 1 h), `iss`, `aud` = Client ID de la app, `exp`, `iat`, `email_verified` y **correo en lista blanca** (`A132_ALLOWED_EMAILS`). Sin esto → **401** y no se llama a Anthropic. | Es la capa que protege la credencial. Reutiliza el Google que la app ya usa para Drive: **ningún servicio nuevo**. |
| **3. Falla cerrado** | Si `A132_ALLOWED_EMAILS` no está configurada → **503** y no se llama a Anthropic. | No puede quedar abierto por descuido al desplegar. |
| **4. Límite de consumo** | Límite por IP (`A132_RATE_PER_MIN`, 6/min) + **presupuesto diario global** (`A132_DAILY_BUDGET`, 200/día) → 429. | Techo de gasto. Se documenta en el código su límite honesto: en serverless la memoria es por instancia, así que es barrera de mejor esfuerzo, no cuota exacta. |
| **5. Validación estricta del cuerpo** | Solo acepta la forma "analizar **un** recibo": 1 mensaje, rol `user`, 1 imagen/PDF + 1 texto corto. Tipos permitidos: jpeg/png/webp/gif/pdf. Base64 validado. Cuerpo máximo 4.2 MB. | Impide usar el endpoint como "cualquier prompt contra Anthropic". |
| **6. El servidor manda** | `model`, `max_tokens` y el prompt de sistema se fijan **en el servidor**; se ignora cualquier `model`, `max_tokens` o `system` que mande el cliente. | Un cliente no puede pedir Opus ni 100 000 tokens. |
| **7. No filtra** | Un error de Anthropic responde `502 {error: 'La IA no pudo procesar el recibo'}`, sin reenviar el mensaje interno. Cabeceras `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. | No se filtra nada del proveedor. |

**Lado cliente:** la app pide el ID token junto con el permiso de Drive (`scope: 'openid email …/drive.file'`), lo guarda con su vencimiento y lo envía en cada escaneo. Si no lo consigue, **avisa y cae a entrada manual** — la app sigue siendo usable sin IA, que es el mismo comportamiento de respaldo que ya tenía.

**Variables de entorno a configurar en Vercel antes de desplegar** (documentadas en la cabecera del archivo): `A132_ALLOWED_EMAILS` (**obligatoria**), `A132_CLIENT_ID`, `A132_ALLOWED_ORIGINS`, `A132_RATE_PER_MIN`, `A132_DAILY_BUDGET`, `A132_MAX_BODY_BYTES`, `A132_MAX_TOKENS`.

**Segundo hallazgo del checkpoint, resuelto:** el modelo con fecha `claude-haiku-4-5-20251001` queda **fijado en el servidor** (una sola constante). Sigue siendo un snapshot con fecha; cambiarlo ahora es una línea, pero **es una decisión de costo/calidad para Jesvan**, no un arreglo automático.

---

## 5. Asociación recibo ↔ registro contable

| Recibo en Drive | ¿Tiene registro contable? |
|---|---|
| A132-REC-001 Caguas Commercial 2025-04-02 | ✅ gasto $43.89 (2025-04-02) |
| A132-REC-005a AAA Plan de Pago 2026-03-25 | ✅ gasto $175 (2026-03-25) + ítem de servicio `132B.AAA` |
| A132-REC-005b AAA Fianza 2026-03-25 | ✅ mismo pago AAA |
| A132-REC-006 Royal Electric 2026-04-12 | ✅ gasto 700006 $12.27 |
| A132-REC-007 AIG Electrical 2026-04-13 | ✅ gasto 700002 $30.22 |
| **A132-REC-008 National Lumber 2026-04-13** | ⚠️ **NO hay ningún gasto llamado "National Lumber".** Existe "Caribbean Lumber Victory $5.09" del **mismo día** (700004) — puede ser el mismo recibo registrado con otro nombre, o puede ser un recibo nunca registrado. **Requiere que Jesvan confirme.** |
| A132-REC-009 Toa Alta Hardware 2026-04-13 | ✅ gasto 700003 $22.28 |
| A132-REC-010 Ferreterías 3C 2026-04-15 | ✅ gasto 700001 $293.02 |
| A132-REC-011 La Ferretería Cataño 2026-04-15 | ✅ gasto 700007 $28.88 |
| A132-REC-012 Steel Services 2026-04-15 | ✅ gasto 700005 $267.42 |
| A132-REC-012b Steel Services Autorización | ✅ documento del checklist (id 14) |
| A132-REC-013 Target Rental Car 2026-04-15 | ✅ gasto 700008 $87.86 |
| A132-REC-014 Ferretería Cosme 2026-04-28 | ✅ gasto $232.48 (2026-04-28) |

**12 de 13 con registro asociado.** Y en el sentido contrario: los 8 gastos históricos sin fecha/descripción verificable (§19 del expediente) **siguen sin imagen de recibo**, y los 3 pagos de viaje listados arriba tampoco tienen comprobante.

---

## 6. Flujo móvil verificado, eslabón por eslabón

| Paso | Estado | Evidencia |
|---|---|---|
| Fotografía | ✅ | `<input type="file" accept="image/*" capture="environment">` + selector de archivo/PDF. Límite de PDF 5 MB. |
| Extracción IA | ✅ (código) | `handleUpload` → `POST /api/analyze-invoice` con la imagen; ahora **con `Authorization: Bearer`**. Precrellena fecha, monto, contratista, categoría y descripción. |
| Revisión humana | ✅ | La IA **solo precrellena**; no guarda nada. El formulario queda a la vista para confirmar o corregir. |
| Categorías | ✅ | 14 categorías reales; la IA elige de esa lista y el `<select>` la selecciona por `value` o por texto. |
| Detección de duplicados | ✅ (2 ejes) | `encontrarGastoDuplicado` (contratista+fecha+monto ±$0.50) y `fotoYaExiste` (miniatura idéntica). Ambos piden `confirm()` explícito; nunca bloquean en silencio. |
| Guardado | ✅ | `guardarGasto` con botón auto-deshabilitado (anti doble clic) → `save()` → `localStorage`. |
| Respaldo | ⚠️ **corregido** | Era el eslabón roto (§3). Ahora renueva el token, avisa si falla y reintenta. |
| Consulta desde otro dispositivo | ⚠️ **corregido** | El botón para traer los datos desde Drive no existía. Ahora existe y fusiona sin borrar. |

**Lo que sigue sin poder verificarse desde aquí:** la punta a punta **real** en un teléfono — porque requiere (a) una llamada real a la IA (cuesta dinero → autorización de gasto) y (b) acceso al navegador del teléfono. Todo lo verificable sin esos dos accesos está verificado.

---

## 7. Recuperación ante fallos de conexión

| Situación | Antes | Ahora |
|---|---|---|
| Sin señal al guardar | El respaldo fallaba **en silencio** | Se marca pendiente, el ícono queda en ⚠️ y **reintenta solo** al volver la conexión o al reabrir la app |
| Sesión de Google vencida | El respaldo moría hasta que el usuario tocara ☁️ | Se renueva **sin abrir ventana**; si no se puede, se avisa |
| Drive caído | Silencio | ⚠️ + mensaje con el motivo + reintento |
| Se recarga la app con cambios sin respaldar | Nada | El aviso ⚠️ se ve desde que abre, con la fecha del último respaldo bueno |
| Sin Drive del todo | No había forma de sacar los datos | **Exportar respaldo** a un archivo; **Importar respaldo** de vuelta |
| Restaurar un respaldo viejo | **Borraría** los gastos locales | **Fusiona**: ningún gasto se pierde y ninguno se duplica |
| Guardado repetido / doble toque | Botón auto-deshabilitado | Igual (ya existía) |

Los datos nunca viven solo en la red: `localStorage` es la fuente primaria y Drive la copia. Ningún fallo de conexión puede perder un registro ya guardado.

---

## 8. Pruebas

| Suite | Qué cubre | Resultado |
|---|---|---|
| `verificacion_endpoint_seguridad.test.js` **(nueva)** | 27 casos: firma manipulada, `alg:none`, `aud`/`iss`/`exp`/correo incorrectos, 401 sin token, 403 de origen, 429 de límite y de presupuesto, rechazo de 2 imágenes / solo texto / texto gigante / tipo no permitido / múltiples mensajes / cuerpo de 4.3 MB, modelo y `max_tokens` fijados por el servidor, fallo de Anthropic sin filtrar | **27/27** |
| `verificacion_sync_respaldo.test.js` **(nueva)** | 44 casos: carga sin excepciones, fusión sin borrar ni duplicar, payload completo, marca de pendiente y su resolución, aviso que sobrevive, `Authorization: Bearer` en el escaneo, restauración que solo añade, red de seguridad local | **44/44** |
| `integration_port_branch` | Rama del port | 16/16 |
| `verificacion_app_actual` | Estructura e integraciones de la app **desplegada** (`main:index.html`) | 36/36 |
| `verificacion_diagnostico` / `verificacion_ivu` / `verificacion_presupuesto` | GD-2 | 30/30 · 7/7 · 12/12 |
| **`verificacion_app_actual` contra el archivo de TRABAJO** | Comprobado también contra el `index.html` modificado, para descartar regresión estructural antes de fusionar | **36/36** |

**Total: 101 pruebas previas (sin regresiones) + 71 nuevas = 172, 0 fallos.**

*Nota de invocación (ya conocida): `node --test tests/` falla; la forma correcta es `node --test tests/*.test.js`.*

---

## 9. Lo que NO se tocó, a propósito

- **Producción**: nada desplegado, nada fusionado a `main`, nada enviado a Vercel.
- **Recibos y datos financieros**: ningún archivo de Drive fue borrado, movido, renombrado ni sobrescrito. **Los 19 grupos duplicados siguen ahí** (13 de ellos son el mismo recibo con dos nombres): eliminarlos es una acción destructiva y necesita la autorización de Jesvan.
- **El archivo vivo de Drive** (`arroyo132-datos.json`, 2 gastos del 17-jun): **NO se sobrescribió con el formato nuevo**. Hacerlo es una escritura sobre el respaldo real; queda para cuando Jesvan apruebe el despliegue, que es lo que lo actualizará de forma natural.
- **Credenciales**: no se cambió ninguna. El Client ID de Google ya estaba versionado en el código (no es secreto); el secreto real, la API key de Anthropic, vive solo en Vercel y sigue ahí.
- **Miniaturas de 320 px** (parche #11 del expediente): sin cambios. Aumentar la calidad es una decisión de Jesvan por el consumo de `localStorage`; sigue siendo un Human Gate.

---

## 10. Qué falta para dejar Arroyo 132 operativo en producción

**Requiere decisión de Jesvan (no se puede ejecutar solo):**

1. **Desplegar la rama** `feat/seguridad-y-sincronizacion-recibos` a producción. Es un cambio de producción → gate. Al desplegarlo hay que **configurar las variables de entorno primero**, sobre todo `A132_ALLOWED_EMAILS`; sin ella el endpoint responde 503 (falla cerrado a propósito).
2. **Autorizar UNA llamada real a la IA** para cerrar la punta a punta con extracción (Haiku, ≤600 tokens, costo mínimo), en un contexto de navegador nuevo y **sin pulsar Backup**, para no escribir en el respaldo real.
3. **Decidir sobre los 19 duplicados de Drive** (13 son el mismo recibo con dos nombres). Borrarlos es destructivo.
4. **Confirmar el recibo National Lumber** (A132-REC-008): ¿es el gasto "Caribbean Lumber Victory $5.09" o nunca se registró?
5. **Reconciliar las 4 generaciones de gastos** contra la app real (§1b). Sigue siendo la pregunta abierta más grande y no se resuelve leyendo archivos.

**Requiere acceso que esta sesión no tiene:**

6. **Acceso al teléfono / a los datos del navegador móvil**, para contar los recibos "subidos desde el teléfono" que aún no están en Drive. Mientras no exista, la única vía es que el respaldo corregido (§4a) los suba, y que se pulse **☁️ Traer datos desde Google Drive** en la computadora.
7. **Identificar la carpeta de Drive** a la que apunta el botón "📂 Abrir Drive" (`…/folders/11yIIr6FrK2I4pFLtDiW-pcyUbuSGLSE6`). No se pudo resolver su ID desde el sistema de archivos. Es un clic para comprobarlo, y las dos carpetas del proyecto (`📸 Facturas y Recibos` y `📋 Documentos Legales`) están **vacías**.

**Recomendación técnica (no urgente):** mover al Haiku actual en vez del snapshot con fecha, y subir la miniatura del recibo por encima de 320 px —hoy es probable que no se lean los montos en la foto guardada—. Ambas son decisiones de costo/almacenamiento.
