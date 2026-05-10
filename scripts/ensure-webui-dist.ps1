# Sync web/out -> internal/webui/dist for go:embed, or create a placeholder (PowerShell).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "web\out\index.html"
$dest = Join-Path $root "internal\webui\dist"
if (Test-Path $out) {
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Path $dest | Out-Null
  Copy-Item -Path (Join-Path $root "web\out\*") -Destination $dest -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  @"
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DNSFleet</title></head>
<body><p>Build UI: <code>cd web; npm run build</code> then re-run this script or <code>make ensure-webui-dist</code></p></body></html>
"@ | Set-Content -Path (Join-Path $dest "index.html") -Encoding utf8
}
