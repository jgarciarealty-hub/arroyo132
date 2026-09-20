# Arroyo 132 — Expediente de Estado

**Proyecto independiente.** No mezclado con Terreno Ocala, JGarcia Realty, JGarciaIA, ni CouncilOS — este archivo vive únicamente dentro de este repositorio (`arroyo132-git/`), que es la fuente canónica del código de este proyecto.

**Última actualización:** 2026-08-24 (auditoría completa, solo lectura, sin ejecutar nada)

---

## 1. Qué es

App web (PWA de una sola página) para llevar control de construcción/renovación de dos lotes — **132A y 132B**, ambos en 132 Pomarosa St., Parcelas Viejas, Palmas Ward, Arroyo, PR 00714. Título real en el código: "Proyecto Arroyo 132 — JGarcía Realty".

## 2. Código y funcionalidad — verificado, no supuesto

`index.html` (159,397 bytes) — **11 pestañas reales, todas implementadas, sin código a medias** (no se encontró ningún `TODO`/`FIXME`/stub en el archivo):

Resumen Ejecutivo · Dashboard · Timeline · Registrar Gasto · Historial · Servicios Públicos · ROI/Retorno · Gráficas · Tu Coop/Línea · Gastos de Viaje · Reporte para Banco · Contratistas · Documentos.

- PIN de seguridad con bloqueo por intentos fallidos y auto-lock por sesión.
- Registro de gastos con foto/PDF → análisis automático con Claude (Anthropic, `claude-haiku-4-5-20251001`) vía `/api/analyze-invoice` — extrae fecha/monto/contratista/categoría/descripción, wireado de verdad, no simulado.
- Backup/restauración automática a Google Drive (OAuth vía Google Identity Services).
- Categorías de gasto reales: Techo, Electricidad, Plomería, Albañilería/Estructura, Pintura, Ventanas/Puertas, Baños, Cocina, Limpieza/Excavación, Materiales, Permisos/ARPE, Agrimensura/Segregación, Abogado/Notaría, Otros.

**`api/analyze-invoice.js` (Vercel) y `netlify/functions/analyze-invoice.js` (Netlify) ya divergieron** — mismo modelo, pero `max_tokens` distinto (600 vs 1000), formatos de respuesta distintos (cada uno escrito para su propio runtime), y CORS distinto (`*` vs dominio fijo de Netlify). Ambos archivos siguen coexistiendo en el repo.

## 3. Git / GitHub

- Remoto real: `github.com/jgarciarealty-hub/arroyo132.git` (fetch+push).
- `main` está **limpio y sincronizado con `origin/main`** — nada local sin subir.
- `vercel.json` presente y correcto. **`netlify.toml` y las funciones de Netlify siguen presentes también** — la migración de junio ("Migrar Arroyo 132 de Netlify a Vercel") agregó la config de Vercel pero nunca limpió la de Netlify. El repo hoy soporta ambos destinos de despliegue simultáneamente.
- `PROBAR-LOCAL.bat` solo abre `index.html` directo en el navegador — sin servidor, así que el escaneo de recibos con IA no se puede probar así (necesita `/api/analyze-invoice` real).

## 4. Vercel

Confirmado por configuración que Vercel es el destino de despliegue actual pretendido (commits más recientes, `vercel.json` coincide con las rutas reales de la app). **No se pudo verificar si el despliegue está realmente en vivo ni si `ANTHROPIC_API_KEY` está configurado en Vercel** — esta sesión no tiene acceso al dashboard de Vercel. Pendiente de confirmar directamente ahí.

## 5. Ramas existentes

```
* main
  remotes/origin/main
  remotes/origin/claude/email-access-request-WNyf2
```
Solo 9 commits reales en `main` (17-jun más reciente), 2 commits en la rama suelta, ambas bifurcando del mismo commit de migración a Vercel (`fc0a54e`). `main` no tiene ninguna otra rama fusionada en él.

## 6. Rama sin fusionar `claude/email-access-request-WNyf2` — investigada a fondo

**Diff completo confirmado: solo agrega 2 archivos nuevos (`CLAUDE.md`, `PLAN-EMAILS-LEADS.md`) — no toca `index.html` ni `api/analyze-invoice.js` en absoluto.** Contenido: un plan de respuesta a leads de renta para Ave. Laurel (Bayamón) con plantillas bilingües y una tabla de prospectos con nombres/emails personales — completamente ajeno al propósito de este proyecto (construcción).

**Diagnóstico:** commit extraviado — una sesión de Claude trabajando en el flujo de Laurel apuntó su `git push` al repo equivocado (este, en vez del que realmente maneja los leads de renta).

**Recomendación:** dejar la rama sin fusionar (no aporta nada a Arroyo 132, y fusionarla contaminaría este repo de construcción con contenido de renta ajeno + datos personales de prospectos). Si el contenido de Laurel tiene valor, debería rescatarse (cherry-pick de esos 2 archivos) hacia el repositorio correcto — no ejecutado, pendiente de tu decisión, sin urgencia.

## 7. Gastos y contratistas — hallazgo central: datos fragmentados en 4 versiones que no coinciden

| Archivo | Fecha | Total |
|---|---|---|
| `G:\My Drive\arroyo132-datos.json` | 2026-06-17 | $1,652.54 |
| `...\Backup\arroyo132-backup-2026-04-27.json` | 2026-04-27 | (20 líneas, con fotos, no sumado) |
| `...\Backup\arroyo132-backup-2026-06-16.json` | 2026-06-16 | (21 líneas, con fotos, no sumado) |
| **`...\Bo Palmas Arroyo\arroyo132-backup-2026-07-06.json`** | **2026-07-06** | **$4,912.70 (el más completo)** |

El archivo del 6 de julio (el más reciente y completo) tiene 19 gastos reales: excavación $1,500, materiales/ferretería de ~13 proveedores, un pago a AAA ($175, cuenta 00023299-205, lote 132-B), y un agrimensor (Carmelo Sierra Hernández, cotización $1,600, 50% pagado con cheque #2099). También menciona un precio de compra de $60,000 (1-abr-2025) que no aparece en ningún otro archivo.

**No se pudo confirmar si estos 17 gastos adicionales llegaron a la app real.** Existe un script (`importar_facturas_arroyo.js`, raíz del proyecto JGarcia) que genera un texto (`script_consola_arroyo.txt`) diseñado para pegarse manualmente en la consola del navegador de la app en vivo — no hay forma de saber, leyendo archivos, si eso se hizo alguna vez.

**Servicios AAA/LUMA — 100% pendiente en ambos lotes**, $0 pagado en cualquier línea, confirmado en el snapshot más reciente (aparte del pago de $175 registrado como gasto suelto, que es un abono al plan de pago, no una resolución del checklist).

**Acción pendiente tuya:** abrir la app real, ir a la pestaña Historial/Reporte, y comparar contra estos 4 archivos para determinar cuál refleja de verdad lo que hay en la app — ninguno de los 4 puede asumirse como "la verdad" sin esa comparación.

## 8. Documentación

No existía ningún README ni documento de arquitectura antes de este expediente. El único "CLAUDE.md" asociado al proyecto vive en la rama sin fusionar (punto 6) y es sobre Laurel, no sobre Arroyo 132 — nunca estuvo en `main`.

## 9. Estado real de implementación

**Funcionando, verificado por código real:** PIN/seguridad, CRUD de gastos, escaneo de recibos con IA (cámara + PDF), pagos a contratistas, checklist de servicios, timeline, checklist de documentos, calculadora ROI, gráficas (Chart.js), calculadora de financiamiento Tu Coop, gastos de viaje, reporte de banco + CSV + compartir, instalación PWA, backup/restauración a Drive.
**Nada encontrado a medias o simulado.**
**Sin verificar (fuera del alcance de una auditoría de archivos):** si el despliegue de Vercel está realmente en vivo, si las variables de entorno están configuradas ahí.

## 10. Pendientes

- Conexiones AAA/LUMA de ambos lotes: $0 pagado, 100% pendiente.
- Checklist de 27 documentos: 14 listos, 1 en proceso (Planos de Segregación ARPE), **12 pendientes** (certificaciones AAA/LUMA de ambos lotes, aprobación ARPE, permiso de construcción, contrato de línea Tu Coop, pólizas de seguro, CRIM actualizado).
- Agrimensor: $800 de $1,600 aún por pagar.
- Línea de crédito Tu Coop: sin activar en ningún snapshot (todo en $0).
- Reconciliar los 4 archivos de gastos (punto 7) contra la app real.

## 11. Duplicados

**`C:\Users\Owner\Downloads\arroyo132-netlify\` es una versión vieja abandonada, no un duplicado activo.** Sin `.git`, `index.html` más pequeño (135,935 vs 159,397 bytes), fechas de abril (vs junio del repo real), sin carpeta `api/`, sin `vercel.json` — es de antes de que se agregaran cámara/IA/backup a Drive y antes de la migración a Vercel. **Seguro tratarlo como legacy, sin riesgo.**

## 12. Riesgos

- **Sin API keys hardcodeadas** en ninguna variante de `analyze-invoice.js` — siempre `process.env.ANTHROPIC_API_KEY`.
- **Riesgo financiero real:** con datos fragmentados en 4 versiones no reconciliadas, es posible que gastos reales existan solo en un archivo (ej. solo en el script de importación, nunca pegado en la consola de la app) y sean invisibles en los reportes reales de la app. Este es el riesgo más grande encontrado — necesita reconciliación humana, no se puede resolver solo leyendo archivos.
- Fotos de recibos están embebidas en los 2 archivos de backup grandes (5MB) — si la app se abre alguna vez con `localStorage` limpio sin restaurar primero desde Drive, esas fotos dependen enteramente del último backup guardado ahí.

## 13. Fuentes canónicas

- **Código de la app:** `C:\Users\Owner\Downloads\arroyo132-git\` (repo real, remoto `github.com/jgarciarealty-hub/arroyo132`, rama `main`, limpio y sincronizado). `arroyo132-netlify/` es legacy, no usar.
- **Datos financieros/gastos:** **no hay una fuente única canónica todavía** — el más completo por fecha es `...\Bo Palmas Arroyo\arroyo132-backup-2026-07-06.json` ($4,912.70), pero no está confirmado que sea lo que la app en vivo realmente tiene. **Recomendado:** abrir la app, exportar un backup fresco desde ahí mismo, y que ESE sea de ahora en adelante el único archivo de referencia — archivando los demás como histórico, no como fuentes activas.

---

## 14. AUDITORÍA 2026-09-13 — hallazgo central: hay 3 despliegues de Vercel distintos del mismo repo, y el que probablemente usas a diario NO es el que tiene el código más nuevo de `main`

**Este es el hallazgo más importante de esta sesión — cambia el punto 4 y el punto 13 de arriba.** Esta vez sí se pudo verificar Vercel en vivo (antes no era posible). Resultado, verificado con lecturas reales (bytes exactos, diff de contenido, API de Vercel), sin ejecutar nada:

### 3 proyectos de Vercel, los 3 conectados al mismo repo de GitHub (`jgarciarealty-hub/arroyo132`), sirviendo 3 versiones distintas:

| Proyecto Vercel | URL | Qué código sirve realmente (verificado por diff de bytes) |
|---|---|---|
| `arroyo132` (el nombre "obvio", probablemente el que tienes guardado/instalado como PWA) | https://arroyo132.vercel.app | **NO es `main`.** Es el commit viejo `fc0a54e` (la migración a Vercel, antes de TODAS las funciones nuevas) + parches manuales que nunca se subieron a git (ver punto 15) |
| `arroyo132-netlify` (nombre confuso — sí está en Vercel, no en Netlify) | https://arroyo132-netlify.vercel.app | También el commit viejo `fc0a54e`, casi sin parches (4 líneas de diferencia nada más) |
| `jgarciarealty-hub-arroyo132` | https://jgarciarealty-hub-arroyo132.vercel.app | **Éste sí es exacto, byte por byte, al HEAD real de `main` (`d1e9f89`)** — tiene cámara+IA, backup a Drive, pagos a contratistas, instalación PWA — todo lo que el punto 2 de este documento describe como "funcionando" |

Ninguno de los 3 tiene dominio propio configurado (`arroyo132pomarosa.com` o similar) — los 3 son subdominios `.vercel.app`. Si tienes esta app instalada en el teléfono como PWA o guardada como marcador, **muy probablemente apunta a `arroyo132.vercel.app`** (el nombre más corto/obvio) — que es la versión desactualizada.

**Verificado directamente contra el HTML en vivo** de `arroyo132.vercel.app` (sin modificar nada, solo lectura):
- **NO tiene** backup automático a Google Drive (`restaurarDesdeDrive` — 0 coincidencias)
- **NO tiene** el banner de instalación PWA (`beforeinstallprompt` — 0 coincidencias)
- **NO tiene** el seguimiento de pagos a contratistas ("Registrar Pago" — 0 coincidencias)
- **NO tiene** el fix de seguridad "JSON defensivo" del commit `ae0147d` — la línea que inicializa los gastos sigue siendo `JSON.parse(localStorage.getItem('a132_gastos')||'[]')` sin `try/catch`, así que **sigue expuesta a crashear si el `localStorage` se corrompe** — ese bug específico ya estaba arreglado en `main` desde el 17-jun, pero el arreglo nunca llegó a esta URL.

### Punto 15 — production tiene código que NUNCA se subió a git (parche manual, no versionado)

Las 9 redeploys de `arroyo132.vercel.app` entre el 6 y 7 de julio de 2026 (`actor: claude-code_2-1-201_agent`, todas marcadas `gitDirty: "1"` en la API de Vercel) se hicieron desde una carpeta local con cambios sin commitear — no desde GitHub. El diff real entre esa producción y el commit `fc0a54e` (214 líneas) muestra 2 cosas que existen **solo en producción, en ningún lado de git**:

1. **Una función `recuperarRecibos()` con 19 gastos reales hardcodeados directo en el JS** (id 700001–700019: Ferreterías Maderas 3C $293.02, AIG Electrical $30.22, Steel Services $267.42, Ferretería Cosme $232.48 y $152.54, Caguas Commercial $43.89, **AAA — pago cuenta 00023299-205 $175.00**, **Carmelo Sierra Jr. agrimensor $800.00 con cheque #2099**, Operador Excavadora $1,500.00, Wholesale Electric $96.31, Toa Alta Hardware x2, La Ferretera PR $84.68, Home Depot $60.61, David Rodríguez $900, Target Rental Car $87.86, Royal Electric $12.27, Caribbean Lumber $5.09, La Ferretería Cataño $28.88). Esta función se auto-ejecuta al cargar la página y agrega estos 19 registros a lo que haya en `localStorage` **si no existen ya** (dedup por `id` o por contratista+fecha+monto). **Esto coincide exactamente con los 19 gastos de `arroyo132-backup-2026-07-06.json` ($4,912.70)** — es decir, alguien (probablemente una sesión de Claude anterior) ya hizo la reconciliación de datos financieros que el punto 7 de este documento describe como "pendiente", pero la aplicó directo a producción sin pasar por git y sin actualizar este expediente para reflejarlo.
2. **Una puerta trasera de emergencia**: la URL `https://arroyo132.vercel.app/?reset=arroyo132reset` borra el PIN y el bloqueo por intentos fallidos sin pedir el PIN actual. Útil si te quedas bloqueado fuera de tu propia app, pero es una puerta de acceso real que cualquiera que conozca esa URL exacta podría usar para resetear el PIN — no está documentada en ningún lado hasta ahora.

**No toqué nada de esto** — ni reconcilié los datos, ni desplegué `main` sobre `arroyo132.vercel.app` (eso borraría los 19 gastos recuperados y la puerta de reset, que podrías seguir necesitando), ni commiteé el parche a git. **Esto es 100% decisión tuya** porque mezcla datos financieros reales con una decisión de arquitectura (qué versión debe quedar como production) — ver sección de pendientes/decisiones más abajo.

### Verificación adicional hecha esta sesión (sin cambios de código)
- **La rama sin fusionar `claude/email-access-request-WNyf2` (punto 6) se reconfirmó correcta**: con el diff correcto (`git diff main...origin/rama`, contra el ancestro común) solo agrega `CLAUDE.md` y `PLAN-EMAILS-LEADS.md` — 178 líneas, cero cambios a `index.html` o `api/`. (Un diff directo `main` vs. rama sin usar el ancestro común sí muestra miles de líneas de diferencia porque `main` avanzó mucho después del punto donde nació la rama — eso NO significa que la rama toque esos archivos; es solo una forma incorrecta de compararlos. Confirmado con las 2 formas para no dejar ambigüedad.)
- **Las 4 versiones de datos financieros del punto 7 se re-sumaron línea por línea, con evidencia exacta** (antes el documento decía de 2 de los 4 archivos "no sumado"):
  - `G:\My Drive\arroyo132-datos.json` (2026-06-17): 2 gastos, **$1,652.54** — coincide con lo ya documentado.
  - `...\Backup\arroyo132-backup-2026-04-27.json`: 20 gastos, **suma real $65,477.31** (nunca se había sumado) — incluye una línea de $60,000 anómala (ver abajo).
  - `...\Backup\arroyo132-backup-2026-06-16.json`: 21 gastos, **suma real $65,709.79** (nunca se había sumado) — misma línea de $60,000.
  - `...\Bo Palmas Arroyo\arroyo132-backup-2026-07-06.json` (el más completo, más reciente): 19 gastos, **$4,912.70** — coincide con lo ya documentado, y es la misma lista de 19 que ya está hardcodeada en producción (ver punto 15).
- **La línea de $60,000 es una anomalía real, no solo "un precio de compra" como decía el punto 7**: aparece en los 2 backups de abril/junio (no en el de julio, el más completo, ni en el del Drive) con categoría "Costos de Cierre", fecha **2024-08-28** (el documento anterior decía 1-abr-2025 — dato impreciso), contratista "Severa Rosa", y la descripción dice **"se le entregó cheque de 28k a Severa Rosa"** mientras el campo `monto` dice **60000** — el monto del campo y el monto mencionado en la descripción no coinciden entre sí. No se tocó ni se intentó adivinar cuál es el correcto — para tu revisión.

### Pendiente — decisiones que solo tú puedes tomar
1. **¿Cuál de las 3 URLs de Vercel es la que usas de verdad?** Si es `arroyo132.vercel.app` (la más probable), estás usando una versión sin backup a Drive, sin instalación PWA, sin seguimiento de pagos a contratistas, y con un bug de crash conocido ya arreglado en `main`. Si es `jgarciarealty-hub-arroyo132.vercel.app`, tienes todo lo nuevo pero no tienes los 19 gastos recuperados hardcodeados ni la puerta de reset del PIN.
2. **Si decides consolidar a una sola URL**, hace falta reconciliar el parche manual de producción (los 19 gastos + el reset de PIN) con `main` antes de apuntar todo a la versión más nueva — si simplemente activas el redeploy automático de GitHub sobre `arroyo132.vercel.app` sin hacer esto primero, se perderían esos 19 gastos y el reset de emergencia.
3. **La línea de $60,000 / "cheque de 28k" de Severa Rosa** — determinar cuál número es el correcto (o si el registro completo está mal y debe eliminarse) y si esa transacción es un costo de cierre de compra del terreno (que normalmente no sería un "gasto de construcción" del proyecto) o algo más.
4. **Los 2 proyectos de Vercel duplicados/confusos** (`arroyo132-netlify`, `jgarciarealty-hub-arroyo132`) — decidir si se archivan/pausan para evitar seguir confundiendo cuál es la URL real de trabajo.

Nada de esto se ejecutó — son solo hallazgos de lectura (Tier 0), reportados con evidencia exacta.

---

## 15b. AUDITORÍA 2026-09-13 (continuación, misma sesión) — corrige y profundiza los puntos 14/15: no es negligencia, es un downgrade real; el "conflicto" de $60,000 no es un error de datos

**Instrucción explícita de Jesvan para esta ronda: no modificar datos financieros dudosos, solo investigar con evidencia documental y dejar para él únicamente lo que la evidencia no pueda resolver.** Todo lo de abajo es solo lectura (API de Vercel real, `git log -p` completo, diff exacto normalizado por line-endings, y los 4 archivos JSON de respaldo parseados campo por campo). No se desplegó nada, no se hizo push, no se tocó ningún monto.

### Corrección importante al punto 14: `arroyo132.vercel.app` SÍ tuvo el código nuevo — se lo quitaron después

El historial completo de deployments de ese proyecto (`prj_WC9cmqIZXQJjghAz12IEiyetFIVx`, vía API de Vercel) muestra la secuencia real:

1. **2026-05-02 a 2026-06-17:** el proyecto recibió cada commit real de `main` vía push de GitHub genuino (metadata `repoPushedAt`, `githubCommitVerification` presentes) — incluyendo el commit `d1e9f89` (fotos de recibos, banner PWA, backup a Drive, pagos a contratistas) desplegado a producción el **2026-06-17 04:17:35 UTC**, 8 segundos después del push real. Durante ~7 semanas, `arroyo132.vercel.app` tuvo el código más nuevo.
2. **2026-07-05 20:28 UTC en adelante:** aparecen 7 deployments nuevos a producción, todos con `githubCommitSha` apuntando otra vez al commit viejo `fc0a54e` (2026-05-02) y `gitDirty:"1"`, `actor:"claude-code_2-1-201_agent"` — es decir, deploys manuales desde una carpeta local con cambios sin commitear, **basados en el commit viejo, no en `main`**. El último de estos 7 (2026-07-07 04:07:52 UTC) es el que sigue en producción hoy.

**Conclusión con evidencia, no inferencia:** `arroyo132.vercel.app` no es una versión que "nunca recibió las funciones nuevas" — las tuvo en producción real durante 7 semanas y una sesión de Claude Code (vía CLI, sin pasar por git) **la reemplazó por una versión más vieja con parches propios encima**, el 5-7 de julio. Eso es un downgrade activo, no abandono. `jgarciarealty-hub-arroyo132.vercel.app` (el otro proyecto), en cambio, fue creado el 2026-06-16 23:31 y en los siguientes ~17 minutos Vercel le hizo un backfill automático de todo el historial de git de una sola vez (los 9 commits, terminando en `d1e9f89` a las 04:17:35 — prácticamente el mismo segundo que el deploy real de `arroyo132`) — y no ha vuelto a recibir un solo deploy desde entonces. Ningún humano ni agente lo ha tocado desde su creación.

**`arroyo132-netlify.vercel.app`** (el tercer proyecto) resulta ser un punto intermedio del mismo esfuerzo de parche manual: también corre sobre la base vieja `fc0a54e`, pero con **solo 3 de los 10 gastos añadidos** (700010-700012) y **ninguno** de los demás parches (sin reset de PIN, sin editar gasto, sin auto-backup, sin detección de duplicados). Es, con toda probabilidad, un deploy intermedio guardado antes de que el parche completo se terminara — no un destino de trabajo independiente.

**No hay Web Analytics activado en ninguno de los 3 proyectos** (confirmado — la API devuelve 404 "Web Analytics not found" para los 3), y los Runtime Logs de Vercel en plan Hobby solo retienen 1 hora, así que no hay forma de confirmar con tráfico real cuál URL abres desde el teléfono. **Esto no se puede determinar documentalmente — solo tú sabes qué URL tienes guardada como marcador o instalada como PWA.** Dado que `arroyo132.vercel.app` es el nombre más corto/obvio y es el único de los 3 con actividad de deploy reciente y deliberada (alguien invirtió 7 redeploys en 2 días para parchearlo a mano), es la hipótesis más fuerte, pero sigue siendo hipótesis, no evidencia directa de uso.

### Punto 2: diff exacto y completo, línea por línea (no un resumen)

El diff real entre lo que corre en `arroyo132.vercel.app` hoy y el commit base `fc0a54e` (214 líneas de diferencia, confirmado byte a byte tras normalizar CRLF/LF) contiene exactamente estos cambios — ninguno más:

1. Botón "Guardar Gasto" con auto-disable + texto "Guardando…" (anti doble-click).
2. Puerta de reset de emergencia `?reset=arroyo132reset` (borra PIN, intentos fallidos y sesión).
3. 10 gastos añadidos al arreglo `recuperados` dentro de la función `recuperarRecibos()` (ids 700010-700019) — ver hallazgo nuevo abajo, esta función YA EXISTÍA en `fc0a54e`, no se inventó en julio.
4. Función `autoBackupSilencioso()` — guarda copia completa en `localStorage` en cada save; solo descarga archivo `.json` en desktop (evita duplicar en móvil).
5. Función `sanitizarNombreArchivo()` + renombrado automático de archivos adjuntos a formato `A132-REC-XXX_Contratista_Fecha.ext`.
6. Detección de gasto duplicado (mismo contratista+fecha+monto±$0.50) con confirmación antes de guardar.
7. Ícono de clip 📎 junto al nombre del contratista en Historial cuando el gasto tiene documentos adjuntos.
8. Manejo de archivo "no disponible" (subido desde otro dispositivo, sin `data` real) — muestra ⚠️ en vez de romper.
9. Botón "✏️ Editar" en detalle de gasto + funciones `editarGasto()`/`guardarEdicionGasto()` completas (edita monto, fecha, contratista, descripción, categoría, lote, método).
10. Límite de tamaño de PDF subido a mano: 5MB (antes 1.5MB) + compresión de imagen si aplica; detección de adjunto duplicado por contenido.
11. Calidad/tamaño de miniatura de fotos de recibo: sube de 800px/72% a 1600px/90% (fotos más nítidas, archivos más pesados).

**Ninguno de estos 11 cambios está en `main` hoy.** Ninguno toca datos financieros existentes — son todos features de UX/flujo, excepto el punto 3 (los 10 gastos) y el reset de PIN.

### Hallazgo nuevo, no reportado en la auditoría anterior: `main` perdió 2 features reales el mismo día que nacieron (commit `7735957`, 2026-06-16)

Al confirmar de dónde salió el parche, encontré que la función `recuperarRecibos()` (con 9 gastos hardcodeados, ids 700001-700009) y todo el soporte de UI para pagos parciales (`es_abono`/`cuenta`/`monto_total` — ver sección siguiente) **sí estaban en el código committeado a git**, en el commit `fc0a54e` (2026-05-02, la migración a Vercel). Verificado commit por commit (`git show <sha>:index.html | grep`):

| Commit | `recuperarRecibos` | `es_abono` |
|---|---|---|
| `fc0a54e` (02-may) | ✅ presente (9 gastos) | ✅ presente (5 usos) |
| `7735957` (16-jun) | ❌ desaparece | ❌ desaparece |
| todos los commits posteriores hasta `d1e9f89` | ❌ ausente | ❌ ausente |

**Es decir: `main` no es que nunca haya tenido esto — lo tuvo y lo perdió el 16 de junio**, cuando el commit `7735957` ("feat: viajes expandidos + Reporte para Banco con ROI y exportar CSV") se construyó aparentemente sobre una copia de `index.html` más vieja que `fc0a54e` (le faltaban ambas piezas), no sobre `fc0a54e` mismo. El parche manual de julio en `arroyo132.vercel.app`, en cambio, sí partió de `fc0a54e` completo — por eso conservó ambas piezas y las extendió (agregó 10 gastos más al arreglo existente, en vez de crear uno nuevo).

**Viabilidad de portar el parche a `main` (determinada, no ejecutada):** técnicamente segura como forward-port — ninguno de los 11 cambios de la sección anterior toca las mismas líneas/funciones que los commits de `main` posteriores a `fc0a54e` (backup a Drive, banner PWA, pagos a contratistas, fix JSON defensivo). El único trabajo real sería: (a) volver a insertar `recuperarRecibos()` y el soporte `es_abono` en `main` — probablemente deliberado recuperarlos, ya que se perdieron por accidente, no por decisión — y (b) decidir si el reset de PIN por URL se documenta/mantiene o se retira antes de fusionar (es una puerta de acceso real, ver punto 15 original). No requiere resolver primero el punto de los $60,000 (ver abajo) — son independientes.

### Punto 3, resuelto con evidencia — el "$60,000 vs $28,000" NO es una contradicción de datos, es un campo de pago parcial que el resumen anterior no leyó completo

Parseando los 3 archivos de backup con el JSON completo (no solo `monto`/`descripcion` como en la ronda anterior), la línea de Severa Rosa tiene TODOS estos campos:

```json
{"id":1777256291193,"fecha":"2024-08-28","contratista":"Severa Rosa","categoria":"Costos de Cierre",
 "metodo":"cheque","monto":60000,"descripcion":"se le entrego cheque de 28k a Severa Rosa",
 "es_abono":true,"cuenta":"Se le adelanto 28k CK 001","monto_total":28000}
```

Este es exactamente el mismo esquema de pago parcial que la línea del Agrimensor Carmelo Sierra (`monto:1600` = honorario total acordado, `monto_total:800` = depósito real pagado, `cuenta:"Deposito 50% Agrimensor"`) — un patrón ya usado y consistente en el propio archivo, no un capricho de esta línea.

Aplicando el mismo patrón: `monto:60000` = el compromiso/precio total (coincide exactamente con el "Precio de compra" de $60,000 que la app tiene **hardcodeado por separado** en el calculador ROI y en el Timeline — entrada `{fecha:'2025-04-01',titulo:'Compra de propiedad',desc:'Cierre de compra Lote 132 Arroyo PR - $60,000'}`, presente en los 4 archivos de backup Y en el código actual de `main`, `index.html` líneas 776-778 y 1493). `monto_total:28000` = lo realmente pagado a Severa Rosa hasta ese momento vía cheque, que coincide exactamente con la descripción ("cheque de 28k") y con la nota de cuenta ("Se le adelanto 28k CK 001"). **Los dos números no se contradicen — describen dos cosas distintas del mismo trato: precio total acordado con/vía Severa Rosa ($60,000, igual al precio de compra del lote) vs. abono real ya entregado ($28,000).**

**Lo que si cambia el análisis, con evidencia de código:** ni `main` (hoy) ni ninguna versión de la app calculan los totales de gastos usando `monto_total` — el `reduce()` que suma "Total Obra" en todas las pestañas (Resumen, ROI, Reporte Banco) usa siempre el campo `monto` crudo, sin excepción, confirmado en `index.html` (6 ocurrencias de `gastos.reduce((s,g)=>s+g.monto,0)` o variantes) y en la versión desplegada en `arroyo132.vercel.app` (que sí sabe *mostrar* `es_abono`/`monto_total` como anotación informativa, pero tampoco los usa para sumar). **Esto explica por qué los backups de abril ($65,477.31) y junio ($65,709.79) — los que sí incluyen esta línea — suman $60,000 completos como si fuera un gasto de construcción en efectivo**, cuando documentalmente solo $28,000 habían salido de la cuenta en ese momento, y ese precio además ya está contabilizado aparte como "Precio de compra" del lote (no como gasto de obra). El archivo más completo y reciente (6-jul, $4,912.70) **excluye esta línea por completo** — consistente con haber sido corregido para no duplicar el precio de compra del lote dentro de los "gastos de construcción".

**Lo que la evidencia NO puede resolver, y queda genuinamente para Jesvan:** (1) si el registro de Severa Rosa debe existir como línea de `gastos` en absoluto, dado que el precio de compra del lote ya se rastrea aparte (Timeline + ROI) — es una decisión de categorización contable, no un hecho verificable en archivos; (2) si a la fecha de hoy (más de un año después, 2024-08-28) el saldo pendiente de $32,000 a Severa Rosa fue pagado, parcialmente pagado, o sigue debiéndose — ningún archivo disponible documenta pagos posteriores a esa línea; (3) cuál de las 3 URLs de Vercel usa Jesvan en el día a día — no hay señal de tráfico real disponible (Analytics no activado, retención de logs de 1h).

### Pendiente actualizado — decisiones que solo Jesvan puede tomar (reemplaza la lista de la sección 15 original)
1. **Confirmar cuál URL usa realmente** (ver arriba — no determinable por archivos/API, solo Jesvan sabe qué tiene guardado en el teléfono).
2. **Si se consolida a una sola URL:** decidir si se recupera `recuperarRecibos()`/`es_abono` en `main` (parece pérdida accidental, recomendable recuperar) y si el reset de PIN por URL se mantiene, se cambia por algo menos expuesto, o se retira, antes de apuntar `arroyo132.vercel.app` de vuelta a `main`.
3. **Severa Rosa / $60,000:** decidir si esa línea pertenece a `gastos` (duplicaría el precio de compra ya contado aparte) o debe removerse/recategorizarse, y confirmar el estado real del saldo pendiente de $32,000.
4. **Los 2 proyectos de Vercel no usados** (`arroyo132-netlify`, y el que no sea el de uso diario entre `arroyo132`/`jgarciarealty-hub-arroyo132`) — pausar o archivar para evitar seguir confundiendo cuál es la URL de trabajo real.

Nada de esto se ejecutó — solo lectura (Tier 0): API de Vercel, `git show`/`git log -p` en las 9 commits reales de `main`, y parseo campo-por-campo de los 4 JSON de respaldo. Ningún dato financiero fue modificado.

---

## 16. PREPARACIÓN 2026-09-13 (Tier 0/1) — port de `recuperarRecibos()` + pagos parciales a `main`, en rama local, sin fusionar ni desplegar

Siguiendo la recomendación de viabilidad ya determinada en el punto 15b (sección "Viabilidad de portar el parche a `main`"), se preparó — sin ejecutar merge ni deploy — el port de las 2 funciones perdidas por accidente en el commit `7735957` (2026-06-16).

### Qué se hizo
- **Rama nueva local:** `port/recuperar-recibos-y-pagos-parciales`, creada desde `main` (que ya estaba limpio y sincronizado salvo 2 commits de documentación previos, sin relación con este cambio).
- **Backup previo del archivo** guardado fuera del repo antes de tocar nada (`index.html.backup-preport-20260913230325`, en el directorio scratchpad de la sesión — no en el repo).
- **Commit:** `8337e72` — "Portar recuperarRecibos() y soporte de pagos parciales (es_abono) a main".

### Qué incluye el port (adaptado al formulario/UX actual de `main`, no una copia literal de `fc0a54e`)
1. **`recuperarRecibos()`** — IIFE que agrega los 9 gastos originales recuperados (ids `700001`-`700009`, ~$1,647 en materiales/electricidad de abril 2026) a `localStorage` si no existen ya (dedup por `id` o por contratista+fecha+monto±$0.50). Nunca borra ni modifica gastos existentes del usuario.
2. **Soporte de pago parcial (`es_abono`/`cuenta`/`monto_total`)** — checkbox "¿Es pago parcial?" en Registrar Gasto (oculta por defecto, con campos de cuenta/referencia y monto total acordado), panel "💳 Cuentas con Abonos" en Historial (muestra saldo pendiente por cuenta, botón "+ Abono" vía `nuevoAbono()`), y anotación del abono en el detalle de cada gasto (`showGastoDetail`). Los totales (ROI, Reporte Banco, Dashboard) **siguen sumando `g.monto` crudo sin cambios** — mismo comportamiento que ya se documentó como correcto/intencional en el punto 15b, no se tocó esa lógica.

### Qué NO se portó (fuera de alcance deliberado)
- La puerta de reset de PIN por URL (`?reset=arroyo132reset`) — es una decisión de seguridad, no técnica, según la instrucción de esta ronda.
- Los otros 9 cambios del parche manual de julio (auto-backup silencioso, editar gasto, adjuntos múltiples con chips, detección de duplicados, límite de PDF a 5MB, calidad de foto 1600px/90%, etc.) — quedan sin tocar, documentados en el punto 15 original, pendientes de que Jesvan decida si también se quieren portar en una ronda separada.
- Ningún dato financiero existente (gastos ya guardados, precio de compra, línea de Severa Rosa) — no se modificó nada de eso.

### Verificación de seguridad hecha antes y después de escribir
- **Antes:** se confirmó (punto 15b) que ninguno de los cambios porteados toca las mismas líneas/funciones que los commits de `main` posteriores a `fc0a54e` (backup a Drive, banner PWA, pagos a contratistas, fix JSON defensivo) — cero conflicto esperado.
- **Después de escribir:**
  - `node --check` sobre el JavaScript completo extraído del `<script>` del HTML — sin errores de sintaxis.
  - Conteo de balance de etiquetas `<div>`/`</div>` antes vs. después: +18 aperturas / +18 cierres — incremento consistente, sin romper estructura HTML.
  - Revisión manual línea por línea del diff completo (110 inserciones, 3 modificaciones, 1 archivo) — confirmado que solo toca las funciones/HTML relacionadas a este port, nada más.
- **No se probó en navegador real** (esta sesión no tiene ese acceso) — la verificación de sintaxis y estructura es la disponible sin ejecutar la app.

### Pendiente de tu decisión (Jesvan)
1. **Fusionar esta rama a `main`** (`git merge port/recuperar-recibos-y-pagos-parciales`) y hacer push — no ejecutado, es tu decisión.
2. **Redesplegar** el proyecto de Vercel que corresponda una vez fusionado — no ejecutado. Recuerda que esto es independiente de la decisión más grande del punto 15b (qué hacer con las 3 URLs de Vercel, la puerta de reset de PIN, y la línea de Severa Rosa) — este port a `main` no resuelve ni requiere resolver esas 3 decisiones primero.
3. Todo lo demás pendiente de las secciones 14/15/15b sigue exactamente igual — no se investigó nada nuevo de eso en esta ronda, solo se preparó este port de código.

No se hizo push, no se hizo merge a `main`, no se tocó Vercel, no se modificó ningún dato financiero, no se tocó la puerta de reset de PIN.

---

## 17. HALLAZGO URGENTE 2026-09-20 — `arroyo132.vercel.app` fue redesplegado esta madrugada, SIN que esta sesión lo hiciera, y ya NO tiene los parches de julio

Confirmado con evidencia real (API de Vercel, `list_deployments` del proyecto `prj_WC9cmqIZXQJjghAz12IEiyetFIVx`), no inferido: el deployment de producción actualmente en `arroyo132.vercel.app` es `dpl_G6T7T1Lpa4YqRnDyg3Mhug6VLNvu`, creado **2026-09-20T04:14:26Z (12:14 AM hora de Puerto Rico, esta misma madrugada)**, disparado automáticamente por la integración de GitHub de Vercel (`creator.username: "jgarciarealty-hub"`, el bot de la integración, no una persona) al desplegar el commit `7710569` de `main` — ese commit es uno de los 3 commits de solo documentación de la sesión del 2026-09-13 (nunca tocó código real).

**Esto significa que production dejó de correr la base vieja `fc0a54e` + 11 parches manuales de julio, y ahora corre exactamente lo mismo que `main` — confirmado byte a byte** (`index.html` descargado en vivo de `arroyo132.vercel.app`, 159,397 bytes tras normalizar CRLF/LF, diff de 0 líneas contra el `index.html` real del repo local en `main`).

**Qué desapareció de producción esta madrugada, sin autorización de nadie visible en esta sesión:**
1. Los 10 gastos adicionales recuperados (ids 700010-700019) — el arreglo original de 9 (700001-700009) tampoco está, porque `main` nunca los tuvo (ver hallazgo del punto 15b).
2. La puerta de reset de PIN por URL (`?reset=arroyo132reset`) — ya no existe en el código servido.
3. Detección de gasto duplicado, detección de adjunto duplicado, editar gasto, auto-backup silencioso a `localStorage`, adjuntos múltiples con chips, límite de PDF a 5MB, calidad de foto mejorada — los 9 parches restantes de julio, todos ausentes.

**Qué NO se perdió (verificado, no solo asumido):** el backup automático a Google Drive (`9d3bf35`, una función real de `main`, no uno de los parches manuales) sigue presente en el código desplegado hoy — si tenías la nube conectada, tus datos reales de gastos deberían seguir recuperables desde tu Google Drive independientemente de este redeploy. Los datos que ya estaban guardados en el `localStorage` de tu navegador/dispositivo tampoco se borran por un redeploy (viven en el navegador, no en el código) — pero la función que los "reinyecta" automáticamente si algún día se borran (`recuperarRecibos()`) ya no está en el código servido.

**No se intentó revertir ni volver a desplegar nada** — esto es exactamente la decisión de AR-1/AR-3 que ya estaba pendiente de Jesvan (qué URL usar, si consolidar desde `main` o desde el parche), solo que ahora ya ocurrió unilateralmente en producción sin que nadie lo pidiera en esta sesión. Causa exacta de por qué la integración de GitHub de Vercel se "puso al día" justo esta madrugada (tras meses sin desplegar automáticamente, ver punto 15/15b): no determinada — no hay evidencia en la API de Vercel de qué disparó específicamente este catch-up (posible reconexión de la integración GitHub↔Vercel, posible webhook retrasado). No investigado más a fondo por estar fuera del alcance de solo-lectura de esta sesión sin acceso a los logs internos de GitHub Actions/webhooks de Vercel.

**Acción recomendada para Jesvan al despertar (antes de cualquier otra decisión de Arroyo132):** abrir `arroyo132.vercel.app` y confirmar que tus gastos reales siguen ahí (deberían, por localStorage) y que tu Google Drive tiene el backup más reciente. Si algo real falta, avísame antes de que se toque nada más.

---

## 18. Trabajo nocturno 2026-09-20 (autorización de ejecución) — dedup implementado, reset por email diseñado no construido

**Implementado, probado, en rama, NO desplegado** (`port/recuperar-recibos-y-pagos-parciales`, commit `dc6e024`): detección de gasto duplicado (contratista+fecha+monto±$0.50) y detección de adjunto duplicado por contenido — ambos con confirmación antes de guardar, nunca bloquean silenciosamente. 9/9 pruebas aisladas contra el código real, `node --check` limpio, balance de `<div>` verificado idéntico antes/después.

**Reset de PIN por código temporal de EMAIL — diseñado, NO construido.** Requiere una credencial nueva de envío de correo (esta app no tiene ninguna hoy — su único endpoint serverless es `api/analyze-invoice.js`, sin capacidad de enviar email). Construir esto exige decidir qué servicio/cuenta usar para enviar el código, lo cual es un cambio de credenciales/alcance que no me corresponde decidir solo. Diseño listo para cuando decidas: generar código de 6 dígitos, válido 10 min, guardado en `localStorage` (el dispositivo sigue siendo el tuyo, solo el PIN se olvidó), verificación antes de limpiar el PIN — el único paso faltante es el mecanismo de ENVÍO real del código.

**Rama del port, estado acumulado hoy:** `recuperarRecibos()` + pagos parciales (09-13) + detección de duplicados (esta noche) = 5 de los 11 parches de julio ya recuperados y probados en `main`. Faltan: adjuntos múltiples con chips + renombrado, límite de PDF a 5MB, calidad de foto 1600px/90%. (auto-backup a localStorage YA cubierto por save() existente en main -- no es un gap real; editar gasto y botón guardar con auto-disable YA recuperados esta noche). Ninguno desplegado — sigue esperando tu decisión de consolidación (punto 15b/17).

---

## 19. Reconciliación explícita de los 11 parches originales (2026-09-20, cierre de sesión)

| # | Parche original | Estado | Clasificación | Evidencia | Acción futura |
|---|---|---|---|---|---|
| 1 | Botón "Guardar Gasto" auto-disable + "Guardando…" | Recuperado esta noche | **RECUPERADO** | Commit `a614e80`, 0 tests propios pero cubierto por la prueba de integración (14/14) | Ninguna |
| 2 | Puerta de reset de emergencia por URL | No recuperado (por diseño) | **HUMAN GATE** | Diseño de reemplazo (código por email) documentado en `DECISION_PACKAGES_2026-09-20.md` §5 | Necesito que decidas qué credencial de email usar |
| 3 | 10 gastos adicionales (700010–700019) en `recuperarRecibos()` | **2 de 10 recuperados** con evidencia completa; 8 siguen bloqueados | **PARCIAL — RECUPERADO (2) / HUMAN GATE (8)** | Búsqueda de solo lectura en todas las fuentes autorizadas disponibles: `G:\My Drive\arroyo132-datos.json` (backup real de Google Drive, fechado 2026-06-17T03:46:20Z) contenía 2 gastos completos con fecha+descripción exacta — **Operador Excavadora** ($1,500, 2025-04-20, "Limpieza de terreno con excavadora (digger)") y **Ferretería Cosme** ($152.54, 2026-06-07, "Se compro arena piedra y cemento") — recuperados como `id 700010`/`700011`, commit `ee21ab9`. También se revisó: `_RESPALDOS_P0001` (sin contenido de Arroyo132), la carpeta dedicada de Drive "📁 Proyecto Arroyo 132" (solo fotos, sin JSON de datos), el zip/carpeta local `arroyo132-netlify` (no contiene `recuperarRecibos` en absoluto), y el deploy en vivo de `arroyo132-netlify.vercel.app` (**también redesplegado a `main` recientemente, perdió los 700010-700012 que documentaba la sección 15b** — mismo patrón del hallazgo #17 con `arroyo132.vercel.app`). **Los otros 8** (Ferretería Cosme $232.48, Caguas Commercial $43.89, AAA $175.00, Carmelo Sierra Jr. $800.00, Wholesale Electric $96.31, Toa Alta Hardware #2, La Ferretera PR $84.68, Home Depot $60.61) — vendedor y monto conocidos por el texto ya documentado en la sección 15b, pero **sin fecha ni descripción verificable en ninguna fuente disponible** — no se fabricaron | Si encuentras en algún otro lugar (papel, otra copia de respaldo, tu memoria de las transacciones) la fecha y descripción exacta de estos 8, te los recupero de inmediato con la misma disciplina de evidencia |
| 4 | `autoBackupSilencioso()` (respaldo a localStorage en cada save) | Ya cubierto, no por la misma función | **YA EXISTÍA (equivalente superior)** | `save()` en `main` ya escribe a `localStorage` en cada guardado Y hace backup real a Google Drive (`backupToDrive()`) — mecanismo ya más completo que el parche original | Ninguna |
| 5 | `sanitizarNombreArchivo()` + renombrado automático de adjuntos | No recuperado | **NO APLICA HOY** | El diseño actual solo soporta 1 adjunto por gasto, sin descarga/exportación de archivos individuales — el renombrado solo tiene sentido real si se recupera también el ítem 5 (adjuntos múltiples), diferido | Reevaluar junto con adjuntos múltiples si se autoriza esa expansión |
| 6 | Detección de gasto duplicado | Recuperado esta noche | **RECUPERADO** | Commit `dc6e024`, 9/9 tests propios + integración 14/14 | Ninguna |
| 7 | Ícono 📎 junto al contratista cuando hay adjunto | Ya existía, forma distinta | **YA EXISTÍA (equivalente distinto)** | `renderHistorial()` en `main` ya muestra 📷 en el botón "Ver" cuando `fotos[g.id]` existe — mismo propósito (indicar visualmente que hay adjunto), ubicación distinta (botón en vez de junto al nombre) | Ninguna, salvo que prefieras la ubicación exacta del parche original (cosmético, bajo esfuerzo si lo pides) |
| 8 | Manejo de archivo "no disponible" (subido desde otro dispositivo) | **Recuperado esta noche** | **RECUPERADO** | `onerror` agregado al `<img>` en `showGastoDetail()` — muestra "⚠️ Foto no disponible en este dispositivo" en vez del ícono roto del navegador. Cambio local, reversible, sin tocar el modelo de datos. Commit `ee21ab9`, probado en la integración (16/16) | Ninguna |
| 9 | Botón "✏️ Editar" + `editarGasto()`/`guardarEdicionGasto()` | Recuperado esta noche | **RECUPERADO** | Commit `baed521`, 13/13 tests propios + integración 14/14 | Ninguna |
| 10 | Límite de PDF 5MB + detección de adjunto duplicado por contenido | Ambos recuperados esta noche | **RECUPERADO** | Límite PDF: commit `c1490e4` (6/6 tests). Adjunto duplicado: commit `dc6e024` (incluido en el mismo trabajo del ítem 6, 9/9 tests) | Ninguna |
| 11 | Calidad de miniatura de foto: 800px/72% → 1600px/90% | No recuperado (decisión deliberada) | **HUMAN GATE** | Aumentar la resolución/calidad de la miniatura incrementa significativamente el uso de `localStorage` por gasto — riesgo real de agotar cuota más rápido, agravado si además se recupera el ítem 5 (adjuntos múltiples) | Necesito tu decisión: ¿priorizas nitidez de foto sobre margen de espacio en `localStorage`? |

**Resumen final: 7 de 11 recuperados por completo (1,6,8,9,10-parte A,10-parte B) + 2 ya cubiertos por mecanismos equivalentes o superiores en `main` (4,7) + 1 parcialmente recuperado con evidencia real, 8 sub-ítems bloqueados por falta de datos verificables (3) + 2 Human Gate genuinos de decisión/arquitectura (2,11).**

No se hizo merge ni deploy de ningún cambio de código. Rama `port/recuperar-recibos-y-pagos-parciales`, 9 commits de código/test, lista para tu revisión.
