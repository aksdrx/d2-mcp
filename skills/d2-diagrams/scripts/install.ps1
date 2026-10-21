# Cross-platform d2 installer for Windows (PowerShell 5.1+ / pwsh 7+).
# Order of attempts: winget -> GitHub release tarball (user-local, no admin).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Log($msg) { Write-Host $msg }

if (Get-Command d2 -ErrorAction SilentlyContinue) {
    Write-Log "d2 already installed: $((Get-Command d2).Source) ($(d2 version))"
    exit 0
}

# 1) winget (Windows 10 1709+ with App Installer, Windows 11)
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Log "Trying winget install Terrastruct.d2 ..."
    try {
        winget install --id Terrastruct.d2 -e --accept-source-agreements --accept-package-agreements
        if (Get-Command d2 -ErrorAction SilentlyContinue) {
            Write-Log "Installed: $(d2 version)"
            exit 0
        }
        Write-Log "winget install finished but d2 not on PATH yet; continuing with tarball fallback."
    } catch {
        Write-Log "winget failed: $($_.Exception.Message). Falling back to tarball."
    }
}

# 2) GitHub release tarball -> %LOCALAPPDATA%\Programs\d2 (no admin)
$arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'amd64' }
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/d2lang/d2/releases/latest' -TimeoutSec 30
$tag = $release.tag_name
$url = "https://github.com/d2lang/d2/releases/download/$tag/d2-$tag-windows-$arch.tar.gz"

$dest = Join-Path $env:LOCALAPPDATA 'Programs\d2'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path $env:TEMP ("d2-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    $tgz = Join-Path $tmp 'd2.tar.gz'
    Write-Log "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $tgz -TimeoutSec 300
    tar -xzf $tgz -C $tmp
    Copy-Item (Join-Path $tmp "d2-$tag\bin\d2.exe") (Join-Path $dest 'd2.exe') -Force

    # Add to user PATH if missing
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$dest*") {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$dest", 'User')
        $env:Path = "$env:Path;$dest"
        Write-Log "Added $dest to user PATH (restart shells to pick it up)."
    }
    Write-Log "Installed $(& (Join-Path $dest 'd2.exe') version) to $dest\d2.exe"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
