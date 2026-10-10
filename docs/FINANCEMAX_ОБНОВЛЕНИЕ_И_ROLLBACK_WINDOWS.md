# FinanceMAX — обновление и rollback на Windows Server

[Deployment](DEPLOYMENT_СЕРВЕР_FINANCEMAX_WINDOWS.md) · [Backup/restore](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md) · [Чек-лист](FINANCEMAX_SERVER_CHECKLIST_WINDOWS.md). Команды здесь не выполнялись на production при подготовке пакета.

## 1. Перед изменением

Утвердить точный полный TargetCommit, просмотреть source/migrations/dependency diff в private GitHub, определить совместимость отката, согласовать downtime и ответственного. На изолированной Windows Server копии провести npm tests/HTTP/financial regression и пробный upgrade. Не запускать общий `npm test` с production connection; это отдельный тестовый кластер. Подготовить off-site/Verified dump, рабочую консоль и предыдущие версии Node/WinSW. Нельзя начинать с незавершённой миграцией или грязным Git tree.

Windows automation пока поставляется отдельно и игнорируется первоначальным Git manifest. Проверять checksum её версии отдельно от SHA приложения. Обновление приложения не заменяет автоматически Automation scripts, WinSW, IIS или PostgreSQL major; это отдельный reviewed maintenance change. Не расширять approved manifest и не пушить infrastructure без отдельной проверки.

## 2. Штатное обновление

```powershell
$cfg = 'C:\ProgramData\FinanceMAX\Automation\config.psd1'
$target = 'REVIEWED_40_CHARACTER_COMMIT_SHA'
& 'C:\ProgramData\FinanceMAX\Automation\update-financemax.ps1' -ConfigPath $cfg -TargetCommit $target -DryRun
# Во время утверждённого окна:
& 'C:\ProgramData\FinanceMAX\Automation\update-financemax.ps1' -ConfigPath $cfg -TargetCommit $target
```

DryRun валидирует параметры и выводит план; **не fetch**, не читает секреты, не останавливает service, не доказывает server readiness. Placeholder target надо заменить даже для DryRun.

Реальный update:

1. Administrator/Server/Node/PG, clean main/origin и старый pin. Проверка старой БД через status/diff до остановки.
2. Stop FinanceMAX, ждать Stopped и освобождения app port. Проверить другие writers организационно; один service stop не исключает ручной DB client.
3. PreUpdate dump, TOC/hash. Приложение остаётся остановленным. Оператор выполняет **полный** restore-test по backup guide на другом имени БД, фиксирует PASS JSON с matching dump hash/code SHA и data/schema checks. Script требует этот протокол; он не принимает один `--list` за restore.
4. Fetch origin/main, сравнение с TargetCommit и ancestry; показать diff stat и миграции/dependencies. Просмотреть **весь** diff отдельно и ввести TargetCommit. Шаг `git pull --ff-only origin <точный SHA>` закреплён на reviewed object и не подхватит новую, неожиданно передвинутую main. Нет force/reset/clean.
5. npm ci, generate, status (pending может вернуть ненулевой код), migrate deploy от migrator, runtime grants, status/diff/counts. При любой ошибке deploy остановка; нельзя `migrate resolve` без расследования.
6. Чистая повторная сборка npm ci/generate/typegen/typecheck/build с build-only env; миграторский секрет не передаётся build. Повторный npm ci намерен: общий build helper одинаков для install/update, это несколько медленнее, но упрощает контроль.
7. Обновить **только ExpectedCommit** в исходном config и Automation\config.psd1, если это разные файлы, подтвердить. Скрипт читает pin заново, затем запускает service, ждёт HTTPS /login и выполняет verify.
8. JSON record в Deployments содержит UTC, old/new SHA, dump/proof paths, status, Node patch. Browser acceptance остаётся отдельным шагом.

До изменения pin сверить остальные параметры config; не менять в ходе обновления network/db/paths. Backup task Daily должна уже успешно выполняться, иначе verify блокирует completion. Strict verify может обнаружить старые logs за 24 часа: изучить и документировать устранение, не удалять логи ради зелёной проверки.

Если оператор отменил или любой шаг завершился ошибкой после остановки, служба остаётся остановленной; record сохраняется. Это намеренно исключает автоматический запуск несовместимого old/new кода после частичной миграции. Не возвращать приложение пользователям до выяснения состояния schema. DB транзакции защищены миграциями PostgreSQL в пределах их SQL; универсальный автоматический rollback всех миграций не обещается.

## 3. Code-only rollback

Допустим **только после доказательства**, что текущая БД совместима с previous SHA. Migration count/diff для старой schema может отличаться даже при обратно совместимой additive migration: решение по diff/тесту, не по отсутствию сообщения об ошибке. При сомнении применять DB recovery, а не запускать старый код.

```powershell
. 'C:\ProgramData\FinanceMAX\Automation\common.ps1'
$c = Read-FmConfig 'C:\ProgramData\FinanceMAX\Automation\config.psd1'
$previous = 'REVIEWED_PREVIOUS_FULL_SHA'
if ($previous -notmatch '^[a-f0-9]{40}$') { throw 'Требуется полный проверенный SHA' }
Assert-FmAdmin
Assert-FmGit $c $c.ExpectedCommit
Stop-Service FinanceMAX
(Get-Service FinanceMAX).WaitForStatus('Stopped',[timespan]::FromSeconds(90))
if (Get-NetTCPConnection -State Listen -LocalPort $c.AppPort -ErrorAction SilentlyContinue) { throw 'Остался writer' }
$null = Invoke-FmNative 'git.exe' @('-C',$c.AppPath,'switch','--detach',$previous)
Invoke-FmBuild $c
Set-FmAcl (Join-Path $c.AppPath '.next') @{'NT SERVICE\FinanceMAX'='Modify'}
# Обновить ExpectedCommit в обоих config и записать rollback record.
# Только после отдельной проверки совместимости текущей БД:
Start-Service FinanceMAX
```

Не переписывает main. Проверить startup/TLS/login/roles/XLSX/financial totals. При миграционном расхождении verify не объявляет PASS; приложить отдельную совместимость и remaining blockers, не скрывать diff. Для следующего штатного обновления согласовать возврат на main и новый target: не `reset --hard`. При неудаче снова остановить.

## 4. Rollback с БД

Если новый код/миграции несовместимы: остановить service; сохранить broken DB и backup; восстановить pre-update dump в **новую** recovery DB; проверить по совместимому old SHA; runtime grants; обе URL/config/pgpass/HBA перевести на recovery DB; построить old code; backup recovery DB; HTTPS/login/browser smoke; финансовая сверка. Старую БД не удалять до подписанного завершения расследования и срока retention. Не писать reverse migration SQL вручную и не отключать FK/triggers.

Если между update и rollback были финансовые записи, pre-update dump их не содержит. До открытия ввода перечислить эти операции, сопоставить с первичкой, утвердить audited восстановление. Не суммировать superseded accepted versions и не повторять платежи без проверки bank/cash journal.

## 5. Критерии допуска после обновления

Service identity/loopback, HTTPS/Host/XFF spoofing, чистый Git/SHA, migration status/diff, runtime permissions, latest backup/full restore-test, login/logout и изоляция ролей, download management/partner XLSX, финансовые контрольные итоги. Повторный reboot проверить на staging и в согласованное окно. Лишь после подписи ответственного открыть офисный ввод. Автоматический PASS скрипта не означает безусловную production readiness.
