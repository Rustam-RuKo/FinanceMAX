#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath,[ValidateSet('Daily','PreUpdate')][string]$Kind='Daily',[switch]$DryRun)
. "$PSScriptRoot\common.ps1"
$c = Read-FmConfig $ConfigPath
if ($DryRun) { Write-Output 'DRY-RUN: pg_dump -> .part -> list -> SHA256 -> rename; retention 7/4/12. Ничего не изменено.'; return }
$lock = $null
$part = $null
try {
    foreach ($tier in @('Daily','Weekly','Monthly','Verified','PreUpdate','Incoming')) { $null = Assert-FmPath (Join-Path $c.BackupRoot $tier) }
    if (Test-Path -LiteralPath (Join-Path $c.BackupRoot 'backup.lock')) { $null = Assert-FmPath (Join-Path $c.BackupRoot 'backup.lock') }
    $lock = [IO.File]::Open((Join-Path $c.BackupRoot 'backup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $now = [datetime]::UtcNow
    $name = 'financemax-' + $now.ToString('yyyyMMddTHHmmssfffZ') + '.dump'
    $dest = Join-Path (Join-Path $c.BackupRoot $Kind) $name
    $part = "$dest.part"
    $vars = Get-FmPgEnv $c 'financemax_backup' 'backup.pgpass'
    Invoke-FmEnvironment $vars {
        $null = Invoke-FmNative (Join-Path $c.PgBin 'pg_dump.exe') @('-w','--format=custom','--file',$part)
    }
    if ((Get-Item -LiteralPath $part).Length -eq 0) { throw 'Пустой dump.' }
    $null = Invoke-FmNative (Join-Path $c.PgBin 'pg_restore.exe') @('--list',$part)
    $hash = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash
    [IO.File]::WriteAllText("$dest.sha256.part",$hash)
    # Same-volume renames; sidecar is published last as completion marker.
    Move-Item -LiteralPath $part -Destination $dest
    Move-Item -LiteralPath "$dest.sha256.part" -Destination "$dest.sha256"
    Test-FmBackupPair $dest
    if ($Kind -eq 'Daily') {
        $tiers = @()
        if ($now.DayOfWeek -eq [DayOfWeek]::Sunday) { $tiers += 'Weekly' }
        if ($now.Day -eq 1) { $tiers += 'Monthly' }
        foreach ($tier in $tiers) {
            $copy = Join-Path (Join-Path $c.BackupRoot $tier) $name
            Copy-Item -LiteralPath $dest -Destination "$copy.part"
            if ((Get-FileHash -LiteralPath "$copy.part").Hash -ne $hash) { throw 'Ошибка проверки копии.' }
            Move-Item -LiteralPath "$copy.part" -Destination $copy
            [IO.File]::WriteAllText("$copy.sha256",$hash)
        }
        foreach ($tier in @(@('Daily',7),@('Weekly',4),@('Monthly',12))) {
            $directory = [IO.Path]::GetFullPath((Join-Path $c.BackupRoot $tier[0]))
            foreach ($file in @(Get-FmRetentionCandidates $directory $tier[1])) {
                if ($file.DirectoryName -ne $directory -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Небезопасный retention path.' }
                Test-FmBackupPair $file.FullName
                Remove-Item -LiteralPath $file.FullName
                Remove-Item -LiteralPath ($file.FullName + '.sha256')
            }
        }
    }
    Add-Content -LiteralPath (Join-Path $c.DataRoot 'Logs\Backup\backup.log') -Value "$($now.ToString('o')) OK $Kind $name" -Encoding UTF8
    [pscustomobject]@{Dump=$dest;SHA256=$hash;Utc=$now.ToString('o');RestoreTested=$false}
} catch {
    # Preserve partial artifacts for investigation; never rotate after a failed dump.
    Write-Error 'Резервное копирование не завершено. Проверьте место, ACL и доступ БД; незавершённые файлы сохранены.'
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
