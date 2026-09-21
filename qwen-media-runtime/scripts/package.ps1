param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$target = [IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $target) { throw '发布包已存在，请使用新的文件名。' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$allowed = @('.md','.mjs','.py','.ps1','.json','.yaml','.html','.js','.css','.txt','.png','.svg')
$files = @()
foreach ($name in @('yy-douyin-video','yy-qwen-asr','yy-qwen-omni','qwen-media-runtime')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $repo $name) -File -Recurse | Where-Object { $_.Extension -in $allowed -and $_.FullName -notmatch '[\\/](__pycache__|node_modules)[\\/]' }
}
$files += Get-Item -LiteralPath (Join-Path $repo 'README.md')
$files += Get-ChildItem -LiteralPath (Join-Path $repo 'assets/readme') -File
New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
$archive = [IO.Compression.ZipFile]::Open($target, 'Create')
try {
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($repo.Length + 1).Replace('\','/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative)
    }
} finally { $archive.Dispose() }
Write-Output "完整发布包：$target（$($files.Count) 个文件）"
