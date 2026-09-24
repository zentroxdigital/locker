@echo off
REM Double-click to open the Locker graphical app (no terminal window).
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher.ps1"
exit
