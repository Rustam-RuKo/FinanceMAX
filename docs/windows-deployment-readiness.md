# FinanceMAX — готовность Windows deployment package

Дата: 10.10.2026. Область: только документы, PowerShell automation и безопасные локальные проверки. Никакого deployment на текущем компьютере или сервере. Финансовая логика, schema/migrations, production DB/users/password hashes, GitHub и исходный Git manifest не изменены.

## Состав пакета

| Файл | Назначение |
|---|---|
| [DEPLOYMENT_СЕРВЕР_FINANCEMAX_WINDOWS.md](DEPLOYMENT_СЕРВЕР_FINANCEMAX_WINDOWS.md) | 18 разделов установки и handover |
| [FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md) | Source transfer, Scheduler, retention, полный restore-test и recovery |
| [FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md](FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md) | Update, code rollback, new-DB recovery |
| [FINANCEMAX_SERVER_CHECKLIST_WINDOWS.md](FINANCEMAX_SERVER_CHECKLIST_WINDOWS.md) | Неотмеченный приёмочный checklist |
| [install-financemax.ps1](../scripts/windows/install-financemax.ps1) | Подготовка файлов/build/остановленной службы, шаблон IIS и backup task |
| [verify-financemax.ps1](../scripts/windows/verify-financemax.ps1) | Read-only проверки инфраструктуры и БД |
| [backup-financemax.ps1](../scripts/windows/backup-financemax.ps1) | Custom dump, TOC/hash, .part/rename, retention |
| [update-financemax.ps1](../scripts/windows/update-financemax.ps1) | Контролируемый update с backup/restore gate, ff-only, migrations и smoke |
| [config.example.psd1](../scripts/windows/config.example.psd1) | Только placeholders и утверждённый исходный SHA |
| [common.ps1](../scripts/windows/common.ps1) | Общая валидация, ACL/env, безопасный native invocation и DB checks |
| [start-runtime.ps1](../scripts/windows/start-runtime.ps1) | Загрузка разрешённых env из внешнего файла, loopback Node |
| [test-windows-package.ps1](../scripts/windows/test-windows-package.ps1) | Безопасный воспроизводимый тестовый набор |
| Этот отчёт | Границы проверки и remaining blockers |

Всего 13 файлов: 5 документов и 8 файлов scripts/windows. Дополнительные helpers ограничены общей библиотекой, runtime launcher и тестом. Linux-документы сохранены.

## Выбор инфраструктуры и фактический проект

Windows Server 2022/2025 x64; Hyper-V Gen2/Secure Boot, стартовая оценка 4 vCPU/8 GB/100 GB, не hard minimum. Node 22.x official MSI; PostgreSQL 18.x Windows EDB installer. Точные patch версии фиксируются администратором при установке. package-lock: Next **16.3.6**, Prisma **6.19.0**; `npm start` уже содержит `--hostname 127.0.0.1`. В schema два URL, из которых directUrl берётся из MIGRATION_DATABASE_URL. Миграций **12**. Исходный commit **8ddbd94f7684679094dd2020f8f45a136bdbd2d2**, origin `https://github.com/Rustam-RuKo/FinanceMAX.git`; target clone использует SSH того же repository.

Основной proxy: **IIS 10 + URL Rewrite 2.1 + ARR 3**, HTTPS binding. Выбор проверен по официальной документации, не по установленному IIS на этой рабочей станции. Основной service: **WinSW 2.12.0 .NET Framework**, runtime identity **NT SERVICE\FinanceMAX**, пароль не нужен. WinSW stable release и XML reference просмотрены; живая регистрация/virtual-account transition здесь не тестировались. Документы ссылаются на официальные источники Microsoft/PostgreSQL/Node/WinSW/GitHub.

## Что автоматизировано

Install проверяет параметры/ОС/prerequisites, готовит каталоги/ACL, clone+pin, npm ci/generate/typegen/typecheck/build, wrapper definition и остановленную службу, proxy template и unregistered backup-task XML. Firewall только с config opt-in и явным подтверждением, без изменения чужих правил. Никакой bootstrap users/restore/seed.

Backup использует отдельный read-only DB account через pgpass, lock, custom .part, TOC, SHA256, публикацию completion sidecar; Daily7/Weekly4/Monthly12. Verified/PreUpdate не удаляются автоматически. Task principal — отдельный local user, не Administrator. Runtime service не читает backup/migration/deploy-key secrets.

Update требует clean main, старую корректную schema, остановку writer, PreUpdate dump, **подписанный оператором протокол полного restore-test соответствующего dump/SHA**, review diff и ввод target SHA. Затем ff-only на immutable SHA, миграции под migrator, runtime grants, сборка, актуальный pin, service start и verify. Ошибка оставляет service остановленным. Протокол оператора не заменяет реальный restore-test, скрипт не выполняет его автоматически.

## Ручные шаги

Установка подписанных MSI/WinSW, подготовка read-only deploy key/known_hosts, DNS/LAN parameters, PostgreSQL/HBA/roles/passwords/locale, остановка source writer, transfer/full restore, secrets+file ACL, backup OS account/batch rights/task credentials, IIS/ARR settings/certificate/headers, review глобальных firewall/GPO, off-site backup и серверная/browser приёмка. Подробные процедуры в linked guides. Standalone — основной путь; AD CS/GPO/gMSA описаны как варианты администратора без изменения приложения.

## Выполненные проверки

Окончательные результаты безопасной локальной проверки приведены ниже. Никакие результаты старых npm tests/build не переиспользуются как результаты этого задания.

| Проверка | Фактический результат |
|---|---|
| Windows PowerShell 5.1.22621.6133, test-windows-package.ps1 | **43 PASS / 0 FAIL**, exit 0 |
| Parser всех 8 файлов .ps1/.psd1 | Ошибок нет, входит в тестовый набор |
| PowerShell examples в документах | **23 блока**, синтаксических ошибок нет; команды не исполнялись |
| Относительные ссылки документов | **30**, все цели существуют |
| Config guards | Placeholders, repository/SHA, ports, private CIDR, unsafe paths/ADS/traversal и неизвестные keys отвергаются |
| Env/native invocation | Runtime повышенная роль отвергается, duplicate/unknown env отвергаются, scoped env восстанавливается, space arguments и nonzero exit проверены |
| Backup helper | SHA256 принимает целый fixture и отвергает порчу; retention выбирает только ожидаемые старые имена; настоящего dump нет |
| Idempotency / DryRun | Повторная запись совпадающего template безопасна, drift блокируется; 4 entry scripts запущены по два раза с tripwires на system/API commands |
| XML | WinSW/IIS templates разобраны, space paths/loopback/XFF overwrite проверены в памяти |
| Secret scan | **0 совпадений**: сравнение с пятью локальными первоначальными паролями + private-key/token/password-hash patterns; значения не выводились |
| Git boundary | **13/13 файлов ignored**, **0 tracked changes**, без commit/push |
| PSScriptAnalyzer | Не установлен, **не выполнялся** |

Локальные evidence: `.runtime/windows-package-validation/ps51-final/results.json`, `package-checks.json`, `manifest.json` в том же validation-каталоге. Manifest содержит SHA256 всех 13 файлов; передавать вместе с пакетом отдельно от секретов. Проверки пишут только fixtures/evidence внутри `.runtime`; нет регистрации служб/tasks, IIS/firewall/DB изменений. Файлы PowerShell сохранены в UTF-8 **с BOM** для корректного русского текста в Windows PowerShell 5.1.

Для повторения безопасного набора в рабочей копии указать полный путь к `test-windows-package.ps1` и параметр `-EvidenceRoot` на новый подкаталог `.runtime` этой копии. Тесты не требуют PostgreSQL или WinSW. `-DryRun` валидирует заполненный config; пример с placeholders намеренно отвергается. Parser/DryRun не покрывают настоящие ACL/SCM/Task Scheduler/IIS/pg_dump integration.

## Обработка секретов

В config.example и scripts нет production passwords, TLS private keys, GitHub tokens, DB password hashes или dumps. Env/pgpass создаются только администратором в ProgramData\Secrets. Native commands скрывают error output, способный содержать DB URL; пароли не передаются command line. Runtime/migration URL передаются процессам через scoped env с восстановлением прежних значений. Task password только secure prompt → Windows task credential store; никакой записи в XML/config. Backup и SSH отдельно ACL-защищены. Инструкции содержат только явно помеченные placeholders.

## Блокеры реального deployment и ограничения

1. Нет целевого Windows Server: службы/WinSW stop tree, IIS/ARR pipeline, TLS headers spoofing, firewall isolation и reboot пока не проверены. Их нельзя объявить работающими по syntax/DryRun.
2. Production dump здесь не создавался/не восстанавливался, DB counts/roles/Prisma diff не выполнялись против production. Перенос разрешён только после реального успешного restore-test и baseline comparison.
3. Полный `npm test`, HTTP suite и production build приложения в этом задании **не запускались**: приложение не менялось, а задача запрещает deployment/system changes. На отдельной Server test VM выполнить тесты перед пилотом; команды scripts для будущего запуска не считаются выполненными сейчас.
4. PSScriptAnalyzer отсутствует. Его анализ не выполнен, пакет не устанавливает software.
5. Проверка verify консервативна: broad Allow rules или historical error logs могут блокировать результат до ручного review. Локальное отсутствие listener exposure не заменяет тест с другого компьютера; ranges/GPO/NAT/IPv6 проверяются отдельно. Raw proxy XML не доказывает effective order ARR headers.
6. Backup не реализует off-site transport; он документирован как обязательная внешняя операция компании. Предварительный proof JSON — подписанное утверждение администратора, без криптографической аттестации. Counts/FK/migrate diff не заменяют business reconciliation и PostgreSQL custom-trigger baseline.
7. Windows пакет пока **локальный**, исключён существующим default-deny Git manifest. GitHub не менялся. Для доставки использовать защищённую передачу всего набора с manifest; включение в Git требует отдельного review. Не копировать только старый GitHub tree в надежде, что новые Windows файлы уже там.

`READY` ниже означает готовность подготовленного скрипта к контролируемому тесту администратором на Windows Server; **не** успешный production apply. Server acceptance checklist остаётся неотмеченным.

```text
Windows deployment package: COMPLETE
Windows Server target documented: YES
Hyper-V documented: YES
PowerShell installer: READY
Verification script: READY
Backup script: READY
Update script: READY
Production DB transfer documented: YES
HTTPS documented: YES
LAN-only documented: YES
Secrets embedded in scripts/docs: NO
```
