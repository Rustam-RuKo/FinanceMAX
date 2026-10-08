DROP INDEX "QuarterEmployeeSettlement_seasonId_employeeId_periodStart_key";
CREATE INDEX "QuarterEmployeeSettlement_seasonId_employeeId_periodStart_idx" ON "QuarterEmployeeSettlement"("seasonId","employeeId","periodStart");
DROP INDEX "SeasonEmployeeSettlement_seasonId_employeeId_key";
CREATE INDEX "SeasonEmployeeSettlement_seasonId_employeeId_idx" ON "SeasonEmployeeSettlement"("seasonId","employeeId");
CREATE FUNCTION immutable_financial_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Историческая запись неизменяема. Создайте новый расчет или сторно'; END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['EmployeePayment','PartnerPayment','CashOutTransaction','CashOutAllocation','QuarterEmployeeSettlement','SeasonEmployeeSettlement','AllocationRun','ProjectAllocation','SettlementSource'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_financial_row()',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_rate_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_column text; entity_id text; start_date date; end_date date; conflicting boolean;
BEGIN
 entity_column:=TG_ARGV[0];entity_id:=to_jsonb(NEW)->>entity_column;start_date:=NEW."validFrom";end_date:=NEW."validTo";
 PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || entity_id));
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['validTo','updatedAt','updatedBy']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['validTo','updatedAt','updatedBy']) THEN RAISE EXCEPTION 'Ставка неизменяема: создайте новую историческую ставку'; END IF;
 EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I::text=$1 AND id<>$2 AND "validFrom"<=COALESCE($4,''9999-12-31''::date) AND COALESCE("validTo",''9999-12-31''::date)>=$3)',TG_TABLE_NAME,entity_column) INTO conflicting USING entity_id,NEW.id,start_date,end_date;
 IF conflicting THEN RAISE EXCEPTION 'Периоды ставок пересекаются'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER rate_history BEFORE INSERT OR UPDATE ON "EmployeeSalaryRate" FOR EACH ROW EXECUTE FUNCTION guard_rate_history('employeeId');
CREATE TRIGGER rate_history BEFORE INSERT OR UPDATE ON "ComplexityRate" FOR EACH ROW EXECUTE FUNCTION guard_rate_history('complexityLevelId');
CREATE TRIGGER rate_history BEFORE INSERT OR UPDATE ON "ProjectPartnerRate" FOR EACH ROW EXECUTE FUNCTION guard_rate_history('projectId');
CREATE TRIGGER rate_history BEFORE INSERT OR UPDATE ON "CashOutMethodRate" FOR EACH ROW EXECUTE FUNCTION guard_rate_history('cashOutMethodId');
CREATE FUNCTION validate_cashout_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; fee numeric; allocated numeric;
BEGIN
 IF TG_TABLE_NAME='CashOutTransaction' THEN target_id:=NEW.id; ELSE target_id:=NEW."cashOutTransactionId"; END IF;
 SELECT "actualFee" INTO fee FROM "CashOutTransaction" WHERE id=target_id;
 SELECT COALESCE(SUM(amount),0) INTO allocated FROM "CashOutAllocation" WHERE "cashOutTransactionId"=target_id;
 IF fee IS DISTINCT FROM allocated THEN RAISE EXCEPTION 'Распределение стоимости обналичивания не сходится'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER fee_total AFTER INSERT ON "CashOutTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_cashout_allocations();
CREATE CONSTRAINT TRIGGER fee_total AFTER INSERT ON "CashOutAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_cashout_allocations();
