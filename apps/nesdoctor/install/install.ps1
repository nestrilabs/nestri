# nesdoctor installer — https://doctor.nestri.io/install.ps1
#
# This file is the source of what that URL serves. It lives in the public
# repository so that anyone about to run it can read it first:
#
#   https://github.com/nestrilabs/nestri/blob/dev/apps/nesdoctor/install/install.ps1
#
# What it does, in order: download the matching nesdoctor.exe from GitHub
# Releases, verify it against the published SHA256SUMS, run it, and delete it.
# It installs nothing permanently, writes to no system directory, and needs no
# administrator rights.
#
# Usage:
#   powershell -c "irm https://doctor.nestri.io/install.ps1 | iex"

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'nestrilabs/nestri'

# Pinned, and NOT `releases/latest`. This repository ships product releases as
# well as this tool, so `latest` is whatever went out most recently -- it
# resolved to a 2024 release while this was being written, and the day a
# product release goes out it would move again and every install here would
# 404. Bump this line when cutting a nesdoctor release; NESDOCTOR_TAG overrides
# it for testing.
$DefaultTag = 'nesdoctor-v0.2.2'
$Tag = if ($env:NESDOCTOR_TAG) { $env:NESDOCTOR_TAG } else { $DefaultTag }

# TLS 1.2 explicitly: Windows PowerShell 5.1 still defaults to older protocols
# on some builds, and GitHub refuses them, which surfaces as a bare
# "underlying connection was closed".
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$arch = if ([Environment]::Is64BitOperatingSystem) { 'x86_64' } else { 'x86' }
if ($arch -ne 'x86_64') {
  throw "nesdoctor needs 64-bit Windows."
}
$target = 'x86_64-pc-windows-msvc'
$asset  = "nesdoctor-$target.exe"

$base = "https://github.com/$Repo/releases/download/$Tag"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("nesdoctor-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$exe = Join-Path $tmp 'nesdoctor.exe'

try {
  Write-Host "Downloading nesdoctor ($target)..."
  # -UseBasicParsing for PowerShell 5.1, where the default wants Internet
  # Explorer's engine to be present.
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $exe -UseBasicParsing

  # A checksum fetched from the same place as the binary is not a security
  # boundary and we do not claim it is. It catches a truncated or corrupted
  # download, which is the failure that actually happens.
  try {
    $sums = Join-Path $tmp 'SHA256SUMS'
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing
    $want = (Select-String -Path $sums -SimpleMatch $asset |
             Select-Object -First 1).Line -split '\s+' | Select-Object -First 1
    $have = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLower()
    if (-not $want) { throw "no checksum for $asset in SHA256SUMS" }
    if ($have -ne $want.ToLower()) {
      throw "checksum mismatch - do not run this file`n  expected $want`n  got      $have"
    }
    Write-Host "Checksum OK."
  } catch {
    Write-Host "Could not verify checksum: $($_.Exception.Message)"
  }

  Write-Host ""
  # Called through the console host so the interactive prompts work: piping
  # this script through `iex` leaves stdin consumed, and nesdoctor would then
  # see a non-terminal stdin and skip every question.
  & $exe @args
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
