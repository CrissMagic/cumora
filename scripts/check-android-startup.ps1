param(
    [ValidatePattern('^emulator-\d+$')][string]$DeviceSerial = 'emulator-5580',
    [ValidateSet('Granted', 'Denied', 'Prompt')][string]$Permission = 'Granted',
    [string]$AdbPath = (Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe')
)
$ErrorActionPreference = 'Stop'
# Dedicated, authenticated emulator only: this changes its notification grant.
function Invoke-Adb([string[]]$Arguments) {
    $result = & $AdbPath -s $DeviceSerial @Arguments
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $($Arguments[0])" }
    return $result
}
if ((Invoke-Adb @('shell', 'getprop', 'sys.boot_completed')).Trim() -ne '1') {
    throw 'Wait for the dedicated emulator to finish booting'
}
Invoke-Adb @('shell', 'am', 'force-stop', 'io.cumora.app') | Out-Null
$operation = if ($Permission -eq 'Granted') { 'grant' } else { 'revoke' }
Invoke-Adb @('shell', 'pm', $operation, 'io.cumora.app', 'android.permission.POST_NOTIFICATIONS') | Out-Null
if ($Permission -eq 'Prompt') {
    Invoke-Adb @('shell', 'pm', 'clear-permission-flags', 'io.cumora.app', 'android.permission.POST_NOTIFICATIONS', 'user-set', 'user-fixed') | Out-Null
}
Invoke-Adb @('logcat', '-c') | Out-Null
Invoke-Adb @('shell', 'am', 'start', '-n', 'io.cumora.app/.MainActivity') | Out-Null
# The original crash follows async auth restoration; checking just launch intent
# success or a PID immediately after launch gave a false pass.
Start-Sleep -Seconds 20
$appProcess = (& $AdbPath -s $DeviceSerial shell pidof io.cumora.app) -join ''
$nativeLogs = Invoke-Adb @('logcat', '-d', '-s', 'AndroidRuntime')
$crashes = @($nativeLogs | Select-String -SimpleMatch 'FATAL EXCEPTION').Count
if (-not $appProcess -or $crashes -gt 0) {
    # Print only the relevant native stack markers, never JS/network logs.
    $nativeLogs | Select-String 'FATAL EXCEPTION|Default FirebaseApp|PushNotificationsPlugin.register' |
        ForEach-Object { $_.Line -replace '^.*AndroidRuntime: ', '' }
    throw 'Android cold startup crashed'
}
$windows = Invoke-Adb @('shell', 'dumpsys', 'window')
if ($windows | Select-String 'mCurrentFocus=.*GrantPermissionsActivity') {
    throw 'A build without Firebase must not request unusable notification permission'
}
Invoke-Adb @('forward', 'tcp:9223', "localabstract:webview_devtools_remote_$($appProcess.Trim())") | Out-Null
# Prove the authenticated UI is usable, rather than merely a live native process.
& node (Join-Path $PSScriptRoot 'check-android-navigation.mjs') 9223
if ($LASTEXITCODE -ne 0) { throw 'Authenticated Android UI did not pass navigation checks' }
[pscustomobject]@{ Permission = $Permission; ProcessAlive = $true; FatalExceptions = $crashes; NavigationPassed = $true } | ConvertTo-Json
