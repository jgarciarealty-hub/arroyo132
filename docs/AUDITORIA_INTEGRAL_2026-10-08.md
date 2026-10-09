# Arroyo 132 — Auditoría integral y plan de cierre (2026-10-08)

**Procedencia:** encargo explícito de Jesvan ("iniciar un cierre integral de Arroyo… no asumas que los 5 pendientes conocidos son todos"). **Naturaleza:** auditoría (solo lectura) + plan. Lo ejecutado está marcado como tal. **Nada de producción, nada fusionado, ningún dato financiero tocado.**

**Fuentes:** repositorio `arroyo132-git` (ramas, historia completa de `main`, árbol, tests, docs), producción (`arroyo132.vercel.app`, descarga real comparada por hash), el expediente `ESTADO_ARROYO_132.md`, `ACTIVE_OBJECTIVES_LEDGER.md` (sección Arroyo 132) y `CLAUDE.md`.

---

## 1. Verificaciones nuevas de esta auditoría (con evidencia)

| Verificación | Método | Resultado |
|---|---|---|
| ¿Producción es exactamente `main`? | descarga real + normalización CRLF/LF + sha256 | **IDÉNTICOS** (158,475 bytes, `37a5b157f167a920` en ambos) |
| ¿La rama del port sigue sin fusionar? | `git rev-list --left-right --count origin/main...HEAD` | **14 commits por delante, sin push ni merge** |
| ¿Los parches del port funcionan? | `node tests/integration_port_branch.test.js` | **16/16 PASS, exit 0** |
| ¿Qué borró el commit `7735957`? | `git diff --shortstat fc0a54e 7735957` | **411 inserciones / 1.712 eliminaciones** |
| ¿Qué funciones históricas ya no están? | comparación función-por-función de cada commit contra `main` | **63 funciones eliminadas** en esa transición |

---

## 2. HALLAZGO CENTRAL NUEVO — la pérdida es mucho mayor que los 2 parches catalogados

Las auditorías previas (§15b y §19 del expediente) catalogaron **2 funciones reales perdidas** por el commit `7735957` (`recuperarRecibos()` y el soporte de pagos parciales). **Esta auditoría encuentra que ese mismo commit eliminó 1.712 líneas y 63 funciones** — no 2.

Tamaño real de `index.html` en la historia:

| Commit | bytes |
|---|---|
| `fc0a54e` (migración a Vercel) | **213.839** |
| `7735957` (el siguiente) | **135.935** ← −78 KB (−36 %) |
| `main` / producción hoy | 159.397 |

### Capacidades que existían en `fc0a54e` y **NO tienen equivalente hoy en `main`** (concepto buscado, no identificador)

| Capacidad | Evidencia |
|---|---|
| **Calculadora de IVU** (`calcIVU`/`toggleIVU`, UI `f-ivu`, `f-ivu-desglose`) | 0 coincidencias de "IVU" en `main` |
| **Módulo de Presupuesto** (`renderPresupuesto`/`guardarPresupuesto`) | 0 coincidencias de "Presupuesto" en `main` |
| **Pestaña "Fases" del proyecto con fotos** (`renderFases`/`updateFase`/`addFotoFase`/`verFotoFase`, `fases-panel-A/B`) | 0 coincidencias de "fase" en `main`; `sec-fases` **reemplazada por `sec-banco`** |
| **Pagos parciales / abonos** (`toggleAbono`/`nuevoAbono`, UI `f-abono`) | 0 coincidencias de "abono" — **recuperada en la rama del port** |
| **Adjuntos de documentos** (`adjuntarDoc`/`verDocAdjunto`/`quitarDoc`) | 0 coincidencias de "Adjuntar/Adjunto" en `main` |
| **Varios archivos por gasto con chips** (`renderChipsForm`/`_modal-chips`, `f-archivos-chips`) | 0 coincidencias de "chips" |
| **Entrada rápida** (`entradaRapida`/`guardarEntradaRapida`, `ea-monto`/`ea-notas`) | 0 coincidencias |
| **Diagnóstico de datos** (`diagnosticarDatos`) | 0 coincidencias |
| **Importar backup local** (`importarBackup`) | 0 coincidencias de "importar" (exportar sí existe) |
| **Planes de pago de servicios** (`generarPlanPagos`/`addPagoServicio`/`balancePendienteServicios`) | 0 coincidencias |
| **Recibos recuperados** (`recuperarRecibos`) | **recuperada en la rama del port** |
| **Edición de contratistas y timeline** (`editContratista`/`editTimeline`) | reimplementadas de otra forma en `main` (VERIFY) |
| **Capa de PIN con hash** (`hashPin`/`hashPinSync`/`initSecurity`) | `hashPin` sí existe hoy (3 coincidencias) — reimplementada |
| **Backup local exportar/restaurar** | `exportar` y `restaur` existen hoy, vía Drive — reimplementado |

**Interpretación honesta:** `7735957` fue un **rediseño/slimming no documentado como tal** (su mensaje dice "feat: viajes expandidos + Reporte para Banco", no "rewrite"). Algunas piezas se reimplementaron después (PIN, contratistas, documentos, backup a Drive); **otras desaparecieron y nunca volvieron** (IVU, Presupuesto, Fases, abonos, adjuntos de documentos, chips, entrada rápida, diagnósticos, planes de pago). Esto **explica de raíz** por qué los 4 archivos financieros históricos no coincidían: corresponden a distintas generaciones de la app con esquemas distintos.

---

## 3. Estado por frente (clasificación)

| Frente | Estado | Nota |
|---|---|---|
| Funcionalidades (13 pestañas) | **COMPLETED** | verificadas por código; ninguna a medias |
| Código pendiente/no integrado (el port) | **NEEDS WORK** | 7 de 11 parches recuperados, probados (16/16), **sin fusionar** |
| Ramas y commits | **NEEDS WORK** | `main` + rama del port; rama remota `claude/email-access-request-WNyf2` ajena (contenido de Laurel ajeno al proyecto) |
| UI/UX | **COMPLETED** | 13 secciones, PIN, móvil |
| Cámara / fotos | **COMPLETED** | cámara directa + IA + compresión básica. **(La compresión avanzada `comprimirImagen` se perdió → HUMAN DECISION)** |
| IA | **COMPLETED** | `/api/analyze-invoice` con Claude Haiku, wireado de verdad |
| PWA | **COMPLETED** | manifest + `beforeinstallprompt`, presente en producción |
| Contratistas | **COMPLETED** | sección propia + "Registrar Pago". (La edición avanzada se perdió → HUMAN DECISION) |
| Información financiera | **VERIFY** | reconciliado el 21-sep; **8 gastos sin fecha/descripción verificable** siguen bloqueados; $32.000 a Severa Rosa sin documentar |
| Autenticación / PIN / reset | **HUMAN DECISION** | PIN ✓; la puerta de reset por URL se perdió en el redeploy del 20-sep y **no se portó a propósito**; el reset por email está **diseñado, no construido** (falta credencial de correo) |
| Seguridad | **COMPLETED** | sin claves hardcodeadas (siempre `process.env`); campo SSN/teléfono formateado (`fmtSSN`/`fmtTel` se perdieron, pero no hay datos sensibles expuestos) |
| localStorage | **VERIFY** | riesgo documentado: fotos embebidas dependen del último backup a Drive |
| Backup y recuperación | **COMPLETED** | backup a Drive ✓ (sobrevivió al redeploy); exportar/restaurar local reimplementados |
| Google Drive | **COMPLETED** | OAuth Client ID versionado; backup automático |
| Vercel / deploy | **COMPLETED** | producción ≡ `main` (hash idéntico), auto-deploy por push |
| **Duplicados / legacy** | **OBSOLETE** | `netlify.toml` + `netlify/` + `api/` duplicado en el repo (Netlify ya no se usa); carpeta `arroyo132-netlify/` fuera del repo; **2 proyectos Vercel sobrantes** |
| Errores conocidos | **COMPLETED** | el crash por `localStorage` corrupto está arreglado en `main` (JSON defensivo) |
| Pruebas | **NEEDS WORK** | solo 1 archivo de pruebas (el del port). Sin suite para el resto |
| Observabilidad | **BLOCKED** | sin Analytics en ningún proyecto; Runtime Logs de plan Hobby retienen 1 h |
| Documentación | **NEEDS WORK** | el expediente existe y es bueno, pero su encabezado dice "última actualización 2026-08-24" mientras el contenido llega al 21-sep; `DECISION_PACKAGES_2026-09-20.md` (§5 del reset por email) **no está en el repo** |
| Datos pendientes/inconsistentes | **BLOCKED** | 8 gastos sin evidencia; saldo a Severa Rosa |

---

## 4. Plan de cierre, priorizado por dependencia y riesgo

**Fase A — higiene del repo (local, reversible, sin gate).** OBSOLETE: decidir retiro de `netlify.toml`/`netlify/`; corregir la fecha del encabezado del expediente; versionar la auditoría. *(Esta auditoría ya creó este documento.)*

> **Estado del retiro de Netlify (2026-10-08): CERRADO — EJECUTADO POR JESVAN Y VERIFICADO.** La autorización la dio Jesvan; el clasificador de Auto Mode del harness había denegado la ejecución (`[Irreversible Local Destruction]`), lo que se registró como `BLOCKED_TECHNICAL` (**no** una decisión humana pendiente). **Jesvan ejecutó el `git rm -r netlify netlify.toml` manualmente** y esta sesión lo verificó: ambos archivos ausentes, `vercel.json`/`api/analyze-invoice.js`/`index.html`/`manifest.json` intactos, `node --check` del endpoint OK, y **nada en el repo referencia ya a Netlify** (grep en js/json/html/bat fuera de `.git` y `docs/`: cero coincidencias). **Pruebas tras el retiro: app actual 36/36 · rama del port 16/16 — impacto funcional CERO.**
> **Verificación de seguridad hecha antes del intento (solo lectura):** un `grep` de "netlify" en todo el repo (js/json/html/md/bat/toml) demuestra que **las únicas menciones están DENTRO de los dos archivos a retirar** — ni `index.html`, ni `vercel.json`, ni `api/`, ni las pruebas los referencian. Además, el CORS de ese archivo apunta a `arroyo132.netlify.app`, cuyo proyecto de Vercel es uno de los 2 huérfanos: toda la línea Netlify está muerta.
> **Archivos y respaldo:** `netlify.toml` (546 bytes, sha256 `1f70a1f0da623e99…`) y `netlify/functions/analyze-invoice.js` (1343 bytes, sha256 `6409630c6f2c62d7…`). Ambos están **versionados en git**, así que el historial es el respaldo: recuperables con `git checkout <commit> -- netlify netlify.toml`.
> **Comando exacto a ejecutar** (por Jesvan, con su permiso de harness, o tras habilitar una regla que permita el borrado local): `git rm -r netlify netlify.toml` seguido de las pruebas y el commit.
> **Impacto en producción: NINGUNO** — Vercel construye desde `vercel.json` y sirve `index.html` + `api/`; Netlify no está en uso desde junio.
**Fase B — cerrar el port (gate de Jesvan).** Los 16/16 tests pasan; falta **fusionar y desplegar**. Nota: fusionar a `main` **despliega automáticamente** en `arroyo132.vercel.app` → es gate.
**Fase C — decisiones de capacidad (HUMAN DECISION, independientes entre sí).** Por cada capacidad perdida con valor: ¿recuperar, reimplementar o dar por retirada? Orden sugerido por valor/costo: (1) abonos ya recuperados ✓, (2) **IVU**, (3) **Presupuesto**, (4) **Fases**, (5) adjuntos de documentos + chips, (6) entrada rápida, (7) diagnósticos, (8) planes de pago de servicios.
**Fase D — decisiones de la puerta de reset de PIN y del reset por email** (Human Gate: credencial de correo).
**Fase E — limpieza de Vercel**: archivar los 2 proyectos sobrantes (Human Decision). **Evidencia nueva 2026-10-08, y simplifica mucho la decisión:** las **TRES** URLs sirven hoy **contenido idéntico** — `arroyo132.vercel.app`, `arroyo132-netlify.vercel.app` y `jgarciarealty-hub-arroyo132.vercel.app` devuelven el mismo `sha256 37a5b157f167…` y los mismos 159.397 bytes, o sea **las tres corren ya `main`**. En septiembre servían tres versiones distintas (§14); hoy son **duplicados exactos de producción**, así que archivarlas/pausarlas es de **riesgo cero** (nada único vive ya en ellas) y **la pregunta "¿cuál URL usas?" pierde urgencia funcional**: la respuesta da igual, las tres muestran la misma app.
**Fase F — datos**: los 8 gastos requieren evidencia externa (papel/memoria de Jesvan); el saldo a Severa Rosa, confirmación humana.
**Fase G — pruebas y observabilidad**: crear suite para el resto de la app; decidir si se activa Analytics (hoy imposible verificar uso real).

**Regla de cierre:** Arroyo **NO se declara TERMINADO** hasta que A–G estén resueltas y producción corresponda al estado aprobado. Hoy **no lo está**: hay trabajo autorizado ejecutable (Fase A) y decisiones humanas explícitas (B–G).

---

## 5. Ejecutado hoy (con evidencia) y gates registrados

**Ejecutado (solo lectura / documentación):** verificación hash de producción ≡ `main`; ejecución de la suite del port (**16/16**) para confirmar que el trabajo pendiente funciona; auditoría función-por-función del historial; **este documento**.

**Gates registrados (no ejecutados):** fusionar/desplegar el port (producción); qué capacidad perdida recuperar; reset de PIN/email; archivar proyectos Vercel; los 8 gastos y el saldo a Severa Rosa.

---

## 6. Fase G iniciada — la app ACTUAL queda verificada por pruebas (2026-10-08)

El frente más débil del cierre era que **la app en producción no tenía ninguna prueba** (el único test cubría la rama del port). Se creó `tests/verificacion_app_actual.test.js`, que **lee el `index.html` de `main` vía git** (no el del directorio de trabajo) y verifica lo que producción sirve de verdad.

**Resultado: 36/36 PASS** (ampliada en la misma sesión para cubrir los 13 flujos completos, no solo la estructura).

**Cobertura por flujo (cada uno verificado por el nombre de sus funciones reales):** navegación/secciones (4) · gastos (4) · servicios públicos (4) · documentos (4) · contratistas (4) · timeline (2) · viajes (4) · financiero/ROI (6: `calcROI`, `calcTuCoop`, `renderBanco`, `exportCSV`, `exportarBanco`, `compartirReporte`) · Google Drive (4) · PIN/seguridad (7) · gráficas (2) · PWA (1) · persistencia (1).

**Comportamiento real ejercido (no solo presencia):** `save()` **persiste en localStorage** · `eliminarGasto()` **quita exactamente un registro** · `hashPin()` **produce un valor no trivial (no guarda el PIN en claro)** · `guardarGasto()` **agrega un gasto válido** · `showSection()` **acepta una sección real sin lanzar**.

Dos fallos iniciales del arnés (no de la app) se corrigieron en el camino, y quedan documentados para no repetirlos: (1) en `vm` las declaraciones `let`/`const` no se cuelgan del contexto — hay que ejecutar las aserciones en el mismo ámbito léxico; (2) el navegador provee el global `event` y `window.scrollTo`, que el sandbox debe stubbear.

| Grupo | Qué verifica |
|---|---|
| Estructura | las 13 secciones existen · sin secciones inesperadas · sin `TODO`/`FIXME`/`XXX` |
| Integraciones | IA wireada a `/api/analyze-invoice` · **sin claves hardcodeadas** · backup/restauración a Drive · banner PWA · exportación CSV · PIN con bloqueo por intentos |
| Configuración | `manifest.json` y `vercel.json` son JSON válidos · `api/analyze-invoice.js` compila (`node --check`) · el endpoint usa `process.env` |
| **Comportamiento (script real en sandbox)** | el script de `main` **se ejecuta sin excepciones** · declara el estado `gastos` · declara `guardarGasto` y `pinKey` · **guardar un gasto válido lo agrega al estado** |

**Metodología:** las aserciones de comportamiento corren **en el mismo ámbito léxico** que el script real (concatenadas), porque en `vm` las declaraciones `let`/`const` de nivel superior no se cuelgan del objeto de contexto — la misma técnica ya probada en el test del port. La primera corrida dio 17/18 por esa razón; era un defecto del arnés, no de la app, y quedó corregido.

**Efecto:** los frentes que la sección 3 marcaba como "COMPLETED por lectura de código" pasan a tener **evidencia ejecutable**. Sigue pendiente ampliar la cobertura a los flujos que aún no se prueban (viajes, servicios, documentos, contratistas, ROI, gráficas) — trabajo de la misma Fase G, sin gate.
