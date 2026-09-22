$ErrorActionPreference = 'Stop'
$packages = Get-Content -Raw (Join-Path $PSScriptRoot '../qwen-media-runtime/scripts/setup-packages.json') | ConvertFrom-Json
foreach ($name in @('ffmpeg','uv')) {
    $entry = $packages.$name
    $directory = Join-Path $env:RUNNER_TEMP "qwen-ci-$name"
    New-Item -ItemType Directory -Force $directory | Out-Null
    $archive = Join-Path $directory 'package.zip'
    Invoke-WebRequest -Uri $entry.url -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $entry.sha256) { throw "$name 校验失败" }
    Expand-Archive -LiteralPath $archive -DestinationPath $directory
    $exe = Get-ChildItem -LiteralPath $directory -Filter $entry.exe -Recurse -File | Select-Object -First 1
    if (!$exe) { throw "$name 未找到可执行文件" }
    (Split-Path $exe.FullName) | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8
}
