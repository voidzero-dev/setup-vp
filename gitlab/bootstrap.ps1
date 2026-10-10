$ErrorActionPreference = 'Stop'
$runtimeNode = (Get-Command node -ErrorAction Stop).Source
$setupRef = if ($env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF } else { 'v1.21.2' }
if ($setupRef -cnotmatch '\A[A-Za-z0-9_-]+([./][A-Za-z0-9_-]+)*\z') {
  throw 'setup-vp: invalid setup-ref; use a tag, branch or commit SHA with safe ref characters.'
}
$runtime = Join-Path ([IO.Path]::GetTempPath()) ("setup-vp-gitlab-" + [guid]::NewGuid() + ".mjs")
try {
  $url = "https://raw.githubusercontent.com/voidzero-dev/setup-vp/$setupRef/dist/gitlab/index.mjs"
  Invoke-WebRequest -Uri $url -OutFile $runtime -TimeoutSec 60
  & $runtimeNode $runtime
  if ($LASTEXITCODE -ne 0) { throw "setup-vp failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item -LiteralPath $runtime -Force -ErrorAction SilentlyContinue
}
