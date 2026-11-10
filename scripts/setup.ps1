$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-tools.ps1')
try {
    Refresh-ToolPath
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Install App Installer from the Microsoft Store, then run Setup.cmd again. Manual tool installation links are in README.md.' }
    Write-Host 'Frameflow setup: missing dependencies will be installed through winget.'
    $packages = @(
        @{ Tool = 'node.exe'; Id = 'OpenJS.NodeJS.LTS' },
        @{ Tool = 'yt-dlp.exe'; Id = 'yt-dlp.yt-dlp' },
        @{ Tool = 'ffmpeg.exe'; Id = 'Gyan.FFmpeg' }
    )
    foreach ($package in $packages) {
        $existing = Find-MediaTool $package.Tool
        $needsInstall = -not $existing
        if ($existing -and $package.Tool -eq 'node.exe') {
            $version = & $existing -p 'process.versions.node'
            $needsInstall = $LASTEXITCODE -ne 0 -or [version]$version -lt [version]'22.9.0'
        }
        if ($existing -and $package.Tool -eq 'ffmpeg.exe') { $needsInstall = -not (Test-Path -LiteralPath (Join-Path (Split-Path $existing) 'ffprobe.exe')) }
        if ($needsInstall) {
            & winget.exe install --id $package.Id --exact --source winget --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) { throw "Installation failed for $($package.Id). Resolve the installer message and rerun Setup.cmd." }
            Refresh-ToolPath
        } else { Write-Host "Found $($package.Tool)" }
    }
    $tools = Get-FrameflowTools
    & $tools.YtDlp --version
    if ($LASTEXITCODE -ne 0) { throw 'yt-dlp could not start.' }
    & $tools.FFmpeg -version | Select-Object -First 1
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg could not start.' }
    Write-Host 'Setup complete. Double-click Start.cmd to open Frameflow.' -ForegroundColor Green
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
