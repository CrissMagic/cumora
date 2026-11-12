$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $repoRoot '.local/config.json') -Raw | ConvertFrom-Json
$address = $null
if (-not [Net.IPAddress]::TryParse($config.lanAddress, [ref]$address) -or $address.AddressFamily -ne 'InterNetwork' -or [Net.IPAddress]::IsLoopback($address)) { throw 'Invalid LAN IPv4 address' }
if ($config.port -lt 1024 -or $config.port -gt 65535) { throw 'Invalid service port' }
$digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($repoRoot.ToLowerInvariant()))).Substring(0, 12)
$firewallName = "Cumora Local HTTP ($digest)"
if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $config.port -LocalAddress $config.lanAddress -RemoteAddress LocalSubnet -Profile Any | Out-Null
}
Write-Host "Allowed local-subnet TCP traffic to $($config.lanAddress):$($config.port)"
[pscustomobject]@{ rule=$firewallName; localAddress=$config.lanAddress; port=$config.port; remoteSubnet='LocalSubnet'; verified=(Get-NetFirewallRule -DisplayName $firewallName).Enabled.ToString() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repoRoot '.local/firewall-lan.json') -Encoding utf8
