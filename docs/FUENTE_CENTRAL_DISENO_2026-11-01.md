# Arroyo 132 — fuente central única de datos y documentos (diseño + prototipo local, 2026-11-01)

Estado: **diseño y prototipo probado en local. Nada migrado, nada desplegado, la app de producción no cambió.** Código: `central/estado_central.js`; pruebas: `tests/central_estado.test.js` (21/21 con copias reales respaldadas de solo lectura).

## 0. Por qué falla hoy (evidencia, no suposición)
1. Los gastos viven en `localStorage` de cada navegador; Drive es solo una copia. No hay quién decida «la verdad».
2. **Colisión de ids sembrados.** `recuperarRecibos` inyecta en todo perfil vacío 11 gastos con ids fijos 700001–700011. El celular usa esos mismos ids para otros gastos (700010 = Ferretería Cosme Inc. $232.48 en el celular; = Operador Excavadora $1,500 en la semilla). «Traer datos desde Drive» conserva lo local en un conflicto, así que **importar el archivo de 61 en la computadora da 59 gastos y $8,528.53** (probado en un navegador aislado con el archivo real respaldado: faltan Caguas $43.89 y Cosme Inc. $232.48 y AIG queda en $30.22). Por eso **no se ejecutó la importación real**: la condición «61 por $8,808.37» no se cumple con la función actual.
3. Las dos copias de un mismo registro no tienen versión: no se sabe cuál es más nueva (solo «gana lo local»).

## 1. Infraestructura existente evaluada (reutilizar primero)
| Componente | Qué ya hace | Aptitud como fuente central |
|---|---|---|
| **Google Drive + OAuth `drive.file`** (en uso) | Respaldo combinado, copia por dispositivo, carpeta de originales verificada (MD5), todo del propietario; $0 | **Sí, como almacén canónico**. Límites: sin escritura condicional atómica (se mitiga: ver §3); la app solo ve lo que ella creó (los 13 PDF antiguos se abren por enlace) |
| **Proyecto Vercel `arroyo132`** (serverless, autenticación Google + lista de correos, ya desplegado) | `api/analyze-invoice.js` | Reutilizable como API de datos si algún día se necesita atomicidad |
| **Vercel Blob** (misma cuenta) | Escritura condicional `ifMatch`/ETag (documentación oficial), acceso privado | **Plan B** si se quiere atomicidad real. Requiere crear el almacén y una variable de entorno con token (cambio de producción + credencial → su aprobación). Cuotas de Hobby: **no verificadas** |
| **Supabase del negocio** (`wkizzwqsyyobrbkooyxd`, Pro) | Postgres + Storage ya pagos | **No**: CLAUDE.md prohíbe mezclar Arroyo con los datos de JGarcia Realty; un proyecto nuevo tendría costo ($0 adicional es la regla) |
| CouncilOS | Gobernanza/vigilancia (resumen diario, `arroyo_vigilancia.js`) | No almacena datos de Arroyo; sí vigila |

**Recomendación mínima y reutilizable: «Drive canónico v5» (Fase 1, $0, sin servicios ni dependencias nuevas)**, con un adaptador de almacén intercambiable para pasar a Blob (Fase 2) sin reescribir la lógica.

## 2. Modelo de datos (v5)
Un único documento canónico `arroyo132-central-v5.json` en Drive (archivo NUEVO; el v4 `arroyo132-datos.json` no se toca):
`{version:5, rev, actualizado, gastos:{<id>:{…campos…, _v, _t, _o, _del?, docs:[…]}}, viajes, servicios, contratistas, docs, timeline, presupuesto, conflictos[]}`
- `_v` versión del registro (sube con cada edición), `_t` hora, `_o` dispositivo. Borrar = `_del:true` (lápida; nunca eliminación física; reutiliza la idea de la rama `a160afc`).
- **Sin semillas**: en modo v5 se elimina `recuperarRecibos`; la computadora ya no inventa ids.
- **Documentos por gasto** (`docs[]`): `{tipo:'recibo|factura|foto', origen:'app|externo', driveId, nombre, bytes, sha256, ancho, alto, procedencia:'cámara|galería|PDF|importado', fecha}`. `origen:'app'` → el original completo (resolución intacta) vive en la carpeta «Arroyo 132 — Recibos originales» con verificación MD5/SHA-256 (ya implementado y probado); `origen:'externo'` → los 13 PDF existentes, abiertos por enlace (la app no puede descargarlos con su permiso actual). Las miniaturas son solo vista previa.
- Tipos de registro: `compra`, `servicio`, `viaje` (sin recibo obligatorio), `pago_terreno`; el requisito documental se deriva del tipo; «sin comprobante» es un estado válido, nunca un error.

## 3. Protocolo de lectura/escritura (sin duplicados, sin sobrescrituras, sin pérdidas)
1. **Al abrir** (y cada vez que la app vuelve a primer plano): leer el v5; el estado local es solo caché.
2. **Escribir** = leer → aplicar el cambio → fusionar (`fusionar`: gana la versión mayor, a igualdad la hora, a igualdad el dispositivo; el perdedor queda en `conflictos`) → **escritura condicional**: Drive no ofrece precondición atómica, así que se comprueba `headRevisionId` justo antes, se escribe, y se **relee y verifica** que los registros propios están; si otro dispositivo se coló, se repite (hasta 5 veces). Con Blob (Fase 2) es atómico (`ifMatch`).
3. **Guardas**: nunca se escribe un estado con menos registros que el leído; si el archivo existe y no se puede leer, se aborta (ya implementado en `driveDescargar`); las ediciones sin conexión van a una cola local y se fusionan al reconectar.
4. **Respaldos independientes**: instantánea diaria inmutable `arroyo132-snap-AAAAMMDD.json` (nunca se sobrescribe), copia por dispositivo, y el v4 intacto; `arroyo_vigilancia.js` ya alerta si el respaldo retrocede.
5. Todo cambio de un importe dudoso exige evidencia documental; el sistema solo **registra** la diferencia (p. ej. AIG: central $33.69 vs semilla $30.22).

## 4. Prototipo y evidencia (TESTED LOCAL)
`tests/central_estado.test.js` — con las copias reales respaldadas: migración v4→v5 = **61 gastos, $8,808.37 exactos**, entrada intacta (reversible), idempotente; perfil antiguo de la computadora (solo semilla) incorporado → **sigue 61 / $8,808.37** (700010 y 700011 reconocidos como duplicados de otros ids, AIG registrado como diferencia sin cambiar el importe, repetir no cambia nada); concurrencia (escritura obsoleta rechazada y reintentada, ambas altas se conservan); edición simultánea del mismo registro (determinista, el perdedor se conserva); lápidas (se propagan, no resucitan); guarda de no-regresión; instantánea inmutable.
Pendiente: adaptador Drive (headRevisionId + relectura), integración en `index.html` tras bandera, y **revisión independiente** (no sustituible por estas pruebas).

## 5. Plan de migración reversible (NO ejecutado; requiere su aprobación en cada paso material)
| Paso | Acción | Reversión |
|---|---|---|
| M0 | Respaldos con hash (hecho, 10 archivos) | — |
| M1 | Local: generar v5 a partir de la copia del celular y comparar (61 / $8,808.37) | borrar el archivo local |
| M2 | **[aprobación]** subir `arroyo132-central-v5.json` como archivo NUEVO a Drive; v4 intacto | borrar el v5 |
| M3 | **[aprobación + revisión independiente]** desplegar la app que lee v5 si existe (bandera), sin tocar datos locales | rollback de Vercel (`dpl_CH3SW5FXwT5qgGXcJwQuD74UBeNY` → etapa anterior) |
| M4 | **[aprobación]** primero el celular (canónico) y después la computadora con «incorporar perfil antiguo» (semilla descartada, diferencias registradas) | volver a v4: los archivos y el localStorage previos no se modifican |
| M5 | Verificar 61 / $8,808.37 en ambos y snapshot diaria activa | — |

## 6. Decisiones que necesito (ninguna se ejecuta sin su respuesta)
1. Aprobar la **Fase 1 (Drive canónico v5, $0)** como diseño; Blob queda como Plan B solo si exige atomicidad real.
2. Autorizar construir en local el adaptador Drive + integración con bandera y su revisión independiente.
3. Más adelante: M2–M5 y el despliegue (cada uno con su propia aprobación).

## 7. Estado de implementación (2026-11-01, tras la aprobación de la Fase 1) — TESTED LOCAL, sin migrar ni desplegar
- **Causa del 59/$8,528.53 (corregida):** los dos registros que el import clásico omitía eran **Caguas Commercial $43.89** (id 700011 del celular) y **Ferretería Cosme Inc. $232.48** (id 700010 del celular): sus ids chocaban con los ids sembrados 700011 («Ferretería Cosme $152.54») y 700010 («Operador Excavadora $1,500») de la computadora; la fusión conserva lo local en un conflicto y no añade el registro remoto. La diferencia de $3.47 era AIG ($30.22 sembrado vs $33.69). Corrección: en modo central las semillas no se inyectan, y al activar, el perfil antiguo se reconoce **por contenido con multiplicidad** (los peajes idénticos de ida y vuelta cuentan por separado), nunca por id.
- **Código:** `central/estado_central.js` (núcleo puro), `central/almacen_drive.js` (adaptador Drive: comprobación de `headRevisionId`, recuperación por historial de revisiones si otro dispositivo se coló, verificación inmutable de la revisión escrita, aborta ante duplicados/archivo vacío o ilegible), bloque «Fuente central única» en `index.html` (apagado por defecto; botón solo con `?central=1`; activación con confirmación que explica idénticos/duplicados/conflictos; copia previa `a132_antes_central`).
- **Pruebas:** `central_estado` 25, `central_drive` 22, `central_app` 26 (dos dispositivos con funciones reales de la app) + 11 suites previas; mutaciones de las guardas detectadas; además prueba en navegador real con dos orígenes y un Drive simulado por HTTP: celular (61 reales) crea el central, computadora (semilla de 11) activa y ve **61 / $8,808.37**, AIG intacto en $33.69 y diferencia registrada; alta y edición se propagan; sin conexión queda ERROR visible y se envía al volver.
- **Pendiente:** revisión independiente de la integración (en curso), prueba contra Drive real (revisiones, `headRevisionId`) y las aprobaciones M2–M5 de §5.
