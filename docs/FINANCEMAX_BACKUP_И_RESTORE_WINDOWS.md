# FinanceMAX — backup и restore на Windows Server

Исполняет ответственный администратор после чтения [deployment](DEPLOYMENT_СЕРВЕР_FINANCEMAX_WINDOWS.md). На текущем компьютере при подготовке пакета pg_dump/restore, создание БД и Task Scheduler не выполнялись. Все приведённые команды — будущая серверная процедура. [Обновления](FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md), [чек-лист](FINANCEMAX_SERVER_CHECKLIST_WINDOWS.md).

## 1. Что защищаем

Custom dump содержит реальные логины, password hashes, аудит и финансовые данные. Он конфиденциален целиком. Не помещать dump, pgpass, `.env`, ключи, screenshots/session state в repository или обычную почту. Локальные NTFS ACL + BitLocker/защищённый volume; дополнительная encrypted off-site копия вне физического сервера, ключ отдельно. NAS/носитель/cloud — по политике, без привязки к провайдеру. Проверять off-site SHA256 и restore, не только «файл скопирован».

В комплекте backup хранить nonsensitive manifest: UTC, код SHA, версии PostgreSQL/Node, имя БД, schema/migration baseline, количество строк, SHA256 dump, result restore-test, ответственный. Не хранить там credentials. `pg_restore --list` — проверка TOC; SHA256 — целостность передачи; только полный restore + data/schema validation подтверждают восстановимость.

## 2. Первый перенос: source Windows → Windows Server

1. Утвердить downtime. Остановить **фактический исходный writer** (не угадывать service name), отключить автоперезапуск, запретить параллельный ввод/скрипты. `Get-NetTCPConnection`/`pg_stat_activity` подтвердить отсутствие writers. Не завершать чужие sessions без разбора.
2. Установить source `PGHOST/PGPORT/PGDATABASE/PGUSER` по фактической конфигурации. У старой локальной установки порт может отличаться от 5432 — не подменять его предположением.
3. Сохранить baseline таблиц, ID/roles/Partner links, schema constraints/triggers/migrations и дату. Не печатать passwordHash. Source остаётся остановленным до switch либо явно документированного отказа от переноса.
4. В выделенном защищённом каталоге создать custom dump и SHA256. Использовать PostgreSQL 18 tools, не старый major.

Формат защищённого pgpass: `127.0.0.1:SOURCE_PORT:financemax_production:SOURCE_BACKUP_ROLE:ACTUAL_PASSWORD`. В реальном файле значения заполняет администратор; `:` и `\` внутри значений экранируются обратной косой. Это libpq pgpass, **не URI encoding**. Права только account, выполняющий backup, и admin/SYSTEM. [PostgreSQL pgpass](https://www.postgresql.org/docs/18/libpq-pgpass.html).

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = 'SOURCE_PORT'
$env:PGDATABASE = 'financemax_production'
$env:PGUSER = 'SOURCE_BACKUP_ROLE'
$env:PGPASSFILE = 'C:\SecureTransfer\source.pgpass'
$env:PGPASSWORD = $null
$dump = 'C:\SecureTransfer\financemax-transfer.dump'
if (Test-Path -LiteralPath $dump) { throw 'Не перезаписывать существующий dump' }
& "$pgBin\pg_dump.exe" -w --format=custom --file "$dump.part"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; writer не запускать автоматически' }
& "$pgBin\pg_restore.exe" --list "$dump.part" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'TOC failed' }
$sha = (Get-FileHash -LiteralPath "$dump.part" -Algorithm SHA256).Hash
Move-Item -LiteralPath "$dump.part" -Destination $dump
[IO.File]::WriteAllText("$dump.sha256",$sha)
```

Без бинарных pipeline `pg_dump > file` в Windows PowerShell. Передать dump+sidecar+baseline по SFTP с проверенным host key или зашифрованному носителю. Не открывать WAN ради передачи. На target поместить в BackupRoot\Incoming с admin ACL, повторно сверить hash. Не переносить source PGDATA методом file copy между работающими серверами.

## 3. Плановый backup и отдельный account

`backup-financemax.ps1` использует read-only **DB role** `financemax_backup` с SELECT всех таблиц, включая `_prisma_migrations`, и sequences. SQL grants — в deployment. Это не runtime role. Для Scheduler создать отдельную **Windows account**, например `financemax_backup_os`, без Administrators membership; пароль вводится как SecureString:

```powershell
$password = Read-Host 'Пароль локального backup account' -AsSecureString
New-LocalUser -Name 'financemax_backup_os' -Password $password -Description 'FinanceMAX scheduled database backups' -AccountNeverExpires
Remove-Variable password
```

Не назначать PasswordNeverExpires без принятой политики. Установить Log on as a batch job через secpol.msc/GPO, запретить local interactive/RDP logon. Срок действия/ротация пароля account и соответствующего task credential контролируются администратором. `BackupTaskUser='.\financemax_backup_os'` в config. Account не получает SSH key, migration.env, runtime.env, App write или DB write. Дать read/execute Automation и PostgreSQL bin, Modify только BackupRoot и Logs\Backup. В защищённом файле `Secrets\backup.pgpass` ровно tuple для production backup role (без `*` host/user):

```text
127.0.0.1:5432:financemax_production:financemax_backup:ACTUAL_PASSWORD
```

После install и создания файлов:

```powershell
. 'C:\ProgramData\FinanceMAX\Automation\common.ps1'
$backupAccount = "$env:COMPUTERNAME\financemax_backup_os"
$readers = @{'NT SERVICE\FinanceMAX'='ReadAndExecute'}
$readers[$backupAccount] = 'ReadAndExecute'
Set-FmAcl 'C:\ProgramData\FinanceMAX\Automation' $readers
$backupWrite = @{}; $backupWrite[$backupAccount] = 'Modify'
Set-FmAcl 'D:\FinanceMAXBackups' $backupWrite
Set-FmAcl 'C:\ProgramData\FinanceMAX\Logs\Backup' $backupWrite
$backupRead = @{}; $backupRead[$backupAccount] = 'Read'
Set-FmAcl 'C:\ProgramData\FinanceMAX\Secrets\backup.pgpass' $backupRead
```

App service не получает read backup root. У отдельных дочерних папок Incoming/Verified/PreUpdate можно снять backup-account write по политике; тогда плановый Daily продолжает работать, а PreUpdate выполняет admin. Проверить ACL всех уже существовавших файлов: изменение parent не снимает их protected DACL. Backup script не повышает права и не меняет ACL во время планового задания; он опирается на заранее защищённые directories. Это позволяет работать без Administrator. Не запускать если volume не NTFS или наследование создаёт Everyone/Users read.

## 4. Task Scheduler

Install создаёт только `Deployments\backup-task.xml`, **не регистрирует и не запускает task**, поскольку нужен отдельный credential. Перед регистрацией проверить action/path/principal/time, отсутствие существующего FinanceMAX-Backup. Пароль task попадает в защищённое хранилище Windows Task Scheduler, не в XML/config; используемый API требует кратковременную строку в памяти. Не включать transcript/debug печать.

```powershell
$taskName = 'FinanceMAX-Backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Задание уже существует — сначала review' }
$credential = Get-Credential -UserName "$env:COMPUTERNAME\financemax_backup_os" -Message 'Учётная запись планового backup'
$taskXml = Get-Content -LiteralPath 'C:\ProgramData\FinanceMAX\Deployments\backup-task.xml' -Raw
try {
    Register-ScheduledTask -TaskName $taskName -Xml $taskXml -User $credential.UserName -Password $credential.GetNetworkCredential().Password | Out-Null
} finally { Remove-Variable credential }
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
```

Дождаться завершения: LastTaskResult=0 и свежий dump+hash; сам Start-ScheduledTask успех backup не подтверждает. RunLevel Limited; запуск независимо от interactive session, StartWhenAvailable, IgnoreNew, limit 4h. Время `BackupTime` — локальное серверное, default 02:00. Изменение timezone/DST требует проверки. UTC имена не зависят от локального времени. Продолжительность >4h или регулярные ошибки требуют пересмотра SLA/размера storage. Не увеличивать timeout бесконечно вместо диагностики.

## 5. Поведение backup script и retention

Алгоритм: эксклюзивный file lock → pg_dump в `.part` → ненулевой размер → `pg_restore --list` → SHA256 → rename на том же volume → публикация sidecar как completion marker. Ошибка не запускает rotation; `.part` остаётся для разбора, не считается успешным backup. Файлы и дочерние процессы не получают пароль через command line: libpq читает PGPASSFILE.

Daily: последние 7 файлов; Weekly: воскресные UTC копии, последние 4; Monthly: первое UTC число месяца, последние 12. Это retention **копий**, не гарантия 7 календарных суток при ручных повторных запусках. Не запускать Daily многократно вместо тестов; PreUpdate отдельно. Если weekly/monthly запуск пропущен, alert и ручной recovery copy с реальной датой; не придумывать прошлую дату. Проверенные долгосрочные пары помещать в Verified вместе с кодом и протоколом; они и PreUpdate не удаляются скриптом. Привести периодичность к согласованным RPO/RTO (например, до 24h потери при daily), если компании требуется меньше — изменить расписание/retention после review.

Retention удаляет только имена точного шаблона в конкретной tier directory, проверяет sidecar перед удалением, не использует recursion/CASCADE. Не хранить посторонние данные в backup directories. Отдельная encrypted off-site копия запускается принятой компанией системой под отдельным credential; не помещать её ключ в этот пакет. Мониторинг off-site обязателен, скрипт его не имитирует.

## 6. Полный restore-test в отдельную БД

Проводить до первого переноса, до обновления для конкретного PreUpdate dump и регулярно минимум ежемесячно. Для текущего update writer уже остановлен. Выбрать **совместимый code SHA из manifest dump**. Старую копию нельзя сравнивать с произвольной новой schema после несовместимой миграции.

Подготовить admin-only `maintenance.pgpass` для migrator и `restore-admin.pgpass` для postgres. Добавить точный temporary DB tuple на время теста; не ослаблять HBA. В env vars ниже пароль отсутствует. Не печатать вывод DB URL. `PGOPTIONS` и прежние значения окружения контролируются через helper.

```powershell
. 'C:\ProgramData\FinanceMAX\Automation\common.ps1'
$cfgPath = 'C:\ProgramData\FinanceMAX\Automation\config.psd1'
$c = Read-FmConfig $cfgPath
$dump = 'D:\FinanceMAXBackups\PreUpdate\REVIEWED_FILE.dump'
Test-FmBackupPair $dump
$tempDb = 'financemax_restore_test_' + [datetime]::UtcNow.ToString('yyyyMMddHHmmss')
if ($tempDb -notmatch '^financemax_restore_test_\d{14}$' -or $tempDb -eq $c.Database) { throw 'Небезопасная test DB' }
$adminEnv = @{PGHOST='127.0.0.1';PGPORT=[string]$c.PostgresPort;PGUSER='postgres';PGDATABASE='postgres';PGPASSFILE=(Join-Path $c.DataRoot 'Secrets\restore-admin.pgpass');PGPASSWORD=$null;PGOPTIONS=$null}
Invoke-FmEnvironment $adminEnv {
    # Ошибка если DB существует: не использовать IF EXISTS/drop перед CREATE.
    $null = Invoke-FmNative (Join-Path $c.PgBin 'createdb.exe') @('-w','--owner=financemax_migrator','--template=template0',$tempDb)
    $null = Invoke-FmNative (Join-Path $c.PgBin 'pg_restore.exe') @('-w','--dbname',$tempDb,'--no-owner','--no-acl','--role=financemax_migrator','--single-transaction','--exit-on-error',$dump)
}
# Выставить locale/encoding в createdb как у source, если template0 defaults отличаются.
```

При ошибке сохранить temporary DB и логи только в admin-каталоге; не продолжать production restore. Не `drop --force`. После restore применить в temporary DB reviewed grants из deployment (включая GRANT CONNECT), т. к. `--no-acl` не восстанавливает их. Не менять реальные role passwords ради теста. Проверка schema/данных:

```powershell
$testConfig = $c.Clone(); $testConfig.Database = $tempDb
Invoke-FmGrants $testConfig
$values = Read-FmEnv (Join-Path $c.DataRoot 'Secrets\migration.env')
foreach ($key in @('DATABASE_URL','MIGRATION_DATABASE_URL')) {
    $builder = [UriBuilder]::new($values[$key]); $builder.Path=$tempDb
    $values[$key]=$builder.Uri.AbsoluteUri
}
Assert-FmDbEnv $testConfig $values 'financemax_migrator'
Invoke-FmPrismaCheck $testConfig $values
$counts = Assert-FmDatabase $testConfig # -Initial только для исходной пустой production baseline
$counts | ConvertTo-Json
```

У maintenance.pgpass должна быть запись для tempDb. Prisma diff=0 **не проверяет все PostgreSQL custom triggers/functions**: дополнительно сравнить с baseline источника список `pg_constraint` с `pg_get_constraintdef`, `pg_trigger` с `pg_get_triggerdef` (включая enabled), нужные `pg_proc` определения, counts всех public tables. Валидные FK и успешный transaction restore исключают обычные orphan references; дополнительно сопоставить business ledger totals/accepted versions по интерфейсу на изолированной копии. Пример read-only metadata SQL:

```sql
SELECT conrelid::regclass::text,conname,contype,convalidated,pg_get_constraintdef(oid)
FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2;
SELECT t.tgrelid::regclass::text,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY 1,2;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1,2,3;
SELECT id,name,email,role,active,demo FROM "User" ORDER BY id;
SELECT id,"userId" FROM "Partner" ORDER BY id;
```

Metadata/ID baseline хранить защищённо, не в Git. Все public tables counts получить в psql, не вручную перечислять только десять начальных:

```sql
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;',tablename,schemaname,tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
```

На **отдельном временном app instance** со своей HTTPS origin/runtime env/портом проверить чтение восстановленных данных, финансовые totals и XLSX в зависимости от стадии эксплуатации. Не подключать основной service к test DB, не давать офисным пользователям вводить туда данные. Если такие функциональные проверки не сделаны, отразить это в протоколе, не ставить dataValidated=true без достаточного baseline.

Лишь после успешной сверки оператор создаёт протокол для update (это **явная подпись администратора**, не независимое доказательство, сгенерированное скриптом):

```powershell
$proof = [ordered]@{
    utc=[datetime]::UtcNow.ToString('o')
    dumpSha256=(Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash
    codeSha=(Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'rev-parse','HEAD')).Trim()
    temporaryDatabase=$tempDb
    result='PASS'
    schemaDiffZero=$true
    dataValidated=$true
    operator=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    baselineEvidence='PATH_TO_REVIEWED_COUNTS_AND_METADATA'
}
$proofPath = Join-Path $c.DataRoot ('Deployments\restore-test-' + [datetime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')
$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
# Сохранить dump+sidecar+manifest в Verified/off-site прежде чем чистить test DB.
if ($tempDb -notmatch '^financemax_restore_test_\d{14}$' -or $tempDb -eq $c.Database) { throw 'Удаление запрещено' }
if ((Read-Host "Удалить только проверенную temporary DB $tempDb ? Введите её имя") -ne $tempDb) { throw 'База сохранена' }
Invoke-FmEnvironment $adminEnv { $null = Invoke-FmNative (Join-Path $c.PgBin 'dropdb.exe') @('-w',$tempDb) }
```

Не копировать блок с PASS до завершения проверок. Удаление только явно названной temporary DB, без force/termination. Удалить временные HBA/pgpass разрешения после теста. Не удалять последнюю подтверждённую копию.

## 7. Restore в production впервые

После успешного temp restore убедиться, что целевая production БД **пуста** (нет public tables) и владелец migrator; её locale совместим с source. Основной service остановлен. С теми же pgpass/admin env выполнить `pg_restore` с `--dbname financemax_production --no-owner --no-acl --role=financemax_migrator --single-transaction --exit-on-error`. Никакого `--clean`. Если есть таблицы, **STOP**, не удалять их автоматически. Затем применить grants и выполнить source baseline/Initial counts, Prisma status/diff, FK/triggers metadata comparison. Пароли и пользователи приложения приходят из dump без пересоздания. Перед стартом только целевой writer получает разрешение; source архивируется read-only.

## 8. Восстановление после аварии

Остановить writer, сохранить повреждённую БД и журналы, выбрать последнюю verified backup + совместимый SHA. Создать **новую** `financemax_recovery_<timestamp>`, восстановить/сверить, применить grants, обновить обе DB URL в runtime.env/migration.env, Database в обоих config и все pgpass/HBA tuples. Переназначить backup на recovery name **до открытия ввода** и создать первую копию. Код откатить только совместимо; процедура в [rollback](FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md).

Сверить операции между timestamp backup и аварией по первичке: банк/касса, withdrawals/receipts/fees, выплаты сотрудников/партнёров, командировки, accepted calculation versions и reconciliation approvals. Потерю записей после backup признать явно и восполнять через штатные audited операции; не ручным SQL и не автоматическим повтором всех платежей. Определить RPO/RTO из фактического теста, не обещать «нулевую потерю». Ответственный за backup проверяет успех ежедневно, restore — по графику и после инфраструктурных изменений.
