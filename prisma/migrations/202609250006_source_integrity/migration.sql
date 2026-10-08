CREATE FUNCTION validate_settlement_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found_source boolean := false; found_settlement boolean := false;
BEGIN
 CASE NEW."sourceType"
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
CREATE TRIGGER settlement_source_exists BEFORE INSERT ON "SettlementSource" FOR EACH ROW EXECUTE FUNCTION validate_settlement_source();
