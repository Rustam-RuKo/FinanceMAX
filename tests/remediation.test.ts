import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  readSeasonReport,
  collectSeasonReport,
  partnerReport,
  fingerprint,
} from "../src/server/season-report";
import {
  buildWorkbook,
  managementTables,
  partnerTables,
  excelNumber,
} from "../src/server/excel-report";
import { db } from "../src/server/db";
import { executeCommand } from "./section-fixtures";
import { readResource } from "../src/server/queries";
import {
  accountBalance,
  employeeCalculation,
  projectEconomics,
  readiness,
} from "../src/server/calculation-data";
import { partnerBalances, quarterIsCurrent } from "../src/server/versions";
import { hashPassword } from "../src/server/auth";
import { checkLoginRate } from "../src/server/login-rate-limit";
import { contentSecurityPolicy } from "../src/server/csp";
import * as f from "../src/domain/calculations";
import type { Principal } from "../src/domain/authorization";
after(() => db.$disconnect());
test("С-1: остаток минимальной единицы поступает бонусу без потерь", () => {
  for (const value of ["0.0001", "0.0003", "1.0001", "1000000.0001"]) {
    const q = f.quarterFromEntitlement(value, "0");
    assert.equal(f.d(q.bonus).plus(q.carry).toFixed(4), value);
    assert.equal(f.d(q.bonus).minus(q.carry).toFixed(4), "0.0001");
  }
  let carry = "0";
  for (let i = 0; i < 20; i++) {
    const q = f.quarterFromEntitlement("0.0001", "0", carry);
    assert.equal(
      f.d(q.bonus).plus(q.carry).toFixed(4),
      f.d("0.0001").plus(carry).toFixed(4),
    );
    carry = q.carry;
  }
});
test("С-2: нулевые и отрицательные проекты остаются при неразрешенном распределении", () => {
  const a = f.calculatePartnerAllocation(
    [
      {
        id: "zero",
        partnerId: "a",
        revenue: "0",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.5",
      },
      {
        id: "negative",
        partnerId: "a",
        revenue: "0",
        labor: "10",
        otherDirect: "0",
        partnerRate: "0.5",
      },
    ],
    "10",
  );
  assert.equal(a.projects.length, 2);
  assert.match(a.status, /ручн/i);
  assert.equal(a.projects.find((p) => p.id === "negative")!.gad, "-10.0000");
});
test("Н-1, Н-2: независимые лимиты входа и nonce CSP", () => {
  for (let i = 0; i < 10; i++) checkLoginRate("a@example.test", "client", 1000);
  assert.throws(() => checkLoginRate("a@example.test", "client", 1000));
  assert.doesNotThrow(() => checkLoginRate("b@example.test", "client", 1000));
  assert.doesNotThrow(() => checkLoginRate("a@example.test", "client", 62000));
  const csp = contentSecurityPolicy("testnonce", false);
  assert.ok(csp.includes("'nonce-testnonce'"));
  assert.ok(!csp.includes("unsafe-inline"));
  assert.ok(!csp.includes("unsafe-eval"));
});
test("В-4: runtime не является владельцем, суперпользователем и не может менять схему", async () => {
  const [r] = await db.$queryRawUnsafe<
    { super: boolean; createdb: boolean; createrole: boolean }[]
  >(
    "SELECT rolsuper AS super,rolcreatedb AS createdb,rolcreaterole AS createrole FROM pg_roles WHERE rolname=current_user",
  );
  assert.deepEqual(r, { super: false, createdb: false, createrole: false });
  await assert.rejects(() =>
    db.$executeRawUnsafe("CREATE TABLE forbidden_runtime_ddl (id int)"),
  );
});
test("Полный сезон: источники, выплаты, исключения, версии, многосезонность и закрытие", async (t) => {
  const user = await db.user.create({
    data: {
      name: "Руководитель сценария",
      email: randomUUID() + "@test.local",
      passwordHash: await hashPassword("Scenario-password-2026"),
      role: "ADMIN_MANAGEMENT",
      demo: true,
    },
  });
  const admin: Principal = { id: user.id, role: "ADMIN_MANAGEMENT" };
  const run = async (operation: string, data: Record<string, unknown>) =>
    (await executeCommand(admin, { operation, requestId: randomUUID(), data }))
      .id;
  const sid = await run("season", {
    name: "Полный сезон",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  const next = await run("season", {
    name: "Следующий сезон",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
  });
  const partners = [
    await run("partner", { name: "Первый" }),
    await run("partner", { name: "Второй" }),
  ];
  const employees = [
    await run("employee", { name: "Один" }),
    await run("employee", { name: "Два" }),
  ];
  await t.test(
    "С-2: неразрешенные строки сохраняются в БД и не могут быть приняты",
    async () => {
      const emptySeason = await run("season", {
        name: "Нулевая база",
        startDate: "2028-01-01",
        endDate: "2028-12-31",
      });
      for (let i = 0; i < 2; i++)
        await run("project", {
          seasonId: emptySeason,
          partnerId: partners[0],
          name: "Нулевой " + i,
          code: randomUUID(),
          client: "Тест",
          partnerRate: "0.5",
          startDate: "2028-01-01",
          confirmed: true,
        });
      const id = await run("partner-allocation", { seasonId: emptySeason });
      assert.equal(
        await db.projectAllocation.count({ where: { allocationRunId: id } }),
        2,
      );
      await assert.rejects(() =>
        run("accept-calculation", {
          seasonId: emptySeason,
          kind: "ALLOCATION",
          id,
          reason: "Проверка",
          confirmed: true,
        }),
      );
    },
  );
  const projects: string[] = [];
  for (const [index, partnerId] of [
    partners[0],
    partners[0],
    partners[1],
  ].entries())
    projects.push(
      await run("project", {
        seasonId: sid,
        partnerId,
        name: "Проект " + index,
        code: randomUUID(),
        client: "Демо",
        partnerRate: index === 1 ? "0.3" : "0.5",
        startDate: "2026-01-01",
        confirmed: true,
      }),
    );
  const bank = await run("account", { name: "Банк сценария", kind: "BANK" }),
    cash = await run("account", { name: "Касса сценария", kind: "CASH" });
  const level = await run("complexity", {
    name: "Сложность",
    hourlyRate: "100",
    validFrom: "2026-01-01",
  });
  const salary = await run("payment-category", {
    name: "Зарплата",
    kind: "SALARY",
    settlementRelevant: false,
  });
  const bonus = await run("payment-category", {
    name: "Бонус",
    kind: "BONUS",
    settlementRelevant: false,
  });
  const final = await run("payment-category", {
    name: "Окончательная",
    kind: "FINAL",
    settlementRelevant: false,
  });
  const reimbursement = await run("payment-category", {
    name: "Возмещение",
    kind: "REIMBURSEMENT",
    settlementRelevant: false,
  });
  const category = await run("expense-category", { name: "Расходы сценария" });
  const method = await run("cashout-method", {
    name: "Способ сценария",
    rate: "0.05",
    validFrom: "2026-01-01",
  });
  await run("transfer", {
    seasonId: sid,
    date: "2026-01-01",
    toId: bank,
    amount: "100000",
    reason: "Начальный остаток",
  });
  for (const e of employees) {
    await run("assignment", {
      seasonId: sid,
      projectId: projects[0],
      employeeId: e,
    });
    await run("salary-rate", {
      employeeId: e,
      amount: "100",
      validFrom: "2026-01-01",
    });
    await run("work", {
      seasonId: sid,
      projectId: projects[0],
      employeeId: e,
      complexityLevelId: level,
      date: "2026-01-15",
      description: "Работа",
      plannedHours: "1",
      actualHours: "1",
    });
    await run("payment", {
      seasonId: sid,
      employeeId: e,
      paymentCategoryId: salary,
      accountId: bank,
      paymentDate: "2026-02-01",
      accountingPeriod: "2026-01-01",
      amount: "100",
      reason: "Зарплата",
    });
  }
  for (const projectId of projects)
    await run("revenue", {
      seasonId: sid,
      projectId,
      date: "2026-02-01",
      amount: "10000",
      comment: "Выручка",
    });
  await run("expense", {
    seasonId: sid,
    date: "2026-02-01",
    expenseCategoryId: category,
    amount: "100",
    currency: "UZS",
    exchangeRate: "1",
    comment: "Общие расходы",
  });
  await run("expense", {
    seasonId: sid,
    date: "2026-02-01",
    projectId: projects[1],
    expenseCategoryId: category,
    amount: "100",
    currency: "UZS",
    exchangeRate: "1",
    comment: "Прямые расходы",
  });
  const tripInput = {
    seasonId: sid,
    employeeId: employees[0],
    projectId: projects[0],
    destination: "Командировка",
    startDate: "2026-03-01",
    endDate: "2026-03-02",
    perDiemRate: "10",
    transport: "5",
    hotel: "5",
    other: "0",
    expenseCategoryId: category,
    comment: "Демо",
  };
  const scenarioTrip = await run("trip", tripInput);
  await run("trip-payment", {
    seasonId: sid,
    businessTripId: scenarioTrip,
    date: "2026-03-03",
    accountingPeriod: "2026-03-03",
    accountId: bank,
    amount: "30",
    kind: "PAYMENT",
    reason: "Командировка оплачена отдельно от зарплаты",
  });
  await t.test("В-1: межсезонная командировка не создает расход", async () => {
    const count = await db.businessTrip.count({ where: { seasonId: sid } });
    await assert.rejects(
      () =>
        run("trip", {
          ...tripInput,
          startDate: "2026-12-31",
          endDate: "2027-01-01",
        }),
      /решен|сезон/i,
    );
    assert.equal(
      await db.businessTrip.count({ where: { seasonId: sid } }),
      count,
    );
    await assert.rejects(() =>
      run("revenue", {
        seasonId: sid,
        projectId: projects[0],
        date: "2027-01-01",
        amount: "1",
        comment: "Вне сезона",
      }),
    );
  });
  await run("cashout", {
    seasonId: sid,
    date: "2026-03-01",
    bankAccountId: bank,
    cashAccountId: cash,
    cashOutMethodId: method,
    bankOut: "1000",
    cashReceived: "950",
    purpose: "Наличные",
    allocations: [{ projectId: projects[0], amount: "30" }, { amount: "20" }],
  });
  const accept = async (kind: string, id: string) =>
    run("accept-calculation", {
      seasonId: sid,
      kind,
      id,
      reason: "Проверено руководством",
      confirmed: true,
    });
  const qs: string[][] = [];
  for (const employeeId of employees) {
    const ids: string[] = [];
    for (const periodStart of [
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]) {
      const id = await run("quarter", {
        seasonId: sid,
        employeeId,
        periodStart,
      });
      await accept("QUARTER", id);
      ids.push(id);
    }
    qs.push(ids);
  }
  await t.test(
    "С-6: перенос связан с принятой предыдущей версией",
    async () => {
      const q = await db.quarterEmployeeSettlement.findUniqueOrThrow({
        where: { id: qs[0][1] },
      });
      assert.equal(q.carrySourceId, qs[0][0]);
      assert.equal(q.carryIn.toString(), "15");
    },
  );
  const payment = {
    seasonId: sid,
    employeeId: employees[0],
    paymentCategoryId: bonus,
    accountId: bank,
    paymentDate: "2026-04-01",
    accountingPeriod: "2026-03-01",
    amount: "15",
    quarterEmployeeSettlementId: qs[0][0],
    reason: "Бонус",
  };
  await run("payment", payment);
  await t.test(
    "Исключение: превышение требует отдельного решения, аудита и однократного использования",
    async () => {
      await assert.rejects(() => run("payment", { ...payment, amount: "20" }));
      await assert.rejects(() =>
        run("bonus-exception", {
          seasonId: sid,
          employeeId: employees[0],
          originalSettlementId: qs[0][0],
          requestedPayment: "20",
          reason: "",
          confirmed: true,
        }),
      );
      const approval = await run("bonus-exception", {
        seasonId: sid,
        employeeId: employees[0],
        originalSettlementId: qs[0][0],
        requestedPayment: "20",
        reason: "Одобрена дополнительная выплата",
        confirmed: true,
      });
      await run("payment", {
        ...payment,
        amount: "20",
        bonusApprovalId: approval,
      });
      await assert.rejects(() =>
        run("payment", { ...payment, amount: "20", bonusApprovalId: approval }),
      );
      assert.equal(
        await db.auditLog.count({
          where: { entity: "BonusExceptionApproval", entityId: approval },
        }),
        1,
      );
      assert.equal(
        (
          await db.quarterEmployeeSettlement.findUniqueOrThrow({
            where: { id: qs[0][0] },
          })
        ).bonus.toString(),
        "15",
      );
    },
  );
  await t.test(
    "С-6 и исключения: замена квартала инвалидирует перенос, исторический бонус требует разрешения",
    async () => {
      const original = qs[0][0];
      const replacement = await run("quarter", {
        seasonId: sid,
        employeeId: employees[0],
        periodStart: "2026-01-01",
      });
      await accept("QUARTER", replacement);
      assert.equal(await quarterIsCurrent(db, qs[0][1]), false);
      await assert.rejects(() => run("payment", { ...payment, amount: "1" }));
      const approval = await run("bonus-exception", {
        seasonId: sid,
        employeeId: employees[0],
        originalSettlementId: original,
        requestedPayment: "1",
        reason: "Выплата по исторической версии",
        confirmed: true,
      });
      const saved = await db.bonusExceptionApproval.findUniqueOrThrow({
        where: { id: approval },
      });
      assert.equal(saved.currentSettlementId, replacement);
      const pid = await run("payment", {
        ...payment,
        amount: "1",
        bonusApprovalId: approval,
      });
      await run("correction", {
        seasonId: sid,
        date: "2026-04-02",
        entity: "payment",
        id: pid,
        reason: "Проверка сторно исключения",
      });
      qs[0][0] = replacement;
      for (const [index, periodStart] of [
        "2026-04-01",
        "2026-07-01",
        "2026-10-01",
      ].entries()) {
        const id = await run("quarter", {
          seasonId: sid,
          employeeId: employees[0],
          periodStart,
        });
        await accept("QUARTER", id);
        qs[0][index + 1] = id;
      }
    },
  );
  await run("payment", {
    ...payment,
    employeeId: employees[1],
    paymentCategoryId: reimbursement,
    amount: "50",
    quarterEmployeeSettlementId: undefined,
  });
  await t.test(
    "С-7: компенсация исключает возмещение и совпадает с сезонным расчетом",
    async () => {
      const dashboard = (await readResource(
        admin,
        "dashboard",
        new URLSearchParams({ seasonId: sid }),
      )) as any;
      assert.equal(dashboard.totals.compensationPaid, "235.0000");
      const c = await employeeCalculation(db, sid, employees[0]);
      assert.equal(c.seasonResult.paid, "135.0000");
      assert.equal(c.seasonResult.finalPayment, "0");
    },
  );
  for (const employeeId of employees) {
    const c = await employeeCalculation(db, sid, employeeId);
    if (f.d(c.seasonResult.finalPayment).gt(0))
      await run("payment", {
        seasonId: sid,
        employeeId,
        paymentCategoryId: final,
        accountId: bank,
        paymentDate: "2026-12-31",
        accountingPeriod: "2026-12-01",
        amount: c.seasonResult.finalPayment,
        reason: "Окончательная выплата",
      });
  }
  for (const employeeId of employees)
    await accept(
      "SEASON",
      await run("season-settlement", { seasonId: sid, employeeId }),
    );
  let allocation = await run("partner-allocation", { seasonId: sid });
  await accept("ALLOCATION", allocation);
  await t.test(
    "С-5: комиссия одинакова в деталях проекта и сводке, не удваивается",
    async () => {
      const e = await projectEconomics(db, sid);
      const dash = (await readResource(
        admin,
        "dashboard",
        new URLSearchParams({ seasonId: sid }),
      )) as any;
      assert.equal(
        dash.totals.direct,
        f
          .d(
            e.rows
              .reduce((s, r) => s.plus(r.otherDirect).plus(r.labor), f.d("0"))
              .toString(),
          )
          .toFixed(4),
      );
      assert.equal(dash.totals.general, e.general);
      assert.equal(dash.totals.economicResult, "29520.0000");
      assert.equal(
        dash.insights.monthly
          .reduce(
            (total: import("decimal.js").default, month: { result: string }) =>
              total.plus(month.result),
            f.d("0"),
          )
          .toFixed(4),
        dash.totals.economicResult,
      );
    },
  );
  const payPartner = async (partnerId: string, amount: string) =>
    run("partner-payment", {
      seasonId: sid,
      partnerId,
      accountId: bank,
      date: "2026-12-31",
      amount,
      reason: "Доход партнера",
    });
  const verifyPartnerDisplay = async () => {
    const canonical = await partnerBalances(db, sid);
    for (const balance of canonical.balances) {
      for (const principal of [
        admin,
        {
          id: randomUUID(),
          role: "PARTNER",
          partnerId: balance.partnerId,
        } as Principal,
      ]) {
        const detail = (await readResource(
          principal,
          "partner-detail",
          new URLSearchParams({ seasonId: sid, partnerId: balance.partnerId }),
        )) as any;
        assert.deepEqual(detail.totals, {
          entitlement: balance.entitlement,
          payable: balance.payable,
          paid: balance.paid,
          remaining: balance.remaining,
          roundingDifference: balance.roundingDifference,
        });
      }
    }
  };
  await t.test(
    "До принятия расчёта интерфейс не подменяет обязательство нулём",
    async () => {
      const detail = (await readResource(
        admin,
        "partner-detail",
        new URLSearchParams({ seasonId: next, partnerId: partners[0] }),
      )) as any;
      assert.equal(detail.totals, null);
    },
  );
  await t.test(
    "Несколько партнеров: частичная выплата блокирует, полная снимает долг",
    async () => {
      let b = await partnerBalances(db, sid);
      assert.equal(b.balances.length, 2);
      await payPartner(partners[0], "1");
      b = await partnerBalances(db, sid);
      await verifyPartnerDisplay();
      assert.ok(
        b.blockers.some(
          (s) => s.includes("Первый") && s.includes("не выплачено"),
        ),
      );
      for (const row of b.balances)
        await payPartner(row.partnerId, row.remaining);
      assert.equal((await partnerBalances(db, sid)).blockers.length, 0);
      await verifyPartnerDisplay();
    },
  );
  await t.test(
    "Округление в обе стороны: выплаченное обязательство показывает ноль для руководства и партнёра",
    async () => {
      const balances = (await partnerBalances(db, sid)).balances;
      for (const [index, exact, obligation, rounding] of [
        [0, "7808.2591", "7808.0000", "-0.2591"],
        [1, "4979.7571", "4980.0000", "0.2429"],
      ] as const) {
        const b = balances.find((row) => row.partnerId === partners[index])!;
        assert.equal(b.entitlement, exact);
        assert.equal(b.payable, obligation);
        assert.equal(b.paid, obligation);
        assert.equal(b.roundingDifference, rounding);
        assert.equal(b.remaining, "0.0000");
      }
      await verifyPartnerDisplay();
    },
  );
  await t.test(
    "С-4: сторно партнерской выплаты восстанавливает долг и сохраняет историю",
    async () => {
      const p = await db.partnerPayment.findFirstOrThrow({
        where: { seasonId: sid },
      });
      const before = await accountBalance(db, bank);
      await run("correction", {
        seasonId: sid,
        date: "2026-12-31",
        entity: "journal",
        id: p.journalTransactionId,
        reason: "Сторно выплаты партнеру",
      });
      assert.equal(
        f
          .d(await accountBalance(db, bank))
          .minus(before)
          .toFixed(4),
        p.amount.toFixed(4),
      );
      assert.ok(
        (await partnerBalances(db, sid)).blockers.some((s) =>
          s.includes("не выплачено"),
        ),
      );
      const rows = (await readResource(
        admin,
        "partner-payments",
        new URLSearchParams({ seasonId: sid }),
      )) as any;
      await verifyPartnerDisplay();
      assert.equal(
        rows.items.find((r: any) => r.id === p.id).correctionStatus,
        "Отменено",
      );
      await payPartner(p.partnerId, p.amount.toFixed(4));
      assert.equal((await partnerBalances(db, sid)).blockers.length, 0);
    },
  );
  await t.test(
    "С-3, С-8: новая принятая версия не суммируется с историей и требует переотнесения выплат",
    async () => {
      allocation = await run("partner-allocation", { seasonId: sid });
      await accept("ALLOCATION", allocation);
      await verifyPartnerDisplay();
      assert.ok(
        (await partnerBalances(db, sid)).blockers.some((s) =>
          s.includes("не отнесено"),
        ),
      );
      for (const p of await db.partnerPayment.findMany({
        where: {
          seasonId: sid,
          journalTransactionIdRef: {
            JournalTransaction_reversalOf_rows: { none: {} },
          },
        },
      }))
        await run("attribute-partner-payment", {
          seasonId: sid,
          paymentId: p.id,
          reason: "Отнесено к новой принятой версии",
          confirmed: true,
        });
      const current = (await readResource(
        admin,
        "allocations",
        new URLSearchParams({ seasonId: sid }),
      )) as any;
      assert.equal(current.items.length, 3);
      const history = (await readResource(
        admin,
        "allocations",
        new URLSearchParams({ seasonId: sid, history: "1" }),
      )) as any;
      assert.equal(history.items.length, 6);
    },
  );
  await t.test(
    "В-2: следующий сезон не меняет исторические остатки и экономику",
    async () => {
      const before = await accountBalance(db, bank, new Date("2026-12-31"));
      const economics = await projectEconomics(db, sid);
      await run("project-season", {
        seasonId: next,
        projectId: projects[0],
        reason: "Продолжение",
        confirmed: true,
      });
      await run("revenue", {
        seasonId: next,
        projectId: projects[0],
        date: "2027-01-02",
        amount: "999",
        comment: "Новый сезон",
      });
      await run("transfer", {
        seasonId: next,
        date: "2027-01-02",
        toId: bank,
        amount: "777",
        reason: "Новый остаток",
      });
      assert.equal(
        await accountBalance(db, bank, new Date("2026-12-31")),
        before,
      );
      assert.deepEqual((await projectEconomics(db, sid)).rows, economics.rows);
      assert.equal(
        (await projectEconomics(db, next)).rows[0].partnerRate,
        "0.5",
      );
    },
  );
  const reviews = async () => {
    for (const name of f.requiredClosingChecks)
      await run("review", {
        seasonId: sid,
        name,
        resolved: true,
        reason: "Источники проверены",
      });
  };
  for (const a of await db.ledgerAccount.findMany({
    where: { active: true, kind: { in: ["BANK", "CASH"] } },
  }))
    await run("reconciliation", {
      seasonId: sid,
      date: "2026-12-31",
      ledgerAccountId: a.id,
      actual: await accountBalance(db, a.id, new Date("2026-12-31")),
      explanation: "Сверено с источниками",
    });
  await reviews();
  assert.equal((await readiness(db, sid)).canClose, true);
  await t.test(
    "С-8: смена версии при неизменных источниках аннулирует сверку",
    async () => {
      await accept(
        "ALLOCATION",
        await run("partner-allocation", { seasonId: sid }),
      );
      assert.equal((await readiness(db, sid)).canClose, false);
      for (const p of await db.partnerPayment.findMany({
        where: {
          seasonId: sid,
          journalTransactionIdRef: {
            JournalTransaction_reversalOf_rows: { none: {} },
          },
        },
      }))
        await run("attribute-partner-payment", {
          seasonId: sid,
          paymentId: p.id,
          reason: "Новая версия",
          confirmed: true,
        });
      await reviews();
      assert.equal((await readiness(db, sid)).canClose, true);
    },
  );
  const beforeClose = await collectSeasonReport(db, sid);
  assert.equal(beforeClose.totals.economicResult, "29520.0000");
  assert.equal(beforeClose.totals.revenue, "30000.0000");
  assert.equal(beforeClose.totals.cashOutFees, "50.0000");
  assert.equal(beforeClose.totals.compensationPaid, "265.0000");
  await run("close", {
    seasonId: sid,
    reason: "Полный сезон сверен",
    confirmed: true,
  });
  assert.equal(
    (await db.season.findUniqueOrThrow({ where: { id: sid } })).status,
    "Закрыт",
  );
  const closedBefore = await readSeasonReport(admin, sid, "management");
  await run("work", {
    seasonId: next,
    projectId: projects[0],
    employeeId: employees[0],
    complexityLevelId: level,
    date: "2027-02-01",
    description: "Продолжение после закрытия",
    plannedHours: "1",
    actualHours: "1",
  });
  await run("project-status", {
    seasonId: next,
    projectId: projects[0],
    status: "Активный",
    reason: "Продолжение",
  });
  await run("partner-allocation", { seasonId: next });
  await run("cashout", {
    seasonId: next,
    date: "2027-03-01",
    bankAccountId: bank,
    cashAccountId: cash,
    cashOutMethodId: method,
    bankOut: "100",
    cashReceived: "95",
    purpose: "Следующий сезон",
    allocations: [{ projectId: projects[0], amount: "5" }],
  });
  assert.equal((await projectEconomics(db, sid)).rows[0].revenue, "10000.0000");
  const lifetime = (await readResource(
    admin,
    "project-detail",
    new URLSearchParams({ projectId: projects[0], scope: "all" }),
  )) as any;
  assert.equal(lifetime.periods.length, 2);
  assert.equal(lifetime.totals.revenue, "10999.0000");
  assert.equal(lifetime.fixedPartnerRate, "0.5");
  const journals = await db.journalTransaction.findMany({
    where: { seasonId: sid },
    include: { JournalLine_journalTransactionId_rows: true },
  });
  for (const j of journals)
    assert.equal(
      j.JournalLine_journalTransactionId_rows.reduce(
        (s, l) => s.plus(l.debit.toString()).minus(l.credit.toString()),
        f.d("0"),
      ).toString(),
      "0",
    );
  await t.test(
    "Excel: снимок закрытия, 20/8 листов, точные ячейки, изоляция и отсутствие изменений",
    async () => {
      const read = await readSeasonReport(admin, sid, "management");
      assert.deepEqual(read, closedBefore);
      const source = read.data as Awaited<
        ReturnType<typeof collectSeasonReport>
      >;
      assert.equal(source.season.status, "Закрыт");
      assert.deepEqual(source.totals, beforeClose.totals);
      assert.equal(
        fingerprint({ ...source, sourceFingerprint: undefined }),
        source.sourceFingerprint,
      );
      const countBefore = await db.auditLog.count();
      const receiptsBefore = await db.commandReceipt.count();
      await mkdir(".runtime/phase6-reports", { recursive: true });
      const cases = [
        {
          scope: "management" as const,
          data: source,
          file: "management.xlsx",
          tables: managementTables(source),
        },
        ...partners.map((id, i) => {
          const data = partnerReport(source, id);
          return {
            scope: "partner" as const,
            data,
            file: `partner-${i + 1}.xlsx`,
            tables: partnerTables(data),
          };
        }),
      ];
      for (const c of cases) {
        const bytes = await buildWorkbook(c.data, c.scope, {
          user: "Проверка демо-сезона",
          generatedAt: new Date("2026-09-26T00:00:00Z"),
          draft: false,
        });
        await writeFile(".runtime/phase6-reports/" + c.file, bytes);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(bytes as any);
        assert.equal(book.worksheets.length, c.scope === "management" ? 21 : 8);
        const archive = await JSZip.loadAsync(bytes);
        const worksheetXml = archive.file(/^xl\/worksheets\/sheet\d+\.xml$/);
        assert.equal(worksheetXml.length, book.worksheets.length);
        for (const entry of worksheetXml) {
          const xml = await entry.async("string");
          assert.doesNotMatch(
            xml,
            /<(?:\w+:)?pane\b|\b(?:xSplit|ySplit)\s*=|\bstate="(?:frozen|frozenSplit|split)"/,
            entry.name,
          );
        }
        for (const tab of c.tables) {
          const sheet = book.getWorksheet(tab.name)!;
          assert.ok(sheet);
          assert.ok(sheet.views.length > 0);
          for (const view of sheet.views) {
            assert.equal(view.state, "normal", tab.name);
            assert.equal(view.showGridLines, false, tab.name);
            assert.ok(!("xSplit" in view), tab.name);
            assert.ok(!("ySplit" in view), tab.name);
          }
          assert.equal(sheet.getCell("B5").value, source.sourceFingerprint);
          for (let r = 0; r < tab.rows.length; r++)
            for (let col = 0; col < tab.columns.length; col++) {
              const original = tab.rows[r][col],
                actual = sheet.getCell(r + 10, col + 1).value,
                kind = tab.columns[col].kind;
              if (original === null || original === undefined) {
                assert.equal(actual, null);
                continue;
              }
              if (original === "ИТОГО") assert.equal(actual, "ИТОГО");
              else if (kind === "money" || kind === "rate")
                assert.equal(actual, excelNumber(original));
              else if (kind === "date")
                assert.equal(
                  (actual as Date).toISOString(),
                  new Date(String(original)).toISOString(),
                );
              else
                assert.equal(
                  actual,
                  typeof original === "number" ? original : String(original),
                );
            }
        }
        if (c.scope === "partner") {
          const serialized = JSON.stringify(book.model);
          for (const w of source.work)
            assert.ok(!serialized.includes(w.employeeIdRef.name));
          for (const p of source.projects.filter(
            (p) => !c.data.projects.some((own) => own.id === p.id),
          )) {
            assert.ok(!serialized.includes(p.id));
            assert.ok(!serialized.includes(p.name));
          }
          assert.ok(!serialized.includes("Банк основной"));
        }
      }
      assert.equal(await db.auditLog.count(), countBefore);
      assert.equal(await db.commandReceipt.count(), receiptsBefore);
      assert.throws(
        () => excelNumber("1234567890123456.0001"),
        /точность Excel/,
      );
      for (const id of partners) {
        const own = {
          id: randomUUID(),
          role: "PARTNER" as const,
          partnerId: id,
        };
        assert.equal(
          (await readSeasonReport(own, sid, "partner")).scope,
          "partner",
        );
        await assert.rejects(
          readSeasonReport(
            own,
            sid,
            "partner",
            false,
            partners.find((p) => p !== id),
          ),
          /запрещён/,
        );
      }
      await assert.rejects(
        readSeasonReport(
          { id: randomUUID(), role: "EMPLOYEE" },
          sid,
          "management",
        ),
        /недоступен/,
      );
      console.log(
        "EXCEL_ROUNDTRIP_VERIFIED=3 workbooks, 37 sheets, all canonical cells",
      );
    },
  );
  console.log(
    "SCENARIO_RECONCILED",
    JSON.stringify({
      season: sid,
      employees: 2,
      partners: 2,
      projects: 3,
      economicResult: "29520.0000",
      compensation: "265.0000",
      partnerBalances: (await partnerBalances(db, sid)).balances,
      journals: journals.length,
      closed: true,
    }),
  );
  if (process.env.PHASE6_BROWSER === "1") {
    const { openBrowserFixture } = await import("../scripts/browser-fixture");
    await openBrowserFixture(sid, partners[0], user.email);
  }
});
