param(
  [string]$Version = "1.0.1",
  [switch]$SkipUpx
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Executable = Join-Path $Root "src-tauri\target\release\gnm-studio.exe"
$ReleaseRoot = Join-Path $Root "release"

if (-not (Test-Path -LiteralPath $Executable)) {
  throw "Release executable not found. Run: npm run tauri build -- --no-bundle"
}

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
$ResolvedReleaseRoot = (Resolve-Path -LiteralPath $ReleaseRoot).Path

function Remove-ReleaseItemSafely([string]$Path, [switch]$Recurse) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $Resolved = (Resolve-Path -LiteralPath $Path).Path
  if (-not $Resolved.StartsWith($ResolvedReleaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace an item outside the release directory: $Resolved"
  }
  for ($Attempt = 1; $Attempt -le 10; $Attempt++) {
    try {
      if ($Recurse) {
        Remove-Item -LiteralPath $Resolved -Recurse -Force
      } else {
        Remove-Item -LiteralPath $Resolved -Force
      }
      return
    } catch {
      if ($Attempt -eq 10) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function Compress-ArchiveWithRetry([string]$Source, [string]$Destination) {
  for ($Attempt = 1; $Attempt -le 10; $Attempt++) {
    try {
      Compress-Archive -Path $Source -DestinationPath $Destination -CompressionLevel Optimal
      return
    } catch {
      Remove-ReleaseItemSafely -Path $Destination
      if ($Attempt -eq 10) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function New-PortablePackage([string]$PackageName, [bool]$UseUpx) {
  $PackageDirectory = Join-Path $ReleaseRoot $PackageName
  $Archive = Join-Path $ReleaseRoot "$PackageName.zip"
  Remove-ReleaseItemSafely -Path $PackageDirectory -Recurse
  try {
    Remove-ReleaseItemSafely -Path $Archive
  } catch {
    $BuildStamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $Archive = Join-Path $ReleaseRoot "$PackageName-$BuildStamp.zip"
    Write-Warning "The previous archive is open in another program. Writing the refreshed package to $Archive instead."
  }
  New-Item -ItemType Directory -Path $PackageDirectory | Out-Null

  $PackagedExecutable = Join-Path $PackageDirectory "GNM-Studio-v$Version.exe"
  Copy-Item -LiteralPath $Executable -Destination $PackagedExecutable
  Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination $PackageDirectory
  Copy-Item -LiteralPath (Join-Path $Root "README_ZH.md") -Destination $PackageDirectory
  Copy-Item -LiteralPath (Join-Path $Root "THIRD_PARTY_NOTICES.md") -Destination $PackageDirectory
  Copy-Item -LiteralPath (Join-Path $Root "LICENSE") -Destination (Join-Path $PackageDirectory "LICENSE.txt")
  Copy-Item -LiteralPath (Join-Path $Root "third_party\google-gnm\LICENSE") -Destination (Join-Path $PackageDirectory "GOOGLE-GNM-LICENSE.txt")

  if ($UseUpx) {
    if (-not (Get-Command upx -ErrorAction SilentlyContinue)) {
      throw "UPX was requested but the upx command is not installed."
    }
    & upx --best --lzma --force $PackagedExecutable | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "UPX compression failed with exit code $LASTEXITCODE." }
    & upx -t $PackagedExecutable | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "UPX verification failed with exit code $LASTEXITCODE." }
  }

  Compress-ArchiveWithRetry -Source (Join-Path $PackageDirectory "*") -Destination $Archive
  return $Archive
}

$Archives = @()
$Archives += New-PortablePackage -PackageName "GNM-Studio-$Version-Windows-x64-Portable" -UseUpx $false
if (-not $SkipUpx) {
  $Archives += New-PortablePackage -PackageName "GNM-Studio-$Version-Windows-x64-Portable-UPX" -UseUpx $true
}

$Checksums = foreach ($Archive in $Archives) {
  $Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Archive
  "$($Hash.Hash.ToLower())  $([IO.Path]::GetFileName($Archive))"
}
$Checksums | Set-Content -LiteralPath (Join-Path $ReleaseRoot "checksums.txt") -Encoding ascii
$Archives
