[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VencordPath
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $repoRoot 'src\userplugins\youtubeMusicControls'
$checkout = Resolve-Path -Path $VencordPath -ErrorAction Stop
$targetParent = Join-Path $checkout 'src\userplugins'
if (!(Test-Path -LiteralPath (Join-Path $checkout 'package.json'))) {
    throw "A valid Vencord checkout was not found at $VencordPath"
}
if (!(Test-Path -LiteralPath $source)) {
    throw "Plugin source missing: $source"
}
New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
$target = Join-Path $targetParent 'youtubeMusicControls'
if (Test-Path -LiteralPath $target) {
    $backupRoot = Join-Path $checkout '.youtube-music-controls-backups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot "youtubeMusicControls-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Move-Item -LiteralPath $target -Destination $backup
    Write-Host "Previous plugin backed up to $backup"
}
Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
Write-Host "Plugin installed to $target"
Write-Host 'Next: cd your Vencord checkout; pnpm.cmd build; pnpm.cmd inject'
