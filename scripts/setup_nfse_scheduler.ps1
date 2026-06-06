# Setup weekly NFS-e portal sync via Windows Task Scheduler.
# Run once as Administrator (or current user is sufficient for user-scope tasks).
#
# Schedule: every Saturday at 09:00 BRT
# To trigger manually: schtasks /run /tn "NFS-e Portal Sync"

$TaskName  = "NFS-e Portal Sync"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python    = (Get-Command python).Source
$Script    = Join-Path $ScriptDir "sync_nfse_portal.py"
$LogDir    = Join-Path $ScriptDir "..\logs"

# Create logs dir if it doesn't exist
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

$LogFile = Join-Path $LogDir "nfse_sync.log"
$Action  = New-ScheduledTaskAction `
    -Execute $Python `
    -Argument "-X utf8 `"$Script`" >> `"$LogFile`" 2>&1"

$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At "09:00"

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Weekly import of SP NFS-e portal CSV into the Family Expenses DB" `
    -RunLevel Limited | Out-Null

Write-Host "Task '$TaskName' registered — runs every Saturday at 09:00."
Write-Host "Log: $LogFile"
Write-Host ""
Write-Host "To run now: schtasks /run /tn '$TaskName'"
Write-Host "To check:   schtasks /query /tn '$TaskName' /fo LIST"
