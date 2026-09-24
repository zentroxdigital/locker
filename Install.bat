@echo off
REM Double-click ONCE per PC to install Locker for the current user (no admin needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
