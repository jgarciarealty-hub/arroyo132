# Arroyo 132 — prueba real controlada, recuperación y conflictos (2026-11-01)

Estado: preparado para cuando se autorice el despliegue. Nada de esto se ha observado en producción.

## A. Dónde vive cada cosa (verificado 2026-11-01)
| Dato | Ubicación real | Evidencia |
|---|---|---|
| Gastos vigentes | `localStorage` del navegador de cada dispositivo (`a132_gastos`). Celular y computadora tienen copias propias | código |
| Respaldo combinado | Drive: `arroyo132-datos.json` (copia sincronizada `G:\My Drive\arroyo132-datos.json`): 61 gastos, $8,808.37, 2026-11-01 04:59Z | lectura del archivo |
| Respaldo por dispositivo / índice | `arroyo132-datos-<dispositivo>.json`, `arroyo132-dispositivos.json` — **no existen aún en Drive** (la etapa 2 no ha respaldado desde ningún dispositivo) | listado de Drive |
| Respaldo previo a etapa 2 | `arroyo132-datos.RESPALDO-antes-etapa2-20261101.json` (73,623 B) | listado |
| Miniaturas | dentro del respaldo (`fotos`): 4 entradas | lectura |
| Originales de recibos anteriores | **No existen en ningún lugar verificable**: solo hay miniaturas de 320 px; el campo `archivos` de 41 gastos son nombres | análisis del respaldo |
| Carpeta de proyecto en Drive | `📁 Proyecto Arroyo 132 — JGarcía Realty` (creada 2026-04-26): `📸 Facturas y Recibos` y `📋 Documentos Legales` **vacías**; `Fotos` con 8 capturas de pantalla de Facebook (mayo) | listado de `G:\My Drive` |
| Originales nuevos (cambio local, sin desplegar) | Drive, carpeta que crea la app: «Arroyo 132 — Recibos originales» | pruebas con Drive simulado |

Límite técnico: con el permiso `drive.file` la app solo ve lo que ella crea; **no puede escribir en `📸 Facturas y Recibos`**. Por eso crea su propia carpeta. El propietario puede moverla (o su contenido) dentro de la carpeta del proyecto desde Drive: los archivos conservan su id y las referencias siguen válidas. No se movió nada.

## B. Prueba real controlada (requiere a Jesvan y un recibo físico) — tras autorizar el despliegue
1. Abrir la app en el celular, tocar ☁️ y conectar Google (cuenta autorizada).
2. Panel «Respaldo y sincronización»: anotar gastos/monto locales (esperado 61 / $8,808.37) y que «Drive verificado» muestre una fecha.
3. Registrar → fotografiar un recibo real (máxima calidad de la cámara). Esperado: mensaje «✅ Datos extraídos» **solo** si fecha, monto y comercio salieron; si falta algo, «Lectura incompleta (falta: …)». Revisar y corregir a mano; guardar.
4. Detalle del gasto: debe decir «⏳ Pendiente…» y pasar a «✅ En Google Drive, carpeta …, archivo recibo-<id>-<hash>.jpg (verificado …)». Pulsar «Ver recibo original»: debe mostrar «integridad verificada (SHA-256 coincide)».
5. En Drive (web o `G:\My Drive\Arroyo 132 — Recibos originales`): comparar tamaño del archivo con el de la foto original del teléfono (deben ser iguales).
6. Repetir con un PDF. Repetir con modo avión: debe quedar «Pendiente», conservarse la copia temporal, y subirse al volver la señal («Reintentar subida de recibos»).
7. Panel: «Drive verificado por relectura» con 62 gastos; en la computadora «Traer datos desde Google Drive» → solo añade, el total debe ser el mismo.
8. PIN: abrir en Samsung y computadora.
Criterio de cierre del incidente: pasos 3–7 observados y registrados con captura.

## C. Recuperación y conflictos (no automática)
- La app **nunca** restaura ni fusiona sola. «Traer datos desde Google Drive» y «Importar respaldo» muestran el resumen y piden confirmación; solo añaden.
- Conflicto (mismo id, contenido distinto): se conserva el local y el otro valor queda en `conflictos` dentro del archivo combinado (acumulativo, 200 máx.).
- Si el combinado en Drive se daña: cada dispositivo tiene su archivo propio; además `arroyo132-datos.RESPALDO-antes-etapa2-20261101.json`, y «Exportar respaldo (archivo)».
- Si una carga de recibo queda en error: no se pierde nada (copia temporal en el dispositivo); «Reintentar subida de recibos»; si el archivo se corrompe en Drive, la verificación SHA-256 lo avisa al abrirlo.
- Reversión del código: etiquetas git `produccion-etapa2-f192bf0-20261101` y Instant Rollback de Vercel al despliegue `dpl_FosPa7CzWPrjwr7j6wMS5uTSYFfW`.
