#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath,[switch]$Initial,[switch]$DryRun)
. "$PSScriptRoot\common.ps1"
$c = Read-FmConfig $ConfigPath
if ($DryRun) { Write-Output 'DRY-RUN: проверен config. План read-only: service, SHA, IIS/TLS, listeners, DB/migrations/grants/counts, task/backup/disk/events. Live проверки не выполнены.'; return }
Assert-FmAdmin
Assert-FmServer
$null = Assert-FmPrerequisites $c
Assert-FmGit $c $c.ExpectedCommit
$svc = Get-CimInstance Win32_Service -Filter "Name='FinanceMAX'"
if (-not $svc -or $svc.State -ne 'Running' -or $svc.StartName -ne 'NT SERVICE\FinanceMAX' -or $svc.PathName.Trim('"') -ne (Join-Path $c.DataRoot 'Service\FinanceMAX.exe')) { throw 'Неверное состояние/identity/path службы.' }
foreach ($port in @($c.AppPort,$c.PostgresPort)) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port)
    if (-not $listeners.Count -or @($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count) { throw "Порт $port должен слушать только 127.0.0.1." }
}
Import-Module WebAdministration
$site = Get-Website -Name 'FinanceMAX'
if (-not $site -or $site.State -ne 'Started') { throw 'IIS site не запущен.' }
if ($site.physicalPath -ne (Join-Path $c.DataRoot 'Proxy')) { throw 'Неверный IIS physicalPath.' }
$proxyConfig = [xml](Get-Content -LiteralPath (Join-Path $c.DataRoot 'Proxy\web.config') -Raw)
$proxyRule = @($proxyConfig.configuration.'system.webServer'.rewrite.rules.rule | Where-Object name -eq 'FinanceMAX proxy')
if ($proxyRule.Count -ne 1 -or $proxyRule[0].action.url -ne "http://127.0.0.1:$($c.AppPort)/{R:1}") { throw 'Неверная proxy rule.' }
$xff = @($proxyRule[0].serverVariables.set | Where-Object name -eq 'HTTP_X_FORWARDED_FOR')
$xfp = @($proxyRule[0].serverVariables.set | Where-Object name -eq 'HTTP_X_FORWARDED_PROTO')
if ($xff.Count -ne 1 -or $xff[0].value -ne '{REMOTE_ADDR}' -or $xff[0].replace -ne 'true' -or $xfp.Count -ne 1 -or $xfp[0].value -ne 'https') { throw 'Forwarded headers не защищены.' }
foreach ($setting in @('enabled','preserveHostHeader')) {
    $v = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name $setting
    if (-not [bool]$v.Value) { throw 'ARR proxy/preserveHostHeader выключен.' }
}
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if (@($profiles | Where-Object { -not $_.Enabled -or $_.DefaultInboundAction -eq 'Allow' }).Count) { throw 'Firewall profiles отключены или разрешают входящие по умолчанию.' }
$fw = Get-NetFirewallRule -PolicyStore ActiveStore -Name 'FinanceMAX-LAN-HTTPS'
$addresses = @($fw | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)
$ports = @($fw | Get-NetFirewallPortFilter)
if ($fw.Enabled -ne 'True' -or $fw.Action -ne 'Allow' -or $addresses.Count -ne 1 -or $addresses[0] -ne $c.OfficeLanCidr -or $ports[0].LocalPort -ne [string]$c.HttpsPort) { throw 'FinanceMAX firewall rule не соответствует config.' }
$broad = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Allow | Where-Object Name -ne 'FinanceMAX-LAN-HTTPS' | Where-Object {
    $p = @($_ | Get-NetFirewallPortFilter)
    $a = @($_ | Get-NetFirewallAddressFilter)
    ($p[0].Protocol -in @('TCP','6','Any')) -and ($p[0].LocalPort -contains 'Any' -or $p[0].LocalPort -contains [string]$c.HttpsPort -or $p[0].LocalPort -contains [string]$c.AppPort -or $p[0].LocalPort -contains [string]$c.PostgresPort) -and ($a[0].RemoteAddress -contains 'Any')
})
if ($broad.Count) { throw 'Есть другие широкие Allow-правила для проверяемых портов/Any; требуется ручная оценка program/service scope и GPO.' }
$bindings = @(Get-WebBinding -Name 'FinanceMAX')
$binding = @($bindings | Where-Object { $_.protocol -eq 'https' -and $_.bindingInformation -eq "*:$($c.HttpsPort):$($c.Hostname)" })
if ($binding.Count -ne 1 -or $bindings.Count -ne 1) { throw 'Ожидается единственный HTTPS binding FinanceMAX.' }
$thumb = [string]$binding[0].certificateHash
if (-not $thumb) { throw 'Нет certificate binding.' }
$cert = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumb"
if (-not $cert.HasPrivateKey -or $cert.NotAfter -lt (Get-Date).AddDays(30)) { throw 'Нет private key или сертификат истекает менее чем через 30 дней.' }
foreach ($url in @("http://127.0.0.1:$($c.AppPort)/login",((Get-FmOrigin $c) + '/login'))) {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    if ($response.StatusCode -ne 200) { throw 'Не получен HTTP 200 /login.' }
}
$runtime = Read-FmEnv (Join-Path $c.DataRoot 'Secrets\runtime.env')
Assert-FmDbEnv $c $runtime 'financemax_runtime'
$migration = Read-FmEnv (Join-Path $c.DataRoot 'Secrets\migration.env')
Assert-FmDbEnv $c $migration 'financemax_migrator'
$u = [Uri]$runtime.DATABASE_URL
$runtimeVars = @{PGHOST='127.0.0.1';PGPORT=[string]$c.PostgresPort;PGDATABASE=$c.Database;PGUSER='financemax_runtime';PGPASSWORD=[Uri]::UnescapeDataString(($u.UserInfo -split ':',2)[1]);PGOPTIONS='-c default_transaction_read_only=on'}
$runtimeCheck = Invoke-FmEnvironment $runtimeVars { Invoke-FmNative (Join-Path $c.PgBin 'psql.exe') @('-X','-w','-A','-t','-c','SELECT current_user;') }
if ($runtimeCheck.Trim() -ne 'financemax_runtime') { throw 'Runtime connection не подтверждён.' }
Invoke-FmPrismaCheck $c $migration
$counts = Assert-FmDatabase $c -Initial:$Initial
$task = Get-ScheduledTask -TaskName 'FinanceMAX-Backup'
$info = Get-ScheduledTaskInfo -InputObject $task
if ($task.State -eq 'Disabled' -or $task.Principal.UserId -notin @($c.BackupTaskUser,($env:COMPUTERNAME + '\' + $c.BackupTaskUser.Substring(2))) -or $info.LastTaskResult -ne 0 -or $info.LastRunTime -lt (Get-Date).AddHours(-$c.BackupMaxAgeHours)) { throw 'Backup task identity/result/freshness не подтверждены.' }
$latest = Get-ChildItem -LiteralPath (Join-Path $c.BackupRoot 'Daily') -Filter '*.dump' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $latest -or $latest.LastWriteTimeUtc -lt [datetime]::UtcNow.AddHours(-$c.BackupMaxAgeHours)) { throw 'Нет свежего backup.' }
Test-FmBackupPair $latest.FullName
foreach ($root in @($c.AppPath,$c.DataRoot,$c.BackupRoot)) {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $root.Substring(0,2) + "'")
    if (-not $disk -or $disk.FreeSpace -lt ($c.MinimumFreeGB * 1GB)) { throw 'Недостаточно свободного места.' }
}
$events = @(Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddHours(-24)} -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -eq 'Service Control Manager' -and $_.Message -match 'FinanceMAX' })
if ($events.Count) { throw 'За последние 24 часа есть ошибки FinanceMAX в System log; проверьте локально.' }
$errors = @(Get-ChildItem -LiteralPath (Join-Path $c.DataRoot 'Logs\App') -File -Filter '*.log' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Tail 100 | Select-String 'request_failed|Unhandled|FATAL' })
if ($errors.Count) { throw 'Обнаружены признаки ошибок в последних app logs; содержимое не выводится.' }
Write-Output ($counts | ConvertTo-Json -Compress)
Write-Output 'PASS: автоматические локальные проверки. НЕ подтверждает browser login, XLSX, restore-test, LAN/WAN isolation, IIS header spoofing и финансовую сверку. Выполните checklist.'
