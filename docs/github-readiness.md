# FinanceMAX — готовность приватного GitHub-репозитория

Дата проверки: 8 октября 2026 года. Выполнена локальная подготовка, без публикации. Финансовая логика, база компании, миграции, production-пользователи и пароли не изменялись.

## 1. Git: исходное состояние

Папка проекта не является Git-репозиторием: `.git` отсутствует, `git rev-parse --show-toplevel` возвращает «not a git repository». Собственного индекса, staged-файлов, tracked/untracked-статуса, коммитов, истории и remote в ней нет. Называть все файлы «untracked» как результат git status было бы неточно: ниже приведена отдельная файловая инвентаризация.

Не выполнялись git init/add/commit/remote, GitHub login, создание удалённого репозитория или push. Для проверки правил исключения использован настоящий `git check-ignore --no-index` с рабочим деревом FinanceMAX и метаданными уже существующего другого локального репозитория. Его индекс не использовался и не менялся. Ввод передавался с NUL-разделителями, чтобы Windows CRLF не искажал имена. Глобальные исключения отключены для воспроизводимости. Это проверка правил, а не создание Git-состояния FinanceMAX.

## 2. Что подготовлено к публикации

Включены исходный код, Prisma schema и все миграции, тесты, необходимые команды обслуживания и сборки, lockfile, безопасный README, шаблон окружения, инструкция AGENTS и пять явно разрешённых документов. Каталога public сейчас нет; при его появлении содержимое потребует отдельного просмотра.

`.gitignore` использует запрет корневых категорий по умолчанию и разрешённые каталоги. Для scripts и docs действует дополнительный пофайловый список. Разовые скрипты переписывания исходников и исторические технические отчёты сохранены локально, но исключены из будущего коммита.

| Категория | Файлов |
| --- | ---: |
| Корневые конфигурации, README, AGENTS | 8 |
| src | 41 |
| prisma | 14 |
| scripts | 10 |
| tests | 13 |
| docs | 5 |
| **Итого** | **91** |

Три пользовательских руководства включены по прямому разрешению. user-guide-validation.md просмотрен: там нет паролей, хешей или production evidence. Настоящий отчёт включён как результат текущего задания. Упомянутые в руководствах пять имён и согласованные логины, а также их необходимые программные определения, оставлены как явно разрешённые справочные сведения. Это одна из причин обязательной приватности репозитория.

## 3. Что исключено

- `.env`, все локальные варианты окружения, кроме шаблона `.env.example`.
- `.runtime` целиком, node_modules, `.next`, результаты сборки, coverage, временные файлы.
- Дампы, backup/bak, обычные SQL, локальные базы, PostgreSQL data directories, ключи и сертификаты с приватным материалом.
- Файлы credentials/secret/password, кроме узких исключений для необходимого исходного кода; production-initial-credentials.txt исключён также родительским каталогом.
- Состояние браузера, cookies, sessions, storage state, отчёты Playwright, test-results, скриншоты PNG/JPG/JPEG.
- Сформированные XLSX/XLS/CSV, generated, exports, reports/generated.
- Внутренние production-отчёты, сведения об очистке и bootstrap, старые финансовые evidence и служебные документы, не разрешённые в allowlist.
- Локальные OS/editor-файлы и одноразовые скрипты исправления исходников.

Глобальный запрет `*.sql` имеет узкое исключение только `prisma/migrations/**/migration.sql`. Проверено, что исходник с названием password-reset.ts/secret-config.ts не теряется из-за широких правил. При появлении настоящего секрета внутри разрешённого исходника `.gitignore` не помогает: нужен повторный content scan.

`next-env.d.ts` не публикуется: установленная версия Next.js явно требует исключать этот генерируемый файл. Типы создаются инструментами Next.js; финансовые исходники ради этого не менялись.

## 4. Secret scan

Выполнены два отдельных локальных прохода по candidate tree: поиск строк подключения, literal passwords/secrets/tokens, ключей провайдеров, private keys, хешей паролей, JWT, непрозрачных API/session secrets, локальных пользовательских путей, email, телефонных и банковских/паспортных признаков. В отчёт выводились только путь, номер строки и тип совпадения, без значений секретов.

Совпадения первого прохода разобраны: placeholders `.env.example`, адреса без учётных данных в защитных тестах, утверждённые внутренние логины, искусственные тестовые адреса/пароли, адрес из метаданных зависимости. Дополнительный поиск JWT, ключей, literal scrypt-хешей, персональных путей и длинных банковских/паспортных реквизитов совпадений не дал.

`scripts/browser-fixture.ts` содержит искусственный тестовый пароль: файл является помощником исключительно тестового сценария, вызов находится в тестах и защищён маркером одноразовой тестовой базы; не участвует в обычном запуске или production seed. Остальные фиксированные тестовые пароли находятся в tests. Их значения не повторяются в этом отчёте. Production bootstrap генерирует случайные значения, а не хранит их в исходниках.

Подтверждённых production-секретов в проверенном candidate tree не выявлено. Это результат текущего ограниченного снимка, а не гарантия обнаружения любого неизвестного секрета или безопасности будущих добавлений. Проверка Git-истории не применима: собственной истории нет.

## 5. Production credentials

Файл `.runtime/production-initial-credentials.txt` существует локально и исключён настоящим Git matcher. В candidate manifest его нет. Содержимое не выводилось в диалог, журнал результатов или публикуемые документы.

Отдельная машинная проверка извлекала пять значений только в память для точного поиска совпадений; без такого сравнения доказать отсутствие именно generated passwords невозможно. Значения не сохранялись в результатах проверки. Расширенное сравнение проверило 19 227 обычных файлов (1 130 360 791 байт) вне `.runtime` и `.git`, включая установленные зависимости и сборку: совпадений 0, ошибок чтения 0. Три символические ссылки внутри исключённой `.next` не обходились повторно; candidate tree не содержит символических ссылок. Созданные для проверки одноразового PostgreSQL реквизиты находятся исключительно в исключённом локальном каталоге.

## 6. Базы, резервные копии и runtime

В исходной `.runtime` найдены в том числе PostgreSQL data directory, 7 файлов dump, 14 XLSX, 89 PNG, журналы, JSON evidence, локальные SQL и окружения. Эти числа описывают локальные артефакты до новых проверочных файлов, а не содержимое репозитория. Все они исключены целиком по правилу родительского каталога; ничего не удалено ради публикации.

В candidate tree нет дампов, локальных данных PostgreSQL, browser state, сформированных Excel или резервных метаданных. SQL-кандидаты — только 12 миграций. Проверочные копия, логи и новый тестовый кластер также создавались под исключённой `.runtime`.

## 7. Личные и финансовые сведения

Просмотрены источники форм и расчётов, миграции, seed, fixtures, разрешённые документы и результаты поиска реквизитов. Реальные операционные выгрузки, зарплатные реестры, клиентские финансовые документы, паспортные данные, реальные банковские реквизиты и private browser evidence в allowlist не включены.

Числа в demo/test сценариях и учебных примерах являются искусственными данными; 66 шаблонов аудита — справочник, а не операционная база. Имена/логины согласованных пользователей сохранены только там, где разрешены заданием и необходимы текущим материалам. Исторические внутренние отчёты не публикуются даже при отсутствии найденного пароля.

## 8. README и окружение

README переписан: описание продукта и стека, требования, npm ci, создание локального окружения, генерация Prisma, миграции, dev/build/start, команды тестов и ссылки на руководства. Убраны конкретный путь локального PostgreSQL-кластера, рабочий порт и локальные bootstrap evidence. Office deployment не описывается.

`.env.example` содержит placeholders или пустые поля секретов. Перечислены необходимые переменные приложения, миграций, создания администратора, demo, специального production bootstrap и тестового стенда. TRUST_PROXY/FINANCEMAX_ENV — несекретные режимы. Production seed и смена первоначальных паролей не включены в обычную установку.

Все относительные ссылки README проверены и ведут на включённые в candidate документы; ссылка на исключённую финансовую модель из прежнего README убрана.

## 9. Seed и административные процедуры

- Demo seed требует явный --demo, FINANCEMAX_ENV=demo, локальный адрес и имя отдельной demo-базы; production NODE_ENV и основное имя базы запрещены. Демонстрационный пароль берётся из окружения либо генерируется.
- Production seed требует явное целевое имя financemax_production и согласованный архивный источник; demo/test/похожее имя отвергаются. Проверяет чистоту и справочники; читает хеши из источника без публикации. Это исторически специализированная процедура, а не универсальный seed.
- Bootstrap production-пользователей требует проверенный локальный manifest, ровно пять ожидаемых identities и отсутствие маркера прежнего запуска; пароли генерируются случайно и сохраняются только в исключённый файл.
- Данные компании и bootstrap при этой проверке не запускались. Защитные тесты исполняются на одноразовых базах.
- Полный test harness сам по себе не доказывает безопасность адреса исходного сервера: он использует переданный URL. Поэтому проверка выполнена на новом отдельном кластере, и это требование явно записано в README.

## 10. Зависимости и воспроизводимость

package-lock.json присутствует. dependencies и devDependencies корневой записи lockfile совпадают с package.json. Локальных path/file/link-зависимостей и абсолютных разрешённых путей пакетов не обнаружено. В чистой копии `npm ci --no-audit --no-fund` завершился с кодом 0: установлены 172 пакета из lockfile, старый node_modules не копировался.

npm выдал предупреждения об устаревших транзитивных пакетах. Зависимости не обновлялись; vulnerability audit не выполнялся и его успешность не заявляется. Кэш npm мог использоваться штатным npm ci; это не копирование старых установленных модулей проекта.

## 11. Миграции и чистый стенд

В candidate сохранены schema.prisma, migration_lock.toml и 12 миграций от initial до audit_sections. Исходные SQL не изменялись. Проверка интеграционных наборов применяет все миграции с нуля и сравнивает результат с Prisma schema. Production migrate/status не запускались: соответствие проверяется на новой базе, не путём изменения базы компании.

Чистая копия создана строго по allowlist без старых `.env`, `.runtime`, `.next`, node_modules или generated client. После npm ci отдельно выполнена генерация Prisma; для тестов создан новый пустой runtime-каталог и новое окружение со случайными тестовыми реквизитами. Это явная настройка стенда, а не зависимость от прежних артефактов.

## 12. Результаты команд

Все перечисленные команды действительно выполнены в чистой копии:

| Проверка | Результат |
| --- | --- |
| npm ci --no-audit --no-fund | Код 0; 172 пакета |
| npm run db:generate | Код 0; клиент сгенерирован из включённой schema |
| npm run typecheck до тестов | Код 0, без старой `.next` и без скопированного next-env.d.ts |
| npm run test:housekeeping | 7 тестов, 7 pass, 0 fail, 0 skipped |
| npm test | Код 0; 94 теста, 94 pass, 0 fail, 0 skipped, 0 cancelled |
| HTTP внутри npm test | Маркер HTTP_CHECKS_PASSED=172 |
| Чистое применение миграций / Prisma diff | 11 наборов, 11 «No difference detected» |
| Сезонный интеграционный сценарий | Маркер SCENARIO_RECONCILED; сезон закрыт, обязательства двух тестовых партнёров погашены |
| npm run build отдельно после тестов | Код 0; production routes и Proxy собраны |
| npm run typecheck после сборки | Код 0 |
| Уборка тестовых баз и ролей | 0 оставшихся financemax_test_* и fm_test_* на изолированном кластере |
| Остановка проверочного PostgreSQL | «server stopped»; рабочий кластер не останавливался |

Итого 101 успешно выполненный автоматический тест с учётом отдельного housekeeping. 172 HTTP-проверки — внутренние проверки HTTP-теста, не дополнительные 172 верхнеуровневых теста. Отдельный повтор команды test:http не требовался: набор уже выполнен в npm test. Браузерная приёмка и открытие Excel на этом этапе не проводились.

Локальные доказательства: `.runtime/github-preparation/verification.json`, `npm-ci.log`, `tests.log`, `housekeeping.log`, `build.log`, `typecheck-initial.log`, `typecheck-final.log`, `test-cleanup.json`, `credential-comparison.json`, `scan.json`, `extended-scan.json` и `manifest.json`. Они исключены из публикации; сырые логи не переносились в docs.

## 13. Что осталось перед первым коммитом

Технических блокеров для первого коммита проверенного состава не обнаружено. Чистая установка, тесты, типы, сборка и проверка исключений завершены. Это готовность локального состава к приватному репозиторию, не безусловная готовность production-развёртывания. Пользователь отдельно разрешает git init/add/commit. До такого разрешения команды не выполняются. Remote должен быть создан PRIVATE отдельным согласованным действием; никаких GitHub-операций на этом этапе нет.

Перед будущим добавлением нужно повторно сравнить actual staged files с проверенным manifest и просканировать staged content. `.gitignore` не очищает уже отслеживаемые файлы и не защищает от принудительного add. Проверенный состав не следует расширять без нового просмотра.

## 14. Preview initial commit

Полный список кандидатов приведён ниже. Это план, не результат git add.

```text
.env.example
.gitignore
AGENTS.md
README.md
docs/FINANCEMAX_АДМИНИСТРАТОР.md
docs/FINANCEMAX_БЫСТРЫЙ_СТАРТ.md
docs/github-readiness.md
docs/user-guide-validation.md
docs/РУКОВОДСТВО_ПОЛЬЗОВАТЕЛЯ_FINANCEMAX.md
next.config.ts
package-lock.json
package.json
prisma/migrations/202609250001_initial/migration.sql
prisma/migrations/202609250002_workflows/migration.sql
prisma/migrations/202609250003_history/migration.sql
prisma/migrations/202609250004_integrity/migration.sql
prisma/migrations/202609250005_link_trigger/migration.sql
prisma/migrations/202609250006_source_integrity/migration.sql
prisma/migrations/202609250007_fixed_project_rate/migration.sql
prisma/migrations/202609250008_remediation/migration.sql
prisma/migrations/202609260009_report_snapshot/migration.sql
prisma/migrations/202609260010_manual_expense_reference/migration.sql
prisma/migrations/202609270011_trip_payments/migration.sql
prisma/migrations/202610070012_audit_sections/migration.sql
prisma/migrations/migration_lock.toml
prisma/schema.prisma
scripts/bootstrap-production-users.ts
scripts/browser-fixture.ts
scripts/configure-runtime.mjs
scripts/create-admin.ts
scripts/production-cleanup.mjs
scripts/production-safety.mjs
scripts/scan-secrets.mjs
scripts/seed-production.mjs
scripts/seed.ts
scripts/test.mjs
src/app/[section]/page.tsx
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/reports/[scope]/route.ts
src/app/api/v1/[resource]/route.ts
src/app/error.tsx
src/app/globals.css
src/app/layout.tsx
src/app/login/page.tsx
src/app/not-found.tsx
src/app/page.tsx
src/components/AuditForms.tsx
src/components/ManagementDashboard.tsx
src/components/ReportDownload.tsx
src/components/UserManagement.tsx
src/components/Workspace.tsx
src/components/forms.ts
src/domain/audit-templates.ts
src/domain/authorization.ts
src/domain/calculations.ts
src/proxy.ts
src/server/audit-sections.ts
src/server/auth.ts
src/server/calculation-data.ts
src/server/csp.ts
src/server/dashboard.ts
src/server/db.ts
src/server/errors.ts
src/server/excel-report.ts
src/server/http.ts
src/server/login-rate-limit.ts
src/server/manual-expenses.ts
src/server/production-users.ts
src/server/queries.ts
src/server/report-tables.ts
src/server/season-report.ts
src/server/trip-payments.ts
src/server/user-management.ts
src/server/validation.ts
src/server/versions.ts
src/server/workflows.ts
tests/audit-sections.test.ts
tests/authorization.test.ts
tests/edge-cases.test.ts
tests/financial.test.ts
tests/http.test.ts
tests/integration.test.ts
tests/production-bootstrap.test.ts
tests/production-readiness.test.mjs
tests/remediation.test.ts
tests/season-report.test.ts
tests/section-fixtures.ts
tests/trip-payments.test.ts
tests/user-management.test.ts
tsconfig.json
```


GitHub readiness: READY
Repository must be PRIVATE: YES
Secrets detected in candidate repo: NO
Production credentials included: NO
Database dumps included: NO
Safe to create initial commit: YES

