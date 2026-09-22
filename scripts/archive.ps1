param(
    [Parameter(Mandatory=$true)][ValidateSet('Create','Extract')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$Directory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if ($Mode -eq 'Create') {
    [IO.Compression.ZipFile]::CreateFromDirectory($Directory, $Archive)
} else {
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $base = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $Directory $entry.FullName))
            if (!$target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw '发布包包含越界路径' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Directory)
}
