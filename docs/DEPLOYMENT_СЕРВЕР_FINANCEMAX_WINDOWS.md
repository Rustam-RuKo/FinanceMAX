# FinanceMAX — установка на Windows Server

Для Windows Server. Linux инструкция находится отдельно и не применяется буквально.

Дата подготовки: 10.10.2026. Читатель — системный администратор компании. Цель — перенести существующую production-базу и запустить FinanceMAX внутри офиса. Этот пакет не выполняет deployment на текущем компьютере. Финансовые формулы, код приложения, schema, 12 миграций, пользователи и password hashes не изменяются.

Связанные инструкции: [backup/restore](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md), [обновление/rollback](FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md), [чек-лист](FINANCEMAX_SERVER_CHECKLIST_WINDOWS.md), [проверки пакета](windows-deployment-readiness.md). Предыдущая [Linux-инструкция](DEPLOYMENT_СЕРВЕР_FINANCEMAX.md) сохранена.

## 1. Архитектура

Офисный браузер → внутренний DNS → HTTPS IIS 10 → ARR 3 / URL Rewrite 2.1 → `127.0.0.1:3000` Next.js → `127.0.0.1:5432` PostgreSQL 18. Private GitHub используется только администратором для доставки кода. Доступ из WAN, port forwarding и VPN не настраиваются. Не применять IISNode, PM2 или Task Scheduler для постоянного процесса приложения.

Основная ОС — **Windows Server 2022 или 2025 x64**. В коде FinanceMAX нет зависимости от конкретного выпуска Server. PostgreSQL указывает оба выпуска для installer 18; Node 22 поддерживает Windows x64. Это целевой диапазон, а не результат выполненного серверного теста. Проверка установщика допускает build 20348/26100 и отвергает клиентскую Windows.

Выбран IIS: он соответствует компетенциям администратора; официальный сайт Microsoft публикует ARR 3 с поддержкой IIS 10. Это зрелое расширение с отдельным жизненным циклом, не встроенный новый компонент Server. Нельзя из наличия документации делать вывод о поддержке любой комбинации MSI/политик. Проверить установку, headers и HTTPS на целевой VM. Если политика компании запрещает ARR, сначала согласовать отдельный вариант proxy (например, Caddy); этот пакет не смешивает два варианта. [ARR](https://www.iis.net/downloads/microsoft/application-request-routing), [пример reverse proxy Microsoft](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing).

Служба — **WinSW 2.12.0, .NET Framework вариант** и виртуальный аккаунт `NT SERVICE\FinanceMAX`. У Windows есть автоматически управляемые virtual accounts: отдельный пароль в XML не нужен. WinSW сначала регистрируется остановленным как LocalService, затем установщик меняет identity через SCM на виртуальную, и только позже администратор запускает службу. Не запускать wrapper вручную до этого переключения. Не использовать экспериментальную WinSW 3 или сборку, требующую неподдерживаемого .NET 7. [WinSW releases](https://github.com/winsw/winsw/releases), [учётные записи служб Microsoft](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-service-accounts).

## 2. Предварительные условия

У администратора: персональная административная учётная запись, консоль VM/физического сервера, утверждённое окно переноса, доступ к private repository, внутренний DNS и сертификат с SAN на выбранное имя. Не передавать общий Administrator всему персоналу.

| Компонент | Требование |
|---|---|
| ОС | Windows Server 2022/2025 x64, актуальные обновления |
| Node | 22.x, официальный x64 MSI, точный patch фиксируется в протоколе |
| Next / Prisma | lockfile: Next 16.3.6, Prisma 6.19.0; `npm ci`, не `npm update` |
| PostgreSQL | 18.x, EDB installer по ссылке PostgreSQL; точный patch в протоколе |
| PowerShell | Windows PowerShell 5.1 x64; локальная проверка синтаксиса выполнена на нём |
| Proxy | IIS 10, URL Rewrite 2.1, ARR 3; HTTPS certificate в LocalMachine\My |
| Service | Проверенный WinSW 2.12.0 .NET Framework executable, локальный SHA256 |
| Git | Git for Windows и Windows OpenSSH Client |

Параметры сети — только значения администратора, не брать их из примеров. При AD использовать корпоративную DNS-зону и AD CS. `.office.local` — лишь пример, не требование; при возможности выбрать поддомен принадлежащего компании домена, согласованный с DNS-политикой.

## 3. Подготовка Windows и каталогов

Для Hyper-V: Generation 2 VM, Secure Boot, начальные **4 vCPU / 8 GB RAM / 100 GB SSD/VHDX**. Это стартовая оценка, не жёсткий минимум. Fixed/dynamic VHDX — по политике администратора; оставить запас для npm build, БД и dump. Статический или зарезервированный LAN IP. Host backup/checkpoint дополняет, но не заменяет PostgreSQL dump. На физическом Server остальные шаги те же.

| Каталог | Содержание / доступ |
|---|---|
| `C:\FinanceMAX\App` | Git-код, dependencies, build; admin write, service read/execute |
| `C:\ProgramData\FinanceMAX\Automation` | Проверенная копия скриптов и несекретный config |
| `…\Secrets` | runtime.env, migration.env, pgpass; индивидуальные ACL |
| `…\SSH` | deploy key, known_hosts; только deployment admin + SYSTEM |
| `…\Service` | WinSW exe/XML; service read, admin write |
| `…\Proxy` | IIS web.config; app pool read, admin write |
| `…\Logs\App`, `…\Temp` | service Modify |
| `…\Logs\Backup`, `…\Deployments` | backup log / deployment records |
| `D:\FinanceMAXBackups` | отдельный volume предпочтителен; настраивается, вне App/DataRoot |

Не размещать данные на Desktop/Documents или в Git. Скрипты отвергают вложенные App/DataRoot/BackupRoot, UNC и reparse point в пути. NAS используется для отдельной защищённой копии, не как рабочий каталог скрипта. Корневые ACL устанавливаются только в выделенных FinanceMAX-каталогах; не указывать существующий общий каталог компании.

Запускать unsigned пакет только после проверки и согласно execution policy компании. Не отключать execution policy глобально; предпочтительно внутреннее code signing. Изменение подписи после редактирования config/скриптов требует повторной подписи по вашей политике.

Установить роль IIS и инструменты вручную в согласованное окно (команды ниже здесь **не выполнялись**):

```powershell
Install-WindowsFeature Web-Server,Web-Mgmt-Console,Web-Scripting-Tools -IncludeManagementTools
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
Get-WindowsFeature Web-Server
Get-Command ssh.exe,git.exe
```

Не устанавливать OpenSSH Server без необходимости. Проверить Defender/EDR; не отключать его ради npm. Исключения допускает только политика безопасности. На domain-joined Server проверить GPO: сертификаты, firewall, Log on as a service / batch job, запрет интерактивного входа service accounts. gMSA возможен отдельной адаптацией администратора, но основной пакет рассчитан на standalone virtual service + отдельную local backup account.

## 4. GitHub deploy key и получение пакета

Repository: `git@github.com:Rustam-RuKo/FinanceMAX.git`. Утверждённый исходный commit: `8ddbd94f7684679094dd2020f8f45a136bdbd2d2`. Не использовать автоматически плавающий `main`: ExpectedCommit — полный SHA после review. На момент подготовки пакет Windows **локальный и игнорируется действующим Git manifest**, в GitHub не добавлен. Передать весь `scripts/windows` отдельно защищённым каналом в staging, сверить локальный manifest SHA256 из отчёта. Либо позже отдельно проверить и утвердить публикацию пакета; это не выполнено текущим заданием.

Создать выделенные каталоги и ограничить доступ до генерации key. Пример с SID не зависит от языка Windows:

```powershell
$root = 'C:\ProgramData\FinanceMAX'
New-Item -ItemType Directory -Path "$root\SSH" -Force | Out-Null
icacls.exe "$root\SSH" /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'ACL не применён' }
ssh-keygen.exe -t ed25519 -f "$root\SSH\github_financemax" -C 'FinanceMAX-read-only-deploy'
```

Для unattended git этот ключ может не иметь passphrase: тогда его ACL и read-only scope особенно важны. Выбор утверждает администратор; никакой passphrase не в скрипте. На GitHub добавить **только `.pub`** в repository Settings → Deploy keys, **Allow write access выключен**. App virtual account ключ не получает. Не использовать PAT в URL или password.

Host key: получить candidate `ssh-keyscan -t ed25519 github.com`, записать во временный файл, вычислить `ssh-keygen -lf candidate`, отдельно сравнить SHA256 с [официальными fingerprints GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). `ssh-keyscan` сам по себе не устанавливает доверие. Лишь после сравнения перенести в `SSH\known_hosts`, назначить ACL admin/SYSTEM. Установщик всегда использует `StrictHostKeyChecking=yes`, `IdentitiesOnly=yes`, `BatchMode=yes` и именно этот файл. Не использовать `StrictHostKeyChecking=no`.

```powershell
$candidate = 'C:\ProgramData\FinanceMAX\SSH\known_hosts.candidate'
ssh-keyscan.exe -t ed25519 github.com 2>$null | Set-Content -LiteralPath $candidate -Encoding Ascii
ssh-keygen.exe -lf $candidate
# Только после независимого сравнения fingerprint:
Move-Item -LiteralPath $candidate -Destination 'C:\ProgramData\FinanceMAX\SSH\known_hosts'
```

## 5. Node.js

Скачать актуальный согласованный **22.x x64 MSI** с [официальной страницы Node 22](https://nodejs.org/en/download/archive/v22). Проверить Authenticode/издателя и опубликованные checksums. Не брать старый patch из примера и не использовать пользовательский nvm как production dependency. Установить в `C:\Program Files\nodejs`, вновь открыть PowerShell. Записать вывод версии и SHA256 MSI в deployment record.

```powershell
Get-AuthenticodeSignature -FilePath 'C:\Install\node-v22.PATCH-x64.msi'
Get-FileHash -LiteralPath 'C:\Install\node-v22.PATCH-x64.msi' -Algorithm SHA256
& 'C:\Program Files\nodejs\node.exe' --version
& 'C:\Program Files\nodejs\npm.cmd' --version
```

`PATCH` заменить. Установщик пакета проверяет major 22 и фиксирует точный patch; не скачивает и не устанавливает MSI самостоятельно. [Платформы Node 22](https://github.com/nodejs/node/blob/v22.x/BUILDING.md).

## 6. PostgreSQL 18: установка, сеть, роли

Использовать [Windows installer EDB по официальной ссылке PostgreSQL](https://www.postgresql.org/download/windows/). Выбрать 18.x x64; проверить подпись, зафиксировать minor и SHA256. Installer поддерживает Server 2022/2025. Задать уникальный postgres admin password в защищённом вводе, не в automation/config. `postgres` — административная **DB role**, не identity FinanceMAX. DB service обычно `postgresql-x64-18`; точное имя, data directory и порт внести в протокол. PGDATA, например `D:\PostgreSQL\18\data`, получает права только PostgreSQL service identity и администратора, не FinanceMAX.

В `postgresql.conf`: `listen_addresses = '127.0.0.1'`, `port = 5432`, `password_encryption = 'scram-sha-256'`. В `pg_hba.conf` разрешить только нужные роли/БД с `127.0.0.1/32 scram-sha-256`; maintenance postgres только loopback, backup только production; temporary restore names допускаются только на время теста. Не добавлять LAN CIDR, `trust`, `0.0.0.0/0`. Удалять/менять широкие правила только после review существующих consumers. Перезапуск PostgreSQL для listen_addresses — в окно, не общей БД другой системы.

```powershell
Get-Service 'postgresql-x64-18'
Get-NetTCPConnection -State Listen -LocalPort 5432 | Select-Object LocalAddress,LocalPort,OwningProcess
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

В интерактивном psql создать роли **один раз**, после проверки отсутствия конфликтующих ролей. Пароли назначить `\password`, не SQL-литералом и не command line:

```sql
CREATE ROLE financemax_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE financemax_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE financemax_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
\password financemax_migrator
\password financemax_runtime
\password financemax_backup
CREATE DATABASE financemax_production OWNER financemax_migrator TEMPLATE template0 ENCODING 'UTF8';
REVOKE ALL ON DATABASE financemax_production FROM PUBLIC;
GRANT CONNECT ON DATABASE financemax_production TO financemax_runtime,financemax_backup;
```

Кодировка/locale provider/collation должны соответствовать исходной БД; получить `pg_database` metadata до CREATE. Если вышеописанный default Windows locale отличается, **остановиться и выбрать source-compatible locale/ICU по поддержке PostgreSQL**, не менять сортировку незаметно. `CREATE DATABASE` не выполнять в transaction block. Не предоставлять runtime членство в migrator или владение schema/таблицами. Имена recovery DB обновляются согласованно в config/env/pgpass/HBA/backup.

## 7. Перенос существующей production DB

Полный порядок команд — в [backup/restore](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md). Сначала остановить исходное приложение и исключить все другие writers; зафиксировать baseline. Custom dump → SHA256 → `pg_restore --list` → защищённая передача → **полный restore-test в отдельную БД** → восстановление в пустую `financemax_production` с `--no-owner --no-acl --role=financemax_migrator --single-transaction --exit-on-error` → grants → counts/migrations/diff. Не использовать `--clean`, `--disable-triggers` или restore поверх существующих данных.

| Начальная таблица | Строк |
|---|---:|
| User / Partner | 5 / 2 |
| Employee / Project / Season / WorkEntry | 0 / 0 / 0 / 0 |
| AuditSectionTemplate | 66 |
| PaymentCategory / ExpenseCategory / LedgerAccount | 5 / 2 / 4 |
| Завершённые миграции | 12 |
| User demo=true | 0 |

AuditLog может быть >0. Подтвердить, что каждый из пяти логинов существует ровно один раз, активен, связан с правильной ролью/Partner; сравнить ID и связи с source baseline. Не выводить passwordHash. Initial counts действительны **до начала реального ввода**, затем использовать baseline на дату backup. Если source уже содержит реальные операции, не удалять их ради таблицы выше: остановить первый перенос и согласовать новый baseline. Скрипт `-Initial` намеренно блокирует расхождение.

После restore подключиться как migrator к целевой БД и применить:

```sql
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM financemax_runtime;
GRANT USAGE ON SCHEMA public TO financemax_runtime,financemax_backup;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO financemax_runtime;
GRANT DELETE ON "Session" TO financemax_runtime;
REVOKE ALL ON "_prisma_migrations" FROM financemax_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO financemax_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO financemax_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE financemax_migrator IN SCHEMA public GRANT SELECT ON TABLES TO financemax_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE financemax_migrator IN SCHEMA public GRANT SELECT ON SEQUENCES TO financemax_backup;
COMMIT;
```

Backup role не получает write/DDL и отличается от runtime, которому закрыты migration metadata. Runtime DELETE только Session. UUID в текущей schema не требуют runtime sequence privileges. Каждое обновление повторяет grants после миграций. Не запускать `npm run db:runtime`: существующий скрипт пишет `.env` в app tree и рассчитан на другой maintenance процесс. Не запускать seed/bootstrap/create-admin на перенесённой БД.

## 8. Секреты и ACL

Практический формат — UTF-8 файлы вне Git, защищённые NTFS ACL. Это plaintext на диске, а не шифрование; включить BitLocker/защиту server backups по политике. `runtime.env` читают Administrators, SYSTEM и `NT SERVICE\FinanceMAX`; `migration.env` и `maintenance.pgpass` — только admin/SYSTEM; `backup.pgpass` — admin/SYSTEM и отдельный backup account. FinanceMAX service не получает доступ к migrator, dump, deploy key.

`Secrets\runtime.env` (заменить placeholders локально; строки без кавычек):

```dotenv
NODE_ENV=production
FINANCEMAX_ENV=production
DATABASE_URL=postgresql://financemax_runtime:URL_ENCODED_PASSWORD@127.0.0.1:5432/financemax_production
MIGRATION_DATABASE_URL=postgresql://financemax_runtime:URL_ENCODED_PASSWORD@127.0.0.1:5432/financemax_production
APP_ORIGIN=https://FINANCEMAX_HOSTNAME
TRUST_PROXY=true
```

Обе runtime URL содержат **runtime**, не migrator: Prisma directUrl должен быть задан, но повышенный секрет приложению не нужен. `migration.env` имеет те же шесть ключей, обе URL — migrator. Percent-encode username/password URI-компоненты (`:`, `@`, `%`, `#` и т. п.), не весь URL. Парсер не выполняет код, не разворачивает `$`, не принимает произвольные env keys. FINANCEMAX_ENV — marker production safety scripts, не новая финансовая настройка. Нет SESSION_SECRET/AUTH_SECRET в текущем коде. Не добавлять ADMIN_*, DEMO_*, PRODUCTION_SOURCE_DATABASE_URL в runtime.

APP_ORIGIN точно равен browser origin: HTTPS, hostname, нестандартный порт при наличии, **без завершающего `/`**. Значение строится из Hostname/HttpsPort config и проверяется. Secure cookie в production делает HTTP непригодным для рабочего входа.

После регистрации службы создать env через защищённый редактор администратора и применить ACL. Не включать ввод секретов в PowerShell transcript:

```powershell
. 'C:\ProgramData\FinanceMAX\Automation\common.ps1'
Set-FmAcl 'C:\ProgramData\FinanceMAX\Secrets'
Set-FmAcl 'C:\ProgramData\FinanceMAX\Secrets\runtime.env' @{'NT SERVICE\FinanceMAX'='Read'}
Set-FmAcl 'C:\ProgramData\FinanceMAX\Secrets\migration.env'
Set-FmAcl 'C:\ProgramData\FinanceMAX\Secrets\maintenance.pgpass'
Get-Acl -LiteralPath 'C:\ProgramData\FinanceMAX\Secrets\runtime.env' | Format-List Owner,AccessToString
```

Не выводить содержимое env. Service traverse унаследован от обычных Windows bypass-traverse прав; если доменная политика его ограничила, выдать только Traverse на parents, не read всех Secrets. `Set-FmAcl` заменяет DACL только указанного объекта; проверить дочерние файлы с защищёнными старыми ACL отдельно.

## 9. Config и первая сборка

В переданном staging-каталоге скопировать `config.example.psd1` → `config.psd1`. Заполнить Hostname, OfficeLanCidr, AdminNetwork, BackupRoot, PostgreSQL service/paths/port, BackupTaskUser в форме `.\financemax_backup_os`, SHA256 проверенного WinSW. Пример не запускается до замены placeholders. Основной сценарий — частная IPv4 LAN; для IPv6 нужна отдельная проверенная firewall/DNS схема. `EnableFirewallRule=$false` по умолчанию.

```powershell
& 'C:\Install\FinanceMAX-Windows\install-financemax.ps1' -ConfigPath 'C:\Install\FinanceMAX-Windows\config.psd1' -DryRun
# После проверки плана, подготовки prerequisites и deploy key:
& 'C:\Install\FinanceMAX-Windows\install-financemax.ps1' -ConfigPath 'C:\Install\FinanceMAX-Windows\config.psd1'
```

Установщик проверяет Administrator, Windows Server, Node/PG/Git/OpenSSH и WinSW hash; создаёт только выделенные каталоги; clone если отсутствует; проверяет origin, clean tree, полный SHA и отсутствие `.env`; выполняет npm ci, Prisma generate, next typegen, tsc, production build; регистрирует остановленную службу; сохраняет IIS template и backup task XML; пишет install record. Сборка использует **нерабочую build-only URL на loopback port 1**, чтобы вообще не читать production DB. При ошибке build остановиться и исследовать offline; не подставлять production secret в сборку автоматически.

Установщик не выполняет миграции/restore, не создаёт пользователей БД, не устанавливает MSI, не изменяет IIS. Если `EnableFirewallRule=true`, отдельно просит `LAN-HTTPS`; правило только Domain/Private и заданная LAN. Прочие firewall rules не правит.

Повторный запуск допускает только ту же остановленную службу/identity/path и совпадающие generated files; отличия блокируются. Это fail-safe повторяемость, а не обещание полностью повторного apply без побочных действий: npm ci/build повторяются; существующее firewall rule требует ручного review. Не использовать install вместо update. В конце:

```powershell
git.exe -C 'C:\FinanceMAX\App' status --short
git.exe -C 'C:\FinanceMAX\App' rev-parse HEAD
```

## 10. Windows Service

WinSW executable и XML с одинаковым basename в `Service`. Не хранить секреты в XML. Service запускает Windows PowerShell без профиля, который читает строго разрешённый env и вызывает установленный Node напрямую:

```text
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

Это соответствует package.json `npm start`, дополнено явным портом. Working directory — App. Automatic delayed start, dependency PostgreSQL, restart 15 sec, stop timeout 60 sec. Проверить завершение всего дерева при Stop-Service; оставшийся 3000 listener блокирует update. Wrapper logs ограничены по размеру. Service может писать только `.next`, App logs и Temp. Не выдавать Modify всему исходному коду/Automation. После npm build перепроверить права на `.next`.

```powershell
Get-CimInstance Win32_Service -Filter "Name='FinanceMAX'" | Select-Object Name,State,StartMode,StartName,PathName
# Ожидается NT SERVICE\FinanceMAX. Запуск — только после следующих разделов.
```

## 11. IIS, HTTPS и доверенные headers

Скачать URL Rewrite 2.1 и ARR 3 только с официальных страниц Microsoft; проверить подписи. Установить вручную, не через снятый с эксплуатации Web Platform Installer. Сертификат компании/AD CS/private CA: SAN = выбранное DNS-имя, Server Authentication, действующий срок и цепочка доверия на сервере и клиентских ПК. Импортировать PFX в `Cert:\LocalMachine\My` интерактивно:

```powershell
$pfxPassword = Read-Host 'Пароль PFX' -AsSecureString
Import-PfxCertificate -FilePath 'C:\SecureTransfer\financemax.pfx' -CertStoreLocation 'Cert:\LocalMachine\My' -Password $pfxPassword | Select-Object Thumbprint,Subject,NotAfter
Remove-Variable pfxPassword
```

Не указывать `-Exportable` без необходимости. Через certlm.msc → Manage Private Keys проверить доступ только нужного системного контекста HTTP.sys/IIS и admin; Node service TLS key не нужен. Защищать исходный PFX, root CA private key никогда не переносить на app server. На клиентах установить доверие к корпоративной/private CA по политике, не отключать TLS validation.

IIS Manager: сохранить configuration backup, включить ARR server proxy, `preserveHostHeader=true`. Это server-wide настройки: проверить другие сайты до изменения. Добавить allowed server variables **только для FinanceMAX site**: `HTTP_X_FORWARDED_FOR`, `HTTP_X_FORWARDED_PROTO`. Сайт отдельный, physical path `…\Proxy`, отдельный app pool No Managed Code; anonymous authentication использует app pool identity. Выдать `IIS AppPool\FinanceMAX` ReadAndExecute на Proxy. Не останавливать Default Web Site или чужие sites.

Создать сайт сразу с **единственным HTTPS binding** `*:HTTPS_PORT:HOSTNAME`, SNI, выбранный сертификат; HTTP binding не создавать. В GUI это безопаснее автоматического default `New-Website` на 80. Убедиться, что hostname/port не заняты. Из установленного `Proxy\web.config` правило отклоняет не-HTTPS и перезаписывает XFF из `REMOTE_ADDR`, XFP=`https`, затем маршрутизирует на loopback. Для allowed variables можно использовать Configuration Editor для location FinanceMAX; не разрешать arbitrary variables глобально.

ARR может добавлять свой hop в XFF. Приложение берёт **первый** элемент; после overwrite первым должен быть реальный IP клиента, а не присланный клиентом. До допуска проверить запрос с поддельным XFF: на временном диагностическом loopback backend в maintenance подтвердить фактические Host/XFF/XFP, затем убрать диагностический backend и вернуть FinanceMAX. Не добавлять debug endpoint в приложение и не писать cookie/Authorization в tracing. Проверить effective parent/global rewrite rules: raw web.config не доказывает порядок pipeline. Этот живой тест не выполнен при подготовке.

IIS/ARR caching: отключить disk/server farm cache для FinanceMAX, output/kernel cache отключены в template. Не кешировать auth/dashboard/XLSX. Не переписывать Set-Cookie, Origin или response content. Настроить разумный proxy timeout для XLSX и допустимый request limit, проверить реальные отчёты без уменьшения лимитов приложения. WebSockets нужны только при появлении такой функции, не ради dev HMR. [Server variables Microsoft](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/url-rewrite-module-configuration-reference).

## 12. Windows Firewall и DNS

Назначить DNS A-запись на внутренний IP через AD DNS/Windows DNS/router. hosts file допустим только временно. Не выдавать AAAA, если IPv6 доступ ещё не проверен. Установить правильный сетевой профиль Domain/Private. Не открывать WAN и router port forwarding. До любого изменения RDP/WinRM обеспечить консоль; пакет не изменяет admin access.

```powershell
$officeCidr = 'OFFICE_LAN_CIDR' # заменить на согласованный частный IPv4 CIDR
New-NetFirewallRule -Name 'FinanceMAX-LAN-HTTPS' -DisplayName 'FinanceMAX LAN HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress $officeCidr -Profile Domain,Private
Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction
Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Get-NetFirewallPortFilter
```

Не выполнять New-NetFirewallRule повторно, если правило создано install. Для нестандартного HTTPS port взять config.HttpsPort. 80 закрыт. 3000/5432 не должны иметь внешних Allow и слушают loopback. Default inbound Block и отсутствие других более широких разрешений обязательны: узкое правило само по себе не отменяет широкое IIS installer/GPO rule. Проверить также диапазоны портов, service/program filters и IPv6. Не вводить общий Block для 443 — явный Block перекроет LAN Allow. RDP/WinRM/SSH ограничивает admin network через согласованную GPO/консольную процедуру; не менять их вслепую.

## 13. Первый запуск

Перед запуском завершить restore/test, grants, secrets ACL, IIS certificate/header checks, firewall, backup account/task. Выполнить первый backup и проверить task result. Если компания пока не разрешает пользователей, ограничить 443 до приёмочного рабочего места. Зафиксировать source writer stopped и отсутствие двойного ввода.

```powershell
Start-Service FinanceMAX
Get-Service FinanceMAX
Get-NetTCPConnection -State Listen -LocalPort 3000,5432
Invoke-WebRequest 'https://FINANCEMAX_HOSTNAME/login' -UseBasicParsing
```

Не отключать Secure cookie/HTTPS ради обхода ошибки. На отдельном браузере проверить login одним существующим production account; пароль передаётся лично, не в deployment report. Смена существующих паролей/логинов — отдельная management операция, не installation step.

## 14. Проверка

```powershell
& 'C:\ProgramData\FinanceMAX\Automation\verify-financemax.ps1' -ConfigPath 'C:\ProgramData\FinanceMAX\Automation\config.psd1' -Initial
```

После реального ввода убрать `-Initial`; generic checks остаются, количества выводятся без персональных полей. Скрипт проверяет статус/identity, Node/SHA/clean tree, IIS/binding/certificate, raw proxy headers, локальные listeners, firewall признаки, runtime connection, миграции/diff, constraints/triggers/grants, counts/demo, backup task/latest hash, free disk и сигналы ошибок в logs. Он не логинится, не создаёт Session и не меняет бизнес-данные; HTTP GET создаёт обычные server access logs. Prisma status/diff — read-only, schema push не используется.

PASS скрипта — **не окончательная приёмка**. С отдельного офисного ПК проверить HTTPS trust/login/CSRF, management и partner pages, роли, download XLSX и открытие Excel, отсутствие чужих данных, stop/start/reboot. С другого сетевого сегмента убедиться, что HTTPS недоступен, 3000/5432 закрыты с LAN/WAN. Тестовые финансовые операции — только на отдельной копии, не в transferred production. Подробности в чек-листе. Отсутствующего health endpoint не выдумывать: `/login` 200 не доказывает DB/auth.

## 15. Backup

Следовать [отдельному руководству](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md). Daily 7 / Weekly 4 / Monthly 12; Verified и PreUpdate не ротируются автоматически. Task Scheduler, отдельный непривилегированный local backup account, pgpass с read-only DB role. Daily time — локальное время сервера из config (по умолчанию 02:00), имена файлов/протокол — UTC. Разницу timezone задокументировать. Off-site encrypted копия и регулярный restore-test обязательны; локальный dump не единственная стратегия.

## 16. Передача Собиру

Передать LAN URL, server/VM identity, deployed SHA, точные версии Node/Postgres/WinSW, дату/часовой пояс, backup location и schedule, restore-test protocol, ответственного администратора и обновления, подтверждение HTTPS/LAN-only/loopback PostgreSQL, незакрытые пункты приёмки. Пароли БД/ключи/хеши/токены в акт не включать. Открывать controlled pilot только после подписи чек-листа; старые финансовые расчёты автоматически не утверждать.

## 17. Диагностика и наблюдение

App/WinSW: `…\Logs\App`; backup: `…\Logs\Backup\backup.log`; IIS: `%SystemDrive%\inetpub\logs\LogFiles\W3SVC<id>`; PostgreSQL: каталог из `SHOW log_directory`, включённый logging collector по политике; Windows System/Application и TaskScheduler Operational. Читать локально, перед отправкой редактировать чувствительные данные. Скрипты не выводят native stderr с URL/паролями.

```powershell
Get-Service FinanceMAX,'postgresql-x64-18',W3SVC
Get-ScheduledTask -TaskName FinanceMAX-Backup | Get-ScheduledTaskInfo
Get-Content -LiteralPath 'C:\ProgramData\FinanceMAX\Logs\Backup\backup.log' -Tail 20
Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddHours(-24)} -MaxEvents 20 | Select-Object TimeCreated,Id,ProviderName
Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize
Get-PSDrive -PSProvider FileSystem
```

Ежедневно: службы, `/login`, backup freshness/task exit, диск и RAM. Еженедельно: events, off-site подтверждение, сертификат (предупреждение за 30 дней). Ежемесячно: restore-test и корректность retention. IIS 502 — Node/service/port; 500.50 — URL Rewrite allowed variables; 403 Origin — точный APP_ORIGIN/Host/HTTPS; cookie не сохраняется — HTTPS/trust; DB permission denied — grants/runtime role, не выдавать superuser; backup 1 — ACL/pgpass/место; Git SHA mismatch — новая версия требует review.

## 18. Запрещённые действия

Не публиковать сервер в интернет; не выставлять PostgreSQL/Node на `0.0.0.0`; не запускать FinanceMAX Administrator/LocalSystem; не хранить secrets в Git/App; не пересоздавать production users; не запускать demo/seed/reset/cleanup; не отключать constraints/triggers; не делать blind CASCADE; не выполнять тестовый restore поверх production; не выполнять git force/reset/clean; не изменять финансовые формулы или accepted-version model ради deployment. Наличие документов и syntax tests не заменяет серверную приёмку.
