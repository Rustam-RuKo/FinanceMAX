import type { Prisma } from "@prisma/client";
import * as f from "../domain/calculations";
import { ensure } from "./errors";
import { seasonTripPayments } from "./trip-payments";
import { expenseReferenceChecks } from "./manual-expenses";
import {
  quarterIsCurrent,
  seasonIsCurrent,
  acceptedIds,
  approvalFingerprint,
  partnerBalances,
} from "./versions";
export type Tx = Prisma.TransactionClient;
export const sum = (values: { toString(): string }[]) =>
  values
    .reduce<ReturnType<typeof f.d>>((s, x) => s.plus(x.toString()), f.d("0"))
    .toFixed(4);
export const activeJournal = {
  status: "POSTED",
  reversalOf: null,
  JournalTransaction_reversalOf_rows: { none: {} },
} satisfies Prisma.JournalTransactionWhereInput;
export async function employeeCalculation(
  tx: Tx,
  seasonId: string,
  employeeId: string,
) {
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } });
  const [employee, entries, payments] = await Promise.all([
    tx.employee.findUniqueOrThrow({ where: { id: employeeId } }),
    tx.workEntry.findMany({
      where: { seasonId, employeeId, voided: false },
      include: { projectIdRef: { select: { name: true } } },
      orderBy: { accountingDate: "asc" },
    }),
    tx.employeePayment.findMany({
      where: { seasonId, employeeId, journalTransactionIdRef: activeJournal },
      orderBy: { accountingPeriod: "asc" },
    }),
  ]);
  const compensation: f.Compensation[] = payments.map((p) => ({
    kind: p.kindSnapshot as f.Compensation["kind"],
    amount: p.amount.toFixed(4),
    accountingMonth: p.accountingPeriod.toISOString().slice(0, 7),
    paymentDate: p.paymentDate.toISOString().slice(0, 10),
    relevant: p.settlementRelevantSnapshot,
    settlementId: p.quarterEmployeeSettlementId ?? undefined,
  }));
  const quarters = [];
  let carry = "0";
  const cursor = new Date(
    Date.UTC(
      season.startDate.getUTCFullYear(),
      Math.floor(season.startDate.getUTCMonth() / 3) * 3,
      1,
    ),
  );
  while (cursor <= season.endDate) {
    const start = new Date(
      Math.max(cursor.getTime(), season.startDate.getTime()),
    );
    const next = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1),
    );
    const end = new Date(
      Math.min(next.getTime() - 86400000, season.endDate.getTime()),
    );
    const work = entries.filter(
      (e) => e.accountingDate >= start && e.accountingDate <= end,
    );
    const salary = payments.filter(
      (p) =>
        p.kindSnapshot === "SALARY" &&
        p.accountingPeriod >=
          new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)) &&
        p.accountingPeriod <= end,
    );
    const result = f.calculateEmployeeQuarterSettlement(
      sum(work.map((e) => e.earned)),
      sum(salary.map((p) => p.amount)),
      carry,
    );
    quarters.push({
      periodStart: start,
      periodEnd: end,
      ...result,
      workEntries: work,
      salaryPayments: salary,
    });
    carry = result.carry;
    cursor.setTime(next.getTime());
  }
  const seasonResult = f.calculateEmployeeSeasonSettlement(
    sum(entries.map((e) => e.earned)),
    quarters.map((q) => q.ktu),
    compensation,
  );
  return {
    employee: { id: employee.id, name: employee.name },
    season,
    entries,
    payments,
    quarters,
    seasonResult,
  };
}
export async function projectEconomics(tx: Tx, seasonId: string) {
  const [season, projects, entries, expenses, revenues, fees] =
    await Promise.all([
      tx.season.findUniqueOrThrow({ where: { id: seasonId } }),
      tx.project.findMany({
        where: { seasons: { some: { seasonId } } },
        include: { ProjectPartnerRate_projectId_rows: true },
      }),
      tx.workEntry.findMany({ where: { seasonId, voided: false } }),
      tx.expense.findMany({ where: { seasonId, voided: false } }),
      tx.projectRevenue.findMany({ where: { seasonId, voided: false } }),
      tx.cashOutAllocation.findMany({
        where: {
          cashOutTransactionIdRef: {
            seasonId,
            journalTransactionIdRef: activeJournal,
          },
        },
      }),
    ]);
  const rows = projects.map((p) => {
    const rates = p.ProjectPartnerRate_projectId_rows;
    ensure(
      rates.length === 1,
      `Для проекта «${p.name}» требуется одна фиксированная ставка партнера`,
    );
    return {
      id: p.id,
      name: p.name,
      partnerId: p.partnerId,
      revenue: sum(
        revenues.filter((r) => r.projectId === p.id).map((r) => r.amount),
      ),
      labor: sum(
        entries.filter((e) => e.projectId === p.id).map((e) => e.earned),
      ),
      otherDirect: sum([
        ...expenses.filter((e) => e.projectId === p.id).map((e) => e.amount),
        ...fees.filter((e) => e.projectId === p.id).map((e) => e.amount),
      ]),
      partnerRate: rates[0].rate.toString(),
    };
  });
  const general = sum([
    ...expenses.filter((e) => !e.projectId).map((e) => e.amount),
    ...fees.filter((e) => !e.projectId).map((e) => e.amount),
  ]);
  return {
    season,
    rows,
    general,
    entries,
    expenses,
    revenues,
    fees,
    allocation: f.calculatePartnerAllocation(rows, general),
  };
}
export async function accountBalance(tx: Tx, accountId: string, at?: Date) {
  const lines = await tx.journalLine.findMany({
    where: {
      ledgerAccountId: accountId,
      journalTransactionIdRef: {
        status: "POSTED",
        ...(at ? { postingDate: { lte: at } } : {}),
      },
    },
  });
  return f.calculateCashBalance(
    lines.map((l) => ({
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  );
}
export async function readiness(tx: Tx, seasonId: string) {
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } });
  const quarterIds = await acceptedIds(tx, seasonId, "QUARTER"),
    settlementIds = await acceptedIds(tx, seasonId, "SEASON");
  const fingerprint = await approvalFingerprint(tx, seasonId);
  const partnerState = await partnerBalances(tx, seasonId);
  const [
    projects,
    work,
    quarters,
    settlements,
    runs,
    reconciliations,
    accounts,
    review,
  ] = await Promise.all([
    tx.project.findMany({ where: { seasons: { some: { seasonId } } } }),
    tx.workEntry.findMany({
      where: { seasonId, voided: false },
      select: { employeeId: true },
    }),
    tx.quarterEmployeeSettlement.findMany({
      where: {
        seasonId,
        id: { in: quarterIds },
        sourceRevision: season.workRevision,
      },
    }),
    tx.seasonEmployeeSettlement.findMany({
      where: {
        seasonId,
        id: { in: settlementIds },
        sourceRevision: season.compensationRevision,
      },
    }),
    tx.allocationRun.findMany({
      where: {
        seasonId,
        sourceRevision: season.economicRevision,
        status: { in: ["Рассчитано", "Ручное распределение"] },
      },
    }),
    tx.cashReconciliation.findMany({
      where: { seasonId },
      orderBy: { date: "desc" },
    }),
    tx.ledgerAccount.findMany({
      where: {
        active: true,
        kind: { in: ["BANK", "CASH"] },
        JournalLine_ledgerAccountId_rows: {
          some: {
            journalTransactionIdRef: {
              status: "POSTED",
              postingDate: { lte: season.endDate },
            },
          },
        },
      },
    }),
    tx.seasonClosingCheck.findMany({
      where: { seasonClosingIdRef: { seasonId } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const employees = new Set(work.map((w) => w.employeeId));
  const paymentEmployees = await tx.employeePayment.findMany({
    where: { seasonId, journalTransactionIdRef: activeJournal },
    select: { employeeId: true },
  });
  paymentEmployees.forEach((p) => employees.add(p.employeeId));
  const expectedQuarterStarts: string[] = [];
  const quarterCursor = new Date(
    Date.UTC(
      season.startDate.getUTCFullYear(),
      Math.floor(season.startDate.getUTCMonth() / 3) * 3,
      1,
    ),
  );
  while (quarterCursor <= season.endDate) {
    expectedQuarterStarts.push(
      new Date(
        Math.max(quarterCursor.getTime(), season.startDate.getTime()),
      ).toISOString(),
    );
    quarterCursor.setUTCMonth(quarterCursor.getUTCMonth() + 3);
  }
  const validQuarters = new Set(
    (
      await Promise.all(
        quarters.map(async (q) =>
          (await quarterIsCurrent(tx, q.id)) ? q.id : null,
        ),
      )
    ).filter(Boolean),
  );
  const validSeasons = new Set(
    (
      await Promise.all(
        settlements.map(async (q) =>
          (await seasonIsCurrent(tx, q.id)) ? q.id : null,
        ),
      )
    ).filter(Boolean),
  );
  const auto = new Map<string, boolean>([
    [
      "Проекты",
      true /* Continuing projects do not block a completed season. */,
    ],
    [
      "Расчеты сотрудников",
      [...employees].every(
        (id) =>
          settlements.some(
            (s) =>
              s.employeeId === id &&
              validSeasons.has(s.id) &&
              s.finalPayment.lte(0),
          ) &&
          expectedQuarterStarts.every((start) =>
            quarters.some(
              (q) =>
                validQuarters.has(q.id) &&
                q.employeeId === id &&
                q.periodStart.toISOString() === start,
            ),
          ),
      ),
    ],
    ["Расчеты партнеров", partnerState.blockers.length === 0],
    [
      "Необъясненные расхождения",
      reconciliations.every((r) => r.resolved || r.difference.isZero()),
    ],
  ]);
  const currentChecks = await Promise.all(
    accounts.map(async (a) => {
      const last = reconciliations.find((r) => r.ledgerAccountId === a.id);
      return {
        kind: a.kind,
        ready:
          !!last &&
          last.resolved &&
          last.date <= season.endDate &&
          f.d(await accountBalance(tx, a.id, season.endDate)).eq(last.expected),
      };
    }),
  );
  auto.set(
    "Банк",
    currentChecks.filter((c) => c.kind === "BANK").every((c) => c.ready),
  );
  auto.set(
    "Наличные",
    currentChecks.filter((c) => c.kind === "CASH").every((c) => c.ready),
  );
  auto.set(
    "Сверка кассы",
    currentChecks.some((c) => c.kind === "CASH") &&
      currentChecks.filter((c) => c.kind === "CASH").every((c) => c.ready),
  );
  const result = f.calculateSeasonClosingReadiness(
    f.requiredClosingChecks.map((name) => ({
      name,
      resolved:
        (auto.get(name) ?? true) &&
        !!review.find(
          (r) => r.name === name && r.approvalFingerprint === fingerprint,
        )?.resolved,
    })),
  );
  const trips = await seasonTripPayments(tx, seasonId, season.endDate);
  const tripBlockers = trips.flatMap((t) => t.warning ? [`Командировка «${t.destination}», ${t.employee}: ${t.warning}`] :
    f.d(t.remaining).gt(0) ? [`Командировка «${t.destination}», ${t.employee}: осталось выплатить ${t.remaining} UZS`] :
    f.d(t.accountableAdvance).gt(0) ? [`Командировка «${t.destination}», ${t.employee}: подотчетный остаток ${t.accountableAdvance} UZS требует сверки`] : []);
  const expenseChecks = await expenseReferenceChecks(tx, seasonId);
  const expenseBlockers = expenseChecks
    .filter((c) => !c.resolved)
    .map(
      (c) =>
        `Расход по документу «${c.reference}»: части ${c.actual} UZS не соответствуют исходной сумме ${c.expected} UZS`,
    );
  return {
    ...result,
    canClose: result.canClose && expenseBlockers.length === 0 && tripBlockers.length === 0,
    blockers: [
      ...result.blockers,
      ...partnerState.blockers,
      ...expenseBlockers,
      ...tripBlockers,
    ],
    partnerBalances: partnerState.balances,
  };
}
