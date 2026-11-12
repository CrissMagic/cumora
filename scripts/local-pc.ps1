param(
    [Parameter(Mandatory)][ValidateSet('Setup', 'Start', 'Stop', 'Status', 'Login', 'BuildAndroid', 'Firewall', 'UseWsl', 'RestartAgent')][string]$Action,
    [string]$LanAddress,
    [string]$WslDistribution = 'Paperclip-Ubuntu',
    [ValidateRange(1024, 65535)][int]$Port = 5181
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $repoRoot '.local'
Set-Location -LiteralPath $repoRoot

function Invoke-Native([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)" }
}
function Invoke-Stack([string[]]$Arguments) {
    Invoke-Native 'docker' (@('compose', '--project-name', 'cumora-local-pc', '--env-file', '.local/stack.env', '-f', 'deploy/local/compose.yaml') + $Arguments)
}
function Read-Config {
    if (-not (Test-Path -LiteralPath (Join-Path $localRoot 'config.json'))) { throw 'Run Setup -LanAddress <PC IPv4 address> first.' }
    Get-Content -LiteralPath (Join-Path $localRoot 'config.json') -Raw | ConvertFrom-Json
}
function Get-TaskName([string]$Component) {
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($repoRoot.ToLowerInvariant()))).Substring(0, 12)
    "Cumora Local $Component ($digest)"
}
function Stop-Component([string]$Component) {
    # Stop only this checkout's exact launcher tree, never scan other daemons.
    Set-Content -LiteralPath (Join-Path $localRoot "$Component.disabled") -Value ''
    $config = Read-Config
    if ($Component -eq 'agent' -and $config.PSObject.Properties['wslDistribution']) {
        Invoke-Native 'wsl.exe' @('-d', $config.wslDistribution, '--exec', '/usr/local/bin/node', ($config.wslRepo + '/scripts/local-wsl.mjs'), 'stop')
    }
    $launcher = Join-Path $localRoot "$Component-launcher.vbs"
    $processes = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -ieq 'wscript.exe' -and $_.CommandLine -and $_.CommandLine.Contains('"' + $launcher + '"')
    })
    foreach ($launcherProcess in $processes) {
        Invoke-Native 'taskkill.exe' @('/PID', [string]$launcherProcess.ProcessId, '/T', '/F')
    }
    $task = Get-ScheduledTask -TaskName (Get-TaskName $Component) -ErrorAction SilentlyContinue
    if ($task) { Stop-ScheduledTask -InputObject $task }
}
function Start-Component([string]$Component) {
    $marker = Join-Path $localRoot "$Component.disabled"
    if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
    Start-ScheduledTask -TaskName (Get-TaskName $Component)
}
function Register-Component([string]$Component) {
    $taskName = Get-TaskName $Component
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { Stop-Component $Component }
    $launcher = Join-Path $localRoot "$Component-launcher.vbs"
    $pwsh = (Get-Command pwsh.exe).Source
    $runner = Join-Path $PSScriptRoot 'local-supervisor.ps1'
    $command = '"' + $pwsh + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -Component ' + $Component
    $escapedCommand = $command.Replace([string][char]34, ([string][char]34 + [char]34))
    $vbs = @('Set shell = CreateObject("WScript.Shell")', ('WScript.Quit shell.Run("' + $escapedCommand + '", 0, True)'), '') -join "`r`n"
    Set-Content -LiteralPath $launcher -Value $vbs -Encoding ascii
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "//B //Nologo `"$launcher`"" -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}
function Wait-Server {
    $config = Read-Config
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $null = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/api/health" -TimeoutSec 2; return } catch { Start-Sleep -Seconds 2 }
    }
    throw 'Backend did not become ready. Check .local/logs/server.log.'
}
function Enable-LanFirewall {
    $firewallScript = Join-Path $PSScriptRoot 'local-firewall.ps1'
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        & $firewallScript
    } else {
        $elevationArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $firewallScript + '"'))
        $elevated = Start-Process -FilePath (Get-Command pwsh.exe).Source -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $elevationArgs
        if ($elevated.ExitCode -ne 0) { throw 'Firewall configuration failed. Run local-pc.ps1 -Action Firewall as administrator.' }
    }
}

switch ($Action) {
    'Setup' {
        $address = $null
        if (-not [Net.IPAddress]::TryParse($LanAddress, [ref]$address) -or $address.AddressFamily -ne 'InterNetwork' -or [Net.IPAddress]::IsLoopback($address)) {
            throw 'Pass -LanAddress with this PC IPv4 address reachable from the phone.'
        }
        $nodePath = (Get-Command node.exe).Source
        $codexPath = (Get-Command codex.exe).Source
        New-Item -ItemType Directory -Path $localRoot, (Join-Path $localRoot 'logs'), (Join-Path $localRoot 'agent') -Force | Out-Null
        $configPath = Join-Path $localRoot 'config.json'
        if (Test-Path -LiteralPath $configPath) {
            $config = Read-Config
            if ($config.lanAddress -ne $LanAddress -or $config.port -ne $Port) { throw 'Existing trial address differs. Keep the current address or edit .local/config.json and server.env together before rebuilding.' }
            $config.nodePath = $nodePath; $config.codexPath = $codexPath
        } else {
            $config = [pscustomobject]@{ lanAddress = $LanAddress; port = $Port; nodePath = $nodePath; codexPath = $codexPath }
            $pgPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
            $jwtSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
            Set-Content -LiteralPath (Join-Path $localRoot 'stack.env') -Value "POSTGRES_PASSWORD=$pgPassword" -Encoding utf8
            $origin = "http://${LanAddress}:$Port"
            $serverEnv = @(
                'NODE_ENV=production', "PORT=$Port", "DATABASE_URL=postgres://cumora_local:${pgPassword}@127.0.0.1:15433/cumora_local",
                'REDIS_URL=redis://127.0.0.1:16379', 'OPENAI_API_KEY=local-byoa-only-no-server-llm', "AGENT_RUNTIME_SECRET=$jwtSecret",
                "PUBLIC_HOST=$origin", "CUMORA_PUBLIC_ORIGIN=$origin", "CUMORA_AUTH_DONE_URL=$origin/",
                "CUMORA_CORS_ORIGINS=$origin,http://localhost:$Port,https://localhost,capacitor://localhost",
                "CUMORA_AUTH_RETURN_ALLOWLIST=$origin/,http://localhost:$Port/,cumora://auth",
                'ENABLE_SCANNER=false', 'ENABLE_IDLE=false', 'ENABLE_AGENT_POD_GC=false', 'ENABLE_CHROME_PVC_GC=false',
                'ENABLE_CLUSTER_MONITOR=false', 'EMAIL_DOMAIN=cumora.local', 'RESEND_API_KEY='
            )
            Set-Content -LiteralPath (Join-Path $localRoot 'server.env') -Value $serverEnv -Encoding utf8
        }
        $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
        Invoke-Stack @('up', '-d', '--wait')
        Invoke-Native $nodePath @('--env-file=.local/server.env', '--import', 'tsx', 'server/src/migrate-bin.ts')
        $env:VITE_CUMORA_API_BASE = "http://${LanAddress}:$Port"
        Invoke-Native 'npm.cmd' @('run', 'build')
        Invoke-Native 'npm.cmd' @('run', 'build', '--prefix', 'agent-cli')
        Register-Component 'server'
        Start-Component 'server'
        Wait-Server
        Invoke-Native $nodePath @('--env-file=.local/server.env', '--import', 'tsx', 'scripts/local-trial.ts', 'setup')
        Register-Component 'agent'
        Start-Component 'agent'
        Enable-LanFirewall
        Write-Host "Local service ready: http://${LanAddress}:$Port"
        Write-Host 'Read .local/access.json for the private login-page URL; do not share it outside your trial.'
    }
    'Start' { $null = Read-Config; Invoke-Stack @('up', '-d', '--wait'); Start-Component 'server'; Wait-Server; Start-Component 'agent' }
    'Stop' { $null = Read-Config; Stop-Component 'agent'; Stop-Component 'server'; Invoke-Stack @('stop') }
    'Status' {
        $config = Read-Config
        foreach ($component in @('server', 'agent')) {
            Get-ScheduledTask -TaskName (Get-TaskName $component) | Select-Object TaskName,State
            Get-ScheduledTaskInfo -TaskName (Get-TaskName $component) | Select-Object LastRunTime,LastTaskResult
        }
        Invoke-Stack @('ps')
        Write-Host "LAN origin: http://$($config.lanAddress):$($config.port)"
    }
    'Login' { $config = Read-Config; Wait-Server; Invoke-Native $config.nodePath @('--env-file=.local/server.env', '--import', 'tsx', 'scripts/local-trial.ts', 'login') }
    'Firewall' { $null = Read-Config; Enable-LanFirewall }
    'RestartAgent' { $null = Read-Config; Stop-Component 'agent'; Start-Component 'agent' }
    'UseWsl' {
        $config = Read-Config
        Stop-Component 'agent'
        $wslRepo = (& wsl.exe -d $WslDistribution --exec wslpath -a $repoRoot).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $wslRepo.StartsWith('/')) { throw 'Cannot map the checkout into WSL' }
        $codexSource = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
        $wslCodexSource = (& wsl.exe -d $WslDistribution --exec wslpath -a $codexSource).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot map the existing Codex login home into WSL' }
        $stateKey = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($repoRoot.ToLowerInvariant()))).Substring(0, 12)
        $wslState = ($wslCodexSource -replace '/[^/]+$', '') + '/.cumora-local-trial/' + $stateKey
        # Codex's minimal Linux sandbox includes system executables under /usr.
        # A binary under /mnt/e is hidden from its nested bwrap process.
        $wslPackages = '/usr/local/lib/cumora-local-trial/' + $stateKey
        $wslUser = (& wsl.exe -d $WslDistribution --exec id -un).Trim()
        if ($LASTEXITCODE -ne 0 -or $wslUser -notmatch '^[a-z_][a-z0-9_-]*[$]?$') { throw 'Cannot resolve the WSL account' }
        Invoke-Native 'wsl.exe' @('-d', $WslDistribution, '-u', 'root', '--exec', '/usr/bin/install', '-d', '-m', '0755', '-o', $wslUser, $wslPackages)
        $config | Add-Member -NotePropertyName wslCodexSource -NotePropertyValue $wslCodexSource -Force
        $config | Add-Member -NotePropertyName wslState -NotePropertyValue $wslState -Force
        $config | Add-Member -NotePropertyName wslPackages -NotePropertyValue $wslPackages -Force
        $config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localRoot 'config.json') -Encoding utf8
        Invoke-Native $config.nodePath @('--import', 'tsx', 'scripts/local-export-provider.ts')
        Invoke-Native 'wsl.exe' @('-d', $WslDistribution, '--exec', '/usr/local/bin/node', ($wslRepo + '/scripts/local-wsl.mjs'), 'install')
        $config | Add-Member -NotePropertyName wslDistribution -NotePropertyValue $WslDistribution -Force
        $config | Add-Member -NotePropertyName wslRepo -NotePropertyValue $wslRepo -Force
        $config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localRoot 'config.json') -Encoding utf8
        Start-Component 'agent'
    }
    'BuildAndroid' {
        $config = Read-Config
        Wait-Server
        $env:VITE_CUMORA_API_BASE = "http://$($config.lanAddress):$($config.port)"
        Invoke-Native 'npm.cmd' @('run', 'android:build')
        $artifacts = Join-Path $localRoot 'artifacts'
        New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
        Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination (Join-Path $artifacts 'Cumora-local-debug.apk') -Force
        Copy-Item -LiteralPath (Join-Path $artifacts 'Cumora-local-debug.apk') -Destination 'dist/local-trial.apk' -Force
        Invoke-Native $config.nodePath @('--env-file=.local/server.env', '--import', 'tsx', 'scripts/local-trial.ts', 'login')
        Write-Host "APK download: http://$($config.lanAddress):$($config.port)/local-trial.apk"
    }
}
