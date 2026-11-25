@echo off
setlocal

if not "%~1"=="" (
    echo ERROR: This script does not accept parameters.
    echo Open the matching ioBroker Command line from the Windows Start menu
    echo and call this BAT by its full path.
    exit /b 1
)

fltmc.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Open Command Prompt as Administrator and run this BAT again.
    exit /b 1
)

echo ioBroker Windows fixer integration test
echo Target: %CD%
echo.
echo WARNING: This stops ioBroker, changes npm and database files,
echo          and recreates the Windows service.
echo.
choice /C YN /N /M "Run the full test? [Y/N] "
if errorlevel 2 exit /b 2

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
    -File "%~dp0test-windows-fix.ps1" ^
    -IoBrokerDir "%CD%" ^
    -ConfirmDestructiveTest
exit /b %errorlevel%
