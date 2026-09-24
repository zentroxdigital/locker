# install.ps1 - one-time, per-user install of Locker on this PC (no admin needed).
# After running this you can right-click ANY folder -> "Open with Locker" to lock/unlock it,
# and call `locker` from code/terminal. Nothing runs in the background.
# ASCII-only (run by Windows PowerShell 5.1 via Install.bat).

$ErrorActionPreference = "Stop"
$srcDir = $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA "Locker"

Add-Type -AssemblyName System.Windows.Forms | Out-Null
function Info($m){ [System.Windows.Forms.MessageBox]::Show($m, "Locker") | Out-Null }

# 0) sanity: Node present?
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Info("Node.js install kora nei. Age https://nodejs.org theke LTS install koro, tarpor abar Install.bat cholao.")
    exit 1
}

# 1) copy the tool files to a stable location
New-Item -ItemType Directory -Force $installDir | Out-Null
foreach ($f in @("locker-engine.js","app-server.js","launcher.ps1","locker.exe")) {
    $s = Join-Path $srcDir $f
    if (Test-Path $s) { Copy-Item $s $installDir -Force }
}

$launcher = Join-Path $installDir "launcher.ps1"
$exe      = Join-Path $installDir "locker.exe"

# 2) right-click context menu (HKCU = per-user, no admin). "%V" = the clicked folder.
$cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '" "%V"'
function AddMenu($base){
    $key = "HKCU:\Software\Classes\$base\shell\LockerOpen"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name "(default)" -Value "Open with Locker"
    if (Test-Path $exe) { Set-ItemProperty -Path $key -Name "Icon" -Value ($exe + ",0") }
    New-Item -Path "$key\command" -Force | Out-Null
    Set-ItemProperty -Path "$key\command" -Name "(default)" -Value $cmd
}
AddMenu "Directory"             # right-click ON a folder
AddMenu "Directory\Background"  # right-click inside a folder (empty space)

# 3) add install dir to the user PATH so `locker` works from code/terminal
$uPath = [Environment]::GetEnvironmentVariable("Path","User")
if (-not $uPath) { $uPath = "" }
if ($uPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", ($uPath.TrimEnd(';') + ";" + $installDir), "User")
}

Info(
    "Locker install hoye gelo!" + [Environment]::NewLine + [Environment]::NewLine +
    "Ekhon jekono folder e right-click -> 'Open with Locker'." + [Environment]::NewLine +
    "Code/terminal theke:  locker lock `"D:\path`"   (notun terminal khulte hobe)" + [Environment]::NewLine + [Environment]::NewLine +
    "Install location: " + $installDir
)
