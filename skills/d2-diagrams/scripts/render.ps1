# render.ps1 — fmt + validate + render in one command (Windows).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File render.ps1 diagram.d2 [out.svg] [-Watch] [-Layout elk] [-Theme 105]
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Input,
    [Parameter(Position = 1)][string]$Output,
    [switch]$Watch,
    [string]$Layout,
    [int]$Theme = -1,
    [int]$DarkTheme = -1,
    [switch]$Sketch,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command d2 -ErrorAction SilentlyContinue)) {
    Write-Error "d2 not found on PATH — run install.ps1 first"
    exit 1
}

if (-not $Output) { $Output = [IO.Path]::ChangeExtension($Input, '.svg') }

d2 fmt $Input | Out-Null
d2 validate $Input
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$args = @()
if ($Watch) { $args += '-w' }
if ($Layout) { $args += "--layout=$Layout" }
if ($Theme -ge 0) { $args += "--theme=$Theme" }
if ($DarkTheme -ge 0) { $args += "--dark-theme=$DarkTheme" }
if ($Sketch) { $args += '--sketch' }
if ($ExtraArgs) { $args += $ExtraArgs }
$args += @($Input, $Output)

& d2 @args
if ($LASTEXITCODE -eq 0 -and -not $Watch) { Write-Host "rendered: $Output" }
exit $LASTEXITCODE
