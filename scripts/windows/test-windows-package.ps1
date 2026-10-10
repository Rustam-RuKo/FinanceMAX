#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\common.ps1"
# Only writes fixtures/evidence below the caller-selected workspace directory.
$null = New-Item -ItemType Directory -Path $EvidenceRoot -Force
$results = [Collections.Generic.List[object]]::new()
function Test-Case([string]$Name,[scriptblock]$Body) {
    try { & $Body; $results.Add([pscustomobject]@{test=$Name;result='PASS'}) }
    catch { $results.Add([pscustomobject]@{test=$Name;result='FAIL';error=$_.Exception.Message}) }
}
function Must-Throw([scriptblock]$Body) {
    $caught=$false; try { & $Body | Out-Null } catch { $caught=$true }
    if (-not $caught) { throw 'Ожидался отказ.' }
}
function Assert-True($Condition,[string]$Message='Assertion failed') { if (-not $Condition) { throw $Message } }
$fixture = (Get-Content -LiteralPath "$PSScriptRoot\config.example.psd1" -Raw).Replace('FINANCEMAX_HOSTNAME','financemax.example.invalid').Replace('OFFICE_LAN_CIDR','192.168.40.0/24').Replace('ADMIN_NETWORK_CIDR','192.168.41.0/24').Replace('REVIEWED_WINSW_SHA256',('a'*64)).Replace('FINANCEMAX_BACKUP_LOCAL_ACCOUNT','.\fm_backup_test')
$configFile = Join-Path $EvidenceRoot 'config.psd1'
[IO.File]::WriteAllText($configFile,$fixture,[Text.UTF8Encoding]::new($true))
Test-Case 'PowerShell syntax all files' {
    foreach ($f in @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object Extension -in '.ps1','.psd1')) {
        $t=$null;$e=$null
        $null=[Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e)
        Assert-True ($e.Count -eq 0) $f.Name
    }
}
Test-Case 'Example placeholders block apply' { Must-Throw { Read-FmConfig "$PSScriptRoot\config.example.psd1" } }
Test-Case 'Valid config and canonical origin' { $c=Read-FmConfig $configFile; Assert-True ((Get-FmOrigin $c) -eq 'https://financemax.example.invalid') }
$mutations = @(
    @('UNC path',"C:\FinanceMAX\App",'\\server\share'),
    @('Root path',"C:\FinanceMAX\App",'C:\'),
    @('Traversal',"C:\FinanceMAX\App",'C:\FinanceMAX\..\Other'),
    @('Desktop path',"C:\FinanceMAX\App",'C:\Users\Public\Desktop\App'),
    @('Path shell metachar',"C:\FinanceMAX\App",'C:\FinanceMAX\App&whoami'),
    @('Alternate data stream',"C:\FinanceMAX\App",'C:\FinanceMAX\App:stream'),
    @('Trailing dot component',"C:\FinanceMAX\App",'C:\FinanceMAX.\App'),
    @('Nested backup',"D:\FinanceMAXBackups",'C:\FinanceMAX\App\Backup'),
    @('Equal roots',"D:\FinanceMAXBackups",'C:\FinanceMAX\App'),
    @('Public CIDR','192.168.40.0/24','8.8.8.0/24'),
    @('Open CIDR','192.168.40.0/24','0.0.0.0/0'),
    @('Wide private overlap','192.168.40.0/24','192.168.0.0/8'),
    @('Invalid address','192.168.40.0/24','192.168.999.0/24'),
    @('Invalid host','financemax.example.invalid','a.example/evil'),
    @('Hostname injection','financemax.example.invalid','a.example"x'),
    @('Invalid port','AppPort = 3000','AppPort = 70000'),
    @('Same ports','AppPort = 3000','AppPort = 5432'),
    @('Different repository','Rustam-RuKo/FinanceMAX.git','other/project.git'),
    @('Short SHA','8ddbd94f7684679094dd2020f8f45a136bdbd2d2','abcd'),
    @('DB SQL injection','financemax_production','financemax_prod;drop'),
    @('Invalid time',"BackupTime = '02:00'","BackupTime = '29:00'"),
    @('Unknown config',"AppPort = 3000","Unknown = 'x'`n AppPort = 3000")
)
foreach ($m in $mutations) {
    Test-Case $m[0] {
        $badFile=Join-Path $EvidenceRoot 'invalid.psd1'
        [IO.File]::WriteAllText($badFile,$fixture.Replace($m[1],$m[2]),[Text.UTF8Encoding]::new($true))
        Must-Throw { Read-FmConfig $badFile }
    }
}
Test-Case 'Space paths retained and nonstandard HTTPS origin' {
    $path=Join-Path $EvidenceRoot 'spaces.psd1'
    [IO.File]::WriteAllText($path,$fixture.Replace('C:\FinanceMAX\App','C:\Finance MAX\App').Replace('HttpsPort = 443','HttpsPort = 8443'),[Text.UTF8Encoding]::new($true))
    $c=Read-FmConfig $path
    Assert-True ($c.AppPath -eq 'C:\Finance MAX\App')
    Assert-True ((Get-FmOrigin $c) -eq 'https://financemax.example.invalid:8443')
}
Test-Case 'Write same template twice; refuse drift' {
    $f=Join-Path $EvidenceRoot ('idempotency-'+[guid]::NewGuid()+'.txt')
    Write-FmFile $f 'one'; Write-FmFile $f 'one'
    Must-Throw { Write-FmFile $f 'two' }
    Assert-True ([IO.File]::ReadAllText($f) -eq 'one')
}
Test-Case 'Scoped environment restores after failure' {
    $before=[Environment]::GetEnvironmentVariable('FM_SAFE_TEST','Process')
    Must-Throw { Invoke-FmEnvironment @{FM_SAFE_TEST='fixture'} { Assert-True ($env:FM_SAFE_TEST -eq 'fixture'); throw 'synthetic' } }
    Assert-True ([Environment]::GetEnvironmentVariable('FM_SAFE_TEST','Process') -eq $before)
}
Test-Case 'Backup hash verifies then rejects corruption' {
    $f=Join-Path $EvidenceRoot 'fake.dump'
    [IO.File]::WriteAllText($f,'NOT A DATABASE: TEST FIXTURE')
    [IO.File]::WriteAllText("$f.sha256",(Get-FileHash -LiteralPath $f).Hash)
    Test-FmBackupPair $f
    [IO.File]::AppendAllText($f,'corruption')
    Must-Throw { Test-FmBackupPair $f }
}
Test-Case 'Retention selects only old exact names and no nested files' {
    $dir=Join-Path $EvidenceRoot ('retention-'+[guid]::NewGuid()); $null=New-Item -ItemType Directory -Path $dir
    foreach ($i in 1..9) { [IO.File]::WriteAllText((Join-Path $dir ('financemax-202610'+$i.ToString('00')+'T020000000Z.dump')),'fixture') }
    [IO.File]::WriteAllText((Join-Path $dir 'other.dump'),'fixture')
    $rows=@(Get-FmRetentionCandidates $dir 7)
    Assert-True ($rows.Count -eq 2)
    Assert-True ($rows[0].Name -eq 'financemax-20261002T020000000Z.dump')
}
$envFile=Join-Path $EvidenceRoot 'test.env'
$safeEnv="NODE_ENV=production`nFINANCEMAX_ENV=production`nDATABASE_URL=postgresql://financemax_runtime:unused@127.0.0.1:5432/financemax_production`nMIGRATION_DATABASE_URL=postgresql://financemax_runtime:unused@127.0.0.1:5432/financemax_production`nAPP_ORIGIN=https://financemax.example.invalid`nTRUST_PROXY=true"
Test-Case 'Runtime env role and origin' {
    [IO.File]::WriteAllText($envFile,$safeEnv)
    $v=Read-FmEnv $envFile; Assert-FmDbEnv (Read-FmConfig $configFile) $v 'financemax_runtime'
}
Test-Case 'Runtime elevated role rejected' {
    [IO.File]::WriteAllText($envFile,$safeEnv.Replace('financemax_runtime:','financemax_migrator:'))
    Must-Throw { Assert-FmDbEnv (Read-FmConfig $configFile) (Read-FmEnv $envFile) 'financemax_runtime' }
}
Test-Case 'Unknown env variable rejected' { [IO.File]::WriteAllText($envFile,($safeEnv+"`nNODE_OPTIONS=evil")); Must-Throw { Read-FmEnv $envFile } }
Test-Case 'Duplicate env rejected' { [IO.File]::WriteAllText($envFile,($safeEnv+"`nTRUST_PROXY=true")); Must-Throw { Read-FmEnv $envFile } }
Test-Case 'Quoted env rejected' { [IO.File]::WriteAllText($envFile,$safeEnv.Replace('NODE_ENV=production','NODE_ENV="production"')); Must-Throw { Read-FmEnv $envFile } }
Test-Case 'Missing env rejected' { [IO.File]::WriteAllText($envFile,$safeEnv.Replace('TRUST_PROXY=true','')); Must-Throw { Read-FmEnv $envFile } }
Test-Case 'Native argument boundaries with spaces' {
    $f=Join-Path $EvidenceRoot 'echo arguments.ps1'
    [IO.File]::WriteAllText($f,'param([string]$Value) if($Value -ne "C:\Path with space\file"){exit 9}; Write-Output "ARGUMENT-PASS"')
    $ps=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $out=Invoke-FmNative $ps @('-NoProfile','-File',$f,'-Value','C:\Path with space\file')
    Assert-True ($out.Trim() -eq 'ARGUMENT-PASS')
}
Test-Case 'Native nonzero exit rejected without echoing output' {
    $ps=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Must-Throw { Invoke-FmNative $ps @('-NoProfile','-Command','Write-Output "fixture-private-output"; exit 7') }
}
Test-Case 'WinSW and IIS templates produce valid XML with space paths' {
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'install-financemax.ps1'),[ref]$tokens,[ref]$errors)
    $c=Read-FmConfig $configFile
    $ps='C:\Program Files\PowerShell\powershell.exe'
    $argsXml=[Security.SecurityElement]::Escape('-NoProfile -File "C:\Finance MAX\launch.ps1"')
    $appXml='C:\Finance MAX\App'; $logXml='C:\Finance MAX\Logs'
    foreach ($name in @('xml','proxy')) {
        $assignment=$ast.Find({param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq ('$'+$name)},$true)
        Assert-True ($null -ne $assignment)
        $doc=& ([scriptblock]::Create($assignment.Extent.Text + '; [xml]$' + $name))
        if ($name -eq 'xml') {
            Assert-True ($doc.service.executable -eq $ps)
            Assert-True ($doc.service.serviceaccount.user -eq 'LocalService')
            Assert-True ($doc.service.startmode -eq 'Automatic')
        } else {
            $rule=@($doc.configuration.'system.webServer'.rewrite.rules.rule | Where-Object name -eq 'FinanceMAX proxy')[0]
            Assert-True ($rule.action.url -eq 'http://127.0.0.1:3000/{R:1}')
            Assert-True ($rule.serverVariables.set[0].value -eq '{REMOTE_ADDR}')
            Assert-True ($rule.serverVariables.set[0].replace -eq 'true')
        }
    }
}
# Tripwires: DryRun must return before any of these commands are reached.
foreach ($cmd in @('Get-CimInstance','Get-Service','New-Service','Start-Service','Stop-Service','Set-Acl','New-NetFirewallRule','Register-ScheduledTask','Invoke-WebRequest','git.exe','psql.exe')) {
    Set-Item -Path "Function:$cmd" -Value { throw 'SYSTEM MUTATION/PROBE REACHED IN DRY-RUN' }
}
foreach ($script in @('install-financemax.ps1','backup-financemax.ps1','verify-financemax.ps1','update-financemax.ps1')) {
    Test-Case "$script DryRun twice without system access" {
        $parameters=@{ConfigPath=$configFile;DryRun=$true}
        if ($script -eq 'update-financemax.ps1') { $parameters.TargetCommit='b'*40 }
        $first=@(& (Join-Path $PSScriptRoot $script) @parameters)
        $second=@(& (Join-Path $PSScriptRoot $script) @parameters)
        Assert-True (($first -join '') -match 'DRY-RUN')
        Assert-True (($first -join '') -eq ($second -join ''))
    }
}
$report=@{powershell=$PSVersionTable.PSVersion.ToString();utc=[datetime]::UtcNow.ToString('o');passed=@($results|Where-Object result -eq 'PASS').Count;failed=@($results|Where-Object result -eq 'FAIL').Count;results=@($results.ToArray())}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'results.json') -Encoding UTF8
$results | Format-Table -AutoSize
Write-Output "PASS=$($report.passed) FAIL=$($report.failed) PowerShell=$($report.powershell)"
if ($report.failed) { exit 1 }
