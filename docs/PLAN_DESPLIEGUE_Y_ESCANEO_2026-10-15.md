# Arroyo 132 — Plan de despliegue, rollback y procedimiento para escanear recibos (2026-10-15)

**Estado:** preparado, **NADA desplegado**. Rama `feat/seguridad-y-sincronizacion-recibos` (sin fusionar, sin subir). Producción = `main` @ `48d05e8` (deployment `dpl_5zUwYV766ejfZNpJAd79zzzhHu8o`, `isRollbackCandidate: true`).

**2026-10-19 — BLOQUEADOR AÑADIDO:** el **acceso por PIN** (§8.3 #1-bis). Causa raíz demostrada y arreglo local probado (29/29), pero **no verificado con el PIN real del propietario en un navegador real**; hasta entonces el despliegue no se considera seguro. Detalle en `docs/ESTADO_ARROYO_132.md` §26.

## 1. Recomendación

| Pregunta | Veredicto |
|---|---|
| **Código de la rama** | **GO técnico.** 229 comprobaciones, 0 fallos (208 previas + 21 nuevas). |
| **Despliegue a producción hoy** | **NO-GO** hasta cerrar la lista de la §3 (todas son acciones humanas o datos que esta sesión no puede ver). |
| **Escanear recibos hoy con producción actual** | **GO condicionado** a la §5 (riesgo: el respaldo a Drive falla en silencio; el endpoint de IA es público). |

## 2. Qué se verificó (y qué NO)

**Verificado con pruebas simuladas (sin red, sin credenciales, sin llamadas pagas):**
- Respaldo: copia propia por dispositivo + combinado leer→fusionar→escribir; token vencido ⇒ no sube, **no lanza** y deja el aviso ⚠️ visible; reintento al volver la conexión.
- Fusión: nunca descarta; un respaldo viejo **no pisa** lo reciente local (se conserva y se registra el conflicto); un equipo atrasado **no borra** el trabajo del otro (cada uno tiene su archivo propio).
- **Corregido hoy (2 huecos reales):** (a) el archivo combinado de Drive ahora **guarda la versión desplazada** de un registro en conflicto (`conflictos`, acumulativo, tope 200) y las secciones distintas del otro equipo (`alternativas`), porque sin marcas de tiempo por registro no se puede saber cuál es la más reciente: nada se pierde de Drive; (b) un `localStorage` de gastos **ilegible ya no se borra**: el texto crudo queda en `a132_gastos_corrupto_<fecha>` (antes `removeItem` lo destruía).
- Endpoint de IA: exige autenticación (401 sin ella), 503 cerrado si falta `A132_ALLOWED_EMAILS`, límites, validación de cuerpo (38 comprobaciones). Escaneo y fallbacks con IA simulada (sección 8 de `verificacion_sync_respaldo`): una falla de IA siempre deja el formulario manual.
- Recuperación con datos reales: 19 → 31 gastos y 4 viajes sin perder nada (`tests/verificacion_recuperacion_20261015.test.js`).

**NO verificado (requiere navegador real + sesión de Google, o acceso que esta sesión no tiene):**
1. **Renovación silenciosa del token de Google** (`requestAccessToken({prompt:''})`): en un navegador real puede **pedir una ventana** o bloquearla si no nace de un toque del usuario. En ese caso el código falla visible (⚠️), no en silencio, pero no se probó contra Google real. Prueba manual pedida (§4, paso 6).
2. **Variables de entorno de Vercel:** la integración devuelve 403 al listarlas y el CLI no tiene sesión. **No se puede confirmar** si `ANTHROPIC_API_KEY` o `A132_ALLOWED_EMAILS` existen.
3. **Una llamada real a la IA** (no autorizada; el costo estimado es ≈ $0.0003 por recibo).
4. **Los datos del teléfono.**

**Hallazgo de la producción actual (solo lectura):** `/api/analyze-invoice` responde `Access-Control-Allow-Origin: *` (el diseño abierto anterior). No se hizo ninguna petición POST.

## 3. Configuración pendiente (acciones humanas, sin mostrar valores)

En Vercel → proyecto `arroyo132` → Settings → Environment Variables (Production):

| Variable | Estado | Qué hacer |
|---|---|---|
| `A132_ALLOWED_EMAILS` | **No verificable; obligatoria** | Correo(s) de Google autorizados, separados por coma (p. ej. el de Jesvan). **Sin ella el endpoint responde 503 a propósito.** |
| `ANTHROPIC_API_KEY` | No verificable | Debe existir (ya la usa la versión actual). No cambiarla. |
| `A132_ALLOWED_ORIGINS` | Opcional (por defecto `https://arroyo132.vercel.app`) | Añadir cualquier otro origen que realmente se use. |
| `A132_MODEL`, `A132_EFFORT`, `A132_RATE_PER_MIN`, `A132_DAILY_BUDGET`, `A132_MAX_TOKENS`, `A132_CLIENT_ID` | Opcionales | Dejar por defecto salvo razón. |

Google Cloud (OAuth client `797904134164-…`): el origen `https://arroyo132.vercel.app` debe figurar en «Orígenes de JavaScript autorizados» (ya lo usa Drive). Un despliegue *preview* tendría otro origen y no se podría autenticar.

## 4. Plan de despliegue (cuando Jesvan lo autorice)

**Antes (humano):**
1. En el teléfono, en la URL de siempre: abrir la app, tocar ☁️ para respaldar a Drive y confirmar la fecha del archivo `arroyo132-datos-<dispositivo>.json` en Drive. *(La app actual no tiene botón de exportar.)*
2. Confirmar la §3 (`A132_ALLOWED_EMAILS` y `ANTHROPIC_API_KEY`).
3. Decidir **la URL oficial**: hoy hay 3 URLs de Vercel con almacenamiento separado (§14 del expediente). Si los recibos del teléfono están en otra distinta de `arroyo132.vercel.app`, **no desplegar** hasta exportarlos de ahí.

**Despliegue (fast-forward de la rama a `main`; Vercel despliega solo desde `main`):**
4. `git checkout main && git merge --ff-only feat/seguridad-y-sincronizacion-recibos && git push origin main`. *(Cambio de producción: requiere autorización explícita.)*

**Validación posterior (en este orden, ≤15 min):**
5. `index.html` en vivo = el de la rama (hash), `/api/analyze-invoice` sin credencial ⇒ **401** (o 503 si falta `A132_ALLOWED_EMAILS`) y ya **no** `ACAO: *`.
6. En el navegador: abrir la app, comprobar que **los gastos siguen ahí** (el despliegue no toca `localStorage`: no hay service worker y el origen no cambia), tocar ☁️ (debe pedir/renovar sesión de Google y dejar ✅), escanear **un** recibo de prueba (costo ≈ $0.0003) y confirmar que **precarga el formulario y no guarda solo**.
7. Botones nuevos: «Traer de Drive», «Exportar», «Importar» visibles.

**Rollback (≤2 min, sin tocar datos):**
- Vercel → Deployments → `dpl_5zUwYV766ejfZNpJAd79zzzhHu8o` → **Instant Rollback / Promote**, o `git revert` del merge y push. El `localStorage` y los archivos de Drive no se tocan. Nota: la versión anterior, al respaldar, **sobrescribe** el archivo combinado `arroyo132-datos.json` con su propio formato (como siempre hizo); las copias por dispositivo `arroyo132-datos-<dispositivo>.json` que escribió la versión nueva **no se tocan**, así que no se pierde información.

## 5. Procedimiento seguro para empezar a escanear recibos

**Si se espera al despliegue:** hacer la §4 entera y luego escanear.

**Si hay que escanear hoy con la versión en producción:**
1. Usar **siempre el mismo teléfono, el mismo navegador y la misma URL** (idealmente la que ya tenga los datos). No borrar datos del navegador, no desinstalar la PWA, no usar modo privado.
2. **Antes de cada sesión y al terminar:** tocar ☁️ (inicia sesión de Google, dura ~58 min) y confirmar ✅. Si no sale ✅, el respaldo no ocurrió.
3. **Conservar el recibo en papel** y hacer una foto aparte en el álbum del teléfono: la app guarda solo una miniatura.
4. La IA solo **precarga** el formulario: revisar fecha, monto y comercio antes de guardar.
5. Una vez a la semana, comprobar en Drive que `arroyo132-datos.json` tenga fecha reciente.

## 6. Cómo recuperar recibos si falla la sincronización
1. **No borrar nada** (ni datos del navegador, ni la app, ni archivos de Drive).
2. Los datos viven en el `localStorage` de ese navegador: abrir la app en el **mismo** teléfono y, con la versión nueva, **Exportar** (archivo `arroyo132-backup-AAAA-MM-DD.json`) y guardarlo en Drive/computadora.
3. En la computadora: **Importar** (fusiona sin borrar, avisa de duplicados) o «Traer de Drive».
4. Archivos originales y respaldos: `arroyo132-respaldo-independiente-20261015\` (solo lectura) y `docs/RECUPERACION_DE_DATOS_2026-10-15.md`.
5. Si un gasto desapareció de la lista pero el dato estaba corrupto: buscar la clave `a132_gastos_corrupto_*` en el almacenamiento del navegador (la versión nueva la conserva) y avisar antes de limpiar nada.

## 7. Riesgos que quedan
- **Sin marcas de tiempo por registro** no existe «el más reciente gana»: en un conflicto gana el dispositivo que respalda y el otro valor queda en `conflictos` (visible, recuperable). Mejora futura: campo `modificado` por gasto (decisión de diseño).
- **Una eliminación no se propaga** (la fusión nunca descarta): un gasto borrado en un equipo puede reaparecer al respaldar o traer desde otro. Es la contrapartida de «nada se pierde».
- Los contadores de límite del endpoint viven en memoria del proceso (no son una cuota global); la barrera real es la autenticación.
- 3 URLs de Vercel con almacenamiento separado hasta que se decida una sola.

---

## 8. Checklist consolidado de pendientes (2026-10-16, verificación independiente)

**Naturaleza:** verificación de solo lectura + documentación. No se desplegó, no se fusionó, no se tocaron credenciales ni se borró ningún dato. Lo que sigue sustituye a los pendientes dispersos de §3, §7 y del expediente: **una sola representación del estado vigente**.

### 8.1 Los tres despliegues (medidos hoy, `curl` + hash del blob de git)

| URL | bytes | sha256 (16) | sirve | variables de entorno |
|---|---|---|---|---|
| **https://arroyo132.vercel.app** | 182.138 | `9f1636224e8577cb` | **`main` byte a byte** | **sí**: `ANTHROPIC_API_KEY` (Production, Preview) |
| https://arroyo132-netlify.vercel.app | 182.138 | `9f1636224e8577cb` | `main` byte a byte | **ninguna** |
| https://jgarciarealty-hub-arroyo132.vercel.app | 182.138 | `9f1636224e8577cb` | `main` byte a byte | **ninguna** |

- **Proyecto canónico: `arroyo132`** (`prj_WC9cmqIZXQJjghAz12IEiyetFIVx`, creado 2026-05-02). Es el **único** con clave de IA ⇒ el único donde `/api/analyze-invoice` puede funcionar. Los tres sirven el mismo `main` desde el 2026-10-09 (producción de los 3 creada en el mismo instante, origen rama `main` del repo). Ninguno tiene dominio propio: los tres son solo `.vercel.app`.
- **La rama verificada NO está desplegada.** Su `index.html` en git es **213.690 bytes / `sha256 e5273110b35d7892…`**.
- **Nota CRLF (evita un falso positivo al validar):** el árbol de trabajo local mide **217.488 bytes / `814f27e5…`** y el blob de git 213.690; la diferencia (3.798 B, uno por línea) son finales de línea (`core.autocrlf=true`), **no** contenido. **Comparar contra el valor del blob, nunca contra el del archivo local.**

### 8.2 Variables requeridas (nombres tomados del código real: `api/analyze-invoice.js`)

| Variable | Estado verificado hoy | Acción |
|---|---|---|
| **`A132_ALLOWED_EMAILS`** | **AUSENTE en los 3 proyectos** | **Obligatoria** (correos de Google autorizados, separados por coma). Sin ella el endpoint responde **503** a propósito |
| `ANTHROPIC_API_KEY` | Presente **solo** en `arroyo132` (Production, Preview) | Nada; no cambiarla |
| `A132_ALLOWED_ORIGINS` | Ausente (por defecto `https://arroyo132.vercel.app`) | Opcional |
| `A132_CLIENT_ID`, `A132_MODEL`, `A132_EFFORT`, `A132_RATE_PER_MIN`, `A132_DAILY_BUDGET` | Ausentes (tienen valor por defecto) | Opcional |
| Google Cloud → OAuth client | No verificable desde aquí (vive en Google) | Confirmar que el origen de la URL canónica está autorizado |

### 8.3 Pendientes, con evidencia y criterio de cierre

| # | Pendiente | Evidencia de hoy | Cierre verificable |
|---|---|---|---|
| 1 | **Desplegar la rama** (§4) | 229/229 comprobaciones, 0 fallos; `main` es ancestro ⇒ `--ff-only` funciona; árbol limpio | `index.html` en vivo ≡ blob de la rama y `/api/analyze-invoice` sin credencial ⇒ 401/503 |
| 1-bis | **Acceso por PIN — BLOQUEADOR de despliegue** | Causa raíz demostrada: la versión en producción del 5-jul al 20-sep (base `fc0a54e`) guardaba el PIN con **SHA-256 + sal**; `main` usa un hash síncrono distinto ⇒ un PIN correcto creado en esa ventana **nunca** coincide; a los 5 intentos bloquea 5 min y, al vencer, el contador seguía en 5 (un intento re-bloqueaba de inmediato). Arreglo local en `index.html`: acepta los 3 formatos, migra a SHA-256 al entrar, limpia bloqueos vencidos/corruptos y sanea el contador — **sin desactivar la autenticación** (5 intentos, 5 min, sesión 30 min). Suite nueva `verificacion_pin_acceso`: **36/36** (incluye simulación escritorio vs celular). **No fusionado, no subido, no desplegado.** **Asimetría confirmada 2026-10-19: computadora SÍ entra, celular NO, ambos en `arroyo132.vercel.app` con el mismo HTML** ⇒ la diferencia es estado local del dispositivo (hash de julio, bloqueo persistente o contador), no código ni versión de la PWA (no hay service worker) | Jesvan abre la versión nueva **en su teléfono** y entra con su PIN real, sin bloqueo; luego exporta de inmediato (§8.3 #12). Si no entra: **NO borrar datos del sitio**. La recuperación por código al correo está diseñada y **no construida** (requiere credencial de correo) |
| 2 | **`A132_ALLOWED_EMAILS`** en `arroyo132` | Ausente en los 3 proyectos (búsqueda en el repo y en el historial: **nunca se ha configurado**, no hay valor previo que recuperar). **Propuesta para que Jesvan solo confirme:** los 2 correos que ya figuran como suyos — `jesvan@jgarciarealtypr.com` (literal en el repo) y `jgarciarealty@gmail.com`. Debe incluir **la cuenta de Google con la que se abre la app en el teléfono**, o el endpoint responderá 403 a esa sesión | Endpoint deja de responder 503 con una sesión válida, probado con la cuenta real |
| 3 | **URL oficial + PWA del teléfono** | **CONFIRMADO 2026-10-19 por el propietario: el celular usa `arroyo132.vercel.app`** — el mismo origen y el mismo HTML que la computadora (182.138 B). No hay service worker ni IndexedDB: la PWA es un acceso directo a la página viva, así que **no puede haber una versión vieja cacheada** | Confirmado (hecho) |
| 4 | **19 grupos duplicados en Drive** | Verificado por sha256: los 19 son **copias byte-idénticas** (2 por grupo) ⇒ riesgo de pérdida de contenido **cero**. 13 recibos (raíz ↔ `Recibos\A132-REC-*`) + 4 de `Severa Rosa\` + 2 pares entre expedientes. Hay además 1 par de punteros `.gsheet` (2 revisiones de la hoja) | Cada grupo con 1 copia y su hash == el del grupo; el recuento baja en 19 |
| 4-bis | **17 decidibles / 2 no** | Criterio por defecto: conservar la copia de la subcarpeta específica. **No decidibles:** `2013-198372-DEC-71814\` ↔ `2013-198372-Rec-83218\` (`escritura.pdf`, `Memorial Explicativo.pdf`): retirar uno lo saca de ese expediente | Decisión de Jesvan sobre esos 2 |
| 5 | **REC-002 (agrimensor)** — **archivo localizado** | `Agrimensor Carmelo\CONTRATO Y PRIMER PAGO PARCIAL.pdf`, 481.041 B, `sha256 8cb21358…` (medido 2 veces: copia de Drive ≡ adjunto embebido del respaldo de abril) | Copiado a `Recibos\` como `A132-REC-002_…`; la hoja deja de decir "Pendiente" |
| 6 | **7 recibos sin comprobante** (REC-003, 004, 015–019) | Ninguna de las 4 fuentes JSON tiene `fotos` ni `archivos`; los 5 de junio son posteriores al respaldo de abril y no están en el de julio. Si existen, **solo en el `localStorage` del teléfono** | O aparece el archivo, o la hoja los marca **"sin comprobante"** como estado final (hoy "Pendiente" es indefinido) |
| 7 | **REC-008** (id `700004`, 2026-04-13, $5.09) | Un solo registro con dos nombres; el PDF se llama `National Lumber` y es **escaneo solo-imagen** (ilegible por software); la app dice `Caribbean Lumber Victory` en los 3 respaldos; el dato del "mismo teléfono" **no está transcrito en ningún artefacto** | 1 minuto de Jesvan frente a `Recibos\A132-REC-008_NationalLumber_2026-04-13.pdf`: ¿mismo gasto (renombrar) o compra aparte? Un solo nombre en las 3 fuentes |
| 8 | **La Ferretería Cataño $28.88 duplicada** (ids `700007` / `1777258444590`) | La hoja solo tiene REC-011 | Decidir si se fusiona (afecta el total) |
| 9 | **Viajes vs "Gastos de Viaje"** | Abril/junio: 4 viajes ($271.30) **y** 3 gastos "Gastos de Viaje" ($198.35) | Confirmar si es doble conteo |
| 10 | **Cosme, mismo gasto con ids distintos** | Junio $232.48 con id nuevo vs REC-014 | Un solo registro |
| 11 | **Propagación de eliminaciones** (§7) | Causa raíz verificada en el código: sin `modificado` por registro y sin tombstone, la fusión **re-añade** lo borrado — incluido el propio dispositivo que borra (E1). **Parche COMPLETO Y PROBADO, en rama local aparte `feat/propagacion-borrados`** (commits `a160afc` + `e71ea12`, desde `e428f41`; `git diff --stat e428f41..feat/propagacion-borrados` = `index.html` +297 y `tests/verificacion_sync_respaldo.test.js` +183 = 451 inserciones / 29 supresiones). Contenido: lápida `{id, borrado, modificado}` + sello `modificado` al crear y al editar + "gana el `modificado` mayor" + la lápida que gana oculta el registro **y su foto** + purga conservadora a ~90 días. Compatibilidad: sin sello un registro nunca pierde, un respaldo antiguo **no puede borrar nada**, el respaldo sigue en `version: 4` (campos nuevos y aditivos). **Sin fusionar, sin push, sin desplegar.** Medición propia: **268 PASS / 0 FAIL** en esa rama (`verificacion_sync_respaldo` 108, era 69) y **229 PASS / 0 FAIL** en la candidata, intacta. Reversión: no usar la rama (`git branch -D feat/propagacion-borrados`). **Verificado 2026-10-18:** el merge con la punta actual de la candidata es limpio y el árbol fusionado pasa **268/268** (worktree temporal; las ramas no se tocaron) | Decisión de diseño de Jesvan: aprobar y autorizar el merge (el código no toca `A132_ALLOWED_EMAILS`, Drive ni producción). Límite conocido y aceptado a documentar: la regla depende del reloj de cada dispositivo (un reloj adelantado gana); si se quiere neutralizar, hay que acordar una regla extra de desempate |
| 12 | `localStorage` del teléfono | Los registros creados desde el teléfono después del 17-jun nunca llegaron a Drive. **El celular está bloqueado por PIN, y la exportación de la app vive detrás del PIN** ⇒ hoy no se puede exportar desde dentro de la app | Con el arreglo de PIN desplegado (autorizado): entrar en el celular → panel de respaldo → **Exportar respaldo (archivo)** → importarlo en la computadora y verificar. **No borrar datos del sitio.** Respaldo alterno sin tocar el almacenamiento: Android por USB (`chrome://inspect` → consola → copiar `a132_gastos`); iPhone no tiene vía segura sin un Mac → desplegar el arreglo y exportar. Ver §27 del expediente |

### 8.4 Estado de verificación (evidencia de esta pasada)

- **229 comprobaciones / 0 fallos** sobre `e428f41`, medidas por suite: `integration_port_branch` 16 · `verificacion_app_actual` 36 · `verificacion_diagnostico` 30 · `verificacion_endpoint_seguridad` 38 · `verificacion_ivu` 7 · `verificacion_presupuesto` 12 · `verificacion_recuperacion_20261015` 21 · `verificacion_sync_respaldo` 69.
- **Rama del parche (`feat/propagacion-borrados`, no candidata):** mismas 8 suites, medidas igual ⇒ **268 PASS / 0 FAIL** (`verificacion_sync_respaldo` 108, +39 pruebas nuevas de los apartados O1 a–d: propagación en 2 dispositivos, precedencia del sello, compatibilidad con respaldos viejos, registros heredados sin sello y purga). La rama candidata `e428f41` re-medida tras el trabajo: **229 / 0**, sin cambios.
- `api/analyze-invoice.js`: `node --check` limpio. `manifest.json` y `vercel.json`: JSON válido. Rama limpia; `git merge-base --is-ancestor main HEAD` ⇒ **fast-forward posible** (3 commits).
- Respaldo independiente en disco: `C:\Users\Owner\Downloads\arroyo132-respaldo-independiente-20261015\` (**65 archivos**, ~40,8 MB).
- **Corrección documental aplicada hoy:** `RECUPERACION_DE_DATOS_2026-10-15.md` §2 afirmaba que el contrato del agrimensor «no existe en ninguna carpeta de Drive». **Es falso** (ver #5); queda corregido ahí, con la afirmación anterior marcada como superada. Causa: el respaldo del 15-oct copió 4 orígenes y **ninguna subcarpeta**.
- **2026-10-19 — acceso por PIN:** suite nueva `tests/verificacion_pin_acceso.test.js` **29/29** y `verificacion_app_actual` **36/36** sobre el árbol de trabajo con el arreglo. **No se repitieron las 8 suites** (sin cambio que lo justifique: el arreglo está aislado al bloque de PIN y la suite nueva ejecuta el script completo). La cifra 229/229 de arriba sigue siendo la medición de `e428f41`, no de este árbol.

### 8.5 Reversión del despliegue

- Vía preferida: Vercel → Deployments → **Instant Rollback**. El despliegue de producción anterior documentado en §4 es `dpl_5zUwYV766ejfZNpJAd79zzzhHu8o`; **no se pudo reconfirmar por CLI en esta sesión** (el comando no devolvió salida), así que la vía siempre verificable es la del panel o `git revert`.
- Vía git: `git revert -m 1 <merge>` y push a `main`.
- **Ninguna de las dos toca datos**: `localStorage` y los archivos de Drive quedan intactos. La versión anterior, al respaldar, vuelve a escribir el archivo combinado `arroyo132-datos.json` con su formato de siempre; las copias por dispositivo `arroyo132-datos-<dispositivo>.json` **no se tocan**.
