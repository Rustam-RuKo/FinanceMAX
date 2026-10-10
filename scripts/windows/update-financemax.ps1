#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath,[Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$TargetCommit,[switch]$DryRun)
. "$PSScriptRoot\common.ps1"
$c = Read-FmConfig $ConfigPath
if ($DryRun) { Write-Output 'DRY-RUN: clean Git/SHA; stop; backup; manual full restore-test gate; fetch/diff/confirm; ff-only; build/migrations/grants; smoke. Ничего не изменено.'; return }
Assert-FmAdmin
Assert-FmServer
$null = Assert-FmPrerequisites $c
Assert-FmGit $c $c.ExpectedCommit
$branch = (Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'branch','--show-current')).Trim()
if ($branch -ne 'main') { throw 'Update разрешён только на main; сначала завершите документированный rollback.' }
$old = (Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'rev-parse','HEAD')).Trim()
if ($TargetCommit -eq $old) { Write-Output 'Утверждённый commit уже установлен. Изменений нет.'; return }
$migration = Read-FmEnv (Join-Path $c.DataRoot 'Secrets\migration.env')
Assert-FmDbEnv $c $migration 'financemax_migrator'
Invoke-FmPrismaCheck $c $migration
Set-FmGitEnvironment $c
$record = @{utc=[datetime]::UtcNow.ToString('o');oldSha=$old;targetSha=$TargetCommit;status='started'}
$recordPath = Join-Path $c.DataRoot ('Deployments\update-' + [datetime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')
try {
    Stop-Service -Name FinanceMAX
    (Get-Service FinanceMAX).WaitForStatus('Stopped',[timespan]::FromSeconds(90))
    if (Get-NetTCPConnection -State Listen -LocalPort $c.AppPort -ErrorAction SilentlyContinue) { throw 'Остался writer/listener; update остановлен.' }
    $backup = & "$PSScriptRoot\backup-financemax.ps1" -ConfigPath $ConfigPath -Kind PreUpdate
    Test-FmBackupPair $backup.Dump
    $record.backup = $backup.Dump
    Write-Output "Backup: $($backup.Dump). Выполните полный restore-test по руководству в отдельной БД, пока приложение остановлено."
    $proof = Read-Host 'Введите полный путь к JSON-протоколу успешного restore-test'
    $evidence = Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
    if ($evidence.dumpSha256 -ne $backup.SHA256 -or $evidence.codeSha -ne $old -or $evidence.result -ne 'PASS' -or -not $evidence.schemaDiffZero -or -not $evidence.dataValidated) { throw 'Нет подходящего протокола полного restore-test.' }
    $record.restoreProof = $proof
    $null = Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'fetch','origin','main')
    if ((Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'rev-parse','origin/main')).Trim() -ne $TargetCommit) { throw 'origin/main отличается от утверждённого TargetCommit.' }
    $null = Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'merge-base','--is-ancestor',$old,$TargetCommit)
    Write-Output (Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'diff','--stat',$old,$TargetCommit))
    Write-Output (Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'diff',$old,$TargetCommit,'--','prisma/migrations','package.json','package-lock.json'))
    if ((Read-Host "Проверьте полный diff отдельно. Для применения введите $TargetCommit") -ne $TargetCommit) { throw 'Update отменён; служба остаётся остановленной.' }
    # Pull the reviewed immutable SHA, not a moving remote branch.
    $null = Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'pull','--ff-only','origin',$TargetCommit)
    Assert-FmGit $c $TargetCommit
    Push-Location $c.AppPath
    $oldPath = $env:PATH
    try {
        $env:PATH = (Split-Path $c.NodeExe) + ';' + $env:PATH
        $npm = Join-Path (Split-Path $c.NodeExe) 'npm.cmd'
        $null = Invoke-FmNative $npm @('ci','--include=dev','--no-audit','--no-fund')
        Invoke-FmEnvironment $migration {
            $null = Invoke-FmNative $npm @('run','db:generate')
            # status may return 1 for expected pending migrations; deploy is the checked gate.
            try { $null = Invoke-FmNative $c.NodeExe @('node_modules/prisma/build/index.js','migrate','status') } catch { Write-Output 'Статус не up-to-date; далее migrate deploy с остановкой при ошибке.' }
            $null = Invoke-FmNative $npm @('run','db:migrate')
        }
        Invoke-FmGrants $c
        Invoke-FmPrismaCheck $c $migration
        $null = Assert-FmDatabase $c
    } finally { $env:PATH=$oldPath; Pop-Location }
    Invoke-FmBuild $c
    Set-FmAcl (Join-Path $c.AppPath '.next') @{'NT SERVICE\FinanceMAX'='Modify'}
    # Operator deliberately updates the non-secret deployment pin before starting.
    Write-Output "В config.psd1 обновите только ExpectedCommit на $TargetCommit (включая Automation\config.psd1)."
    if ((Read-Host 'После сохранения введите CONFIG-UPDATED') -ne 'CONFIG-UPDATED') { throw 'Pin не подтверждён.' }
    $newConfig = Read-FmConfig $ConfigPath
    $serviceConfig = Read-FmConfig (Join-Path $c.DataRoot 'Automation\config.psd1')
    if ($newConfig.ExpectedCommit -ne $TargetCommit -or $serviceConfig.ExpectedCommit -ne $TargetCommit) { throw 'Config SHA не обновлён.' }
    foreach ($key in $c.Keys) { if ($key -ne 'ExpectedCommit' -and ($newConfig[$key] -ne $c[$key] -or $serviceConfig[$key] -ne $c[$key])) { throw 'Во время update изменены другие параметры config; запуск запрещён.' } }
    Start-Service -Name FinanceMAX
    (Get-Service FinanceMAX).WaitForStatus('Running',[timespan]::FromSeconds(90))
    $ready = $false
    for ($i=0; $i -lt 12; $i++) {
        try { $r = Invoke-WebRequest -Uri ((Get-FmOrigin $c) + '/login') -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) { throw 'HTTPS smoke не прошёл.' }
    & "$PSScriptRoot\verify-financemax.ps1" -ConfigPath $ConfigPath
    $record.status='automatic-checks-passed-browser-pending'
    $record.node=(Invoke-FmNative $c.NodeExe @('--version')).Trim()
} catch {
    Stop-Service -Name FinanceMAX -ErrorAction SilentlyContinue
    $record.status='failed-service-stopped'
    throw 'Обновление остановлено. Старый SHA и backup сохранены в deployment record. Следуйте rollback; автоматического отката БД нет.'
} finally { [IO.File]::WriteAllText($recordPath,($record | ConvertTo-Json)) }
