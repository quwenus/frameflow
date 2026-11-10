# Refresh registry PATH to pick up tools installed after this terminal started.
function Refresh-ToolPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Find-MediaTool([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    if ($Name -eq 'node.exe') {
        $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $packages) {
        $prefixes = switch ($Name) {
            'yt-dlp.exe' { @('yt-dlp.yt-dlp_*') }
            'ffmpeg.exe' { @('Gyan.FFmpeg_*', 'yt-dlp.FFmpeg_*') }
            default { @() }
        }
        foreach ($prefix in $prefixes) {
            foreach ($package in Get-ChildItem -LiteralPath $packages -Directory -Filter $prefix) {
                $file = Get-ChildItem -LiteralPath $package.FullName -Recurse -File -Filter $Name | Select-Object -First 1
                if ($file) { return $file.FullName }
            }
        }
    }
    return $null
}
function Get-FrameflowTools {
    Refresh-ToolPath
    $node = Find-MediaTool 'node.exe'
    if (-not $node) { throw 'Node.js is missing. Run Setup.cmd first.' }
    $version = & $node -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or [version]$version -lt [version]'22.9.0') { throw 'Node.js 22.9 or newer is required. Run Setup.cmd.' }
    $yt = Find-MediaTool 'yt-dlp.exe'
    $ff = Find-MediaTool 'ffmpeg.exe'
    if (-not $yt -or -not $ff) { throw 'yt-dlp or FFmpeg is missing. Run Setup.cmd first.' }
    if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $ff) 'ffprobe.exe'))) { throw 'ffprobe.exe must be installed beside ffmpeg.exe. Reinstall FFmpeg.' }
    return @{ Node = $node; YtDlp = $yt; FFmpeg = $ff }
}
