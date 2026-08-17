# Upload the whole LobsterAI project to the server.
# Run:
#   powershell -ExecutionPolicy Bypass -File scripts\upload-to-server.ps1
#
# If the .tgz is already on the server from a previous attempt:
#   powershell -ExecutionPolicy Bypass -File scripts\upload-to-server.ps1 -SkipUpload
#
param(
  [string]$HostName = '106.54.15.76',
  [string]$User = 'ubuntu',
  [string]$RemoteDir = '/opt/lobsterai',
  [string]$Archive = '',
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Archive) {
  $Archive = Join-Path (Split-Path -Parent $repoRoot) 'lobsterai-server.tgz'
}
if (-not $SkipUpload -and -not (Test-Path $Archive)) {
  Write-Error "Archive not found: $Archive"
}

$target = "$User@$HostName"
$remoteTmp = '/tmp/lobsterai-server.tgz'
$remoteScript = '/tmp/lobsterai-extract.sh'
$localScript = Join-Path $env:TEMP 'lobsterai-extract.sh'

# Keep this as LF-only. Do not use Windows CRLF in the remote bash file.
$lines = @(
  '#!/bin/bash'
  'set -euo pipefail'
  "REMOTE_DIR='$RemoteDir'"
  "REMOTE_TGZ='$remoteTmp'"
  'sudo mkdir -p /opt'
  'sudo rm -rf "$REMOTE_DIR"'
  'sudo rm -rf /tmp/lobsterai-extract'
  'sudo mkdir -p /tmp/lobsterai-extract'
  'if [ ! -f "$REMOTE_TGZ" ]; then'
  '  echo "ERROR: missing $REMOTE_TGZ — re-run without -SkipUpload"'
  '  exit 1'
  'fi'
  'echo "Extracting $REMOTE_TGZ ..."'
  'sudo tar -xzf "$REMOTE_TGZ" -C /tmp/lobsterai-extract'
  'if [ ! -d /tmp/lobsterai-extract/lobsterai ]; then'
  '  echo "ERROR: tarball root folder lobsterai not found"'
  '  ls -la /tmp/lobsterai-extract || true'
  '  exit 1'
  'fi'
  'sudo mv /tmp/lobsterai-extract/lobsterai "$REMOTE_DIR"'
  'sudo chown -R ubuntu:ubuntu "$REMOTE_DIR"'
  'rm -f "$REMOTE_TGZ"'
  "rm -f '$remoteScript'"
  'echo UPLOAD_OK'
  'du -sh "$REMOTE_DIR"'
  'ls -la "$REMOTE_DIR" | head -40'
)
$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText($localScript, $content, [System.Text.UTF8Encoding]::new($false))

$auth = @('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no')

Write-Host "==> Target $target"
Write-Host "    remote dir: $RemoteDir"

if (-not $SkipUpload) {
  $mb = [math]::Round((Get-Item $Archive).Length / 1MB, 1)
  Write-Host "==> Upload archive ($mb MB)"
  & scp @auth $Archive "${target}:${remoteTmp}"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "==> SkipUpload: reuse $remoteTmp on server"
}

Write-Host "==> Upload extract script and run"
& scp @auth $localScript "${target}:${remoteScript}"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& ssh @auth $target "bash $remoteScript"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "UPLOAD_OK -> $RemoteDir"
Write-Host "Next: configure .env / npm / Nginx on the server."
