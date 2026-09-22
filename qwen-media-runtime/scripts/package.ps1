param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../scripts/package.mjs'))
& node $entry --out $Out
exit $LASTEXITCODE
