-- CreateEnum
CREATE TYPE "AuditProjectType" AS ENUM ('INDUSTRIAL', 'INTERNATIONAL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "projectType" "AuditProjectType";

-- AlterTable
ALTER TABLE "WorkEntry" ADD COLUMN     "projectAuditSectionId" UUID;

-- CreateTable
CREATE TABLE "AuditSectionTemplate" (
    "id" UUID NOT NULL,
    "projectType" "AuditProjectType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,

    CONSTRAINT "AuditSectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAuditSection" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "templateId" UUID,
    "codeSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "ProjectAuditSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSectionAssignment" (
    "id" UUID NOT NULL,
    "projectAuditSectionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "plannedHours" DECIMAL(12,4),
    "defaultComplexityLevelId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "ProjectSectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditSectionTemplate_projectType_code_key" ON "AuditSectionTemplate"("projectType", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAuditSection_projectId_codeSnapshot_key" ON "ProjectAuditSection"("projectId", "codeSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSectionAssignment_projectAuditSectionId_employeeId_key" ON "ProjectSectionAssignment"("projectAuditSectionId", "employeeId");

-- AddForeignKey
ALTER TABLE "WorkEntry" ADD CONSTRAINT "WorkEntry_projectAuditSectionId_fkey" FOREIGN KEY ("projectAuditSectionId") REFERENCES "ProjectAuditSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAuditSection" ADD CONSTRAINT "ProjectAuditSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAuditSection" ADD CONSTRAINT "ProjectAuditSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AuditSectionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAuditSection" ADD CONSTRAINT "ProjectAuditSection_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_projectAuditSectionId_fkey" FOREIGN KEY ("projectAuditSectionId") REFERENCES "ProjectAuditSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_defaultComplexityLevelId_fkey" FOREIGN KEY ("defaultComplexityLevelId") REFERENCES "ComplexityLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Initial catalogs; historical rows remain unassigned.
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E','Программа',1);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 01','Правоустанавливающие документы',2);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 02','Основные средства все процедуры',3);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 05','ТМЗ все процедуры',4);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 13','Проверка кассы',5);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 14/1','Расчетный счет все процедуры',6);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 14/2','Расчетный счет все процедуры',7);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 14/3','Расчетный счет все процедуры',8);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 17','Командировочные все процедуры',9);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','D 19','Заработная плата все процедуры',10);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E03/1','Строительство все процедуры',11);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E03/2','Строительство все процедуры',12);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E03/3','Строительство все процедуры',13);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E04/1','Консультанты все процедуры',14);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E04/2','Консультанты все процедуры',15);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E04/3','Консультанты все процедуры',16);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E05/1','Товары',17);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E05/2','Товары',18);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E05/3','Товары',19);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E06/1','Операц. все процедуры',20);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E06/2','Операц. все процедуры',21);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E06/3','Операц. все процедуры',22);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E07/1','Тренинги',23);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E07/2','Тренинги',24);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E07/3','Тренинги',25);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E08','Финансирование',26);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E09/1','свод COE с р/с',27);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','E09/2','свод COE с р/с',28);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/И','Инвентаризация',29);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/О','Отчет',30);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/П1','Папка',31);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/П2','Папка',32);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/ПД','Проверка рабочих документов',33);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/ПР','Письмо руководству',34);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Пр1','Прочее 1',35);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Пр2','Прочее 2',36);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Пр3','Прочее 3',37);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Пр4','Прочее 4',38);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Пр5','Прочее 5',39);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/С','Сводная отчетность',40);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','П/Ч','Чек листы',41);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INTERNATIONAL','Р/Р1','Руководство',42);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 01','Основные средства',1);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 02','Капитальные вложения',2);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 03','Финансовые вложения',3);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 04','Производственные запасы',4);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 05','Учет затрат и себестоимость',5);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 06','Товары',6);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 07','Расходы и доходы будущих периодов',7);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 08','Реализация готовой продукции',8);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 09','Внутрисистемные расчеты',9);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 10','Денежные средства',10);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 11','Расчеты с поставщиками',11);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 12','Налогообложение',12);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 13','Расчеты с персоналом',13);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 14','Прочие дебиторы и кредиторы',14);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 15','Подотчетные лица',15);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 16','Капитал, расчеты с учредителями',16);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 17','Кредиты и займы',17);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','D 18','Учет расходов периода',18);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','КР','Корректировочный баланс',19);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','ОТ','Написание отчета',20);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','ПВ','Перевод',21);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','ПК','Подготовка папки',22);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','РД','Проверка рабочих документов',23);
INSERT INTO "AuditSectionTemplate" (id,"projectType",code,name,"sortOrder") VALUES(gen_random_uuid(),'INDUSTRIAL','РК','Руководство',24);

-- Guard new work without retroactively fabricating legacy sections.
CREATE FUNCTION validate_work_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW."projectAuditSectionId" IS NULL THEN RAISE EXCEPTION 'Выберите раздел аудита'; END IF;
 IF NEW."projectAuditSectionId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."projectAuditSectionId" IS DISTINCT FROM OLD."projectAuditSectionId") THEN
  IF NOT EXISTS(SELECT 1 FROM "ProjectAuditSection" s JOIN "ProjectSectionAssignment" a ON a."projectAuditSectionId"=s.id WHERE s.id=NEW."projectAuditSectionId" AND s."projectId"=NEW."projectId" AND s.active AND a."employeeId"=NEW."employeeId" AND a.active) THEN RAISE EXCEPTION 'Раздел другого проекта, архивирован или сотрудник не назначен'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_section BEFORE INSERT OR UPDATE ON "WorkEntry" FOR EACH ROW EXECUTE FUNCTION validate_work_section();
CREATE FUNCTION validate_new_project_type() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."projectType" IS NULL THEN RAISE EXCEPTION 'Выберите тип проекта'; END IF; RETURN NEW; END $$;
CREATE TRIGGER new_project_type BEFORE INSERT ON "Project" FOR EACH ROW EXECUTE FUNCTION validate_new_project_type();
CREATE OR REPLACE FUNCTION protect_economic_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='WorkEntry' AND current_setting('financemax.section_attribution',true)=OLD.id::text AND (to_jsonb(OLD)->>'projectAuditSectionId') IS NULL AND (to_jsonb(NEW)->>'projectAuditSectionId') IS NOT NULL AND NOT OLD.voided AND COALESCE(current_setting('financemax.reason',true),'')<>'' AND (to_jsonb(NEW)-ARRAY['projectAuditSectionId','updatedAt','updatedBy'])=(to_jsonb(OLD)-ARRAY['projectAuditSectionId','updatedAt','updatedBy']) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['voided','updatedAt','updatedBy']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voided','updatedAt','updatedBy']) OR OLD.voided OR NOT NEW.voided OR COALESCE(current_setting('financemax.reason',true),'')='' THEN RAISE EXCEPTION 'Используйте отмену с причиной и новую корректирующую запись'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_audit_section() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Используйте архивирование раздела или назначения'; END IF;
 IF TG_TABLE_NAME='ProjectAuditSection' THEN pid:=NEW."projectId";
 ELSE SELECT "projectId" INTO pid FROM "ProjectAuditSection" WHERE id=NEW."projectAuditSectionId"; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectSeason" ps JOIN "Season" s ON s.id=ps."seasonId" WHERE ps."projectId"=pid AND s.status<>'Закрыт') THEN RAISE EXCEPTION 'Все сезоны проекта закрыты'; END IF;
 IF TG_OP='UPDATE' AND (NEW."createdBy"<>OLD."createdBy" OR NEW."createdAt"<>OLD."createdAt") THEN RAISE EXCEPTION 'Автор и дата создания неизменны'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='ProjectAuditSection' THEN
   IF (to_jsonb(NEW)-ARRAY['active','sortOrder']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','sortOrder']) THEN RAISE EXCEPTION 'Снимок раздела неизменен'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['active','plannedHours','defaultComplexityLevelId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','plannedHours','defaultComplexityLevelId']) THEN RAISE EXCEPTION 'Сотрудник и раздел назначения неизменны'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER section_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectAuditSection" FOR EACH ROW EXECUTE FUNCTION guard_audit_section();
CREATE TRIGGER section_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectSectionAssignment" FOR EACH ROW EXECUTE FUNCTION guard_audit_section();
CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON "ProjectAuditSection" FOR EACH ROW EXECUTE FUNCTION audit_remediation();
CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON "ProjectSectionAssignment" FOR EACH ROW EXECUTE FUNCTION audit_remediation();
CREATE TRIGGER financial_audit AFTER INSERT OR UPDATE ON "AuditSectionTemplate" FOR EACH ROW EXECUTE FUNCTION audit_remediation();
ALTER TABLE "ProjectSectionAssignment" ADD CHECK ("plannedHours" IS NULL OR "plannedHours">=0);
