param([string]$ExistingProgramId)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$cli = Join-Path $projectRoot 'chain/tooling/kora/bin/kora-deploy.exe'
$binary = Join-Path $projectRoot 'chain/deploy/geo_duels.so'
$wallet = Join-Path $projectRoot '.secrets/deployer.json'
if (!(Test-Path -LiteralPath $binary)) { throw 'Build the Solana program before deployment.' }
if (!(Test-Path -LiteralPath $wallet)) { throw 'Generate a dedicated devnet deployment key under .secrets/deployer.json.' }
$arguments = @('--program-so', $binary, '--wallet', $wallet, '--user-id', 'geo-duels-20261011')
if ($ExistingProgramId) { $arguments += @('--program-id', $ExistingProgramId) }
& $cli @arguments
if ($LASTEXITCODE -ne 0) { throw 'Devnet sponsorship deployment failed.' }
