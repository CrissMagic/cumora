param([Parameter(Mandatory)][ValidateSet('server', 'agent')][string]$Component)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$repoRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $repoRoot '.local'
$config = Get-Content -LiteralPath (Join-Path $localRoot 'config.json') -Raw | ConvertFrom-Json
Set-Location -LiteralPath $repoRoot
$env:PATH = "$(Split-Path -Parent $config.codexPath);$env:PATH"
$env:CUMORA_CONFIG_DIR = Join-Path $localRoot 'agent'
$env:CUMORA_AUTO_UPDATE = '0'
$env:CUMORA_SUPERVISED = '1'
$env:CUMORA_DEFAULT_CODEX_MODEL = ''
$logPath = Join-Path $localRoot "logs/$Component.log"
while (-not (Test-Path -LiteralPath (Join-Path $localRoot "$Component.disabled"))) {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 20MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
    $launchArgs = if ($Component -eq 'server') {
        @('--env-file=.local/server.env', '--import', 'tsx', 'server/src/index.ts')
    } elseif ($config.PSObject.Properties['wslDistribution']) {
        @()
    } else {
        @('agent-cli/dist/cli.js', 'agent', 'computer', '--server', "http://127.0.0.1:$($config.port)")
    }
    if ($Component -eq 'agent' -and $config.PSObject.Properties['wslDistribution']) {
        & wsl.exe -d $config.wslDistribution --exec /usr/local/bin/node ($config.wslRepo + '/scripts/local-wsl.mjs') start 2>&1 | ForEach-Object { Add-Content -LiteralPath $logPath -Value "$_" -Encoding utf8 }
    } else {
        & $config.nodePath @launchArgs 2>&1 | ForEach-Object { Add-Content -LiteralPath $logPath -Value "$_" -Encoding utf8 }
    }
    $componentExit = $LASTEXITCODE
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] $Component exited $componentExit; retrying in 5 seconds" -Encoding utf8
    Start-Sleep -Seconds 5
}
