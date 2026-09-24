@echo off
REM Removes Locker's right-click menu and PATH entry for the current user.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
