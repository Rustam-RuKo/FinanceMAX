#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath,[switch]$DryRun)
. "$PSScriptRoot\common.ps1"
$c = Read-FmConfig $ConfigPath
if ($DryRun) {
    Write-Output 'DRY-RUN: validation only. План: prerequisites; directories/ACL; clone+SHA; npm ci/generate/typecheck/build; WinSW service STOPPED; IIS template; backup task template; optional LAN firewall.'
    Write-Output 'Секреты, службы, Git/network, БД и системная конфигурация не читаются и не изменяются.'
    return
}
Assert-FmAdmin
Assert-FmServer
$nodeVersion = Assert-FmPrerequisites $c
if ((Get-FileHash -LiteralPath $c.WinSWSource -Algorithm SHA256).Hash -ne $c.WinSWSha256) { throw 'WinSW SHA256 не совпадает.' }
$serviceExe = Join-Path $c.DataRoot 'Service\FinanceMAX.exe'
$service = Get-CimInstance Win32_Service -Filter "Name='FinanceMAX'"
if ($service) {
    if ($service.PathName.Trim('"') -ne $serviceExe -or $service.StartName -ne 'NT SERVICE\FinanceMAX' -or $service.State -ne 'Stopped') { throw 'Существующая служба отличается или запущена; используйте update, не install.' }
}
foreach ($dir in @($c.DataRoot,$c.BackupRoot)) {
    $null = New-Item -ItemType Directory -Path $dir -Force
    Set-FmAcl $dir
}
foreach ($name in @('Secrets','SSH','Logs','Logs\App','Logs\Backup','Deployments','Service','Automation','Proxy','Temp')) {
    $null = New-Item -ItemType Directory -Path (Join-Path $c.DataRoot $name) -Force
}
foreach ($name in @('Daily','Weekly','Monthly','Verified','PreUpdate','Incoming')) { $null = New-Item -ItemType Directory -Path (Join-Path $c.BackupRoot $name) -Force }
Set-FmGitEnvironment $c
if (-not (Test-Path -LiteralPath $c.AppPath)) {
    $parent = Split-Path $c.AppPath
    $null = New-Item -ItemType Directory -Path $parent -Force
    $null = Invoke-FmNative 'git.exe' @('clone','--branch','main','--single-branch','--',$c.GitRepository,$c.AppPath)
} elseif (-not (Test-Path -LiteralPath (Join-Path $c.AppPath '.git'))) { throw 'AppPath существует и не является проверенным clone.' }
Assert-FmGit $c $c.ExpectedCommit
Set-FmAcl $c.AppPath
Invoke-FmBuild $c
$auto = Join-Path $c.DataRoot 'Automation'
foreach ($file in @('common.ps1','install-financemax.ps1','verify-financemax.ps1','backup-financemax.ps1','update-financemax.ps1','start-runtime.ps1')) {
    Write-FmFile (Join-Path $auto $file) ([IO.File]::ReadAllText((Join-Path $PSScriptRoot $file)))
}
Write-FmFile (Join-Path $auto 'config.psd1') ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $ConfigPath)))
if (Test-Path -LiteralPath $serviceExe) {
    if ((Get-FileHash -LiteralPath $serviceExe).Hash -ne $c.WinSWSha256) { throw 'Установленный wrapper отличается.' }
} else { Copy-Item -LiteralPath $c.WinSWSource -Destination $serviceExe }
$escape = { param($s) [Security.SecurityElement]::Escape([string]$s) }
$ps = & $escape (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe')
$argsXml = & $escape ('-NoLogo -NoProfile -NonInteractive -File "' + (Join-Path $auto 'start-runtime.ps1') + '" -ConfigPath "' + (Join-Path $auto 'config.psd1') + '"')
$appXml = & $escape $c.AppPath
$logXml = & $escape (Join-Path $c.DataRoot 'Logs\App')
$xml = @"
<service>
  <id>FinanceMAX</id><name>FinanceMAX</name>
  <description>FinanceMAX LAN application</description>
  <executable>$ps</executable><arguments>$argsXml</arguments>
  <workingdirectory>$appXml</workingdirectory>
  <startmode>Automatic</startmode><delayedAutoStart/>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
  <depend>$($c.PostgresService)</depend>
  <onfailure action="restart" delay="15 sec"/><resetfailure>1 hour</resetfailure>
  <stoptimeout>60 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
  <logpath>$logXml</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
Write-FmFile (Join-Path $c.DataRoot 'Service\FinanceMAX.xml') $xml
if (-not $service) { $null = Invoke-FmNative $serviceExe @('install') }
# Install never starts the service. Switch to dedicated passwordless virtual account before startup.
$svc = Get-CimInstance Win32_Service -Filter "Name='FinanceMAX'"
$change = Invoke-CimMethod -InputObject $svc -MethodName Change -Arguments @{StartName='NT SERVICE\FinanceMAX';StartPassword=''}
if ($change.ReturnValue -ne 0) { throw 'Не удалось установить virtual service account. Служба остаётся остановленной.' }
$null = Invoke-FmNative 'sc.exe' @('sidtype','FinanceMAX','unrestricted')
$read = @{'NT SERVICE\FinanceMAX'='ReadAndExecute'}
Set-FmAcl $c.AppPath $read
foreach ($name in @('Service','Automation')) { Set-FmAcl (Join-Path $c.DataRoot $name) $read }
foreach ($name in @('Logs\App','Temp')) { Set-FmAcl (Join-Path $c.DataRoot $name) @{'NT SERVICE\FinanceMAX'='Modify'} }
Set-FmAcl (Join-Path $c.AppPath '.next') @{'NT SERVICE\FinanceMAX'='Modify'}
# Secrets/SSH/backup remain administrators+SYSTEM. Grant runtime.env READ separately after secure creation.
$proxy = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer>
  <caching enabled="false" enableKernelCache="false"/>
  <rewrite><rules>
    <rule name="FinanceMAX HTTPS only" stopProcessing="true"><match url=".*"/><conditions><add input="{HTTPS}" pattern="^ON$" negate="true"/></conditions><action type="CustomResponse" statusCode="403" statusReason="HTTPS required" statusDescription="HTTPS required"/></rule>
    <rule name="FinanceMAX proxy" stopProcessing="true"><match url="(.*)"/>
      <serverVariables><set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" replace="true"/><set name="HTTP_X_FORWARDED_PROTO" value="https" replace="true"/></serverVariables>
      <action type="Rewrite" url="http://127.0.0.1:$($c.AppPort)/{R:1}" appendQueryString="true"/>
    </rule>
  </rules></rewrite>
</system.webServer></configuration>
"@
Write-FmFile (Join-Path $c.DataRoot 'Proxy\web.config') $proxy
$taskArgs = '-NoLogo -NoProfile -NonInteractive -File "' + (Join-Path $auto 'backup-financemax.ps1') + '" -ConfigPath "' + (Join-Path $auto 'config.psd1') + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($c.BackupTime,'HH:mm',[Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId $c.BackupTaskUser -LogonType Password -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Write-FmFile (Join-Path $c.DataRoot 'Deployments\backup-task.xml') ($task | Export-ScheduledTask)
if ($c.EnableFirewallRule) {
    if ((Read-Host 'Создать LAN-only правило HTTPS? Введите LAN-HTTPS') -ne 'LAN-HTTPS') { throw 'Firewall не изменён: подтверждение не получено.' }
    if (Get-NetFirewallRule -Name 'FinanceMAX-LAN-HTTPS' -ErrorAction SilentlyContinue) { throw 'Правило уже существует: проверьте его вручную, перезаписи нет.' }
    $null = New-NetFirewallRule -Name 'FinanceMAX-LAN-HTTPS' -DisplayName 'FinanceMAX LAN HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $c.HttpsPort -RemoteAddress $c.OfficeLanCidr -Profile Domain,Private
}
$record = @{utc=[datetime]::UtcNow.ToString('o');sha=$c.ExpectedCommit;node=$nodeVersion;state='prepared-not-started';wrapperSha256=$c.WinSWSha256} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $c.DataRoot ('Deployments\install-' + [datetime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')),$record)
Write-Output 'Подготовлено. Служба НЕ запущена. Далее: restore-test/restore, runtime.env+ACL, backup account+pgpass+task, IIS/сертификат/headers/firewall, verify, запуск и browser acceptance.'
