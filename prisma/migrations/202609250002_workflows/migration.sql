-- AlterTable
ALTER TABLE "User" ADD COLUMN     "demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkEntry" ADD COLUMN     "correctionOf" UUID,
ADD COLUMN     "voided" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmployeePayment" ADD COLUMN     "kindSnapshot" TEXT NOT NULL DEFAULT 'SALARY';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "correctionOf" UUID,
ADD COLUMN     "costType" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "journalTransactionId" UUID,
ADD COLUMN     "voided" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProjectRevenue" ADD COLUMN     "correctionOf" UUID,
ADD COLUMN     "journalTransactionId" UUID,
ADD COLUMN     "voided" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BusinessTrip" ADD COLUMN     "correctionOf" UUID,
ADD COLUMN     "hotel" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "other" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "perDiemAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "transport" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "voided" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bank" TEXT;

-- AlterTable
ALTER TABLE "JournalTransaction" ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "employeeId" UUID,
ADD COLUMN     "operation" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
ADD COLUMN     "partnerId" UUID,
ADD COLUMN     "projectId" UUID,
ADD COLUMN     "sourceId" UUID,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "CashOutAllocation" ADD COLUMN     "businessTripId" UUID;

-- AlterTable
ALTER TABLE "QuarterEmployeeSettlement" ADD COLUMN     "sourceRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SeasonEmployeeSettlement" ADD COLUMN     "sourceRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AllocationRun" ADD COLUMN     "sourceRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSource" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "settlementType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "SettlementSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSource_settlementId_sourceId_sourceType_key" ON "SettlementSource"("settlementId", "sourceId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkEntry_correctionOf_key" ON "WorkEntry"("correctionOf");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_journalTransactionId_key" ON "Expense"("journalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_correctionOf_key" ON "Expense"("correctionOf");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRevenue_journalTransactionId_key" ON "ProjectRevenue"("journalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRevenue_correctionOf_key" ON "ProjectRevenue"("correctionOf");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTrip_correctionOf_key" ON "BusinessTrip"("correctionOf");

ALTER TABLE "EmployeeSalaryRate" ADD CHECK (amount >= 0 AND ("validTo" IS NULL OR "validTo" >= "validFrom"));
ALTER TABLE "ComplexityRate" ADD CHECK ("hourlyRate" >= 0 AND ("validTo" IS NULL OR "validTo" >= "validFrom"));
ALTER TABLE "ProjectPartnerRate" ADD CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "CashOutMethodRate" ADD CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "Project" ADD CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "BusinessTrip" ADD CHECK ("endDate" >= "startDate" AND days > 0 AND "perDiemRate" >= 0 AND transport >= 0 AND hotel >= 0 AND other >= 0 AND "perDiemAmount" = ROUND(days * "perDiemRate",4));
ALTER TABLE "ProjectAllocation" ADD CHECK (weight >= 0 AND allocated >= 0 AND entitlement >= 0 AND "rateSnapshot" BETWEEN 0 AND 1);
ALTER TABLE "CashOutAllocation" ADD CHECK (amount >= 0);
ALTER TABLE "AllocationRun" ADD CHECK (pool >= 0 AND "periodEnd" >= "periodStart");
ALTER TABLE "ProjectRevenue" ADD CHECK (amount >= 0);
ALTER TABLE "QuarterEmployeeSettlement" ADD CHECK (earned >= 0 AND ktu = ROUND(earned * 0.30,4) AND "periodEnd" >= "periodStart");
ALTER TABLE "JournalTransaction" ADD CHECK (status IN ('DRAFT','POSTED'));
ALTER TABLE "EmployeePayment" ADD CHECK ("kindSnapshot" IN ('SALARY','BONUS','OTHER','REIMBURSEMENT','FINAL') AND ("kindSnapshot" <> 'BONUS' OR "quarterEmployeeSettlementId" IS NOT NULL));
ALTER TABLE "CashOutAllocation" ADD FOREIGN KEY ("businessTripId") REFERENCES "BusinessTrip"(id) ON DELETE RESTRICT;
ALTER TABLE "Expense" ADD FOREIGN KEY ("journalTransactionId") REFERENCES "JournalTransaction"(id) ON DELETE RESTRICT;
ALTER TABLE "ProjectRevenue" ADD FOREIGN KEY ("journalTransactionId") REFERENCES "JournalTransaction"(id) ON DELETE RESTRICT;
ALTER TABLE "CommandReceipt" ADD FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "JournalTransaction" ADD FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT;
ALTER TABLE "JournalTransaction" ADD FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE RESTRICT;
ALTER TABLE "JournalTransaction" ADD FOREIGN KEY ("partnerId") REFERENCES "Partner"(id) ON DELETE RESTRICT;

CREATE FUNCTION protect_posted_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_status text;
BEGIN
 IF TG_TABLE_NAME = 'JournalTransaction' THEN
  IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'Проведенная операция неизменяема: создайте сторно'; END IF;
 ELSE
  SELECT status INTO transaction_status FROM "JournalTransaction" WHERE id = COALESCE(OLD."journalTransactionId",NEW."journalTransactionId") FOR UPDATE;
  IF transaction_status = 'POSTED' THEN RAISE EXCEPTION 'Проводки проведенной операции неизменяемы'; END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE TRIGGER posted_history BEFORE UPDATE OR DELETE ON "JournalTransaction" FOR EACH ROW EXECUTE FUNCTION protect_posted_history();
CREATE TRIGGER posted_lines BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION protect_posted_history();

CREATE FUNCTION guard_season_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; season_id uuid; season_status text; parent_id uuid;
BEGIN
 row_data := COALESCE(to_jsonb(NEW),to_jsonb(OLD));
 season_id := (row_data->>'seasonId')::uuid;
 IF season_id IS NULL AND row_data ? 'projectId' THEN SELECT "seasonId" INTO season_id FROM "Project" WHERE id=(row_data->>'projectId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'journalTransactionId' THEN SELECT "seasonId" INTO season_id FROM "JournalTransaction" WHERE id=(row_data->>'journalTransactionId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'cashOutTransactionId' THEN SELECT "seasonId" INTO season_id FROM "CashOutTransaction" WHERE id=(row_data->>'cashOutTransactionId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'allocationRunId' THEN SELECT "seasonId" INTO season_id FROM "AllocationRun" WHERE id=(row_data->>'allocationRunId')::uuid; END IF;
 IF season_id IS NULL AND row_data ? 'seasonClosingId' THEN SELECT "seasonId" INTO season_id FROM "SeasonClosing" WHERE id=(row_data->>'seasonClosingId')::uuid; END IF;
 SELECT status INTO season_status FROM "Season" WHERE id=season_id FOR UPDATE;
 IF season_status='Закрыт' THEN RAISE EXCEPTION 'Сезон закрыт. Требуется авторизованное открытие для коррекции'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Удаление финансовой истории запрещено'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'seasonId') IS DISTINCT FROM (row_data->>'seasonId') THEN RAISE EXCEPTION 'Перенос записи между сезонами запрещен'; END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['Project','ProjectAssignment','ProjectPartnerRate','WorkEntry','EmployeePayment','Expense','ProjectRevenue','BusinessTrip','JournalTransaction','JournalLine','CashOutTransaction','CashOutAllocation','CashReconciliation','QuarterEmployeeSettlement','SeasonEmployeeSettlement','AllocationRun','ProjectAllocation','PartnerPayment','SeasonClosing','SeasonClosingCheck'] LOOP
 EXECUTE format('CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_season_record()',t);
 END LOOP;
END $$;

CREATE FUNCTION audit_financial_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 actor := COALESCE(NULLIF(current_setting('financemax.actor',true),''),to_jsonb(NEW)->>'updatedBy',to_jsonb(NEW)->>'createdBy')::uuid;
 INSERT INTO "AuditLog"(id,entity,"entityId",operation,"oldValue","newValue",reason,"createdAt","updatedAt","createdBy")
 VALUES(gen_random_uuid(),TG_TABLE_NAME,NEW.id,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),NULLIF(current_setting('financemax.reason',true),''),now(),now(),actor);
 RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['Season','Employee','Partner','Project','ProjectAssignment','EmployeeSalaryRate','ComplexityRate','ProjectPartnerRate','WorkEntry','PaymentCategory','EmployeePayment','Expense','ProjectRevenue','BusinessTrip','LedgerAccount','JournalTransaction','CashOutMethodRate','CashOutTransaction','CashOutAllocation','CashReconciliation','QuarterEmployeeSettlement','SeasonEmployeeSettlement','AllocationRun','ProjectAllocation','PartnerPayment','SeasonClosing','SeasonClosingCheck'] LOOP
 EXECUTE format('CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION audit_financial_change()',t);
 END LOOP;
END $$;

CREATE FUNCTION protect_economic_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['voided','updatedAt','updatedBy']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voided','updatedAt','updatedBy']) OR OLD.voided OR NOT NEW.voided OR COALESCE(current_setting('financemax.reason',true),'')='' THEN
 RAISE EXCEPTION 'Используйте отмену с причиной и новую корректирующую запись'; END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['WorkEntry','Expense','ProjectRevenue','BusinessTrip'] LOOP
 EXECUTE format('CREATE TRIGGER economic_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_economic_record()',t);
 END LOOP;
END $$;
