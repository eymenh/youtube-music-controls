[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,
    [string]$UpstreamRoot = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (!$UpstreamRoot) { $UpstreamRoot = Join-Path $repoRoot '.upstream\Vencord' }
$UpstreamRoot = [System.IO.Path]::GetFullPath($UpstreamRoot)

function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

if (!(Test-Path -LiteralPath (Join-Path $UpstreamRoot 'package.json'))) {
    New-Item -ItemType Directory -Path (Split-Path $UpstreamRoot) -Force | Out-Null
    Run-Checked 'git' @('clone', '--depth', '1', 'https://github.com/Vendicated/Vencord.git', $UpstreamRoot)
}

$version = (Get-Content -LiteralPath (Join-Path $UpstreamRoot 'package.json') -Raw | ConvertFrom-Json).packageManager
if (!$version -or !$version.StartsWith('pnpm@')) { throw 'No pnpm version defined by upstream Vencord' }
$pnpmVersion = ($version -replace '^pnpm@', '') -replace '\+.*$', ''
Run-Checked 'npm' @('install', '--global', "pnpm@$pnpmVersion")

$pluginFrom = Join-Path $repoRoot 'src\userplugins\youtubeMusicControls'
$pluginTo = Join-Path $UpstreamRoot 'src\userplugins\youtubeMusicControls'
New-Item -ItemType Directory -Path (Split-Path $pluginTo) -Force | Out-Null
if (Test-Path -LiteralPath $pluginTo) { Remove-Item -LiteralPath $pluginTo -Recurse -Force }
Copy-Item -LiteralPath $pluginFrom -Destination $pluginTo -Recurse -Force

Push-Location $UpstreamRoot
try {
    Run-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
    Run-Checked 'pnpm.cmd' @('build', '--standalone')
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or !$commit) { throw 'Unable to read Vencord commit' }
} finally { Pop-Location }

$dist = Join-Path $UpstreamRoot 'dist'
$jsFiles = @(Get-ChildItem -LiteralPath $dist -File -Filter '*.js' -ErrorAction SilentlyContinue)
if ($jsFiles.Count -eq 0) { throw 'Vencord did not produce compiled JS assets; no release created' }
$releaseDir = Join-Path $repoRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$distZip = Join-Path $releaseDir "YouTube-Music-Controls-$Tag-Windows-Vencord-dist.zip"
$sourceZip = Join-Path $releaseDir "YouTube-Music-Controls-$Tag-source.zip"
$info = "Vendicated/Vencord`nCommit: $commit`nBuild: pnpm build --standalone`nPlugin: YouTube Music Controls $Tag`n"
Set-Content -Path (Join-Path $releaseDir 'VENCORD_COMMIT.txt') -Value $info -NoNewline -Encoding utf8

if (Test-Path $distZip) { Remove-Item $distZip -Force }
if (Test-Path $sourceZip) { Remove-Item $sourceZip -Force }
# Include all compiled Vencord desktop assets, including native bundle components.
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $distZip -CompressionLevel Optimal
Push-Location $repoRoot
try {
    Compress-Archive -Path @('src', 'tests', 'docs', 'scripts', 'assets', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', '.github') -DestinationPath $sourceZip -CompressionLevel Optimal
} finally { Pop-Location }

$hashList = @($distZip, $sourceZip) | ForEach-Object {
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant()
    "$sha  $(Split-Path -Leaf $_)"
}
Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Value $hashList -Encoding ascii
Write-Host "Release build complete: $releaseDir"
