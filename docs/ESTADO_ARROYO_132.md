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
