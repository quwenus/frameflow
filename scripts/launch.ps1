param([switch]$NoBrowser, [switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-tools.ps1')
$root = Split-Path $PSScriptRoot -Parent
$child = $null
$lock = $null
try {
    Set-Location -LiteralPath $root
    $lock = [IO.File]::Open((Join-Path $root '.launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $tools = Get-FrameflowTools
    $env:YT_DLP_PATH = $tools.YtDlp
    $env:FFMPEG_PATH = $tools.FFmpeg
    $env:HOST = '127.0.0.1'
    $env:Path = (Split-Path $tools.Node) + ';' + $env:Path
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $env:PORT = [string]$listener.LocalEndpoint.Port
    $listener.Stop()
    $url = 'http://127.0.0.1:' + $env:PORT
    $env:FRAMEFLOW_LAUNCH_TOKEN = [guid]::NewGuid().ToString('N')
    $child = Start-Process -FilePath $tools.Node -ArgumentList @('--env-file-if-exists=.env', 'server.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root '.launcher-out.log') -RedirectStandardError (Join-Path $root '.launcher-error.log') -PassThru
    $ready = $false
    $lastError = 'Server did not respond.'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($child.HasExited) { throw 'The server exited before it was ready. See .launcher-error.log in the app folder.' }
        try {
            $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 3
            if ($health.ready -and $health.launchToken -eq $env:FRAMEFLOW_LAUNCH_TOKEN) { $ready = $true; break }
        } catch { $lastError = $_.Exception.Message }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Frameflow did not become ready. $lastError" }
    Write-Host "Frameflow is ready: $url" -ForegroundColor Green
    Write-Host 'Keep this window open. Press Ctrl+C to stop Frameflow.'
    if ($SmokeTest) { Write-Host 'Launcher smoke test passed.'; exit 0 }
    if (-not $NoBrowser) { Start-Process $url }
    while (-not $child.HasExited) { Start-Sleep -Milliseconds 500 }
    if ($child.ExitCode -ne 0) { throw "Frameflow exited with code $($child.ExitCode)." }
} catch {
    Write-Host "Unable to launch: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If Frameflow is already open from this folder, use its existing browser tab.'
    exit 1
} finally {
    if ($child -and -not $child.HasExited) { & taskkill.exe /PID $child.Id /T /F 2>$null | Out-Null }
    if ($lock) { $lock.Dispose() }
}
