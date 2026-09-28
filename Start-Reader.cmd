@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-optimization-preview.ps1" -BootstrapPython "E:\ReadWebRuntime\optimization-python\Scripts\python.exe" %*
set "readerExitCode=%ERRORLEVEL%"
if not "%readerExitCode%"=="0" pause
exit /b %readerExitCode%
