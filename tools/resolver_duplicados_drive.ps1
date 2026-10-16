<#
.SYNOPSIS
  Plan / resolucion REVERSIBLE de duplicados byte-identicos (mismo SHA256)
  en la carpeta de Drive "Bo Palmas Arroyo" (proyecto Arroyo 132).

.DESCRIPTION
  Detecta archivos duplicados (mismo SHA256 y mismo tamano) entre:
    * la RAIZ de la carpeta de Drive          -> copias sueltas   -> SE RETIRAN
    * Recibos\ y Severa Rosa\ (subcarpetas)   -> copias buenas    -> SE CONSERVAN

  MODO POR DEFECTO = SECO (solo lectura):
    No mueve, no borra y NO escribe ningun archivo. Solo imprime el plan,
    mostrando que copia se conserva, que copia se retiraria, el SHA256 de
    ambas y la verificacion de que coinciden.

  CON -Aplicar:
    NUNCA borra. Mueve la copia redundante a una carpeta de cuarentena dentro
    de Drive conservando su ruta relativa, e imprime el comando exacto de
    reversion para cada movimiento. Escribe la bitacora
    tools\duplicados_2026-10-16\log_movimientos.csv (dentro del repo, no en Drive).

  SALVAGUARDAS OBLIGATORIAS:
    a) Recalcula SHA256 de AMBAS copias inmediatamente antes de mover y ABORTA
       ESE PAR si no coinciden exactamente.
    b) Excluye SIEMPRE los 2 pares de expedientes legales (lista explicita por ruta).
       Excluye SIEMPRE los punteros .gsheet.
    c) Nunca usa Recibos\ ni Severa Rosa\ como origen: lo que se retira es
       siempre la copia suelta de la raiz.
    d) Bitacora CSV dentro del repo (tools\duplicados_2026-10-16\).
    e) Si la carpeta de cuarentena ya existe con contenido, ABORTA y avisa.

.PARAMETER Aplicar
  Ejecuta los movimientos a cuarentena. Sin este modificador solo imprime el plan.

.PARAMETER IncluirExpedientesLegales
  DESACTIVADO por defecto y NO RECOMENDADO. Incluye en el plan los 2 pares de
  expedientes legales. Retirar una copia saca ese documento de su expediente.
  Si se usa, el script advierte por consola antes de continuar.

.PARAMETER RaizDrive
  Carpeta raiz de Drive a procesar.

.PARAMETER Cuarentena
  Carpeta destino de las copias retiradas (por defecto _duplicados_2026-10-16
  dentro de la raiz, para que la reversion sea un movimiento inverso simple).

.PARAMETER LogDir
  Carpeta dentro del repo donde se escribe log_movimientos.csv al aplicar.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\resolver_duplicados_drive.ps1
  (modo seco: solo imprime el plan)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\resolver_duplicados_drive.ps1 -Aplicar
  (aplica: mueve las 17 copias sueltas a cuarentena, nunca borra)

.NOTES
  Proyecto Arroyo 132. Script ASCII-only: la "i" con acento de "Bienes Raices"
  se construye con [char]0xED, para que PowerShell 5.1 no corrompa el literal
  al leer el .ps1 sin BOM.
#>

[CmdletBinding()]
param(
    [switch]$Aplicar,
    [switch]$IncluirExpedientesLegales,
    [string]$RaizDrive,
    [string]$Cuarentena,
    [string]$LogDir
)

$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------------------
# Rutas por defecto
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($RaizDrive)) {
    $RaizDrive = 'G:\My Drive\Bienes Ra' + [char]0xED + 'ces\LISTING JGARCIA REALTY\Bo Palmas Arroyo'
}
if ([string]::IsNullOrWhiteSpace($Cuarentena)) {
    $Cuarentena = Join-Path $RaizDrive '_duplicados_2026-10-16'
}
if ([string]::IsNullOrWhiteSpace($LogDir)) {
    if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $LogDir = Join-Path (Get-Location).Path 'tools\duplicados_2026-10-16'
    } else {
        $LogDir = Join-Path $PSScriptRoot 'duplicados_2026-10-16'
    }
}
$LogCsv = Join-Path $LogDir 'log_movimientos.csv'

# ---------------------------------------------------------------------------
# Areas que solo se CONSERVAN (nunca son origen de un retiro)
# ---------------------------------------------------------------------------
$AreasConservadas = @(
    (Join-Path $RaizDrive 'Recibos'),
    (Join-Path $RaizDrive 'Severa Rosa')
)

# ---------------------------------------------------------------------------
# EXCLUSION EXPLICITA: los 2 pares de expedientes legales.
# El mismo documento esta archivado en DOS expedientes distintos; retirar una
# copia lo saca de ese expediente. NO SE TOCAN.
#   expediente A: 2024-SCE-303832\2013-198372-DEC-71814\
#   expediente B: 2024-SCE-303832\2013-198372-Rec-83218\
# ---------------------------------------------------------------------------
$ExpedientesLegales = @(
    '2024-SCE-303832\2013-198372-DEC-71814\escritura.pdf',
    '2024-SCE-303832\2013-198372-DEC-71814\Memorial Explicativo.pdf',
    '2024-SCE-303832\2013-198372-Rec-83218\escritura.pdf',
    '2024-SCE-303832\2013-198372-Rec-83218\Memorial Explicativo.pdf'
)
# Copia que se conservaria si se usara -IncluirExpedientesLegales (expediente con
# mas soportes). Su pareja en DEC-71814 seria la que se retiraria.
$ExpedientesLegalesConservar = '2024-SCE-303832\2013-198372-Rec-83218'

function Get-Sha256 {
    param([string]$Path)
    try {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash
    } catch {
        return $null
    }
}

function Test-BajoRuta {
    param([string]$Path, [string]$Base)
    $p = $Path.TrimEnd('\').ToLowerInvariant()
    $b = $Base.TrimEnd('\').ToLowerInvariant()
    return $p.StartsWith($b + '\')
}

function Test-EsExpedienteLegal {
    param([string]$Path)
    foreach ($rel in $ExpedientesLegales) {
        $full = (Join-Path $RaizDrive $rel).ToLowerInvariant()
        if ($Path.ToLowerInvariant() -eq $full) { return $true }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Encabezado
# ---------------------------------------------------------------------------
$modo = if ($Aplicar) { 'APLICAR (mueve a cuarentena, NUNCA borra)' } else { 'SECO (solo plan, no toca nada)' }
Write-Host ''
Write-Host '=============================================================================='
Write-Host ' RESOLVER DUPLICADOS - Bo Palmas Arroyo (Arroyo 132)'
Write-Host ' Modo          :' $modo
Write-Host ' Raiz de Drive :' $RaizDrive
Write-Host ' Cuarentena    :' $Cuarentena
Write-Host ' Bitacora CSV  :' $LogCsv
Write-Host '=============================================================================='

if (-not (Test-Path -LiteralPath $RaizDrive)) {
    Write-Host ('ERROR: no existe la carpeta raiz: ' + $RaizDrive) -ForegroundColor Red
    exit 1
}

if ($IncluirExpedientesLegales) {
    Write-Host ''
    Write-Host '******************************************************************************' -ForegroundColor Yellow
    Write-Host ' ADVERTENCIA: -IncluirExpedientesLegales ACTIVADO' -ForegroundColor Yellow
    Write-Host ' Se incluiran los 2 pares de expedientes legales. NO RECOMENDADO: el mismo' -ForegroundColor Yellow
    Write-Host ' documento vive en DOS expedientes (DEC-71814 y Rec-83218); retirar una copia' -ForegroundColor Yellow
    Write-Host ' lo saca de ese expediente. Por defecto estos archivos NO se tocan.' -ForegroundColor Yellow
    Write-Host '******************************************************************************' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Salvaguarda (e): la cuarentena no debe existir ya con contenido
# ---------------------------------------------------------------------------
$cuarentenaConContenido = $false
if (Test-Path -LiteralPath $Cuarentena) {
    $contenido = @(Get-ChildItem -LiteralPath $Cuarentena -Force -ErrorAction SilentlyContinue)
    if ($contenido.Count -gt 0) { $cuarentenaConContenido = $true }
}
if ($cuarentenaConContenido) {
    Write-Host ''
    Write-Host ('ABORTA: la carpeta de cuarentena ya existe y tiene contenido: ' + $Cuarentena) -ForegroundColor Red
    Write-Host 'Revise/renombre esa carpeta antes de continuar (puede contener una corrida previa).' -ForegroundColor Red
    if ($Aplicar) { exit 1 }
    Write-Host '(Modo seco: se muestra el plan de todas formas; -Aplicar abortaria ahora mismo.)' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Indice de copias a CONSERVAR (Recibos\ + Severa Rosa\)
# ---------------------------------------------------------------------------
$indice = @{}
$ilegibles = @()
foreach ($area in $AreasConservadas) {
    if (-not (Test-Path -LiteralPath $area)) {
        Write-Host ('AVISO: no existe la subcarpeta de conservacion: ' + $area) -ForegroundColor Yellow
        continue
    }
    foreach ($f in (Get-ChildItem -LiteralPath $area -Recurse -File -Force)) {
        if ($f.Extension.ToLowerInvariant() -eq '.gsheet') { continue }
        if ((Test-EsExpedienteLegal $f.FullName) -and (-not $IncluirExpedientesLegales)) { continue }
        $h = Get-Sha256 $f.FullName
        if ($null -eq $h) { $ilegibles += $f.FullName; continue }
        if (-not $indice.ContainsKey($h)) { $indice[$h] = @() }
        $indice[$h] += $f.FullName
    }
}

# Duplicados DENTRO de las areas conservadas: solo informativo, nunca se actua.
$dupsInternos = @()
foreach ($k in $indice.Keys) {
    if ($indice[$k].Count -gt 1) { $dupsInternos += , $indice[$k] }
}

# ---------------------------------------------------------------------------
# Candidatos a RETIRAR: archivos sueltos en la RAIZ
# ---------------------------------------------------------------------------
$plan = @()
$omitidos = @()

foreach ($f in (Get-ChildItem -LiteralPath $RaizDrive -File -Force)) {

    # (b) punteros .gsheet: siempre fuera
    if ($f.Extension.ToLowerInvariant() -eq '.gsheet') {
        $omitidos += [pscustomobject]@{ Archivo = $f.FullName; Motivo = 'Puntero .gsheet (excluido siempre)' }
        continue
    }
    # (b) expedientes legales: excluidos salvo modificador explicito
    if ((Test-EsExpedienteLegal $f.FullName) -and (-not $IncluirExpedientesLegales)) {
        $omitidos += [pscustomobject]@{ Archivo = $f.FullName; Motivo = 'Expediente legal (excluido por defecto)' }
        continue
    }
    # (c) guarda defensiva: jamas como origen desde un area conservada
    $esAreaConservada = $false
    foreach ($area in $AreasConservadas) { if (Test-BajoRuta $f.FullName $area) { $esAreaConservada = $true } }
    if ($esAreaConservada) { continue }
    # jamas como origen desde la propia cuarentena
    if (Test-BajoRuta $f.FullName $Cuarentena) { continue }

    $h = Get-Sha256 $f.FullName
    if ($null -eq $h) { $ilegibles += $f.FullName; continue }

    if (-not $indice.ContainsKey($h)) { continue }

    $copias = $indice[$h]
    if ($copias.Count -gt 1) {
        $omitidos += [pscustomobject]@{ Archivo = $f.FullName; Motivo = 'AMBIGUO: varias copias conservadas con el mismo hash (revision manual)' }
        continue
    }

    $keep = $copias[0]
    $plan += [pscustomobject]@{
        Conservar      = $keep
        ConservarRel   = $keep.Substring($RaizDrive.Length).TrimStart('\')
        Retirar        = $f.FullName
        RetirarRel     = $f.Name
        Hash           = $h
        Bytes          = $f.Length
    }
}

# Expedientes legales (solo si se pidio explicitamente)
if ($IncluirExpedientesLegales) {
    foreach ($rel in $ExpedientesLegales) {
        if ($rel -like ($ExpedientesLegalesConservar + '\*')) { continue }
        $origen = Join-Path $RaizDrive $rel
        if (-not (Test-Path -LiteralPath $origen)) { continue }
        $h = Get-Sha256 $origen
        if ($null -eq $h) { continue }
        # la copia a conservar es la del expediente principal
        $hoja = Split-Path $rel -Leaf
        $keep = Join-Path $RaizDrive (Join-Path $ExpedientesLegalesConservar $hoja)
        if (-not (Test-Path -LiteralPath $keep)) { continue }
        $hk = Get-Sha256 $keep
        if ($hk -ne $h) { continue }
        $plan += [pscustomobject]@{
            Conservar    = $keep
            ConservarRel = $keep.Substring($RaizDrive.Length).TrimStart('\')
            Retirar      = $origen
            RetirarRel   = $origen.Substring($RaizDrive.Length).TrimStart('\')
            Hash         = $h
            Bytes        = (Get-Item -LiteralPath $origen).Length
        }
    }
}

# ---------------------------------------------------------------------------
# IMPRIMIR EL PLAN
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host ('PLAN: ' + $plan.Count + ' par(es) a resolver') -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------------'

$i = 0
foreach ($p in $plan) {
    $i++
    $hashKeep = Get-Sha256 $p.Conservar
    $coincide = ($hashKeep -eq $p.Hash)
    Write-Host ('[' + $i.ToString('00') + ']') -ForegroundColor Cyan
    Write-Host ('     CONSERVAR : ' + $p.ConservarRel)
    Write-Host ('     RETIRAR   : ' + $p.RetirarRel) -ForegroundColor Yellow
    Write-Host ('     sha256    : ' + $p.Hash + '  (' + $p.Bytes + ' bytes)')
    if ($coincide) {
        Write-Host '     verificacion: ambas copias COINCIDEN (sha256 identico)' -ForegroundColor Green
    } else {
        Write-Host '     verificacion: NO COINCIDEN -> este par se ABORTARIA al aplicar' -ForegroundColor Red
    }
    $destinoPrevisto = Join-Path $Cuarentena $p.RetirarRel
    Write-Host '     reversion  : Move-Item -LiteralPath "' -NoNewline
    Write-Host $destinoPrevisto -NoNewline
    Write-Host '" -Destination "' -NoNewline
    Write-Host $p.Retirar -NoNewline
    Write-Host '" -Force'
    Write-Host ''
}

Write-Host '------------------------------------------------------------------------------'
Write-Host 'NO SE TOCA (excluido por diseno)' -ForegroundColor Cyan
Write-Host ('  * Expedientes legales (2 pares): ' + (-join ($ExpedientesLegales -join ' | ')))
foreach ($o in $omitidos) {
    if ($o.Motivo -like 'Puntero .gsheet*') { Write-Host ('  * ' + $o.Archivo + '  ->  ' + $o.Motivo) }
}
Write-Host '  * La raiz no se usa como destino: lo que se retira es siempre la copia'
Write-Host '    suelta de la raiz; Recibos\ y Severa Rosa\ solo se leen.'

if ($dupsInternos.Count -gt 0) {
    Write-Host ''
    Write-Host 'AVISO - duplicados DENTRO de las areas conservadas (revision manual, NO se actua):' -ForegroundColor Yellow
    foreach ($grupo in $dupsInternos) { foreach ($g in $grupo) { Write-Host ('   ' + $g) -ForegroundColor Yellow } }
}
if ($ilegibles.Count -gt 0) {
    Write-Host ''
    Write-Host 'AVISO - archivos ilegibles (se ignoraron):' -ForegroundColor Yellow
    foreach ($x in $ilegibles) { Write-Host ('   ' + $x) -ForegroundColor Yellow }
}

# ---------------------------------------------------------------------------
# APLICAR
# ---------------------------------------------------------------------------
if (-not $Aplicar) {
    Write-Host ''
    Write-Host 'MODO SECO: no se movio, no se borro y no se escribio nada.' -ForegroundColor Cyan
    Write-Host ('Para aplicar de verdad: agregue -Aplicar  ->  mueve ' + $plan.Count + ' copia(s) a cuarentena (nunca borra).') -ForegroundColor Cyan
    Write-Host ''
    exit 0
}

if ($cuarentenaConContenido) { exit 1 }

Write-Host ''
Write-Host 'APLICANDO (mueve a cuarentena, NUNCA borra)' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------------------------'

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$movidos = 0
$abortados = 0
$registro = @()

foreach ($p in $plan) {

    # Salvaguarda (a): recalcular AMBAS copias justo antes de mover
    $hKeep2 = Get-Sha256 $p.Conservar
    $hRet2  = Get-Sha256 $p.Retirar

    if (($null -eq $hKeep2) -or ($null -eq $hRet2) -or ($hKeep2 -ne $hRet2) -or ($hKeep2 -ne $p.Hash)) {
        Write-Host ('ABORTADO: ' + $p.RetirarRel + ' (sha256 no coincide o no se pudo leer)') -ForegroundColor Red
        Write-Host ('    conservar=' + $hKeep2 + '  retirar=' + $hRet2) -ForegroundColor Red
        $abortados++
        continue
    }

    $destino = Join-Path $Cuarentena $p.RetirarRel
    $dirDestino = Split-Path $destino -Parent
    if (-not (Test-Path -LiteralPath $dirDestino)) {
        New-Item -ItemType Directory -Path $dirDestino -Force | Out-Null
    }
    if (Test-Path -LiteralPath $destino) {
        Write-Host ('ABORTADO: ya existe el destino en cuarentena: ' + $destino) -ForegroundColor Red
        $abortados++
        continue
    }

    try {
        Move-Item -LiteralPath $p.Retirar -Destination $destino -ErrorAction Stop
    } catch {
        Write-Host ('ABORTADO: fallo el movimiento de ' + $p.RetirarRel + ' -> ' + $_.Exception.Message) -ForegroundColor Red
        $abortados++
        continue
    }
    if (-not (Test-Path -LiteralPath $destino)) {
        Write-Host ('ABORTADO: el movimiento no se confirmo para ' + $p.RetirarRel) -ForegroundColor Red
        $abortados++
        continue
    }

    $movidos++
    Write-Host ('MOVIDO: ' + $p.RetirarRel) -ForegroundColor Green
    Write-Host ('    -> ' + $destino)
    Write-Host ('    REVERTIR: Move-Item -LiteralPath "' + $destino + '" -Destination "' + $p.Retirar + '" -Force')

    $registro += [pscustomobject]@{
        fecha           = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        ruta_original   = $p.Retirar
        ruta_cuarentena = $destino
        sha256          = $hRet2
        accion          = 'MOVIDO_A_CUARENTENA'
    }
}

if ($registro.Count -gt 0) {
    $registro | Export-Csv -LiteralPath $LogCsv -NoTypeInformation -Encoding UTF8 -Append
    Write-Host ''
    Write-Host ('Bitacora escrita en: ' + $LogCsv) -ForegroundColor Cyan
}

Write-Host ''
Write-Host ('RESULTADO: ' + $movidos + ' movido(s) a cuarentena, ' + $abortados + ' abortado(s). Nada se borro.') -ForegroundColor Cyan
if ($movidos -gt 0) {
    Write-Host 'Reversion: ejecute el comando REVERTIR de cada movimiento (o mueva el contenido'
    Write-Host 'de la carpeta de cuarentena de vuelta a su ruta original).'
}
Write-Host ''
exit 0
