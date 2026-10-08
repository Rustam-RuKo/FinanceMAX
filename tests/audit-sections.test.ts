import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { db } from "../src/server/db";
import { executeCommand } from "../src/server/workflows";
import { readResource } from "../src/server/queries";
import { auditSectionRows } from "../src/server/audit-sections";
import {
  collectSeasonReport,
  partnerReport,
} from "../src/server/season-report";
import {
  buildWorkbook,
  managementTables,
  partnerTables,
} from "../src/server/excel-report";
import { initialAuditTemplates } from "../src/domain/audit-templates";
import type { Principal } from "../src/domain/authorization";
let user: Principal,
  seasonId: string,
  nextSeason: string,
  partnerId: string,
  employeeId: string,
  other: string,
  level: string,
  projectId: string,
  international: string,
  sectionId: string,
  secondSection: string;
const run = async (operation: string, data: Record<string, unknown>) =>
  (await executeCommand(user, { operation, data, requestId: randomUUID() })).id;
const query = (
  resource: string,
  extra: Record<string, string> = {},
  actor = user,
) => readResource(actor, resource, new URLSearchParams({ seasonId, ...extra }));
const work = (extra: Record<string, unknown> = {}) => ({
  seasonId,
  projectId,
  employeeId,
  projectAuditSectionId: sectionId,
  complexityLevelId: level,
  date: "2026-02-01",
  description: "Проверка первичных документов",
  plannedHours: "4",
  actualHours: "2.5",
  ...extra,
});
before(async () => {
  assert.match(process.env.TEST_DATABASE_NAME ?? "", /^financemax_test_/);
  const row = await db.user.create({
    data: {
      name: "Руководитель аудита",
      email: randomUUID() + "@test.local",
      passwordHash: "test-only",
      role: "ADMIN_MANAGEMENT",
      demo: true,
    },
  });
  user = { id: row.id, role: "ADMIN_MANAGEMENT" };
  seasonId = await run("season", {
    name: "Аудит 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  nextSeason = await run("season", {
    name: "Аудит 2027",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
  });
  partnerId = await run("partner", { name: "Партнер разделов" });
  employeeId = await run("employee", { name: "Секретное имя сотрудника А" });
  other = await run("employee", { name: "Секретное имя сотрудника Б" });
  level = await run("complexity", {
    name: "Проверка",
    hourlyRate: "123.4567",
    validFrom: "2026-01-01",
  });
  const templates = await db.auditSectionTemplate.findMany({
    where: { projectType: "INDUSTRIAL" },
    orderBy: { sortOrder: "asc" },
  });
  const project = {
    seasonId,
    partnerId,
    client: "Демо",
    partnerRate: "0.3",
    confirmed: true,
    startDate: "2026-01-01",
  };
  projectId = await run("project", {
    ...project,
    name: "Завод",
    code: randomUUID(),
    projectType: "INDUSTRIAL",
    sections: templates.slice(0, 2).map((t) => ({ templateId: t.id })),
  });
  international = await run("project", {
    ...project,
    name: "Международный",
    code: randomUUID(),
    projectType: "INTERNATIONAL",
  });
  const sections = await db.projectAuditSection.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });
  sectionId = sections[0].id;
  secondSection = sections[1].id;
});
after(() => db.$disconnect());
test("Коды с одинаковыми названиями остаются отдельными строками", async () => {
  const rows = await db.auditSectionTemplate.findMany({
    where: {
      projectType: "INTERNATIONAL",
      code: { in: ["E03/1", "E03/2", "E03/3"] },
    },
  });
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  assert.equal(new Set(rows.map((r) => r.name)).size, 1);
});
test("Каталоги содержат 24 и 42 точных кода и названия в исходном порядке", async () => {
  for (const type of ["INDUSTRIAL", "INTERNATIONAL"] as const) {
    const rows = await db.auditSectionTemplate.findMany({
      where: { projectType: type },
      orderBy: { sortOrder: "asc" },
    });
    assert.equal(rows.length, type === "INDUSTRIAL" ? 24 : 42);
    assert.deepEqual(
      rows.map((r) => [r.code, r.name]),
      initialAuditTemplates[type],
    );
  }
  const options: any = await query("lookups");
  assert.equal(
    options.auditTemplates.filter((t: any) => t.projectType === "INDUSTRIAL")
      .length,
    24,
  );
  assert.equal(
    options.auditTemplates.filter((t: any) => t.projectType === "INTERNATIONAL")
      .length,
    42,
  );
});
test("Тип обязателен; выбирается подмножество, другой каталог отклоняется", async () => {
  assert.equal(await db.projectAuditSection.count({ where: { projectId } }), 2);
  assert.equal(
    await db.projectAuditSection.count({ where: { projectId: international } }),
    0,
  );
  await assert.rejects(
    run("project", {
      seasonId,
      partnerId,
      name: "Без типа",
      code: randomUUID(),
      client: "Демо",
      partnerRate: "0.3",
      confirmed: true,
      startDate: "2026-01-01",
    }),
  );
  const t = await db.auditSectionTemplate.findFirstOrThrow({
    where: { projectType: "INTERNATIONAL" },
  });
  await assert.rejects(
    run("section-add", {
      seasonId,
      projectId,
      reason: "Неверный каталог",
      sections: [{ templateId: t.id }],
    }),
    /тип/,
  );
});
test("Многие ко многим: сотрудник в двух разделах, раздел с двумя сотрудниками", async () => {
  for (const [section, employee] of [
    [sectionId, employeeId],
    [secondSection, employeeId],
    [sectionId, other],
  ])
    await run("section-assignment", {
      seasonId,
      projectId,
      projectAuditSectionId: section,
      employeeId: employee,
      reason: "Назначение",
      plannedHours: "8",
    });
  assert.equal(
    await db.projectSectionAssignment.count({ where: { employeeId } }),
    2,
  );
  assert.equal(
    await db.projectSectionAssignment.count({
      where: { projectAuditSectionId: sectionId },
    }),
    2,
  );
});
test("Работа требует раздел; чужой проект и отсутствие назначения отклоняются", async () => {
  await assert.rejects(run("work", work({ projectAuditSectionId: undefined })));
  await assert.rejects(
    run("work", work({ projectId: international })),
    /раздел/i,
  );
  await assert.rejects(
    run(
      "work",
      work({ employeeId: other, projectAuditSectionId: secondSection }),
    ),
    /назнач/,
  );
});
test("Историческая ставка и заработок не изменены: 2.5 × 123.4567", async () => {
  const id = await run("work", work());
  const row = await db.workEntry.findUniqueOrThrow({ where: { id } });
  assert.equal(row.rateSnapshot.toFixed(4), "123.4567");
  assert.equal(row.earned.toFixed(4), "308.6418");
});
test("Пакетный ввод атомарен и проверяет даты каждой строки", async () => {
  const count = await db.workEntry.count();
  await assert.rejects(
    run("work-batch", {
      seasonId,
      entries: [work(), work({ date: "2027-01-01" })],
    }),
    /сезон/,
  );
  assert.equal(await db.workEntry.count(), count);
  await run("work-batch", {
    seasonId,
    entries: [
      work({ actualHours: "1", projectAuditSectionId: secondSection }),
      work({ actualHours: "2", employeeId: other }),
    ],
  });
  assert.equal(await db.workEntry.count(), count + 2);
});
test("Итоги разделов равны исходным WorkEntry; дашборд равен финансовому контракту", async () => {
  const report = await collectSeasonReport(db, seasonId),
    dashboard: any = await query("dashboard");
  assert.deepEqual(dashboard.totals, report.totals);
  const rows = await auditSectionRows(db, seasonId);
  assert.equal(rows.find((r) => r.id === sectionId)?.earned, "555.5552");
  assert.equal(rows.find((r) => r.id === secondSection)?.earned, "123.4567");
  assert.equal(dashboard.insights.auditProgress.withWork, 2);
});
test("Переименование шаблона не меняет проектный снимок", async () => {
  const section = await db.projectAuditSection.findUniqueOrThrow({
      where: { id: sectionId },
    }),
    template = await db.auditSectionTemplate.findUniqueOrThrow({
      where: { id: section.templateId! },
    });
  await run("audit-template", {
    ...template,
    description: template.description ?? undefined,
    name: "Новое название шаблона",
    reason: "Уточнение каталога",
  });
  assert.equal(
    (
      await db.projectAuditSection.findUniqueOrThrow({
        where: { id: sectionId },
      })
    ).nameSnapshot,
    section.nameSnapshot,
  );
});
test("Один проект, раздел и ставка сохраняются при продолжении в следующем сезоне", async () => {
  await run("project-season", {
    seasonId: nextSeason,
    projectId,
    reason: "Продолжение",
  });
  const before = await collectSeasonReport(db, seasonId);
  await run("work", work({ seasonId: nextSeason, date: "2027-01-10" }));
  const after = await collectSeasonReport(db, seasonId);
  assert.deepEqual(after, before);
  assert.equal(
    (
      await db.projectPartnerRate.findFirstOrThrow({ where: { projectId } })
    ).rate.toString(),
    "0.3",
  );
  assert.equal(await db.projectAuditSection.count({ where: { projectId } }), 2);
});
test("Сотрудник видит только собственные работы и суммы разделов", async () => {
  const employee: Principal = { id: user.id, role: "EMPLOYEE", employeeId };
  const rows: any = await query("audit-sections", {}, employee);
  assert.equal(
    rows.items.find((r: any) => r.id === sectionId).earned,
    "308.6418",
  );
  assert.ok(!JSON.stringify(rows).includes("Секретное имя сотрудника Б"));
  const detail: any = await query(
    "audit-section-detail",
    { id: sectionId },
    employee,
  );
  assert.ok(detail.work.every((w: any) => w.employeeId === employeeId));
  await assert.rejects(
    query("audit-sections", { employeeId: other }, employee),
  );
  await assert.rejects(
    query("employee-detail", { employeeId: other }, employee),
  );
  await assert.rejects(query("audit-templates", {}, employee));
});
test("Партнер не читает внутренние разделы и назначения", async () => {
  await assert.rejects(
    query("audit-sections", {}, { id: user.id, role: "PARTNER", partnerId }),
  );
});
test("Excel: 21/8 листов, разделы и рабочие снимки, ни одного pane, нет утечки партнеру", async () => {
  const source = await collectSeasonReport(db, seasonId);
  const management = managementTables(source);
  assert.equal(management.length, 21);
  assert.ok(management[20]);
  const partner = partnerReport(source, partnerId);
  assert.ok(!JSON.stringify(partner).includes("Секретное имя"));
  const tables = partnerTables(partner);
  assert.equal(tables.length, 8);
  for (const scope of ["management", "partner"] as const) {
    const buffer = await buildWorkbook(
      scope === "management" ? source : partner,
      scope,
      { user: "Тест", generatedAt: new Date(), draft: scope === "management" },
    );
    const opened = new ExcelJS.Workbook();
    await opened.xlsx.load(
      buffer as unknown as Parameters<typeof opened.xlsx.load>[0],
    );
    assert.equal(opened.worksheets.length, scope === "management" ? 21 : 8);
    for (const sheet of opened.worksheets)
      for (const view of sheet.views ?? []) assert.equal(view.state, "normal");
  }
});
test("Архив сохраняет работу, запрещает новую; изменения имеют аудит", async () => {
  await run("section-update", {
    seasonId,
    projectId,
    projectAuditSectionId: secondSection,
    active: false,
    sortOrder: 7,
    reason: "Архив раздела",
  });
  assert.equal(
    await db.workEntry.count({
      where: { projectAuditSectionId: secondSection },
    }),
    1,
  );
  await assert.rejects(
    run("work", work({ projectAuditSectionId: secondSection })),
    /раздел/i,
  );
  assert.ok(await db.auditLog.count({ where: { entityId: secondSection } }));
});
test("Legacy без раздела остается без фиктивной атрибуции; явное отнесение сохраняет деньги", async () => {
  // Simulate a pre-migration row only inside the disposable database; keep all other guards active.
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  assert.equal(url.pathname.slice(1), process.env.TEST_DATABASE_NAME);
  const owner = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  try {
    const source = await db.workEntry.findFirstOrThrow({
      where: { projectAuditSectionId: sectionId, seasonId },
    });
    const legacy = await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "WorkEntry" DISABLE TRIGGER work_section',
      );
      await tx.$executeRaw`SELECT set_config('financemax.actor',${user.id},true)`;
      const row = await tx.workEntry.create({
        data: { ...source, id: randomUUID(), projectAuditSectionId: null },
      });
      await tx.$executeRawUnsafe(
        'ALTER TABLE "WorkEntry" ENABLE TRIGGER work_section',
      );
      return row;
    });
    const report = await collectSeasonReport(db, seasonId);
    assert.equal(
      report.work.find((w) => w.id === legacy.id)?.projectAuditSectionId,
      null,
    );
    await run("work-section-attribution", {
      seasonId,
      projectId,
      projectAuditSectionId: sectionId,
      workEntryId: legacy.id,
      confirmed: true,
      reason: "Добровольная атрибуция исторической работы",
    });
    const now = await db.workEntry.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    assert.equal(now.earned.toString(), legacy.earned.toString());
    assert.equal(now.rateSnapshot.toString(), legacy.rateSnapshot.toString());
    assert.equal(now.projectAuditSectionId, sectionId);
    assert.ok(await db.auditLog.count({ where: { entityId: legacy.id } }));
  } finally {
    await owner.$disconnect();
  }
});

test("Закрытый сезон не допускает изменений разделов или назначений", async () => {
  await db.season.update({
    where: { id: seasonId },
    data: { status: "Закрыт", updatedBy: user.id },
  });
  await db.season.update({
    where: { id: nextSeason },
    data: { status: "Закрыт", updatedBy: user.id },
  });
  await assert.rejects(
    run("section-add", {
      seasonId,
      projectId,
      reason: "Закрытый сезон",
      sections: [{ code: "НЕТ", name: "Запрещено" }],
    }),
    /закрыт/,
  );
  await assert.rejects(
    run("section-assignment", {
      seasonId,
      projectId,
      projectAuditSectionId: sectionId,
      employeeId,
      reason: "Закрытый сезон",
    }),
    /закрыт/,
  );
  await assert.rejects(
    db.projectAuditSection.update({
      where: { id: sectionId },
      data: { active: false },
    }),
    /закрыты/,
  );
});
