# FinanceMAX — приёмочный чек-лист Windows Server

Все пункты ниже **не выполнены автоматически при подготовке пакета**. Отмечает ответственный администратор с датой и ссылкой на evidence. [Deployment](DEPLOYMENT_СЕРВЕР_FINANCEMAX_WINDOWS.md) · [Backup](FINANCEMAX_BACKUP_И_RESTORE_WINDOWS.md) · [Update](FINANCEMAX_ОБНОВЛЕНИЕ_И_ROLLBACK_WINDOWS.md) · [Статус пакета](windows-deployment-readiness.md).

## BEFORE

- [ ] Windows Server 2022/2025 x64, build/patch зафиксированы; консоль доступна.
- [ ] Физический/Hyper-V сервер определён; ресурсы и свободное место достаточны.
- [ ] Hyper-V Generation 2 / Secure Boot / reserved LAN IP проверены, если VM.
- [ ] Target SHA утверждён; отдельно проверены хеши Windows automation.
- [ ] Node 22 patch, PostgreSQL 18 minor, WinSW binary/версия/hash задокументированы.
- [ ] Config placeholders заменены, DryRun пройден; paths не содержат reparse points.
- [ ] Source writer остановлен; dual-write исключён; исходный baseline сохранён.

## SECURITY

- [ ] Обновления Windows и Defender/EDR действуют; персональные admin accounts.
- [ ] FinanceMAX identity = NT SERVICE\FinanceMAX, не Administrator/LocalSystem.
- [ ] App/Automation/Service код service не может изменять; writable только .next/logs/temp.
- [ ] Runtime env читают только нужные identities; migrator/backup/SSH/TLS разделены.
- [ ] Ни один secret не в repository, config.example, command line или deployment record.
- [ ] Deploy key read-only; GitHub host fingerprint сверён отдельно; strict host checking.
- [ ] NTFS ACL существующих дочерних файлов проверены, disk/off-site encryption действует.
- [ ] RDP/WinRM/SSH ограничены admin network; консольный recovery доступ проверен.

## DATABASE

- [ ] Source dump custom + SHA256 + TOC; защищённая передача, hash target совпадает.
- [ ] Полный temp restore завершён, protocol с matching dump hash/code SHA сохранён.
- [ ] Production restore выполнен только в пустую правильную БД, locale совместим.
- [ ] Сохранены User ID/logins/roles/Partner links/password hashes из dump, без пересоздания.
- [ ] Initial counts 5/2/0/0/0/0/66/5/2/4 и migrations 12 подтверждены до реального ввода.
- [ ] demo=true отсутствует; AuditLog сохранён и может быть непустым.
- [ ] PostgreSQL только 127.0.0.1; HBA SCRAM; runtime no DDL/superuser/membership.
- [ ] Runtime DML и DELETE только Session; _prisma_migrations закрыта runtime.
- [ ] Migrate status и diff=0; FK валидны; triggers/functions metadata совпадают с source.
- [ ] Counts всех таблиц и исходные bank/cash/accepted-version totals совпадают.

## APPLICATION

- [ ] Git origin/SHA/clean tree проверены; npm ci, generate, typegen, typecheck/build успешны.
- [ ] Service startup/stop/restart/reboot проверены, после Stop нет оставшегося Node listener.
- [ ] Port 3000 только 127.0.0.1; service env указывает правильную БД/runtime.
- [ ] APP_ORIGIN точно соответствует HTTPS origin без slash, TRUST_PROXY только за IIS.
- [ ] App/wrapper logs читаемы, rotation работает, нет неразобранных ошибок.

## IIS/HTTPS

- [ ] IIS/URL Rewrite/ARR установлены с проверкой источника/подписей.
- [ ] Только отдельный FinanceMAX site, чужие сайты не отключены.
- [ ] Единственный HTTPS hostname/SNI binding, действующий сертификат, SAN/chain/private key ACL.
- [ ] Клиенты доверяют CA; TLS validation не обходится; срок >30 дней.
- [ ] Proxy preserveHostHeader, no response caching; correct timeout/request limits.
- [ ] Реальный тест Host/XFF/XFP выполнен: поддельный клиентский XFF не становится доверенным первым IP.
- [ ] Effective global/parent rewrite rules проверены; временный diagnostic backend удалён.

## FIREWALL

- [ ] Только офисная LAN разрешена на HTTPS; TCP 80 закрыт.
- [ ] Все активные profiles inbound Block; broad installer/GPO/range/IPv6 rules проверены.
- [ ] От офисного ПК 3000/5432 недоступны; от неразрешённого сегмента HTTPS недоступен.
- [ ] WAN/NAT/port forwarding отсутствуют; DNS указывает только корректный внутренний адрес.

## BACKUP

- [ ] Отдельный Windows backup account, batch logon, no Administrator/RDP/interactive login.
- [ ] DB backup role только read; PGPASSFILE ACL; Task credentials вне scripts/XML.
- [ ] Scheduler daily time/timezone и StartWhenAvailable проверены, LastTaskResult=0.
- [ ] Свежий dump+hash, TOC, размер и права доступа проверены.
- [ ] Daily7/Weekly4/Monthly12 работают; Verified/PreUpdate сохраняются отдельно.
- [ ] Off-site encrypted копия вне физического сервера проверена; ключ отдельно.
- [ ] Полный периодический restore-test назначен, RPO/RTO фактически измерены.
- [ ] После recovery DB rename backup следует за новым Database/pgpass/HBA.

## SMOKE TEST

- [ ] verify-financemax.ps1 выполнен без ошибок, JSON counts/результат сохранён безопасно.
- [ ] Реальный HTTPS browser login/logout: Secure cookie, Origin/CSRF, обновление страницы.
- [ ] Все management accounts имеют одинаковые права; partner видит только своё.
- [ ] Существующие production users не пересозданы; логины не выдуманы.
- [ ] Management/partner XLSX скачаны браузером и открыты в Excel; значения сверены.
- [ ] Финансовые write scenarios проверены на изолированной копии, не в production.
- [ ] First real-data reconciliation план: bank/cash, fees once, trips, employee/partner obligations, accepted versions.
- [ ] Старые расчёты не утверждались автоматически; closing blockers соблюдаются.

## HANDOVER

- [ ] Собиру переданы LAN URL, SHA, дата/timezone, server/VM identity.
- [ ] Переданы backup location/schedule/restore-test и имена ответственных за сопровождение/обновление.
- [ ] Подтверждены HTTPS, LAN-only, PostgreSQL/Node not exposed; secrets не включены в акт.
- [ ] Отрепетирован совместимый code rollback и new-DB recovery; понятен порядок остановки writers.
- [ ] Незакрытые ограничения перечислены; controlled pilot письменно разрешён ответственным.

Подпись администратора: __________ Дата: __________

Решение о пилоте / оставшиеся блокеры: __________________________________
