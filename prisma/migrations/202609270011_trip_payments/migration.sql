-- AlterTable
ALTER TABLE "BusinessTrip" ADD COLUMN     "paymentTrackingStarted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TripPaymentLink" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "businessTripId" UUID NOT NULL,
    "journalTransactionId" UUID NOT NULL,
    "cashOutTransactionId" UUID,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "document" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPaymentReview" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "businessTripId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPaymentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripPaymentLink_journalTransactionId_key" ON "TripPaymentLink"("journalTransactionId");

-- CreateIndex
CREATE INDEX "TripPaymentLink_businessTripId_idx" ON "TripPaymentLink"("businessTripId");

-- CreateIndex
CREATE INDEX "TripPaymentReview_businessTripId_idx" ON "TripPaymentReview"("businessTripId");

-- AddForeignKey
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT "TripPaymentLink_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT "TripPaymentLink_businessTripId_fkey" FOREIGN KEY ("businessTripId") REFERENCES "BusinessTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT "TripPaymentLink_journalTransactionId_fkey" FOREIGN KEY ("journalTransactionId") REFERENCES "JournalTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT "TripPaymentLink_cashOutTransactionId_fkey" FOREIGN KEY ("cashOutTransactionId") REFERENCES "CashOutTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT "TripPaymentLink_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentReview" ADD CONSTRAINT "TripPaymentReview_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentReview" ADD CONSTRAINT "TripPaymentReview_businessTripId_fkey" FOREIGN KEY ("businessTripId") REFERENCES "BusinessTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPaymentReview" ADD CONSTRAINT "TripPaymentReview_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing financial amounts and historical attributions are deliberately untouched.
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT trip_payment_kind CHECK (kind IN ('ADVANCE','PAYMENT','REIMBURSEMENT','SETTLEMENT','RETURN'));
ALTER TABLE "TripPaymentLink" ADD CONSTRAINT trip_payment_reason CHECK (length(trim(reason)) > 0);
ALTER TABLE "TripPaymentReview" ADD CONSTRAINT trip_review_reason CHECK (length(trim(reason)) > 0);
CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "TripPaymentLink" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
CREATE TRIGGER season_guard BEFORE INSERT OR UPDATE OR DELETE ON "TripPaymentReview" FOR EACH ROW EXECUTE FUNCTION guard_season_record();
CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON "TripPaymentLink" FOR EACH ROW EXECUTE FUNCTION audit_remediation();
CREATE TRIGGER financial_audit AFTER INSERT ON "TripPaymentReview" FOR EACH ROW EXECUTE FUNCTION audit_remediation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "TripPaymentReview" FOR EACH ROW EXECUTE FUNCTION immutable_financial_row();
CREATE FUNCTION validate_trip_payment_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record; j record; n integer;
BEGIN
 SELECT * INTO t FROM "BusinessTrip" WHERE id=NEW."businessTripId";
 IF t."seasonId" IS DISTINCT FROM NEW."seasonId" THEN RAISE EXCEPTION 'Командировка другого сезона'; END IF;
 IF TG_TABLE_NAME='TripPaymentReview' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW."journalTransactionId"<>OLD."journalTransactionId" OR NEW."createdBy"<>OLD."createdBy" OR NEW."createdAt"<>OLD."createdAt") THEN RAISE EXCEPTION 'Исходный платеж и автор связи неизменны'; END IF;
 SELECT * INTO j FROM "JournalTransaction" WHERE id=NEW."journalTransactionId";
 IF j."seasonId" IS DISTINCT FROM NEW."seasonId" OR j."employeeId" IS DISTINCT FROM t."employeeId" OR j.status<>'POSTED' OR j."reversalOf" IS NOT NULL OR EXISTS(SELECT 1 FROM "JournalTransaction" WHERE "reversalOf"=j.id) THEN RAISE EXCEPTION 'Недействительная выплата командировки'; END IF;
 IF j.operation NOT IN ('TRIP_PAYMENT','TRIP_RETURN') AND NOT EXISTS(SELECT 1 FROM "EmployeePayment" WHERE "journalTransactionId"=j.id AND "kindSnapshot"='REIMBURSEMENT' AND NEW.kind='REIMBURSEMENT') THEN RAISE EXCEPTION 'Нельзя отнести зарплату или перевод к командировке'; END IF;
 IF j.operation IN ('TRIP_PAYMENT','TRIP_RETURN') AND j."projectId" IS DISTINCT FROM t."projectId" THEN RAISE EXCEPTION 'Проект выплаты отличается от командировки'; END IF;
 IF (j.operation='TRIP_RETURN')<>(NEW.kind='RETURN') THEN RAISE EXCEPTION 'Неверное направление выплаты'; END IF;
 SELECT count(*) INTO n FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."ledgerAccountId" WHERE l."journalTransactionId"=j.id AND a.kind IN ('BANK','CASH');
 IF n<>1 THEN RAISE EXCEPTION 'Требуется один денежный счет'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."ledgerAccountId" WHERE l."journalTransactionId"=j.id AND a.kind IN ('BANK','CASH') AND CASE WHEN NEW.kind='RETURN' THEN l.debit>0 AND l.credit=0 ELSE l.credit>0 AND l.debit=0 END) THEN RAISE EXCEPTION 'Неверная денежная проводка командировки'; END IF;
 IF NEW."cashOutTransactionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CashOutTransaction" c JOIN "JournalTransaction" cj ON cj.id=c."journalTransactionId" JOIN "JournalLine" l ON l."journalTransactionId"=j.id AND l."ledgerAccountId"=c."cashAccountId" WHERE c.id=NEW."cashOutTransactionId" AND c."seasonId"=NEW."seasonId" AND cj."postingDate"<=j."postingDate" AND cj.status='POSTED' AND NEW.kind<>'RETURN' AND NOT EXISTS(SELECT 1 FROM "JournalTransaction" r WHERE r."reversalOf"=cj.id)) THEN RAISE EXCEPTION 'Источник наличных не соответствует выплате'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_links BEFORE INSERT OR UPDATE ON "TripPaymentLink" FOR EACH ROW EXECUTE FUNCTION validate_trip_payment_link();
CREATE TRIGGER trip_links BEFORE INSERT ON "TripPaymentReview" FOR EACH ROW EXECUTE FUNCTION validate_trip_payment_link();
