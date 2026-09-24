# launcher.ps1 - starts the local locker GUI server (hidden) and opens it as a chromeless
# app window in Edge or Chrome. When you close the app window, the server is stopped.
# Optional first argument: the folder to lock/unlock (from the "Open with Locker" right-click).
# If none is given, it targets the folder this launcher sits in.
# ASCII-only on purpose (run by Windows PowerShell 5.1).

param([string]$Target)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$targetFolder = if ([string]::IsNullOrWhiteSpace($Target)) { $here } else { $Target.TrimEnd('\') }
$port = Get-Random -Minimum 8800 -Maximum 9600
$token = -join (1..16 | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Node.js install kora nei. Age Node install koro.","Locker") | Out-Null
    exit 1
}

# start the server hidden
$srv = Start-Process -FilePath $node.Source `
    -ArgumentList @("`"$here\app-server.js`"", "$port", "$token", "`"$targetFolder`"") `
    -WindowStyle Hidden -PassThru

# wait until it responds
$base = "http://127.0.0.1:$port"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "$base/ping?t=$token" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 200 }
}
if (-not $ready) {
    try { Stop-Process -Id $srv.Id -Force } catch {}
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Server chalu holo na.","Locker") | Out-Null
    exit 1
}

$url = "$base/?t=$token"

# find a Chromium browser for --app (chromeless) mode
$candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

try {
    if ($browser) {
        $profile = Join-Path $env:TEMP "locker_gui_profile"
        Start-Process -FilePath $browser -Wait -ArgumentList @(
            "--app=$url", "--window-size=470,640",
            "--user-data-dir=`"$profile`""
        )
    } else {
        # no Chromium browser found -> open in default browser and wait for a keypress-less hold
        Start-Process $url
        # keep server alive until this hidden process is killed / a short grace loop
        for ($i = 0; $i -lt 3600; $i++) {
            try { Invoke-WebRequest "$base/ping?t=$token" -UseBasicParsing -TimeoutSec 1 | Out-Null }
            catch { break }
            Start-Sleep -Seconds 2
        }
    }
}
finally {
    try { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue } catch {}
}
