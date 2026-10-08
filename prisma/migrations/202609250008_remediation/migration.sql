-- AlterTable
ALTER TABLE "EmployeePayment" ADD COLUMN     "bonusApprovalId" UUID;

-- AlterTable
ALTER TABLE "QuarterEmployeeSettlement" ADD COLUMN     "carrySourceId" UUID;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "compensationRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "economicRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SeasonClosingCheck" ADD COLUMN     "approvalFingerprint" TEXT;

-- AlterTable
ALTER TABLE "SeasonEmployeeSettlement" ADD COLUMN     "roundingDifference" DECIMAL(20,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProjectSeason" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,

    CONSTRAINT "ProjectSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationAcceptance" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "seasonId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "acceptedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalculationAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusExceptionApproval" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "originalSettlementId" UUID NOT NULL,
    "currentSettlementId" UUID,
    "approvedBonus" DECIMAL(20,4) NOT NULL,
    "requestedPayment" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "explanation" TEXT NOT NULL,
    "authorizedBy" UUID NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusExceptionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPaymentAttribution" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "allocationRunId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPaymentAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSeason_projectId_seasonId_key" ON "ProjectSeason"("projectId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "CalculationAcceptance_key_key" ON "CalculationAcceptance"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPaymentAttribution_paymentId_key" ON "PartnerPaymentAttribution"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayment_bonusApprovalId_key" ON "EmployeePayment"("bonusApprovalId");

-- AddForeignKey
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_bonusApprovalId_fkey" FOREIGN KEY ("bonusApprovalId") REFERENCES "BonusExceptionApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarterEmployeeSettlement" ADD CONSTRAINT "QuarterEmployeeSettlement_carrySourceId_fkey" FOREIGN KEY ("carrySourceId") REFERENCES "QuarterEmployeeSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSeason" ADD CONSTRAINT "ProjectSeason_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSeason" ADD CONSTRAINT "ProjectSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationAcceptance" ADD CONSTRAINT "CalculationAcceptance_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationAcceptance" ADD CONSTRAINT "CalculationAcceptance_acceptedBy_fkey" FOREIGN KEY ("acceptedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusExceptionApproval" ADD CONSTRAINT "BonusExceptionApproval_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusExceptionApproval" ADD CONSTRAINT "BonusExceptionApproval_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusExceptionApproval" ADD CONSTRAINT "BonusExceptionApproval_originalSettlementId_fkey" FOREIGN KEY ("originalSettlementId") REFERENCES "QuarterEmployeeSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusExceptionApproval" ADD CONSTRAINT "BonusExceptionApproval_currentSettlementId_fkey" FOREIGN KEY ("currentSettlementId") REFERENCES "QuarterEmployeeSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusExceptionApproval" ADD CONSTRAINT "BonusExceptionApproval_authorizedBy_fkey" FOREIGN KEY ("authorizedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPaymentAttribution" ADD CONSTRAINT "PartnerPaymentAttribution_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PartnerPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPaymentAttribution" ADD CONSTRAINT "PartnerPaymentAttribution_allocationRunId_fkey" FOREIGN KEY ("allocationRunId") REFERENCES "AllocationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPaymentAttribution" ADD CONSTRAINT "PartnerPaymentAttribution_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve old versions; no historical settlement is rewritten or auto-approved.
INSERT INTO "ProjectSeason"(id,"projectId","seasonId") SELECT gen_random_uuid(),id,"seasonId" FROM "Project";
UPDATE "Season" SET "workRevision"=revision,"compensationRevision"=revision,"economicRevision"=revision;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid='"QuarterEmployeeSettlement"'::regclass AND pg_get_constraintdef(oid) LIKE '%difference%' LOOP
 EXECUTE format('ALTER TABLE "QuarterEmployeeSettlement" DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE "QuarterEmployeeSettlement" ADD CONSTRAINT quarter_exact_split CHECK (
 difference=earned+ktu+"carryIn"-salary AND salary>=0 AND bonus=ROUND(GREATEST(difference,0)/2,4) AND "carryOut"=GREATEST(difference,0)-bonus
) NOT VALID;

CREATE OR REPLACE FUNCTION check_financial_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; sid uuid; expected_employee uuid; expected_season uuid; parent_project uuid;
BEGIN
 r:=to_jsonb(NEW);sid:=(r->>'seasonId')::uuid;
 IF r->>'projectId' IS NOT NULL AND sid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ProjectSeason" WHERE "projectId"=(r->>'projectId')::uuid AND "seasonId"=sid) THEN RAISE EXCEPTION 'Проект не включен в выбранный сезон'; END IF;
 IF TG_TABLE_NAME='WorkEntry' THEN
  IF NOT EXISTS(SELECT 1 FROM "ProjectAssignment" WHERE "projectId"=NEW."projectId" AND "employeeId"=NEW."employeeId") THEN RAISE EXCEPTION 'Сотрудник не назначен на проект'; END IF;
 END IF;
 IF TG_TABLE_NAME='EmployeePayment' AND r->>'quarterEmployeeSettlementId' IS NOT NULL THEN
  SELECT "employeeId","seasonId" INTO expected_employee,expected_season FROM "QuarterEmployeeSettlement" WHERE id=NEW."quarterEmployeeSettlementId";
  IF expected_employee IS DISTINCT FROM NEW."employeeId" OR expected_season IS DISTINCT FROM NEW."seasonId" THEN RAISE EXCEPTION 'Бонус связан с чужим расчетом'; END IF;
 END IF;
 IF TG_TABLE_NAME='CashOutAllocation' THEN
  SELECT "seasonId" INTO expected_season FROM "CashOutTransaction" WHERE id=NEW."cashOutTransactionId";
  IF NEW."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ProjectSeason" WHERE "projectId"=NEW."projectId" AND "seasonId"=expected_season) THEN RAISE EXCEPTION 'Проект не включен в сезон распределения'; END IF;
  IF NEW."businessTripId" IS NOT NULL THEN
   SELECT "seasonId","projectId" INTO sid,parent_project FROM "BusinessTrip" WHERE id=NEW."businessTripId";
   IF sid IS DISTINCT FROM expected_season OR parent_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Командировка не соответствует распределению'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION validate_season_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; first_day date; last_day date; d date; end_day date;
BEGIN
 r:=to_jsonb(NEW);
 SELECT "startDate","endDate" INTO first_day,last_day FROM "Season" WHERE id=(r->>'seasonId')::uuid;
 IF TG_TABLE_NAME='BusinessTrip' THEN d:=NEW."startDate";end_day:=NEW."endDate";
 ELSIF TG_TABLE_NAME='EmployeePayment' THEN d:=NEW."accountingPeriod";end_day:=d;
 ELSE d:=(r->>'accountingDate')::date;end_day:=d; END IF;
 IF d<first_day OR end_day>last_day THEN RAISE EXCEPTION 'Дата учета вне сезона. Межсезонный расход требует решения руководства о распределении'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['WorkEntry','Expense','ProjectRevenue','BusinessTrip','EmployeePayment','JournalTransaction'] LOOP
 EXECUTE format('CREATE TRIGGER season_dates BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION validate_season_dates()',t);
 END LOOP;
END $$;
-- Global project identities can continue after the origin season closes.
DROP TRIGGER season_guard ON "ProjectAssignment";
DROP TRIGGER season_guard ON "ProjectPartnerRate";
CREATE FUNCTION guard_project_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Удаление истории проекта запрещено'; END IF;
 IF TG_TABLE_NAME='ProjectPartnerRate' AND TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM "ProjectSeason" ps JOIN "Season" s ON s.id=ps."seasonId" WHERE ps."projectId"=NEW."projectId" AND s.status='Закрыт') THEN RAISE EXCEPTION 'Сначала откройте все закрытые сезоны проекта для исправления ставки'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_history BEFORE INSERT OR UPDATE OR DELETE ON "ProjectPartnerRate" FOR EACH ROW EXECUTE FUNCTION guard_project_history();
CREATE TRIGGER project_history BEFORE UPDATE OR DELETE ON "ProjectAssignment" FOR EACH ROW EXECUTE FUNCTION guard_project_history();
CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectSeason" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "CalculationAcceptance" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "BonusExceptionApproval" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "BonusExceptionApproval" FOR EACH ROW EXECUTE FUNCTION immutable_financial_row();
CREATE FUNCTION audit_remediation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; actor uuid;
BEGIN
 r:=to_jsonb(NEW);actor:=COALESCE(NULLIF(current_setting('financemax.actor',true),''),r->>'acceptedBy',r->>'authorizedBy',r->>'createdBy')::uuid;
 INSERT INTO "AuditLog"(id,entity,"entityId",operation,"oldValue","newValue",reason,"createdAt","updatedAt","createdBy") VALUES(gen_random_uuid(),TG_TABLE_NAME,NEW.id,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,r,COALESCE(NULLIF(current_setting('financemax.reason',true),''),r->>'explanation',r->>'reason'),now(),now(),actor);
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['CalculationAcceptance','BonusExceptionApproval','PartnerPaymentAttribution'] LOOP
 EXECUTE format('CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION audit_remediation()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION validate_settlement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found_source boolean := false; found_settlement boolean := false;
BEGIN
 CASE NEW."sourceType"
  WHEN 'QUARTER' THEN SELECT EXISTS(SELECT 1 FROM "QuarterEmployeeSettlement" WHERE id=NEW."sourceId") INTO found_source;
  WHEN 'WORK' THEN SELECT EXISTS(SELECT 1 FROM "WorkEntry" WHERE id=NEW."sourceId") INTO found_source;
  WHEN 'PAYMENT' THEN SELECT EXISTS(SELECT 1 FROM "EmployeePayment" WHERE id=NEW."sourceId") INTO found_source;
  WHEN 'EXPENSE' THEN SELECT EXISTS(SELECT 1 FROM "Expense" WHERE id=NEW."sourceId") INTO found_source;
  WHEN 'REVENUE' THEN SELECT EXISTS(SELECT 1 FROM "ProjectRevenue" WHERE id=NEW."sourceId") INTO found_source;
  WHEN 'CASHOUT_ALLOCATION' THEN SELECT EXISTS(SELECT 1 FROM "CashOutAllocation" WHERE id=NEW."sourceId") INTO found_source;
  ELSE RAISE EXCEPTION 'Неизвестный тип источника расчета';
 END CASE;
 CASE NEW."settlementType"
  WHEN 'QUARTER' THEN SELECT EXISTS(SELECT 1 FROM "QuarterEmployeeSettlement" WHERE id=NEW."settlementId") INTO found_settlement;
  WHEN 'SEASON' THEN SELECT EXISTS(SELECT 1 FROM "SeasonEmployeeSettlement" WHERE id=NEW."settlementId") INTO found_settlement;
  WHEN 'ALLOCATION' THEN SELECT EXISTS(SELECT 1 FROM "AllocationRun" WHERE id=NEW."settlementId") INTO found_settlement;
  ELSE RAISE EXCEPTION 'Неизвестный тип расчета';
 END CASE;
 IF NOT found_source OR NOT found_settlement THEN RAISE EXCEPTION 'Источник или расчет не существует'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_season_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; season_id uuid; season_status text; parent_id uuid;
BEGIN
 row_data := COALESCE(to_jsonb(NEW),to_jsonb(OLD));
 season_id := (row_data->>'seasonId')::uuid;
 IF season_id IS NULL AND row_data ? 'journalTransactionId' THEN SELECT "seasonId" INTO season_id FROM "JournalTransaction" WHERE id=(row_data->>'journalTransactionId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'cashOutTransactionId' THEN SELECT "seasonId" INTO season_id FROM "CashOutTransaction" WHERE id=(row_data->>'cashOutTransactionId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'allocationRunId' THEN SELECT "seasonId" INTO season_id FROM "AllocationRun" WHERE id=(row_data->>'allocationRunId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'seasonClosingId' THEN SELECT "seasonId" INTO season_id FROM "SeasonClosing" WHERE id=(row_data->>'seasonClosingId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'projectId' THEN SELECT "seasonId" INTO season_id FROM "Project" WHERE id=(row_data->>'projectId')::uuid; END IF;
 SELECT status INTO season_status FROM "Season" WHERE id=season_id FOR UPDATE;
 IF season_status='Закрыт' THEN RAISE EXCEPTION 'Сезон закрыт. Требуется авторизованное открытие для коррекции'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Удаление финансовой истории запрещено'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'seasonId') IS DISTINCT FROM (row_data->>'seasonId') THEN RAISE EXCEPTION 'Перенос записи между сезонами запрещен'; END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "PartnerPaymentAttribution" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
DROP TRIGGER season_guard ON "Project";
CREATE FUNCTION guard_project_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Удаление истории проекта запрещено'; END IF;
 IF TG_OP='UPDATE' THEN
 IF NEW."seasonId" IS DISTINCT FROM OLD."seasonId" OR NEW."partnerId" IS DISTINCT FROM OLD."partnerId" THEN RAISE EXCEPTION 'Идентичность исторического проекта неизменна'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectSeason" ps JOIN "Season" s ON s.id=ps."seasonId" WHERE ps."projectId"=NEW.id AND s.status<>'Закрыт') THEN RAISE EXCEPTION 'Все сезоны проекта закрыты'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER project_identity BEFORE UPDATE OR DELETE ON "Project" FOR EACH ROW EXECUTE FUNCTION guard_project_identity();
CREATE FUNCTION validate_remediation_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_season uuid; parent_employee uuid; target record;
BEGIN
 IF TG_TABLE_NAME='CalculationAcceptance' THEN
  IF NEW.kind='QUARTER' THEN SELECT "seasonId" INTO parent_season FROM "QuarterEmployeeSettlement" WHERE id=NEW."targetId";
  ELSIF NEW.kind='SEASON' THEN SELECT "seasonId" INTO parent_season FROM "SeasonEmployeeSettlement" WHERE id=NEW."targetId";
  ELSIF NEW.kind='ALLOCATION' THEN SELECT "seasonId" INTO parent_season FROM "AllocationRun" WHERE id=NEW."targetId";
  ELSE RAISE EXCEPTION 'Неизвестный вид расчета'; END IF;
  IF parent_season IS DISTINCT FROM NEW."seasonId" THEN RAISE EXCEPTION 'Принятый расчет другого сезона или не существует'; END IF;
 ELSIF TG_TABLE_NAME='PartnerPaymentAttribution' THEN
  SELECT "seasonId","partnerId" INTO target FROM "PartnerPayment" WHERE id=NEW."paymentId";
  SELECT "seasonId" INTO parent_season FROM "AllocationRun" WHERE id=NEW."allocationRunId";
  IF target."seasonId" IS DISTINCT FROM parent_season OR NOT EXISTS(SELECT 1 FROM "ProjectAllocation" a JOIN "Project" p ON p.id=a."projectId" WHERE a."allocationRunId"=NEW."allocationRunId" AND p."partnerId"=target."partnerId") THEN RAISE EXCEPTION 'Выплата не соответствует начислению сезона и партнера'; END IF;
 ELSIF TG_TABLE_NAME='QuarterEmployeeSettlement' AND NEW."carrySourceId" IS NOT NULL THEN
  SELECT * INTO target FROM "QuarterEmployeeSettlement" WHERE id=NEW."carrySourceId";
  IF target."employeeId" IS DISTINCT FROM NEW."employeeId" OR target."seasonId" IS DISTINCT FROM NEW."seasonId" OR target."periodEnd"+1<>NEW."periodStart" OR target."carryOut"<>NEW."carryIn" THEN RAISE EXCEPTION 'Источник переноса не соответствует кварталу'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_reference BEFORE INSERT OR UPDATE ON "CalculationAcceptance" FOR EACH ROW EXECUTE FUNCTION validate_remediation_links();
CREATE TRIGGER validate_reference BEFORE INSERT OR UPDATE ON "PartnerPaymentAttribution" FOR EACH ROW EXECUTE FUNCTION validate_remediation_links();
CREATE TRIGGER validate_reference BEFORE INSERT ON "QuarterEmployeeSettlement" FOR EACH ROW EXECUTE FUNCTION validate_remediation_links();
CREATE TRIGGER season_guard BEFORE INSERT ON "Project" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
