# Setup the weekly NFS-e sync + payment-intelligence refresh via Task Scheduler.
# Run once as Administrator (or current user is sufficient for user-scope tasks).
#
# Each run (sync_nfse_portal.py):
#   1. imports new notas from the SP NFS-e portal (skipped if NFS_SP_PASSWORD unset)
#   2. dedups against existing notas
#   3. re-runs the payment matcher so installment status ticks forward automatically
#
# Schedule: every Saturday at 09:00 BRT
# To trigger manually: schtasks /run /tn "NFS-e Sync + Payment Refresh"

$TaskName  = "NFS-e Sync + Payment Refresh"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python    = (Get-Command python).Source
$Script    = Join-Path $ScriptDir "sync_nfse_portal.py"
$LogDir    = Join-Path $ScriptDir "..\logs"

# Create logs dir if it doesn't exist
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

$LogFile = Join-Path $LogDir "nfse_sync.log"
# Run through cmd.exe so the ">>" log redirection actually works (python.exe
# cannot redirect its own stdout). cmd /c "" "exe" args >> log "" pattern.
$Cmd     = "`"$Python`" -X utf8 `"$Script`" >> `"$LogFile`" 2>&1"
$Action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$Cmd`""

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
    -Description "Weekly: import SP NFS-e portal CSV, dedup, and refresh installment payment status" `
    -RunLevel Limited | Out-Null

Write-Host "Task '$TaskName' registered — runs every Saturday at 09:00."
Write-Host "Log: $LogFile"
Write-Host ""
Write-Host "To run now: schtasks /run /tn '$TaskName'"
Write-Host "To check:   schtasks /query /tn '$TaskName' /fo LIST"
