import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { db } from "../src/server/db";
import { executeCommand } from "./section-fixtures";
import { tripPaymentSummary } from "../src/server/trip-payments";
import { collectSeasonReport } from "../src/server/season-report";
import { buildWorkbook } from "../src/server/excel-report";
import {
  employeeCalculation,
  accountBalance,
  readiness,
} from "../src/server/calculation-data";
import { readResource } from "../src/server/queries";
import type { Principal } from "../src/domain/authorization";
after(() => db.$disconnect());
test("Этап 6: выплаты командировок из журнала, история и Excel", async (t) => {
  assert.match(process.env.TEST_DATABASE_NAME ?? "", /^financemax_test_/);
  const actor = await db.user.create({
    data: {
      name: "Руководитель этапа 6",
      email: `${randomUUID()}@test.local`,
      passwordHash: "Недоступен",
      role: "ADMIN_MANAGEMENT",
    },
  });
  const user: Principal = { id: actor.id, role: "ADMIN_MANAGEMENT" };
  const run = async (operation: string, data: Record<string, unknown>) =>
    (await executeCommand(user, { operation, data, requestId: randomUUID() }))
      .id;
  const seasonId = await run("season", {
    name: "Сезон командировок",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  const employeeId = await run("employee", { name: "Сотрудник командировок" });
  const partnerId = await run("partner", { name: "Партнер командировок" });
  const projectId = await run("project", {
    seasonId,
    name: "Проект поездок",
    code: randomUUID(),
    client: "Заказчик",
    partnerId,
    partnerRate: "0.3",
    confirmed: true,
    startDate: "2026-01-01",
  });
  const bank = await run("account", { name: "Банк поездок", kind: "BANK" });
  const cash = await run("account", { name: "Касса поездок", kind: "CASH" });
  const category = await run("expense-category", { name: "Командировки" });
  for (const toId of [bank, cash])
    await run("transfer", {
      seasonId,
      date: "2026-01-01",
      toId,
      amount: "10000",
      reason: "Начальный остаток",
    });
  const makeTrip = () =>
    run("trip", {
      seasonId,
      employeeId,
      projectId,
      destination: "Самарканд",
      startDate: "2026-03-01",
      endDate: "2026-03-01",
      perDiemRate: "40",
      transport: "20",
      hotel: "30",
      other: "10",
      expenseCategoryId: category,
      comment: "Первичные документы",
    });
  const pay = (
    businessTripId: string,
    amount: string,
    kind = "PAYMENT",
    accountId = bank,
    extra = {},
  ) =>
    run("trip-payment", {
      seasonId,
      businessTripId,
      amount,
      kind,
      accountId,
      date: "2026-03-02",
      accountingPeriod: "2026-03-02",
      reason: "Оплата поездки",
      document: "Авансовый отчет №6",
      ...extra,
    });
  const summary = (tripId: string, cutoff = "2026-12-31") =>
    tripPaymentSummary(db, tripId, new Date(cutoff));
  const baselineCompensation = await employeeCalculation(
    db,
    seasonId,
    employeeId,
  );
  let bankTrip = "";
  await t.test(
    "A, E: банковская оплата проектной поездки не создает расход повторно",
    async () => {
      bankTrip = await makeTrip();
      const before = await db.expense.count();
      const balance = await accountBalance(db, bank, new Date("2026-12-31"));
      await pay(bankTrip, "100");
      const s = await summary(bankTrip);
      assert.equal(s.recognized, "100.0000");
      assert.equal(s.bankPaid, "100.0000");
      assert.equal(s.remaining, "0.0000");
      assert.equal(s.project, "Проект поездок");
      assert.equal(await db.expense.count(), before);
      assert.equal(
        Number(balance) -
          Number(await accountBalance(db, bank, new Date("2026-12-31"))),
        100,
      );
      assert.equal((await summary(bankTrip, "2026-03-01")).bankPaid, "0.0000");
    },
  );
  await t.test("B: несколько частичных наличных выплат", async () => {
    const trip = await makeTrip();
    await pay(trip, "20", "PAYMENT", cash);
    await pay(trip, "30", "SETTLEMENT", cash);
    let s = await summary(trip);
    assert.equal(s.cashPaid, "50.0000");
    assert.equal(s.remaining, "50.0000");
    await pay(trip, "50", "SETTLEMENT", cash);
    s = await summary(trip);
    assert.equal(s.remaining, "0.0000");
    assert.equal(s.operations.length, 3);
  });
  await t.test("C: аванс и последующее возмещение", async () => {
    const trip = await makeTrip();
    await pay(trip, "60", "ADVANCE", cash);
    await pay(trip, "40", "REIMBURSEMENT");
    const s = await summary(trip);
    assert.equal(s.advances, "60.0000");
    assert.equal(s.reimbursements, "40.0000");
    assert.equal(s.remaining, "0.0000");
  });
  await t.test(
    "D: подотчетный остаток и возврат, без зарплатного долга",
    async () => {
      const trip = await makeTrip();
      await pay(trip, "150", "ADVANCE", cash);
      assert.equal((await summary(trip)).accountableAdvance, "50.0000");
      assert.match(
        (await readiness(db, seasonId)).blockers.join(" "),
        /подотчетный остаток/,
      );
      await pay(trip, "50", "RETURN", cash);
      const s = await summary(trip);
      assert.equal(s.returns, "50.0000");
      assert.equal(s.netPaid, "100.0000");
      assert.equal(s.accountableAdvance, "0.0000");
      await assert.rejects(
        () => pay(trip, "101", "RETURN", cash),
        /Возврат превышает/,
      );
    },
  );
  await t.test("F: источник наличных и однократная комиссия", async () => {
    const method = await run("cashout-method", {
      name: "Обналичивание поездки",
      rate: "0.05",
      validFrom: "2026-01-01",
    });
    const trip = await makeTrip();
    const source = await run("cashout", {
      seasonId,
      date: "2026-03-01",
      cashOutMethodId: method,
      bankAccountId: bank,
      cashAccountId: cash,
      bankOut: "100",
      cashReceived: "95",
      purpose: "Аванс командировки",
      allocations: [{ projectId, businessTripId: trip, amount: "5" }],
    });
    const advanceLink = await pay(trip, "95", "ADVANCE", cash, {
      cashOutTransactionId: source,
    });
    await assert.rejects(
      () => pay(trip, "1", "PAYMENT", cash, { cashOutTransactionId: source }),
      /превышают наличные/,
    );
    await pay(trip, "5", "REIMBURSEMENT");
    const report = await collectSeasonReport(db, seasonId);
    assert.equal(report.totals.cashOutFees, "5.0000");
    assert.equal((await summary(trip)).recognized, "100.0000");
    assert.equal(
      (await summary(trip)).operations.filter(
        (o) => o.cashOutTransactionId === source,
      ).length,
      1,
    );
    const original = await db.tripPaymentLink.findUniqueOrThrow({
      where: { id: advanceLink },
    });
    await run("correction", {
      seasonId,
      date: "2026-03-03",
      entity: "journal",
      id: original.journalTransactionId,
      reason: "Сторно аванса",
    });
    await assert.rejects(
      () =>
        pay(trip, "1", "ADVANCE", cash, {
          cashOutTransactionId: source,
          date: "2026-03-02",
        }),
      /превышают наличные/,
    );
    await pay(trip, "95", "ADVANCE", cash, {
      cashOutTransactionId: source,
      date: "2026-03-04",
    });
    assert.equal((await summary(trip)).remaining, "0.0000");
  });
  await t.test("G: сторно и историческая дата отсечения", async () => {
    const trip = await makeTrip(),
      link = await pay(trip, "100");
    const journal = (
      await db.tripPaymentLink.findUniqueOrThrow({ where: { id: link } })
    ).journalTransactionId;
    await run("correction", {
      seasonId,
      date: "2026-03-03",
      entity: "journal",
      id: journal,
      reason: "Ошибочная выплата",
    });
    assert.equal((await summary(trip)).bankPaid, "0.0000");
    assert.equal((await summary(trip)).remaining, "100.0000");
    assert.equal((await summary(trip, "2026-03-02")).bankPaid, "100.0000");
    await pay(trip, "100", "PAYMENT", bank, { date: "2026-03-04" });
  });
  await t.test(
    "H: историческое возмещение связывается без повторного журнала, с аудитом",
    async () => {
      const trip = await makeTrip();
      const category = await run("payment-category", {
        name: "Возмещение поездок",
        kind: "REIMBURSEMENT",
        settlementRelevant: false,
      });
      const payment = await run("payment", {
        seasonId,
        employeeId,
        paymentCategoryId: category,
        accountId: bank,
        paymentDate: "2026-03-02",
        accountingPeriod: "2026-03-01",
        amount: "100",
        reason: "Прежнее возмещение",
      });
      const journal = (
        await db.employeePayment.findUniqueOrThrow({ where: { id: payment } })
      ).journalTransactionId;
      const before = await db.journalTransaction.count();
      const link = await run("trip-attribution", {
        seasonId,
        businessTripId: trip,
        journalTransactionId: journal,
        kind: "REIMBURSEMENT",
        reason: "Сверено по документам",
        confirmed: true,
      });
      assert.equal(await db.journalTransaction.count(), before);
      assert.equal((await summary(trip)).reimbursements, "100.0000");
      assert.equal(
        await db.auditLog.count({
          where: { entity: "TripPaymentLink", entityId: link },
        }),
        1,
      );
      await run("trip-attribution", {
        seasonId,
        businessTripId: trip,
        journalTransactionId: journal,
        kind: "REIMBURSEMENT",
        reason: "Уточнен документ",
        document: "Документ 7",
        confirmed: true,
      });
      assert.equal(
        await db.auditLog.count({
          where: { entity: "TripPaymentLink", entityId: link },
        }),
        2,
      );
    },
  );
  await t.test(
    "Исторические суммы требуют подтверждения; изменения отменяют его",
    async () => {
      const template = await db.businessTrip.findUniqueOrThrow({
        where: { id: bankTrip },
      });
      const old = await db.businessTrip.create({
        data: { ...template, id: randomUUID(), paymentTrackingStarted: false },
      });
      const expense = await db.expense.findFirstOrThrow({
        where: { businessTripId: bankTrip },
      });
      await db.expense.create({
        data: { ...expense, id: randomUUID(), businessTripId: old.id },
      });
      assert.equal((await summary(old.id)).known, false);
      await pay(old.id, "100");
      assert.equal((await summary(old.id)).known, false);
      await assert.rejects(() =>
        run("trip-review", {
          seasonId,
          businessTripId: old.id,
          reason: "Документ",
        }),
      );
      await run("trip-review", {
        seasonId,
        businessTripId: old.id,
        reason: "Проверена полнота первичных документов",
        confirmed: true,
      });
      assert.equal((await summary(old.id)).known, true);
      const link = await pay(old.id, "1", "SETTLEMENT");
      assert.equal((await summary(old.id)).known, false);
      const journal = (
        await db.tripPaymentLink.findUniqueOrThrow({ where: { id: link } })
      ).journalTransactionId;
      await run("correction", {
        seasonId,
        date: "2026-03-03",
        entity: "journal",
        id: journal,
        reason: "Отмена дополнительной выплаты",
      });
      await run("trip-review", {
        seasonId,
        businessTripId: old.id,
        reason: "Повторная сверка",
        confirmed: true,
      });
      assert.equal((await summary(old.id)).known, true);
    },
  );
  await t.test(
    "I, J: выплаты не влияют на компенсацию, изменения доступны только руководству",
    async () => {
      assert.deepEqual(
        (await employeeCalculation(db, seasonId, employeeId)).seasonResult,
        baselineCompensation.seasonResult,
      );
      for (const role of ["EMPLOYEE", "PARTNER"] as const) {
        for (const operation of [
          "trip-payment",
          "trip-attribution",
          "trip-review",
        ])
          await assert.rejects(
            () =>
              executeCommand(
                { id: user.id, role, employeeId, partnerId },
                { operation, requestId: randomUUID(), data: {} },
              ),
            /доступ|прав/i,
          );
        await assert.rejects(
          () =>
            readResource(
              { id: user.id, role, employeeId, partnerId },
              "trip-detail",
              new URLSearchParams({ id: bankTrip, seasonId }),
            ),
          /доступ|прав/i,
        );
      }
    },
  );
  await t.test(
    "K: лист 15 содержит канонические числовые значения",
    async () => {
      const report = await collectSeasonReport(db, seasonId);
      const bytes = await buildWorkbook(report, "management", {
        user: "Тест",
        generatedAt: new Date(),
        draft: true,
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as any);
      assert.equal(wb.worksheets.length, 21);
      const sheet = wb.getWorksheet("15. КОМАНДИРОВКИ")!;
      const rows = sheet.getRows(10, report.trips.length)!;
      const row = rows.find((r) => r.getCell(20).value === bankTrip)!;
      assert.equal(row.getCell(10).value, 0);
      assert.equal(row.getCell(11).value, 100);
      assert.equal(row.getCell(15).value, 0);
      const legacy = JSON.parse(JSON.stringify(report));
      delete legacy.tripPayments;
      const oldBytes = await buildWorkbook(legacy, "management", {
        user: "Тест",
        generatedAt: new Date(),
        draft: true,
      });
      const old = new ExcelJS.Workbook();
      await old.xlsx.load(oldBytes as any);
      assert.equal(old.getWorksheet(15)!.getCell("J10").value, null);
      assert.match(
        String(old.getWorksheet(15)!.getCell("S10").value),
        /Исторические/,
      );
    },
  );
});

