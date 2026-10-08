import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { executeCommand } from "./section-fixtures";
import {
  collectSeasonReport,
  readSeasonReport,
} from "../src/server/season-report";
import { expenseReferenceChecks } from "../src/server/manual-expenses";
import { readiness } from "../src/server/calculation-data";
import { hashPassword } from "../src/server/auth";
after(() => db.$disconnect());
test("Май–июль / сентябрь: один проект, ручные части расхода, блокировка неподтверждённого экспорта", async () => {
  assert.match(process.env.TEST_DATABASE_NAME ?? "", /^financemax_test_/);
  const u = await db.user.create({
    data: {
      name: "Проверка сезонов",
      email: randomUUID() + "@test.local",
      passwordHash: await hashPassword("Season-report-test-only-2026"),
      role: "ADMIN_MANAGEMENT",
      demo: true,
    },
  });
  const user = { id: u.id, role: "ADMIN_MANAGEMENT" as const };
  const run = async (operation: string, data: Record<string, unknown>) =>
    (await executeCommand(user, { operation, requestId: randomUUID(), data }))
      .id;
  const first = await run("season", {
    name: "Май–июль",
    startDate: "2026-05-01",
    endDate: "2026-07-31",
  });
  const second = await run("season", {
    name: "С сентября",
    startDate: "2026-09-01",
    endDate: "2027-07-31",
  });
  const partnerId = await run("partner", {
    name: "Партнёр продолжаемого проекта",
  });
  const projectId = await run("project", {
    seasonId: first,
    partnerId,
    name: "Один проект",
    code: randomUUID(),
    client: "Клиент",
    partnerRate: "0.35",
    startDate: "2026-05-01",
    confirmed: true,
  });
  await run("project-season", {
    seasonId: second,
    projectId,
    reason: "Продолжение проекта",
  });
  const expenseCategoryId = await run("expense-category", {
    name: "Ручное распределение",
  });
  const part = {
    projectId,
    expenseCategoryId,
    allocationReference: "Документ 42 / договор 7",
    allocationOriginalTotal: "100",
    comment:
      "Часть исходного документа по решению бухгалтерии; ссылка Документ 42",
  };
  await run("expense", {
    ...part,
    seasonId: first,
    date: "2026-07-01",
    amount: "40",
  });
  assert.equal((await expenseReferenceChecks(db, first))[0].resolved, false);
  assert.ok(
    (await readiness(db, first)).blockers.some((b) =>
      b.includes("Документ 42"),
    ),
  );
  await assert.rejects(
    run("expense", {
      ...part,
      seasonId: second,
      date: "2026-09-01",
      amount: "61",
    }),
    /превышает/,
  );
  await assert.rejects(
    run("expense", {
      ...part,
      seasonId: second,
      date: "2026-09-01",
      amount: "60",
      allocationOriginalTotal: "101",
    }),
    /отличается/,
  );
  await run("expense", {
    ...part,
    seasonId: second,
    date: "2026-09-01",
    amount: "60",
  });
  assert.equal((await expenseReferenceChecks(db, first))[0].resolved, true);
  const before = await collectSeasonReport(db, first);
  await run("revenue", {
    seasonId: second,
    projectId,
    date: "2026-09-12",
    amount: "900",
    comment: "Следующий сезон",
  });
  const after = await collectSeasonReport(db, first);
  assert.deepEqual(after, before);
  assert.equal(after.projects[0].id, projectId);
  assert.equal(after.projects[0].rate, "0.35");
  assert.equal(after.totals.direct, "40.0000");
  assert.equal(
    (await collectSeasonReport(db, second)).totals.direct,
    "60.0000",
  );
  await assert.rejects(
    run("expense", {
      seasonId: first,
      projectId,
      expenseCategoryId,
      date: "2026-08-01",
      amount: "1",
      comment: "Вне сезона",
    }),
    /сезон/,
  );
  await assert.rejects(
    readSeasonReport(user, first, "management"),
    /не подтверждён/,
  );
  const receipts = await db.commandReceipt.count();
  const draft = await readSeasonReport(user, first, "management", true);
  assert.equal(draft.draft, true);
  assert.equal(await db.commandReceipt.count(), receipts);
  assert.equal(
    await db.calculationAcceptance.count({ where: { seasonId: first } }),
    0,
  );
});

