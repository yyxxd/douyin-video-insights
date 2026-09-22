param(
    [ValidateSet('Check','Probe','Install','Open','Guide','Run')][string]$Action = 'Check',
    [switch]$Consent,
    [ValidateSet('download','prepare','asr','omni')][string]$Task = 'download',
    [string[]]$TaskArguments = @()
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($env:QWEN_MEDIA_CONFIG_DIR) { $env:QWEN_MEDIA_CONFIG_DIR } else { Join-Path $env:LOCALAPPDATA 'QwenMediaSkills' }
$root = [IO.Path]::GetFullPath($root)
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$packages = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'setup-packages.json') | ConvertFrom-Json

function Measure-Source($Source, $ProbeUrl = $null) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -UseBasicParsing -Method Head -Uri $(if ($ProbeUrl) { $ProbeUrl } else { $Source.url }) -TimeoutSec 6 | Out-Null
        return [pscustomobject]@{ name=$Source.name; url=$Source.url; elapsed=$timer.ElapsedMilliseconds }
    } catch { return $null }
}

function Select-Sources($Entry) {
    $candidates = @([pscustomobject]@{ name='官方源'; url=$Entry.url })
    if ($Entry.mirrors) { $candidates += @($Entry.mirrors) }
    $available = @($candidates | ForEach-Object { Measure-Source $_ } | Where-Object { $_ } | Sort-Object elapsed)
    if (!$available.Count) { return $candidates }
    return @($available) + @($candidates | Where-Object { $_.url -notin $available.url })
}

function Select-PythonIndexes {
    $available = @($packages.pythonIndexes | ForEach-Object { Measure-Source $_ $_.probe } | Where-Object { $_ } | Sort-Object elapsed)
    if (!$available.Count) { return @($packages.pythonIndexes) }
    return @($available) + @($packages.pythonIndexes | Where-Object { $_.url -notin $available.url })
}

function Find-Tool($Name) {
    $candidate = Get-Command "$Name.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
        $flag = if ($Name -eq 'ffmpeg') { '-version' } else { '--version' }
        $version = & $candidate.Source $flag 2>$null
        if ($LASTEXITCODE -eq 0 -and ($Name -ne 'node' -or "$version" -match '^v(2[2-9]|[3-9]\d)\.')) { return $candidate.Source }
    }
    $directory = Join-Path $root "tools/$Name"
    if (Test-Path $directory) {
        $file = Get-ChildItem $directory -Filter "$Name.exe" -Recurse | Select-Object -First 1
        if ($file) { return $file.FullName }
    }
    return $null
}

function Install-Tool($Name) {
    $entry = $packages.$Name
    $directory = Join-Path $root "tools/$Name"
    New-Item -ItemType Directory -Force $directory | Out-Null
    $archive = Join-Path $directory 'package.zip'
    Write-Host "正在测试下载线路：$($entry.label)"
    if (!(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $entry.sha256) {
        $downloaded = $false
        foreach ($source in @(Select-Sources $entry)) {
            try {
                Write-Host "使用$($source.name)：$($entry.label)"
                Invoke-WebRequest -UseBasicParsing $source.url -OutFile $archive -TimeoutSec 600
                if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $entry.sha256) { throw '文件校验不一致' }
                $downloaded = $true
                break
            } catch {
                Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
                Write-Host "$($source.name)不可用，正在尝试下一条线路。"
            }
        }
        if (!$downloaded) { throw "$($entry.label)下载失败，官方源和镜像均不可用。" }
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $entry.sha256) { throw '下载文件校验失败，请重新准备工具。' }
    Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
    $file = Get-ChildItem $directory -Filter $entry.exe -Recurse | Select-Object -First 1
    if (!$file) { throw "未找到$($entry.label)，安装未完成。" }
    return $file.FullName
}

function Get-Tools {
    $tools = @{}
    foreach ($name in @('node','uv','ffmpeg')) { $tools[$name] = Find-Tool $name }
    return $tools
}

function Set-ProcessPaths($tools) {
    $directories = @($tools.node, $tools.uv, $tools.ffmpeg) | ForEach-Object { Split-Path $_ }
    $env:PATH = ($directories -join ';') + ';' + $env:PATH
    $env:QWEN_MEDIA_CONFIG_DIR = $root
    $env:PYTHONIOENCODING = 'utf-8'
    $userKey = [Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY', 'User')
    if ($userKey) { $env:DASHSCOPE_API_KEY = $userKey }
    elseif (Test-Path (Join-Path $root 'setup.json')) {
        $saved = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'setup.json') | ConvertFrom-Json
        if ($saved.environmentManaged) { $env:DASHSCOPE_API_KEY = '' }
    }
}

function Install-Environment {
    if (!$Consent) { throw '请先向用户说明安装清单，并获得同意后再安装。' }
    $tools = Get-Tools
    foreach ($name in @('node','uv','ffmpeg')) { if (!$tools[$name]) { $tools[$name] = Install-Tool $name } }
    Set-ProcessPaths $tools
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $root 'tools/python'
    $python = Join-Path $root 'tools/venv/Scripts/python.exe'
    if (!(Test-Path $python)) {
        $githubSource = @(Select-Sources $packages.uv) | Select-Object -First 1
        if ($githubSource.name -eq 'ghfast') { $env:UV_PYTHON_INSTALL_MIRROR = 'https://ghfast.top/https://github.com/astral-sh/python-build-standalone/releases/download' }
        & $tools.uv venv --python 3.11 (Join-Path $root 'tools/venv')
        if ($LASTEXITCODE -ne 0 -and $env:UV_PYTHON_INSTALL_MIRROR) {
            Remove-Item Env:UV_PYTHON_INSTALL_MIRROR -ErrorAction SilentlyContinue
            Write-Host 'Python 镜像不可用，正在回退官方源。'
            & $tools.uv venv --python 3.11 (Join-Path $root 'tools/venv')
        }
        if ($LASTEXITCODE -ne 0) { throw 'Python 环境准备失败，可重试继续。' }
    }
    $installed = $false
    foreach ($index in @(Select-PythonIndexes)) {
        Write-Host "使用$($index.name)安装浏览器连接工具。"
        & $tools.uv pip install --python $python --default-index $index.url 'playwright==1.63.0'
        if ($LASTEXITCODE -eq 0) { $installed = $true; break }
    }
    if (!$installed) { throw '浏览器连接工具安装失败，PyPI 官方源和镜像均不可用。' }
    $tools.python = $python
    foreach ($name in @('node','uv','python')) { & $tools[$name] --version; if ($LASTEXITCODE -ne 0) { throw "$name 无法运行。" } }
    $probeVersion = & (Join-Path (Split-Path $tools.ffmpeg) 'ffprobe.exe') -version
    if ($LASTEXITCODE -ne 0) { throw '视频检查工具无法运行。' }
    [IO.File]::WriteAllText((Join-Path $root 'toolchain.json'), ($tools | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Host '下载工具准备完成，下一步连接抖音与 AI 服务。'
}

try {
    if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw '自动安装目前支持 Windows x64；当前系统尚未验收。' }
    if ($Action -eq 'Check') {
        $tools = Get-Tools
        $missing = @('node','uv','ffmpeg') | Where-Object { !$tools[$_] } | ForEach-Object { $packages.$_.label }
        $saved = if (Test-Path (Join-Path $root 'setup.json')) { Get-Content -Raw -Encoding UTF8 (Join-Path $root 'setup.json') | ConvertFrom-Json } else { $null }
        @{ configuration=$saved; loginSaved=(Test-Path (Join-Path $root 'douyin-session.protected')); aiSaved=[bool]([Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY', 'User') -or $env:DASHSCOPE_API_KEY); supported=$true; directory=$root; missing=@($missing); environmentPrepared=(Test-Path (Join-Path $root 'toolchain.json')); next='获得安装同意后运行 Guide，一次完成抖音、AI 和费用配置；用户可在页面明确跳过 AI。'; pythonEnvironment='独立 Python 3.11 与浏览器连接工具；缺失时自动下载' } | ConvertTo-Json
        exit 0
    }
    if ($Action -eq 'Probe') {
        $downloadSources = @{}
        foreach ($name in @('node','uv','ffmpeg')) {
            $source = @(Select-Sources $packages.$name) | Select-Object -First 1
            $downloadSources[$name] = @{ name=$source.name; latencyMs=$source.elapsed }
        }
        $pythonIndex = @(Select-PythonIndexes) | Select-Object -First 1
        @{ downloads=$downloadSources; pythonIndex=@{ name=$pythonIndex.name; latencyMs=$pythonIndex.elapsed }; note='仅测试连接，不下载或安装。安装时会重新确认，并在失败时自动回退。' } | ConvertTo-Json -Depth 4
        exit 0
    }
    if ($Action -eq 'Install') { Install-Environment; exit 0 }
    if ($Action -eq 'Guide') {
        if (!(Test-Path (Join-Path $root 'toolchain.json'))) { Install-Environment }
        $tools = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'toolchain.json') | ConvertFrom-Json
        Set-ProcessPaths $tools
        & $tools.node (Join-Path $PSScriptRoot 'setup-server.mjs')
        exit $LASTEXITCODE
    }
    $tools = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'toolchain.json') | ConvertFrom-Json
    Set-ProcessPaths $tools
    if ($Action -eq 'Open') { & $tools.node (Join-Path $PSScriptRoot 'setup-server.mjs'); exit $LASTEXITCODE }
    $entries = @{download='yy-douyin-video/scripts/download_browser.py';prepare='yy-douyin-video/scripts/prepare_video.mjs';asr='yy-qwen-asr/scripts/run_qwen_asr.mjs';omni='yy-qwen-omni/scripts/run_qwen_omni.mjs'}
    $exe = if ($Task -eq 'download') { $tools.python } else { $tools.node }
    & $exe (Join-Path $repo $entries[$Task]) @TaskArguments
    exit $LASTEXITCODE
} catch { Write-Error $_.Exception.Message; exit 1 }
