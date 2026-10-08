ALTER TABLE "Expense" ADD COLUMN "allocationReference" TEXT;
ALTER TABLE "Expense" ADD COLUMN "allocationOriginalTotal" DECIMAL(20,4);
ALTER TABLE "Expense" ADD CONSTRAINT "expense_manual_reference_pair" CHECK
 (("allocationReference" IS NULL AND "allocationOriginalTotal" IS NULL) OR
  ("allocationReference" IS NOT NULL AND "allocationOriginalTotal" IS NOT NULL AND length(trim("allocationReference")) > 0 AND "allocationOriginalTotal" > 0));
