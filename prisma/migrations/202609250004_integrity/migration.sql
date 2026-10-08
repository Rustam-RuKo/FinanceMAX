ALTER TABLE "ProjectAllocation" ADD COLUMN revenue NUMERIC(20,4), ADD COLUMN "directCost" NUMERIC(20,4), ADD COLUMN "allocationShare" NUMERIC(18,12);
ALTER TABLE "ProjectAllocation" ADD CHECK ((revenue IS NULL OR revenue>=0) AND ("directCost" IS NULL OR "directCost">=0) AND ("allocationShare" IS NULL OR "allocationShare" BETWEEN 0 AND 1));
ALTER TABLE "QuarterEmployeeSettlement" ADD CHECK (difference=earned+ktu+"carryIn"-salary AND salary>=0 AND bonus=ROUND(GREATEST(difference,0)/2,4) AND "carryOut"=ROUND(GREATEST(difference,0)/2,4));
CREATE FUNCTION check_financial_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; project_season uuid; expected_employee uuid; expected_season uuid; parent_project uuid;
BEGIN
 r:=to_jsonb(NEW);
 IF r->>'projectId' IS NOT NULL AND r->>'seasonId' IS NOT NULL THEN
  SELECT "seasonId" INTO project_season FROM "Project" WHERE id=(r->>'projectId')::uuid;
  IF project_season IS DISTINCT FROM (r->>'seasonId')::uuid THEN RAISE EXCEPTION 'Проект относится к другому сезону'; END IF;
 END IF;
 IF TG_TABLE_NAME='WorkEntry' THEN
  IF NOT EXISTS(SELECT 1 FROM "ProjectAssignment" WHERE "projectId"=NEW."projectId" AND "employeeId"=NEW."employeeId") THEN RAISE EXCEPTION 'Сотрудник не назначен на проект'; END IF;
 END IF;
 IF TG_TABLE_NAME='EmployeePayment' AND NEW."quarterEmployeeSettlementId" IS NOT NULL THEN
  SELECT "employeeId","seasonId" INTO expected_employee,expected_season FROM "QuarterEmployeeSettlement" WHERE id=NEW."quarterEmployeeSettlementId";
  IF expected_employee IS DISTINCT FROM NEW."employeeId" OR expected_season IS DISTINCT FROM NEW."seasonId" THEN RAISE EXCEPTION 'Бонус связан с чужим расчетом'; END IF;
 END IF;
 IF TG_TABLE_NAME='CashOutAllocation' THEN
  SELECT "seasonId" INTO expected_season FROM "CashOutTransaction" WHERE id=NEW."cashOutTransactionId";
  IF NEW."projectId" IS NOT NULL THEN
   SELECT "seasonId" INTO project_season FROM "Project" WHERE id=NEW."projectId";
   IF project_season IS DISTINCT FROM expected_season THEN RAISE EXCEPTION 'Распределение относится к другому сезону'; END IF;
  END IF;
  IF NEW."businessTripId" IS NOT NULL THEN
   SELECT "seasonId","projectId" INTO project_season,parent_project FROM "BusinessTrip" WHERE id=NEW."businessTripId";
   IF project_season IS DISTINCT FROM expected_season OR parent_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Командировка не соответствует распределению'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['WorkEntry','Expense','ProjectRevenue','BusinessTrip','EmployeePayment','CashOutAllocation'] LOOP
 EXECUTE format('CREATE TRIGGER consistent_links BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION check_financial_links()',t);
 END LOOP;
END $$;
