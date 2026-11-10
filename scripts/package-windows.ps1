param([string]$OutputDirectory = 'dist')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid package version.' }
$name = "Frameflow-$($package.version)-windows"
$dist = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
if (-not $dist.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output directory must be inside this project.' }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$stage = Join-Path $dist ($name + '-stage-' + [guid]::NewGuid().ToString('N'))
$folder = Join-Path $stage $name
New-Item -ItemType Directory -Path $folder -Force | Out-Null
try {
    # Allowlist: never package .env, .git, .data, tools, or downloaded videos.
    $files = @('package.json','server.js','lib.js','README.md','RELEASE.md','QUICK-START.txt','.env.example','Start.cmd','Setup.cmd','youtube-converter-mind-map.svg')
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $folder }
    foreach ($directory in @('public','scripts','test')) { Copy-Item -LiteralPath (Join-Path $root $directory) -Destination $folder -Recurse }
    $zip = Join-Path $dist ($name + '.zip')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $temporaryZip = Join-Path $stage 'package.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($folder, $temporaryZip, [IO.Compression.CompressionLevel]::Optimal, $true)
    Move-Item -LiteralPath $temporaryZip -Destination $zip -Force
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($zip)
    try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
    "$hash  $name.zip" | Set-Content -LiteralPath ($zip + '.sha256') -Encoding ascii
    Write-Host "Created $zip"
    Write-Host "SHA-256: $hash"
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging cleanup path.' }
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
