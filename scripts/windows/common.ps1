#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-FmPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path -match '["%;&|<>`\r\n]' -or $Path -match '[\\/]\.\.?([\\/]|$)') {
        throw 'Требуется абсолютный локальный путь без специальных символов и переходов.'
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($Path.Substring(2).Contains(':') -or $Path -match '[. ]([\\/]|$)') { throw 'ADS и неоднозначные окончания компонентов пути запрещены.' }
    if ($full.Length -le 3 -or $full -match '\\Users\\|\\Windows(\\|$)') { throw 'Системный корень или профиль пользователя запрещён.' }
    $itemPath = $full
    while ($itemPath) {
        if (Test-Path -LiteralPath $itemPath) {
            if ((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point в пути запрещён.' }
        }
        $itemPath = Split-Path -Path $itemPath -Parent
    }
    return $full
}

function Read-FmConfig([string]$Path) {
    $c = Import-PowerShellDataFile -LiteralPath $Path
    $required = @('AppPath','DataRoot','BackupRoot','Hostname','OfficeLanCidr','AdminNetwork','HttpsPort','AppPort','PostgresPort','Database','PostgresService','PgBin','NodeExe','GitRepository','ExpectedCommit','WinSWSource','WinSWSha256','BackupTime','BackupTaskUser','EnableFirewallRule','BackupMaxAgeHours','MinimumFreeGB')
    foreach ($key in $required) { if (-not $c.ContainsKey($key)) { throw "Не задан параметр $key" } }
    foreach ($key in $c.Keys) { if ($key -notin $required) { throw "Неизвестный параметр $key" } }
    foreach ($key in @('AppPath','DataRoot','BackupRoot','PgBin','NodeExe','WinSWSource')) { $c[$key] = Assert-FmPath $c[$key] }
    $roots = @($c.AppPath,$c.DataRoot,$c.BackupRoot)
    foreach ($a in $roots) { foreach ($b in $roots) {
        if ($a -ne $b -and ($a + '\').StartsWith($b + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'App, DataRoot и BackupRoot не должны быть вложены друг в друга.' }
    } }
    if (@($roots | Select-Object -Unique).Count -ne 3) { throw 'Каталоги должны отличаться.' }
    if ($c.Hostname -notmatch '^(?=.{1,253}$)[a-zA-Z0-9]+(?:[a-zA-Z0-9.-]*[a-zA-Z0-9])$' -or $c.Hostname -notmatch '\.' -or $c.Hostname -match '\.\.') { throw 'Замените Hostname на полное DNS-имя.' }
    foreach ($key in @('OfficeLanCidr','AdminNetwork')) {
        $p = $c[$key] -split '/'; $ip = $null
        if ($p.Count -ne 2 -or -not [Net.IPAddress]::TryParse($p[0],[ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork' -or $p[1] -notmatch '^\d{1,2}$' -or [int]$p[1] -lt 8 -or [int]$p[1] -gt 32) { throw "${key}: требуется ограниченный IPv4 CIDR /8–/32." }
        $bytes = $ip.GetAddressBytes()
        if (-not ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31 -and [int]$p[1] -ge 12) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168 -and [int]$p[1] -ge 16))) { throw 'Основная схема разрешает только частную IPv4 LAN.' }
    }
    foreach ($key in @('HttpsPort','AppPort','PostgresPort')) { if ($c[$key] -isnot [int] -or $c[$key] -lt 1 -or $c[$key] -gt 65535) { throw 'Неверный порт.' } }
    if (@($c.HttpsPort,$c.AppPort,$c.PostgresPort | Select-Object -Unique).Count -ne 3) { throw 'Порты должны отличаться.' }
    if ($c.Database -notmatch '^financemax_[a-z0-9_]+$' -or $c.PostgresService -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Недопустимое имя БД/службы.' }
    if ($c.GitRepository -ne 'git@github.com:Rustam-RuKo/FinanceMAX.git' -or $c.ExpectedCommit -notmatch '^[a-f0-9]{40}$') { throw 'Неверный repository или полный SHA.' }
    if ($c.WinSWSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Задайте проверенный SHA256 WinSW.' }
    if ($c.BackupTime -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'BackupTime: HH:mm.' }
    if ($c.BackupTaskUser -notmatch '^\.\\[a-zA-Z0-9_-]+$') { throw 'BackupTaskUser: отдельная локальная учётная запись .\имя.' }
    if ($c.EnableFirewallRule -isnot [bool] -or $c.BackupMaxAgeHours -lt 1 -or $c.MinimumFreeGB -lt 1) { throw 'Недопустимые параметры контроля.' }
    return $c
}

function Assert-FmServer {
    $os = Get-CimInstance Win32_OperatingSystem
    if ($os.ProductType -eq 1 -or [int]$os.BuildNumber -notin @(20348,26100) -or -not [Environment]::Is64BitOperatingSystem) { throw 'Требуется Windows Server 2022/2025 x64.' }
}
function Assert-FmAdmin {
    $p = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Запустите PowerShell от имени администратора.' }
}
function Invoke-FmNative([string]$Exe,[string[]]$Arguments) {
    # Never echo arguments or native error text: tools can include secret URLs.
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = @(& $Exe @Arguments 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $saved }
    if ($code -ne 0) { throw "Команда $([IO.Path]::GetFileName($Exe)) завершилась с кодом $code. Вывод скрыт для защиты секретов." }
    return ($result -join "`n")
}
function Set-FmAcl([string]$Path,[hashtable]$Readers = @{}) {
    $isDir = (Get-Item -LiteralPath $Path).PSIsContainer
    $acl = if ($isDir) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $rules = @{'S-1-5-32-544'='FullControl'; 'S-1-5-18'='FullControl'}
    foreach ($k in $Readers.Keys) { $rules[$k] = $Readers[$k] }
    foreach ($k in $rules.Keys) {
        $id = if ($k -like 'S-1-*') { [Security.Principal.SecurityIdentifier]::new($k) } else { [Security.Principal.NTAccount]::new($k) }
        $inheritance = if ($isDir) { 'ContainerInherit,ObjectInherit' } else { 'None' }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,$rules[$k],$inheritance,'None','Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Write-FmFile([string]$Path,[string]$Text) {
    if (Test-Path -LiteralPath $Path) {
        if ([IO.File]::ReadAllText($Path) -ne $Text) { throw "Существующий файл отличается: $Path. Сравните вручную; перезаписи нет." }
        return
    }
    [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($true))
}
function Get-FmOrigin($Config) {
    if ($Config.HttpsPort -eq 443) { return "https://$($Config.Hostname)" }
    return "https://$($Config.Hostname):$($Config.HttpsPort)"
}
function Read-FmEnv([string]$Path) {
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Z_]+)=(.*)$' -or $Matches[1] -notin @('NODE_ENV','FINANCEMAX_ENV','DATABASE_URL','MIGRATION_DATABASE_URL','APP_ORIGIN','TRUST_PROXY')) { throw 'Недопустимая строка env; содержимое скрыто.' }
        $key = $Matches[1]; $v = $Matches[2]
        if ($values.ContainsKey($key) -or $v -match '[\r\n]' -or $v.StartsWith('"') -or $v.StartsWith("'")) { throw 'Env: дубликат или кавычки запрещены; используйте URL encoding.' }
        $values[$key] = $v
    }
    foreach ($k in @('NODE_ENV','FINANCEMAX_ENV','DATABASE_URL','MIGRATION_DATABASE_URL','APP_ORIGIN','TRUST_PROXY')) { if (-not $values.ContainsKey($k)) { throw "Env: отсутствует $k" } }
    if ($values.NODE_ENV -ne 'production' -or $values.FINANCEMAX_ENV -ne 'production' -or $values.TRUST_PROXY -ne 'true') { throw 'Неверный production env.' }
    return $values
}
function Invoke-FmEnvironment([hashtable]$Values,[scriptblock]$Action) {
    $saved = @{}
    foreach ($k in $Values.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k,'Process'); [Environment]::SetEnvironmentVariable($k,$Values[$k],'Process') }
    try { & $Action } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k,$saved[$k],'Process') } }
}
function Assert-FmDbEnv($Config,$Values,[string]$Role) {
    if ($Values.APP_ORIGIN -ne (Get-FmOrigin $Config)) { throw 'APP_ORIGIN отличается от config.' }
    foreach ($key in @('DATABASE_URL','MIGRATION_DATABASE_URL')) {
        try { $u = [Uri]$Values[$key] } catch { throw 'Неверный DB URL (скрыт).' }
        if ($u.Scheme -ne 'postgresql' -or $u.Host -ne '127.0.0.1' -or $u.Port -ne $Config.PostgresPort -or $u.AbsolutePath -ne "/$($Config.Database)" -or $u.UserInfo.Split(':')[0] -ne $Role) { throw 'База/роль/порт в env не совпадают с config.' }
    }
}
function Set-FmGitEnvironment($Config) {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    $key = (Join-Path $Config.DataRoot 'SSH\github_financemax').Replace('\','/')
    $known = (Join-Path $Config.DataRoot 'SSH\known_hosts').Replace('\','/')
    if (-not (Test-Path $key) -or -not (Test-Path $known)) { throw 'Подготовьте deploy key и проверенный known_hosts.' }
    $env:GIT_SSH_COMMAND = '"' + $ssh.Replace('\','/') + '" -i "' + $key + '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="' + $known + '"'
    $env:GIT_TERMINAL_PROMPT = '0'
}
function Assert-FmGit($Config,[string]$Sha) {
    if ((Invoke-FmNative 'git.exe' @('-C',$Config.AppPath,'status','--porcelain')).Trim()) { throw 'Рабочее дерево не чистое.' }
    $remote = (Invoke-FmNative 'git.exe' @('-C',$Config.AppPath,'remote','get-url','origin')).Trim()
    if ($remote -ne $Config.GitRepository) { throw 'Неожиданный origin.' }
    if ($Sha -and (Invoke-FmNative 'git.exe' @('-C',$Config.AppPath,'rev-parse','HEAD')).Trim() -ne $Sha) { throw 'HEAD не совпадает с утверждённым SHA.' }
    if (@(Get-ChildItem -LiteralPath $Config.AppPath -Force -Filter '.env*' | Where-Object Name -ne '.env.example').Count) { throw 'Env-файлы в app tree запрещены.' }
}
function Assert-FmPrerequisites($Config) {
    $node = Invoke-FmNative $Config.NodeExe @('--version')
    if ($node.Trim() -notmatch '^v22\.') { throw 'Требуется Node.js 22.' }
    $pg = Invoke-FmNative (Join-Path $Config.PgBin 'pg_dump.exe') @('--version')
    if ($pg -notmatch ' 18\.') { throw 'Требуется PostgreSQL tools 18.' }
    if ((Get-Service -Name $Config.PostgresService).Status -ne 'Running') { throw 'PostgreSQL service не запущен.' }
    $null = Invoke-FmNative 'git.exe' @('--version')
    $null = Get-Command (Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe')
    return $node.Trim()
}
function Invoke-FmBuild($Config) {
    Push-Location $Config.AppPath
    $oldPath = $env:PATH
    try {
        $env:PATH = (Split-Path $Config.NodeExe) + ';' + $env:PATH
        $dummy = @{ NODE_ENV='production'; FINANCEMAX_ENV='production'; DATABASE_URL='postgresql://build:unused@127.0.0.1:1/build_only'; MIGRATION_DATABASE_URL='postgresql://build:unused@127.0.0.1:1/build_only'; APP_ORIGIN=(Get-FmOrigin $Config); TRUST_PROXY='true' }
        Invoke-FmEnvironment $dummy {
            $npm = Join-Path (Split-Path $Config.NodeExe) 'npm.cmd'
            $null = Invoke-FmNative $npm @('ci','--include=dev','--no-audit','--no-fund')
            $null = Invoke-FmNative $npm @('run','db:generate')
            $null = Invoke-FmNative $Config.NodeExe @('node_modules/next/dist/bin/next','typegen')
            $null = Invoke-FmNative $npm @('run','typecheck')
            $null = Invoke-FmNative $npm @('run','build')
        }
    } finally { $env:PATH = $oldPath; Pop-Location }
}
function Get-FmPgEnv($Config,[string]$User,[string]$PassName) {
    $file = Join-Path $Config.DataRoot "Secrets\$PassName"
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Подготовьте $PassName с защищённым ACL." }
    return @{ PGHOST='127.0.0.1'; PGPORT=[string]$Config.PostgresPort; PGDATABASE=$Config.Database; PGUSER=$User; PGPASSFILE=$file; PGPASSWORD=$null; PGOPTIONS='-c default_transaction_read_only=on' }
}
function Invoke-FmSql($Config,[string]$Sql,[string]$User='financemax_migrator',[string]$PassName='maintenance.pgpass') {
    $vars = Get-FmPgEnv $Config $User $PassName
    Invoke-FmEnvironment $vars { Invoke-FmNative (Join-Path $Config.PgBin 'psql.exe') @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',$Sql) }
}
function Test-FmBackupPair([string]$Dump) {
    if (-not (Test-Path -LiteralPath $Dump -PathType Leaf) -or -not (Test-Path -LiteralPath "$Dump.sha256" -PathType Leaf)) { throw 'Нет dump или SHA256.' }
    foreach ($file in @($Dump,"$Dump.sha256")) { if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup links запрещены.' } }
    $expected = [IO.File]::ReadAllText("$Dump.sha256").Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Dump -Algorithm SHA256).Hash -ne $expected) { throw 'SHA256 backup не совпадает.' }
}
function Get-FmRetentionCandidates([string]$Directory,[int]$Keep) {
    return @(Get-ChildItem -LiteralPath $Directory -File -Filter 'financemax-*.dump' | Where-Object Name -Match '^financemax-\d{8}T\d{9}Z\.dump$' | Sort-Object Name -Descending | Select-Object -Skip $Keep)
}
function Assert-FmDatabase($Config,[switch]$Initial) {
    $check = @'
SELECT json_build_object(
 'version',current_setting('server_version_num')::int,
 'foreignKeys',(SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace),
 'invalidConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace),
 'disabledTriggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND t.tgenabled<>'O'),
 'migrations',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
 'unfinished',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL),
 'users',(SELECT count(*) FROM "User"), 'partners',(SELECT count(*) FROM "Partner"),
 'employees',(SELECT count(*) FROM "Employee"),'projects',(SELECT count(*) FROM "Project"),
 'seasons',(SELECT count(*) FROM "Season"),'work',(SELECT count(*) FROM "WorkEntry"),
 'templates',(SELECT count(*) FROM "AuditSectionTemplate"),'paymentCategories',(SELECT count(*) FROM "PaymentCategory"),
 'expenseCategories',(SELECT count(*) FROM "ExpenseCategory"),'accounts',(SELECT count(*) FROM "LedgerAccount"),
 'demo',(SELECT count(*) FROM "User" WHERE demo),
 'initialLogins',(SELECT count(*) FROM "User" WHERE active AND email IN ('sobir@financemax.local','atabek@financemax.local','katerina@financemax.local','karina@financemax.local','akilbek@financemax.local')),
 'runtimeUnsafe',(SELECT count(*) FROM pg_roles WHERE rolname='financemax_runtime' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)),
 'runtimeDDL',has_schema_privilege('financemax_runtime','public','CREATE'),
 'runtimeDatabaseDDL',has_database_privilege('financemax_runtime',current_database(),'CREATE'),
 'runtimeOwned',(SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname='financemax_runtime')),
 'runtimeMigrationRead',has_table_privilege('financemax_runtime','"_prisma_migrations"','SELECT'),
 'runtimeDeleteOthers',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'Session' AND has_table_privilege('financemax_runtime',format('%I.%I',schemaname,tablename),'DELETE')),
 'runtimeMissingDml',(SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' AND NOT (has_table_privilege('financemax_runtime',format('%I.%I',schemaname,tablename),'SELECT') AND has_table_privilege('financemax_runtime',format('%I.%I',schemaname,tablename),'INSERT') AND has_table_privilege('financemax_runtime',format('%I.%I',schemaname,tablename),'UPDATE'))),
 'runtimeSessionDelete',has_table_privilege('financemax_runtime','"Session"','DELETE'),
 'runtimeMembership',pg_has_role('financemax_runtime','financemax_migrator','MEMBER'));
'@
    $d = (Invoke-FmSql $Config $check) | ConvertFrom-Json
    if ($d.version -lt 180000 -or $d.version -ge 190000 -or $d.foreignKeys -lt 1 -or $d.invalidConstraints -ne 0 -or $d.disabledTriggers -ne 0 -or $d.unfinished -ne 0 -or $d.demo -ne 0) { throw 'Нарушена проверка версии/constraints/triggers/migrations/demo.' }
    if ($d.runtimeUnsafe -ne 0 -or $d.runtimeDDL -or $d.runtimeDatabaseDDL -or $d.runtimeOwned -ne 0 -or $d.runtimeMigrationRead -or $d.runtimeDeleteOthers -ne 0 -or $d.runtimeMembership -or $d.runtimeMissingDml -ne 0 -or -not $d.runtimeSessionDelete) { throw 'Runtime grants не соответствуют least privilege.' }
    $migrationCount = @(Get-ChildItem -LiteralPath (Join-Path $Config.AppPath 'prisma\migrations') -Directory).Count
    if ($d.migrations -ne $migrationCount) { throw 'Количество миграций БД и кода отличается.' }
    if ($Initial) {
        $expected = @{users=5;partners=2;employees=0;projects=0;seasons=0;work=0;templates=66;paymentCategories=5;expenseCategories=2;accounts=4;migrations=12;initialLogins=5}
        foreach ($k in $expected.Keys) { if ($d.$k -ne $expected[$k]) { throw "Начальный контроль $k не совпадает." } }
    }
    return $d
}
function Invoke-FmPrismaCheck($Config,$Values) {
    Push-Location $Config.AppPath
    try { Invoke-FmEnvironment $Values {
        $null = Invoke-FmNative $Config.NodeExe @('node_modules/prisma/build/index.js','migrate','status')
        $null = Invoke-FmNative $Config.NodeExe @('node_modules/prisma/build/index.js','migrate','diff','--from-schema-datasource','prisma/schema.prisma','--to-schema-datamodel','prisma/schema.prisma','--exit-code')
    } } finally { Pop-Location }
}
function Invoke-FmGrants($Config) {
    $vars = Get-FmPgEnv $Config 'financemax_migrator' 'maintenance.pgpass'
    $vars.PGOPTIONS = $null
    $sql = @'
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM financemax_runtime;
GRANT USAGE ON SCHEMA public TO financemax_runtime;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO financemax_runtime;
GRANT DELETE ON "Session" TO financemax_runtime;
REVOKE ALL ON "_prisma_migrations" FROM financemax_runtime;
COMMIT;
'@
    Invoke-FmEnvironment $vars { $null = Invoke-FmNative (Join-Path $Config.PgBin 'psql.exe') @('-X','-w','-v','ON_ERROR_STOP=1','-c',$sql) }
}
