param([ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    [void][Reflection.Assembly]::LoadWithPartialName('System.Security')
    $inputText = [Console]::In.ReadToEnd()
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Action -eq 'protect') {
        $bytes = [Text.Encoding]::UTF8.GetBytes($inputText)
        $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
        [Console]::Out.Write([Convert]::ToBase64String($result))
    } else {
        $bytes = [Convert]::FromBase64String($inputText)
        $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
        [Console]::Out.Write([Text.Encoding]::UTF8.GetString($result))
    }
} catch { [Console]::Error.Write('本机加密存储不可用。'); exit 1 }
