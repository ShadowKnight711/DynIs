<#
.SYNOPSIS
  Shows a status pill in the DynIs island from your own scripts.

.EXAMPLE
  .\dynis-activity.ps1 -Id build -Title "build" -State running
  .\dynis-activity.ps1 -Id build -Title "build" -State running -Progress 0.4
  .\dynis-activity.ps1 -Id build -Title "build" -State done      # lifts once, then disappears
  .\dynis-activity.ps1 -Id build -Remove                          # ends it

.NOTES
  DynIs watches %LOCALAPPDATA%\com.kevin.dynis\activities\ for *.json files.
  Nothing listens on the network. "Script Activities" must be on in
  Settings -> Notch -> Live Activities.
#>
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Title = $Id,
  [string]$Value,
  [ValidateSet("running", "done", "failed")][string]$State = "running",
  [double]$Progress = -1,
  [string]$Detail,
  [switch]$Remove
)

$dir = Join-Path $env:LOCALAPPDATA "com.kevin.dynis\activities"
New-Item -ItemType Directory -Force $dir | Out-Null
$safeId = ($Id -replace '[^A-Za-z0-9_-]', '_')
$file = Join-Path $dir "$safeId.json"

if ($Remove) {
  Remove-Item $file -ErrorAction SilentlyContinue
  return
}

$data = [ordered]@{ title = $Title; state = $State }
if ($Value) { $data.value = $Value }
if ($Detail) { $data.detail = $Detail }
if ($Progress -ge 0) { $data.progress = [Math]::Min(1, $Progress) }

# Write to a temp file and move it into place so DynIs never reads half a file.
$tmp = "$file.tmp"
($data | ConvertTo-Json -Compress) | Set-Content -Path $tmp -Encoding UTF8
Move-Item -Force $tmp $file
