-- Additive only: existing rows and all integrity constraints are preserved.
ALTER TABLE "SeasonClosing" ADD COLUMN "reportSnapshot" JSONB;
ALTER TABLE "SeasonClosing" ADD COLUMN "reportFingerprint" TEXT;
ALTER TABLE "SeasonClosing" ADD CONSTRAINT "report_snapshot_pair"
CHECK (("reportSnapshot" IS NULL) = ("reportFingerprint" IS NULL));
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "SeasonClosing"
FOR EACH ROW EXECUTE FUNCTION immutable_financial_row();
