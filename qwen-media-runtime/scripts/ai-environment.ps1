param([ValidateSet('read','write')][string]$Action = 'read')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    if ($Action -eq 'read') {
        [Console]::Out.Write([Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY', 'User'))
    } else {
        $value = [Console]::In.ReadToEnd()
        [Environment]::SetEnvironmentVariable('DASHSCOPE_API_KEY', $value, 'User')
    }
} catch { [Console]::Error.Write('AI environment variable operation failed.'); exit 1 }
