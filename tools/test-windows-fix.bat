@echo off
setlocal

if "%~1"=="" goto usage
if "%~1"=="/?" goto usage
if /I "%~1"=="--help" goto usage

fltmc.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Open Command Prompt as Administrator and run this BAT again.
    exit /b 1
)

echo ioBroker Windows fixer integration test
echo Target: %~f1
echo.
echo WARNING: This stops ioBroker, changes npm and database files,
echo          and recreates the Windows service.
echo.
choice /C YN /N /M "Run the full test? [Y/N] "
if errorlevel 2 exit /b 2

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
    -File "%~dp0test-windows-fix.ps1" ^
    -IoBrokerDir "%~f1" ^
    -ConfirmDestructiveTest
exit /b %errorlevel%

:usage
echo Usage:
echo   %~nx0 C:\path\to\the\iobroker-test-installation
echo.
echo Run this BAT from an elevated Command Prompt.
exit /b 1
