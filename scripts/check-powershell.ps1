$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$files = @()
foreach ($directory in @('scripts', 'qwen-media-runtime/scripts')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $repo $directory) -Filter '*.ps1' -File
}
foreach ($file in $files) {
    $parseTokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "PowerShell 语法错误：$($file.Name)" }
}
