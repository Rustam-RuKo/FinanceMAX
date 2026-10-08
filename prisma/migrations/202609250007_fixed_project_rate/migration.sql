-- Preserve existing rates. Ambiguous legacy data must be reviewed explicitly.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "ProjectPartnerRate" GROUP BY "projectId" HAVING count(*)>1) THEN
 RAISE EXCEPTION 'У проекта несколько ставок: требуется явное управленческое исправление перед миграцией';
 END IF;
END $$;
CREATE UNIQUE INDEX "ProjectPartnerRate_projectId_key" ON "ProjectPartnerRate"("projectId");
DROP TRIGGER rate_history ON "ProjectPartnerRate";
CREATE FUNCTION guard_fixed_project_rate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Фиксированную ставку проекта нельзя удалить'; END IF;
 IF TG_OP='INSERT' AND NEW."validTo" IS NOT NULL THEN RAISE EXCEPTION 'Ставка действует весь проект без даты окончания'; END IF;
 IF TG_OP='UPDATE' THEN
  actor := NULLIF(current_setting('financemax.actor',true),'')::uuid;
  IF current_setting('financemax.project_rate_correction',true) IS DISTINCT FROM OLD."projectId"::text
   OR COALESCE(trim(current_setting('financemax.reason',true)),'')=''
   OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=actor AND role='ADMIN_MANAGEMENT' AND active=true)
   OR NEW."updatedBy" IS DISTINCT FROM actor
   OR (to_jsonb(NEW)-ARRAY['rate','updatedAt','updatedBy']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['rate','updatedAt','updatedBy']) THEN
   RAISE EXCEPTION 'Ставка проекта фиксирована. Требуется подтвержденное управленческое исправление с причиной и аудитом';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixed_project_rate BEFORE INSERT OR UPDATE OR DELETE ON "ProjectPartnerRate" FOR EACH ROW EXECUTE FUNCTION guard_fixed_project_rate();
