# uninstall.ps1 - removes the Locker right-click menu and PATH entry for the current user.
# Leaves already-locked folders untouched (unlock them first with the app or CLI if needed).
# ASCII-only.

$ErrorActionPreference = "SilentlyContinue"
$installDir = Join-Path $env:LOCALAPPDATA "Locker"

Add-Type -AssemblyName System.Windows.Forms | Out-Null
function Info($m){ [System.Windows.Forms.MessageBox]::Show($m, "Locker") | Out-Null }

Remove-Item "HKCU:\Software\Classes\Directory\shell\LockerOpen" -Recurse -Force
Remove-Item "HKCU:\Software\Classes\Directory\Background\shell\LockerOpen" -Recurse -Force

# remove install dir from user PATH
$uPath = [Environment]::GetEnvironmentVariable("Path","User")
if ($uPath) {
    $parts = $uPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $installDir.TrimEnd('\')) }
    [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")
}

Info(
    "Locker uninstall hoye gelo (right-click menu + PATH sriye deoya holo)." + [Environment]::NewLine +
    "Install folder ta rekhe deoya holo: " + $installDir + [Environment]::NewLine +
    "(chaile hate delete korte paro. Locked folder gula age unlock kore nio.)"
)
