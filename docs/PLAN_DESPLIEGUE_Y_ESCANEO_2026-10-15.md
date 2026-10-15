# Arroyo 132 — Plan de despliegue, rollback y procedimiento para escanear recibos (2026-10-15)

**Estado:** preparado, **NADA desplegado**. Rama `feat/seguridad-y-sincronizacion-recibos` (sin fusionar, sin subir). Producción = `main` @ `48d05e8` (deployment `dpl_5zUwYV766ejfZNpJAd79zzzhHu8o`, `isRollbackCandidate: true`).

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
