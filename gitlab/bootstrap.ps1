$ErrorActionPreference = 'Stop'
$runtimeNode = (Get-Command node -ErrorAction Stop).Source
$setupRef = if ($env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF } else { 'v1' }
$runtime = Join-Path ([IO.Path]::GetTempPath()) ("setup-vp-gitlab-" + [guid]::NewGuid() + ".mjs")
try {
  $url = "https://raw.githubusercontent.com/voidzero-dev/setup-vp/$setupRef/dist/gitlab/index.mjs"
  Invoke-WebRequest -Uri $url -OutFile $runtime -TimeoutSec 60
  & $runtimeNode $runtime
  if ($LASTEXITCODE -ne 0) { throw "setup-vp failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item -LiteralPath $runtime -Force -ErrorAction SilentlyContinue
}
