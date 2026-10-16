# Arroyo 132 — Recuperación de datos (2026-10-15)

**Naturaleza:** auditoría de solo lectura + respaldo independiente. **No se modificó, borró ni fusionó ningún dato real.** Producción intacta.
**Respaldo independiente:** `C:\Users\Owner\Downloads\arroyo132-respaldo-independiente-20261015\` (52 archivos, 36 MB, SHA-256 verificado releyendo cada copia, solo lectura; `MANIFIESTO.json` y `README.txt`). Los 2 Google Sheets no son copiables como archivo y se leyeron de Drive.

## 1. Qué existe y dónde (verificado)

| Fuente | Gastos | Viajes | Total | Nota |
|---|---|---|---|---|
| Respaldo 27-abr | 20 | 4 ($271.30) | $65,477.31 | incluye $60,000 de cierre y 6 adjuntos PDF embebidos |
| Respaldo 16-jun | 21 | 4 ($271.30) | $65,709.79 | igual + Ferretería Cosme $232.48 |
| Respaldo 6-jul | 19 | 0 | $4,912.70 | **idéntico a la hoja "Registro de Recibos" (REC-001…019, misma suma)** |
| Archivo vivo de Drive (16-jun) | 2 | 0 | $1,652.54 | el respaldo automático dejó de escribir el 17-jun |
| Hoja "Registro de Recibos" (2 versiones, 6-jul) | 19 | — | $4,912.70 | la versión de las 05:35 llama National Lumber a REC-008; la de las 04:49, Caribbean Lumber Victory |

**Corrección importante:** el respaldo del 6-jul **no es un superconjunto**. Contiene 7 filas que abril/junio no tienen, y abril/junio tienen 8 filas que julio no tiene:

- **Solo en abril/junio (no están en julio):** cierre de compra $60,000 (28-ago-2024), agrimensor $1,600 (honorario total; julio registra el primer pago de $800), plomero Edgardo Rodríguez $125 (20-mar), AAA deuda anterior $100 (24-mar), Toa Alta Hardware $234.15 (1-abr) y 3 "Gastos de Viaje" ($72.45, $72.95, $52.95).
- **Solo en julio:** agrimensor $800 (primer pago), AAA $175, Cosme $152.54 (también en el archivo vivo), La Ferretera PR $84.68, WEC $96.31, Toa Alta $120.15, Home Depot $60.61.
- Traer abril y junio sobre julio con la fusión de la app (prueba con los datos reales): **19 → 31 gastos, 4 viajes, 2 posibles duplicados, 0 conflictos, ningún registro perdido.**

## 2. Recibos (archivos)

- `…\Bo Palmas Arroyo\Recibos\`: **13 archivos** = **11 recibos** (REC-001, 005 [2 docs], 006–014 [012 con 2 docs]). Coincide con las 11 filas "Sí" de la hoja.
- **8 recibos sin archivo** (REC-002, 003, 004, 015–019): gastos en efectivo/cheque sin comprobante guardado en `Recibos\`. **Hallazgo:** el respaldo de abril trae embebido `CONTRATO_Y_PRIMER_PAGO_PARCIAL.pdf` (481,041 bytes), y por su nombre corresponde a REC-002 (agrimensor). Quedó extraído a archivo en `_adjuntos_extraidos/`. **No verificado** el contenido (no hay renderizador de PDF en esta máquina).

  > **CORRECCIÓN 2026-10-16 (verificada por sha256; la afirmación anterior queda SUPERADA, no borrada).** Aquí decía: *«que **no existe en ninguna carpeta de Drive**»*. **Es falso.** El archivo **sí existe** en Drive: `Bo Palmas Arroyo\Agrimensor Carmelo\CONTRATO Y PRIMER PAGO PARCIAL.pdf` (nombre con **espacios**; el extraído en el respaldo usa guiones bajos), **481,041 bytes**, `sha256 8cb21358…`, `mtime 2025-04-02` — medido dos veces de forma independiente (hash de la copia de Drive ≡ hash del adjunto embebido del respaldo de abril; gasto `1777255145420`, agrimensor).
  > **Causa del error:** el respaldo del 15-oct copió **4 orígenes y ninguna subcarpeta** (`Bo Palmas Arroyo\` en su raíz, `Recibos\`, el JSON de Drive y `Backup\`) — ver su `MANIFIESTO.json`. Por eso una subcarpeta como `Agrimensor Carmelo\` no quedó cubierta y su archivo se dio por inexistente. **Consecuencia operativa:** REC-002 no está perdido; solo falta copiarlo a `Recibos\` como `A132-REC-002_…` (escritura en Drive ⇒ requiere OK de Jesvan). Los **7** restantes (REC-003, 004, 015–019) sí carecen de adjunto **y de miniatura** en las 4 fuentes JSON: si existen, solo están en el `localStorage` del teléfono.
  > **Corrección de inventario (no afecta a los recibos):** este documento dice «52 archivos»; el árbol en disco tiene **65** (incluye `_analisis\` y los scripts) y el `MANIFIESTO.json` tiene **54 filas**, de las cuales 2 son punteros `.gsheet` sin hash (no copiables). Las tres cifras son coherentes leídas así.
- **7 PDF distintos** viven dentro de los respaldos de abril/junio (16 adjuntos, 9 repetidos); 6 también están en Drive. Ver `README.txt` del respaldo.
- La app **nunca guardó la foto completa**, solo una miniatura de 320 px.

## 3. Discrepancias y duplicados (documentados, NO resueltos)

1. **REC-008:** la app dice "Caribbean Lumber Victory"; la hoja nueva y el nombre del PDF dicen "National Lumber" (mismo día, $5.09, mismo teléfono). Parece una corrección de nombre posterior. Pendiente: que Jesvan confirme el comercio (no cambia ningún monto).
2. **La Ferretería Cataño $28.88 (15-abr)** aparece **dos veces** dentro de abril y de junio (ids 700007 y 1777258444590); la hoja solo tiene una (REC-011). Probable duplicado; no se tocó.
3. **Agrimensor:** $1,600 (abril, honorario total) vs $800 (julio, pago parcial): bases contables distintas, no un error.
4. **Viajes vs. "Gastos de Viaje":** abril/junio tienen 4 viajes ($271.30) **y** 3 gastos llamados "Gastos de Viaje" ($198.35): posible doble conteo; sin verificar.
5. **13 de los 19 grupos de duplicados por contenido** en Drive (mismo recibo con nombre original y copia `A132-REC-*`): no se tocaron (borrarlos es destructivo; decisión de Jesvan). **Verificado 2026-10-16 por sha256:** son **19** grupos en total (13 de recibos + 6 de documentos legales) y **los 19 son copias byte-idénticas** (2 copias exactas por grupo) ⇒ conservar cualquiera preserva el contenido íntegro; **riesgo de pérdida de contenido: cero**. **17 de los 19** tienen criterio de resolución decidible con la evidencia existente (conservar la copia de la subcarpeta específica); **2 no** (los pares del mismo documento archivado en dos expedientes: `2013-198372-DEC-71814\` ↔ `2013-198372-Rec-83218\`) porque retirar uno lo saca de ese expediente. Detalle completo y criterio de cierre: `PLAN_DESPLIEGUE_Y_ESCANEO_2026-10-15.md` §8.
6. **Cosme:** "Ferretería Cosme" (abr: ausente; jun: $232.48 con id nuevo) — mismo gasto REC-014, ids distintos.

## 4. Clasificación

- **Recuperable ahora (verificado):** todo lo anterior; la unión de los 3 respaldos preserva todos los registros.
- **Pendiente de acción humana:** confirmar REC-008, decidir los duplicados, adjuntar comprobante a los 8 sin archivo (o dar por buena la hoja).
- **NO verificable desde aquí:** los gastos y fotos que se registraron **desde el teléfono** después del 17-jun (viven solo en el `localStorage` del navegador de ese teléfono; el respaldo a Drive no los recogió). Hay que abrir la app en ese teléfono y exportar. **Tampoco** se sabe en cuál de las 3 URLs de Vercel se registraron (cada URL tiene su propio almacenamiento).

## 5. Herramientas (solo lectura, reproducibles)
`_analisis/reconciliar.js`, `_analisis/extraer_adjuntos.js` (dentro del respaldo) y `tests/verificacion_recuperacion_20261015.test.js` (en el repo).
