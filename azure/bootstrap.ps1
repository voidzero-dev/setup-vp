$ErrorActionPreference = 'Stop'

# Azure step templates expand YAML from an external repository but do not check
# out bootstrap/runtime files onto the agent. Download the compiled runtime and
# execute its prepare phase, which installs Vite+ and emits cache metadata.

function Setup-VpDownload {
  param(
    [string]$Url,
    [string]$OutFile
  )

  Invoke-WebRequest -Uri $Url -OutFile $OutFile -TimeoutSec 60
}

$setupRef = if ($env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF } else { 'v1' }
$runtimeOut = if ($env:SETUP_VP_RUNTIME_OUT) {
  $env:SETUP_VP_RUNTIME_OUT
} else {
  Join-Path $env:AGENT_TEMPDIRECTORY 'setup-vp-azure/dist/azure/index.mjs'
}

$runtimeDir = Split-Path -Parent $runtimeOut
$chunkDir = Split-Path -Parent $runtimeDir
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $chunkDir -Force | Out-Null

$runtimeUrl = "https://raw.githubusercontent.com/voidzero-dev/setup-vp/$setupRef/dist/azure/index.mjs"
Setup-VpDownload -Url $runtimeUrl -OutFile $runtimeOut

$runtimeText = Get-Content -LiteralPath $runtimeOut -Raw
$chunkMatches = [regex]::Matches($runtimeText, '[''"]\.\./([^''"]+\.mjs)[''"]')
$chunkNames = @($chunkMatches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
foreach ($chunkName in $chunkNames) {
  $chunkUrl = "https://raw.githubusercontent.com/voidzero-dev/setup-vp/$setupRef/dist/$chunkName"
  $chunkOut = Join-Path $chunkDir $chunkName
  Setup-VpDownload -Url $chunkUrl -OutFile $chunkOut
}

& node $runtimeOut prepare
