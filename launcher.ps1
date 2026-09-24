# launcher.ps1 - opens Locker in its native Electron desktop window.
# When the window closes, Electron asks the local server to auto-lock and stop.
# Optional first argument: the folder to lock/unlock (from the "Open with Locker" right-click).
# If none is given, it targets the folder this launcher sits in.
# ASCII-only on purpose (run by Windows PowerShell 5.1).

param([string]$Target)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$targetFolder = if ([string]::IsNullOrWhiteSpace($Target)) { $here } else { $Target.TrimEnd('\') }
$electron = Join-Path $here "node_modules\.bin\electron.cmd"
if (-not (Test-Path $electron)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Locker desktop dependency install kora nei. Install.bat cholao (ba ei folder-e npm install cholao).","Locker") | Out-Null
    exit 1
}

$targetArg = "--locker-target=$targetFolder"
$oldElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
try {
    & $electron $here $targetArg
    $appExitCode = $LASTEXITCODE
}
finally {
    if ($null -ne $oldElectronRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $oldElectronRunAsNode }
}
exit $appExitCode
