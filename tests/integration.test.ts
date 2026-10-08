import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db.js";
import { executeCommand } from "./section-fixtures";
import { readResource } from "../src/server/queries.js";
import {
  hashPassword,
  login,
  authenticate,
  logout,
} from "../src/server/auth.js";
import {
  employeeCalculation,
  accountBalance,
  projectEconomics,
} from "../src/server/calculation-data.js";
import type { Principal } from "../src/domain/authorization.js";
import * as f from "../src/domain/calculations.js";
let admin: Principal,
  seasonId: string,
  employeeId: string,
  otherEmployee: string,
  partnerId: string,
  otherPartner: string,
  projectId: string,
  level: string,
  bank: string,
  cash: string,
  salary: string,
  bonus: string,
  travel: string,
  category: string,
  method: string;
const run = async (operation: string, data: Record<string, unknown>) =>
  (await executeCommand(admin, { operation, requestId: randomUUID(), data }))
    .id;
before(async () => {
  const marker = randomUUID();
  const user = await db.user.create({
    data: {
      name: "Тестовый администратор",
      email: `test-${marker}@demo.local`,
      passwordHash: await hashPassword("Integration-only-pass-2026"),
      role: "ADMIN_MANAGEMENT",
      demo: true,
    },
  });
  admin = { id: user.id, role: "ADMIN_MANAGEMENT" };
  seasonId = await run("season", {
    name: `ТЕСТ ${marker}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  employeeId = await run("employee", { name: "Тестовый сотрудник А" });
  otherEmployee = await run("employee", { name: "Тестовый сотрудник Б" });
  partnerId = await run("partner", { name: "Тестовый партнер А" });
  otherPartner = await run("partner", { name: "Тестовый партнер Б" });
  level = await run("complexity", {
    name: "Тестовый уровень",
    hourlyRate: "300000",
    validFrom: "2026-01-01",
  });
  bank = await run("account", { name: "Тестовый банк", kind: "BANK" });
  cash = await run("account", { name: "Тестовая касса", kind: "CASH" });
  projectId = await run("project", {
    seasonId,
    name: "Тестовый проект",
    code: marker,
    client: "Тест",
    partnerId,
    partnerRate: "0.30",
    confirmed: true,
    startDate: "2026-01-01",
  });
  await run("assignment", { seasonId, projectId, employeeId });
  await run("salary-rate", {
    employeeId,
    amount: "10000000",
    validFrom: "2026-01-01",
  });
  salary = await run("payment-category", {
    name: "Тестовая зарплата",
    kind: "SALARY",
    settlementRelevant: true,
  });
  bonus = await run("payment-category", {
    name: "Тестовый бонус",
    kind: "BONUS",
    settlementRelevant: true,
  });
  travel = await run("payment-category", {
    name: "Тестовое возмещение",
    kind: "REIMBURSEMENT",
    settlementRelevant: false,
  });
  category = await run("expense-category", { name: "Тестовый расход" });
  method = await run("cashout-method", {
    name: "Тестовый способ",
    rate: "0.06",
    validFrom: "2026-01-01",
  });
});
after(async () => {
  await db.$disconnect();
});
test("database-backed phase 2 workflows", async (t) => {
  await t.test(
    "authentication hashes session tokens, verifies login and revokes logout",
    async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      const token = await login(u.email, "Integration-only-pass-2026");
      assert.equal((await authenticate(token)).id, admin.id);
      assert.equal(await db.session.count({ where: { tokenHash: token } }), 0);
      await logout(token);
      await assert.rejects(() => authenticate(token));
      await assert.rejects(() => login(u.email, "wrong"));
    },
  );
  await t.test(
    "server authorization denies cross employee/partner and ledger reads",
    async () => {
      const employee: Principal = {
        id: admin.id,
        role: "EMPLOYEE",
        employeeId,
      };
      const partner: Principal = { id: admin.id, role: "PARTNER", partnerId };
      await assert.rejects(() =>
        readResource(
          employee,
          "employee-detail",
          new URLSearchParams({ seasonId, employeeId: otherEmployee }),
        ),
      );
      await assert.rejects(() =>
        readResource(
          partner,
          "partner-detail",
          new URLSearchParams({ seasonId, partnerId: otherPartner }),
        ),
      );
      await assert.rejects(() =>
        readResource(partner, "journal", new URLSearchParams({ seasonId })),
      );
      await assert.rejects(() =>
        executeCommand(employee, {
          operation: "employee",
          requestId: randomUUID(),
          data: { name: "Denied" },
        }),
      );
    },
  );
  await t.test(
    "idempotent command does not create duplicate financial entries",
    async () => {
      const command = {
        operation: "work",
        requestId: randomUUID(),
        data: {
          seasonId,
          projectId,
          employeeId,
          complexityLevelId: level,
          date: "2026-03-15",
          description: "Тестовая работа",
          plannedHours: "80",
          actualHours: "100",
        },
      };
      const first = await executeCommand(admin, command),
        second = await executeCommand(admin, command);
      assert.equal(first.id, second.id);
      assert.equal(second.replayed, true);
      await assert.rejects(() =>
        executeCommand(admin, {
          ...command,
          data: { ...command.data, actualHours: "101" },
        }),
      );
      assert.equal(await db.workEntry.count({ where: { seasonId } }), 1);
    },
  );
  await t.test(
    "March salary paid in April is Q1; reimbursements and Q1 bonus not Q2 salary",
    async () => {
      await run("payment", {
        seasonId,
        employeeId,
        paymentCategoryId: salary,
        accountId: bank,
        paymentDate: "2026-04-03",
        accountingPeriod: "2026-03-01",
        amount: "30000000",
        reason: "Март",
      });
      const qid = await run("quarter", {
        seasonId,
        employeeId,
        periodStart: "2026-01-01",
      });
      await run("accept-calculation", {
        seasonId,
        kind: "QUARTER",
        id: qid,
        reason: "Проверено",
        confirmed: true,
      });
      await run("payment", {
        seasonId,
        employeeId,
        paymentCategoryId: bonus,
        accountId: bank,
        paymentDate: "2026-04-04",
        accountingPeriod: "2026-03-01",
        amount: "4500000",
        quarterEmployeeSettlementId: qid,
        reason: "Бонус Q1",
      });
      await run("payment", {
        seasonId,
        employeeId,
        paymentCategoryId: travel,
        accountId: bank,
        paymentDate: "2026-04-04",
        accountingPeriod: "2026-03-01",
        amount: "5000000",
        reason: "Возмещение",
      });
      const c = await employeeCalculation(db, seasonId, employeeId);
      assert.equal(
        c.quarters[0].salaryPayments[0].amount.toFixed(4),
        "30000000.0000",
      );
      assert.equal(c.quarters[1].salaryPayments.length, 0);
      assert.equal(c.seasonResult.paid, "34500000.0000");
      assert.equal(c.seasonResult.finalPayment, "4500000");
      assert.equal(
        (await projectEconomics(db, seasonId)).rows[0].labor,
        "30000000.0000",
      );
      assert.equal((await projectEconomics(db, seasonId)).general, "0.0000");
    },
  );
  await t.test(
    "historical work rate remains stable after rate change",
    async () => {
      await run("complexity-rate", {
        complexityLevelId: level,
        hourlyRate: "350000",
        validFrom: "2026-05-01",
      });
      const old = await db.workEntry.findFirstOrThrow({ where: { seasonId } });
      assert.equal(old.rateSnapshot.toString(), "300000");
      await run("work", {
        seasonId,
        projectId,
        employeeId,
        complexityLevelId: level,
        date: "2026-06-15",
        description: "Новая ставка",
        plannedHours: "10",
        actualHours: "10",
      });
      assert.equal(
        (
          await db.workEntry.findFirstOrThrow({
            where: { seasonId, description: "Новая ставка" },
          })
        ).earned.toString(),
        "3500000",
      );
    },
  );
  await t.test(
    "database rejects negative hours and inconsistent rate snapshots",
    async () => {
      const rate = await db.complexityRate.findFirstOrThrow({
        where: { complexityLevelId: level },
      });
      await assert.rejects(() =>
        db.workEntry.create({
          data: {
            seasonId,
            projectId,
            employeeId,
            complexityRateId: rate.id,
            description: "Неверно",
            accountingDate: new Date("2026-01-01"),
            actualHours: "-1",
            plannedHours: "1",
            rateSnapshot: "100",
            earned: "-100",
            createdBy: admin.id,
          },
        }),
      );
    },
  );
  await t.test(
    "cash-out bank/cash/fee balance; fee recognized once; invalid split rolls back",
    async () => {
      const command = {
        seasonId,
        date: "2026-03-10",
        bankAccountId: bank,
        cashAccountId: cash,
        cashOutMethodId: method,
        bankOut: "100000000",
        cashReceived: "95000000",
        purpose: "Тест",
        allocations: [{ projectId, amount: "3000000" }, { amount: "2000000" }],
      };
      const before = await accountBalance(db, cash);
      const cid = await run("cashout", command);
      assert.equal(
        f
          .d(await accountBalance(db, cash))
          .minus(before)
          .toString(),
        "95000000",
      );
      const cost = await db.cashOutTransaction.findUniqueOrThrow({
        where: { id: cid },
      });
      assert.equal(cost.actualFee.toString(), "5000000");
      const economics = await projectEconomics(db, seasonId);
      assert.equal(economics.rows[0].otherDirect, "3000000.0000");
      assert.equal(economics.general, "2000000.0000");
      await assert.rejects(() =>
        run("cashout", {
          ...command,
          allocations: [{ projectId, amount: "5000001" }],
        }),
      );
      assert.equal(
        await db.cashOutTransaction.count({ where: { seasonId } }),
        1,
      );
    },
  );
  await t.test(
    "cash reconciliation does not change journal or account balance",
    async () => {
      const before = await accountBalance(db, cash),
        count = await db.journalTransaction.count({ where: { seasonId } });
      const rid = await run("reconciliation", {
        seasonId,
        date: "2026-03-31",
        ledgerAccountId: cash,
        actual: "94000000",
        explanation: "Проверить",
      });
      assert.equal(await accountBalance(db, cash), before);
      assert.equal(
        await db.journalTransaction.count({ where: { seasonId } }),
        count,
      );
      assert.equal(
        (await db.cashReconciliation.findUniqueOrThrow({ where: { id: rid } }))
          .resolved,
        false,
      );
    },
  );
  await t.test(
    "economic corrections retain originals and source history",
    async () => {
      const row = await db.workEntry.findFirstOrThrow({
        where: { seasonId, description: "Новая ставка" },
      });
      await assert.rejects(() =>
        db.workEntry.update({
          where: { id: row.id },
          data: { actualHours: "99" },
        }),
      );
      await run("correction", {
        seasonId,
        date: "2026-06-20",
        entity: "work",
        id: row.id,
        reason: "Исправление часов",
      });
      assert.equal(
        (await db.workEntry.findUniqueOrThrow({ where: { id: row.id } }))
          .voided,
        true,
      );
      assert.ok(
        (await db.auditLog.count({ where: { entityId: row.id } })) >= 2,
      );
    },
  );
  await t.test(
    "posted journal and audit cannot be silently changed or deleted",
    async () => {
      const journal = await db.journalTransaction.findFirstOrThrow({
        where: { seasonId },
      });
      await assert.rejects(() =>
        db.journalTransaction.update({
          where: { id: journal.id },
          data: { reason: "Перезапись" },
        }),
      );
      await assert.rejects(() =>
        db.journalTransaction.delete({ where: { id: journal.id } }),
      );
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: journal.id },
      });
      await assert.rejects(() =>
        db.auditLog.delete({ where: { id: audit.id } }),
      );
    },
  );
  await t.test(
    "reversal offsets ledger and removes payment from entitlement subtraction",
    async () => {
      const payment = await db.employeePayment.findFirstOrThrow({
        where: { seasonId, kindSnapshot: "BONUS" },
      });
      const before = await accountBalance(db, bank);
      await run("correction", {
        seasonId,
        date: "2026-04-05",
        entity: "payment",
        id: payment.id,
        reason: "Отмена ошибочной выплаты",
      });
      assert.equal(
        f
          .d(await accountBalance(db, bank))
          .minus(before)
          .toString(),
        "4500000",
      );
      assert.equal(
        (await employeeCalculation(db, seasonId, employeeId)).seasonResult.paid,
        "30000000.0000",
      );
      await assert.rejects(() =>
        run("correction", {
          seasonId,
          date: "2026-04-05",
          entity: "payment",
          id: payment.id,
          reason: "Повторная отмена",
        }),
      );
    },
  );
  await t.test(
    "partner entitlement and payment remain separate; exact general pool allocation",
    async () => {
      await run("revenue", {
        seasonId,
        date: "2026-03-31",
        projectId,
        amount: "100000000",
        comment: "Закрытый объем",
      });
      const runId = await run("partner-allocation", { seasonId });
      const rows = await db.projectAllocation.findMany({
        where: { allocationRunId: runId },
      });
      assert.equal(
        rows
          .reduce((s, r) => s.plus(r.allocated.toString()), f.d("0"))
          .toString(),
        "2000000",
      );
      assert.equal(await db.partnerPayment.count({ where: { seasonId } }), 0);
      const restricted = await readResource(
        { id: admin.id, role: "PARTNER", partnerId },
        "partner-detail",
        new URLSearchParams({ seasonId, partnerId }),
      );
      const text = JSON.stringify(restricted);
      assert.ok(!text.includes("salaryRateSnapshot"));
      assert.ok(!text.includes("passwordHash"));
    },
  );
  await t.test(
    "trip source expense and linked cashout fee are recognized once",
    async () => {
      const trip = await run("trip", {
        seasonId,
        employeeId,
        projectId,
        destination: "Тестовая поездка",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        perDiemRate: "100",
        transport: "20",
        hotel: "30",
        other: "10",
        expenseCategoryId: category,
        comment: "Тест командировки",
      });
      assert.equal(
        await db.expense.count({ where: { businessTripId: trip } }),
        1,
      );
      assert.equal(
        (
          await db.expense.findFirstOrThrow({ where: { businessTripId: trip } })
        ).amount.toString(),
        "260",
      );
      const cashoutId = await run("cashout", {
        seasonId,
        date: "2026-06-01",
        bankAccountId: bank,
        cashAccountId: cash,
        cashOutMethodId: method,
        bankOut: "1000",
        cashReceived: "950",
        purpose: "Командировка",
        allocations: [{ projectId, businessTripId: trip, amount: "50" }],
      });
      assert.equal(
        await db.cashOutAllocation.count({
          where: { cashOutTransactionId: cashoutId, businessTripId: trip },
        }),
        1,
      );
      assert.equal(
        await db.expense.count({ where: { businessTripId: trip } }),
        1,
      );
    },
  );
  await t.test(
    "closing readiness cannot be bypassed through empty checklist",
    async () => {
      await assert.rejects(() =>
        run("close", { seasonId, reason: "Проверка", confirmed: true }),
      );
    },
  );
  await t.test(
    "closed season database guard rejects new financial data",
    async () => {
      await db.season.update({
        where: { id: seasonId },
        data: { status: "Закрыт", updatedBy: admin.id },
      });
      await assert.rejects(() =>
        run("revenue", {
          seasonId,
          date: "2026-03-31",
          projectId,
          amount: "1",
          comment: "Запрещено",
        }),
      );
      await assert.rejects(() =>
        db.projectRevenue.create({
          data: {
            seasonId,
            projectId,
            amount: "1",
            accountingDate: new Date("2026-03-31"),
            createdBy: admin.id,
          },
        }),
      );
      await run("reopen", {
        seasonId,
        reason: "Тест авторизованной коррекции",
        confirmed: true,
      });
      assert.equal(
        (await db.season.findUniqueOrThrow({ where: { id: seasonId } })).status,
        "На сверке",
      );
    },
  );
});

test("fixed project rates and audited management correction", async () => {
  const sid = await run("season", {
    name: `Фиксированные ставки ${randomUUID()}`,
    startDate: "2027-01-01",
    endDate: "2027-12-31",
  });
  const create = (partnerRate: string) =>
    run("project", {
      seasonId: sid,
      name: "Проект с фиксированной ставкой",
      code: randomUUID(),
      client: "Тест",
      partnerId,
      partnerRate,
      startDate: "2027-01-01",
      confirmed: true,
    });
  const first = await create("0.3");
  const second = await create("0.5");
  for (const projectId of [first, second])
    await run("revenue", {
      seasonId: sid,
      projectId,
      date: "2027-02-01",
      amount: "1000",
      comment: "Доход",
    });
  const economics = await projectEconomics(db, sid);
  assert.equal(economics.rows.find((p) => p.id === first)?.partnerRate, "0.3");
  assert.equal(economics.rows.find((p) => p.id === second)?.partnerRate, "0.5");
  const allocationId = await run("partner-allocation", { seasonId: sid });
  const saved = await db.projectAllocation.findMany({
    where: { allocationRunId: allocationId },
  });
  assert.equal(
    saved.find((p) => p.projectId === first)?.rateSnapshot.toString(),
    "0.3",
  );
  assert.equal(
    saved.find((p) => p.projectId === second)?.rateSnapshot.toString(),
    "0.5",
  );
  assert.equal(
    saved.find((p) => p.projectId === first)?.entitlement.toString(),
    "300",
  );
  assert.equal(
    saved.find((p) => p.projectId === second)?.entitlement.toString(),
    "500",
  );
  const snapshot = await db.projectPartnerRate.findFirstOrThrow({
    where: { projectId: first },
  });
  await assert.rejects(() =>
    db.projectPartnerRate.update({
      where: { id: snapshot.id },
      data: { rate: "0.7" },
    }),
  );
  await assert.rejects(() =>
    db.projectPartnerRate.update({
      where: { id: snapshot.id },
      data: { validTo: new Date("2027-06-01") },
    }),
  );
  await assert.rejects(() =>
    db.projectPartnerRate.create({
      data: {
        projectId: first,
        rate: "0.7",
        validFrom: new Date("2028-01-01"),
        createdBy: admin.id,
      },
    }),
  );
  const correction = {
    seasonId: sid,
    projectId: first,
    partnerRate: "0.4",
    reason: "Исправлена ошибка ввода",
    confirmed: true,
  };
  await assert.rejects(() =>
    run("project-rate-correction", { ...correction, confirmed: false }),
  );
  await assert.rejects(() =>
    run("project-rate-correction", { ...correction, reason: "" }),
  );
  await assert.rejects(() =>
    executeCommand(
      { id: admin.id, role: "PARTNER", partnerId },
      {
        operation: "project-rate-correction",
        requestId: randomUUID(),
        data: correction,
      },
    ),
  );
  await run("project-rate-correction", correction);
  const audit = await db.auditLog.findFirstOrThrow({
    where: {
      entity: "ProjectPartnerRate",
      entityId: snapshot.id,
      operation: "UPDATE",
    },
  });
  assert.equal(audit.reason, correction.reason);
  assert.equal(audit.createdBy, admin.id);
  assert.equal(String((audit.oldValue as { rate: string }).rate), "0.3");
  assert.equal(String((audit.newValue as { rate: string }).rate), "0.4");
  assert.equal(
    (
      await db.projectAllocation.findFirstOrThrow({
        where: { allocationRunId: allocationId, projectId: first },
      })
    ).rateSnapshot.toString(),
    "0.3",
  );
  const changed = await projectEconomics(db, sid);
  const revisedId = await run("partner-allocation", { seasonId: sid });
  const revised = await db.projectAllocation.findMany({
    where: { allocationRunId: revisedId },
  });
  assert.equal(
    revised.find((p) => p.projectId === first)?.entitlement.toString(),
    "400",
  );
  assert.equal(
    revised.find((p) => p.projectId === second)?.entitlement.toString(),
    "500",
  );
  assert.equal(changed.rows.find((p) => p.id === first)?.partnerRate, "0.4");
  assert.equal(changed.rows.find((p) => p.id === second)?.partnerRate, "0.5");
  assert.ok(
    (await db.season.findUniqueOrThrow({ where: { id: sid } })).revision >
      (
        await db.allocationRun.findUniqueOrThrow({
          where: { id: allocationId },
        })
      ).sourceRevision,
  );
});

