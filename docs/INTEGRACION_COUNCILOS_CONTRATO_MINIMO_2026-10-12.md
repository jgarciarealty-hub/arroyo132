# Arroyo 132 ↔ CouncilOS — Contrato mínimo de integración (propuesta, 2026-10-12)

**Estado:** **propuesta documentada, sin construir.** El encargo pide expresamente *no* construir ahora una plataforma de integración: primero identificar las interfaces que ya existen y definir un contrato mínimo. Esto es ese contrato.

---

## 1. El hecho que define todo el diseño

**Arroyo 132 no tiene servidor de datos.** Su única función de servidor es leer un recibo (`/api/analyze-invoice`) y no guarda nada. Los datos viven en **dos sitios, ambos del usuario**:

1. El `localStorage` del navegador de cada dispositivo.
2. El respaldo en **Google Drive de Jesvan** (el archivo `arroyo132-datos.json` y la copia por dispositivo).

Consecuencia directa: **un endpoint HTTP de solo-lectura en Arroyo no le serviría a CouncilOS**, porque el servidor no tiene los datos — solo los tiene el navegador de Jesvan. Cualquier "consulta a Arroyo" tendría que pasar por su navegador abierto.

Por eso la interfaz correcta no es una API nueva, es **el archivo que Arroyo ya escribe**.

## 2. Contrato propuesto

### 2.1 Superficie

```
Google Drive de Jesvan (solo lectura para CouncilOS)
├── arroyo132-datos.json              ← estado COMBINADO (la vista que leería CouncilOS)
├── arroyo132-datos-<dispositivo>.json ← copia propia de cada dispositivo
└── arroyo132-dispositivos.json        ← índice: qué dispositivos han respaldado y cuándo
```

### 2.2 Esquema de lectura (ya se produce hoy, `version: 4`)

```json
{
  "version": 4,
  "fecha": "ISO-8601",
  "dispositivo": "computadora-… | movil-…",
  "gastos":   [ { "id", "fecha", "contratista", "categoria", "lote",
                  "metodo", "monto", "descripcion", "tipo",
                  "es_abono?", "cuenta?", "monto_total?" } ],
  "viajes":   [ { "id", "fecha", "proposito", "peajes", "gasolina",
                  "comida", "estadia", "otros", "total", "notas" } ],
  "servicios": { "132A|132B": { "AAA|LUMA": [ { "id","concepto","monto","estado" } ] } },
  "contratistas": [ … ],
  "docs":     [ { "id","nombre","lote","estado","driveId","tipo","prioridad" } ],
  "timeline": [ … ],
  "presupuesto": { "<categoría>": <monto> },
  "fotos":    { "<id de gasto>": "data:image/jpeg;base64,…" },
  "tucoop":   { … }, "fin": { … }
}
```

### 2.3 Reglas del contrato

| Regla | Por qué |
|---|---|
| **CouncilOS lee; nunca escribe.** | Arroyo 132 es dueño de sus recibos, gastos y respaldos. Una escritura desde fuera puede corromper el respaldo y duplicar o perder gastos. |
| **Arroyo funciona sin CouncilOS.** | Todo lo rutinario (registrar un recibo, respaldar, consultar) es local + Drive. CouncilOS es un coordinador opcional, nunca una dependencia. |
| **Sin credenciales compartidas.** | CouncilOS no lleva la clave de Anthropic de Arroyo ni la del usuario. Si necesita leer el archivo, necesita **su propia** autorización de lectura sobre ese archivo, revocable. |
| **Arroyo no elige agentes ni evalúa tecnologías.** | Eso pertenece a la gobernanza de CouncilOS. Arroyo declara **capacidades**, no decide quién las usa. |
| **Los `id` son la identidad.** | Estables por dispositivo; CouncilOS no debe deduplicar por comercio+fecha+importe (dos compras legítimas pueden coincidir). |
| **Registro de acciones.** | Cada lectura externa debería quedar registrada en el lado de CouncilOS; Arroyo no puede registrar lo que no ve. |

### 2.4 Capacidades que Arroyo declara (lo que CouncilOS podría coordinar)

```
arroyo132.recibos.leer          — leer gastos/recibos (estructurado)
arroyo132.viajes.leer           — leer viajes y peajes
arroyo132.documentos.leer       — leer el checklist de documentos y su estado
arroyo132.servicios.leer        — leer el estado de AAA/LUMA por lote
arroyo132.resumen.generar       — resumen de gastos y pendientes
arroyo132.recibo.registrar      — [NUNCA desde fuera sin la persona] registrar un gasto
arroyo132.respaldo.verificar    — verificar que el respaldo está al día
```

La última está marcada a propósito: registrar un gasto es dinero real y **siempre** pasa por revisión humana. Ninguna integración puede saltarse eso.

### 2.5 Envoltorio de resultado (para cuando CouncilOS consuma)

```json
{ "ok": true, "proyecto": "arroyo132", "version_esquema": 4,
  "generado": "ISO-8601", "origen": "arroyo132-datos.json",
  "datos": { … }, "avisos": ["3 posibles duplicados sin revisar"],
  "procedencia": "Google Drive del propietario" }
```

`avisos` es obligatorio: el archivo ya registra `a132_conflictos` y los posibles duplicados, y un consumidor debe verlos en vez de tratarlos como datos limpios.

## 3. Ejemplo del encargo, resuelto con este contrato

> *"Revisa los recibos de Arroyo 132, identifica gastos pendientes y prepara un resumen."*

1. CouncilOS identifica el subproyecto → **capacidad** `arroyo132.resumen.generar`.
2. Lee `arroyo132-datos.json` (solo lectura) con su propia autorización.
3. Detecta: gastos sin comprobante, servicios AAA/LUMA en $0, los 8 gastos históricos sin fecha/descripción, y los posibles duplicados marcados.
4. Prepara el resumen con `avisos`.
5. **No escribe nada.** Si el resumen sugiere registrar un gasto, se lo propone a Jesvan, que lo hace en la app.

## 4. Qué haría falta para conectarlo (cuando Jesvan lo decida)

1. **Decisión de Jesvan**: autorizar a CouncilOS lectura sobre el archivo de Drive (o sobre la carpeta). Es una decisión de permisos y credenciales → Human Decision Gate.
2. **Nada que construir en Arroyo** para la lectura: el archivo ya existe, es JSON versionado y está completo.
3. Opcional y futuro: si Arroyo llegara a tener almacén propio en servidor, ahí sí tendría sentido un endpoint `GET /api/arroyo/resumen` de solo lectura autenticado. **Hoy sería infraestructura inútil.**

## 5. Lo que NO se va a hacer (y por qué)

- **No** se construye una API de escritura: puede perder o duplicar gastos reales.
- **No** se le da a CouncilOS la clave de Anthropic ni el Client ID de Arroyo.
- **No** se convierte a CouncilOS en requisito para registrar un recibo.
- **No** se duplica en Arroyo la selección de agentes ni la evaluación de modelos: es gobernanza de CouncilOS.
- **No** se crea una sincronización bidireccional aparente: la fusión es no destructiva y las diferencias se **avisan**, no se resuelven solas.
