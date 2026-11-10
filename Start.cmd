@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
if errorlevel 1 (
  echo.
  echo Frameflow could not start. See the message above or run Setup.cmd.
  pause
)
endlocal
