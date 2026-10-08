import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Principal } from "../domain/authorization";
import * as f from "../domain/calculations";
import { db } from "./db";
import { ensure } from "./errors";
import { seasonTripPayments } from "./trip-payments";
import { auditSectionRows } from "./audit-sections";
import { projectTypeName } from "../domain/audit-templates";
import { expenseReferenceChecks } from "./manual-expenses";
import {
  activeJournal,
  accountBalance,
  readiness,
  sum,
  type Tx,
} from "./calculation-data";
import {
  acceptedIds,
  approvalFingerprint,
  quarterIsCurrent,
  seasonIsCurrent,
  partnerBalances,
} from "./versions";

/** Decimal/date normalization is deliberately before hashing or storing the snapshot. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export function fingerprint(value: unknown) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b, "en"))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(plain(value))))
    .digest("hex");
}
export async function collectSeasonReport(tx: Tx, seasonId: string) {
  const season = await tx.season.findUnique({ where: { id: seasonId } });
  ensure(season, "Сезон не найден", 404);
  const [
    projects,
    work,
    expenses,
    revenue,
    payments,
    trips,
    cashouts,
    journals,
    accounts,
    reconciliations,
    acceptances,
    state,
    closing,
  ] = await Promise.all([
    tx.project.findMany({
      where: { seasons: { some: { seasonId } } },
      include: { partnerIdRef: true, ProjectPartnerRate_projectId_rows: true },
      orderBy: { id: "asc" },
    }),
    tx.workEntry.findMany({
      where: { seasonId, voided: false },
      include: {
        auditSection: true,
        employeeIdRef: true,
        complexityRateIdRef: { include: { complexityLevelIdRef: true } },
      },
      orderBy: { id: "asc" },
    }),
    tx.expense.findMany({
      where: { seasonId, voided: false },
      include: { expenseCategoryIdRef: true },
      orderBy: { id: "asc" },
    }),
    tx.projectRevenue.findMany({
      where: { seasonId, voided: false },
      orderBy: { id: "asc" },
    }),
    tx.employeePayment.findMany({
      where: { seasonId, journalTransactionIdRef: activeJournal },
      include: { employeeIdRef: true, paymentCategoryIdRef: true },
      orderBy: { id: "asc" },
    }),
    tx.businessTrip.findMany({
      where: {
        seasonId,
        OR: [{ voided: false }, { paymentLinks: { some: {} } }],
      },
      include: { employeeIdRef: true },
      orderBy: { id: "asc" },
    }),
    tx.cashOutTransaction.findMany({
      where: { seasonId, journalTransactionIdRef: activeJournal },
      include: {
        journalTransactionIdRef: true,
        cashOutMethodRateIdRef: { include: { cashOutMethodIdRef: true } },
        CashOutAllocation_cashOutTransactionId_rows: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.journalTransaction.findMany({
      where: { seasonId, status: "POSTED" },
      include: {
        JournalLine_journalTransactionId_rows: {
          include: { ledgerAccountIdRef: true },
        },
      },
      orderBy: { id: "asc" },
    }),
    tx.ledgerAccount.findMany({
      where: {
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
      orderBy: { id: "asc" },
    }),
    tx.cashReconciliation.findMany({
      where: { seasonId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    tx.calculationAcceptance.findMany({
      where: { seasonId },
      orderBy: { key: "asc" },
    }),
    partnerBalances(tx, seasonId),
    readiness(tx, seasonId),
  ]);
  const quarters = await tx.quarterEmployeeSettlement.findMany({
    where: { id: { in: await acceptedIds(tx, seasonId, "QUARTER") } },
    include: { employeeIdRef: true },
    orderBy: [{ employeeId: "asc" }, { periodStart: "asc" }],
  });
  const settlements = await tx.seasonEmployeeSettlement.findMany({
    where: { id: { in: await acceptedIds(tx, seasonId, "SEASON") } },
    include: { employeeIdRef: true },
    orderBy: { employeeId: "asc" },
  });
  const currentQuarters = [] as typeof quarters;
  for (const q of quarters)
    if (await quarterIsCurrent(tx, q.id)) currentQuarters.push(q);
  const currentSettlements = [] as typeof settlements;
  for (const s of settlements)
    if (await seasonIsCurrent(tx, s.id)) currentSettlements.push(s);
  const run =
    state.run?.sourceRevision === season.economicRevision &&
    ["Рассчитано", "Ручное распределение"].includes(state.run.status)
      ? state.run
      : null;
  const allocations = run
    ? await tx.projectAllocation.findMany({
        where: { allocationRunId: run.id },
        orderBy: { projectId: "asc" },
      })
    : [];
  const partnerPayments = await tx.partnerPayment.findMany({
    where: { seasonId, journalTransactionIdRef: activeJournal },
    include: { attribution: true },
    orderBy: { id: "asc" },
  });
  const fees = cashouts.flatMap(
    (c) => c.CashOutAllocation_cashOutTransactionId_rows,
  );
  const totals = f.calculateSeasonSummary({
    revenues: revenue.map((r) => r.amount.toString()),
    labor: work.map((w) => w.earned.toString()),
    direct: expenses.filter((e) => e.projectId).map((e) => e.amount.toString()),
    general: expenses
      .filter((e) => !e.projectId)
      .map((e) => e.amount.toString()),
    cashOutFees: cashouts.map((c) => c.actualFee.toString()),
    directCashOutFees: fees
      .filter((c) => c.projectId)
      .map((c) => c.amount.toString()),
    generalCashOutFees: fees
      .filter((c) => !c.projectId)
      .map((c) => c.amount.toString()),
    compensation: payments
      .filter((p) =>
        f.compensationEligible(
          p.kindSnapshot as f.Compensation["kind"],
          p.settlementRelevantSnapshot,
        ),
      )
      .map((p) => p.amount.toString()),
    partnerPayments: partnerPayments.map((p) => p.amount.toString()),
  });
  const balances = await Promise.all(
    accounts.map(async (a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      opening: await accountBalance(
        tx,
        a.id,
        new Date(season.startDate.getTime() - 86400000),
      ),
      closing: await accountBalance(tx, a.id, season.endDate),
    })),
  );
  const projectRows = projects.map((p) => {
    ensure(
      p.ProjectPartnerRate_projectId_rows.length === 1,
      `Проект «${p.name}»: отсутствует единственная фиксированная ставка`,
      409,
    );
    const labor = sum(
        work.filter((w) => w.projectId === p.id).map((w) => w.earned),
      ),
      other = sum(
        expenses.filter((e) => e.projectId === p.id).map((e) => e.amount),
      ),
      fee = sum(fees.filter((e) => e.projectId === p.id).map((e) => e.amount));
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      client: p.client,
      projectType: projectTypeName(p.projectType),
      partnerId: p.partnerId,
      partner: p.partnerIdRef.name,
      status: p.status,
      rate: p.ProjectPartnerRate_projectId_rows[0].rate.toString(),
      revenue: sum(
        revenue.filter((r) => r.projectId === p.id).map((r) => r.amount),
      ),
      labor,
      other,
      fee,
      direct: f.d(labor).plus(other).plus(fee).toFixed(4),
      allocation: allocations.find((a) => a.projectId === p.id) ?? null,
    };
  });
  const payload = plain({
    schemaVersion: 2,
    auditSections: await auditSectionRows(tx, seasonId),
    season: {
      id: season.id,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      status: season.status,
    },
    cutoff: season.endDate,
    approvalFingerprint: await approvalFingerprint(tx, seasonId),
    acceptances: acceptances
      .filter((a) =>
        a.kind === "ALLOCATION"
          ? a.targetId === run?.id
          : a.kind === "QUARTER"
            ? currentQuarters.some((q) => q.id === a.targetId)
            : currentSettlements.some((s) => s.id === a.targetId),
      )
      .map((a) => ({ kind: a.kind, id: a.targetId, acceptedAt: a.updatedAt })),
    projects: projectRows,
    work,
    expenses,
    revenue,
    payments,
    trips,
    cashouts,
    journals,
    balances,
    tripPayments: await seasonTripPayments(tx, seasonId, season.endDate),
    reconciliations,
    quarters: currentQuarters,
    settlements: currentSettlements,
    allocation: run,
    partnerBalances: run ? state.balances : [],
    partnerPayments,
    totals,
    closing,
  });
  const withReferences = {
    ...payload,
    expenseReferences: await expenseReferenceChecks(tx, seasonId),
  };
  return { ...withReferences, sourceFingerprint: fingerprint(withReferences) };
}
export type SeasonReport = Awaited<ReturnType<typeof collectSeasonReport>>;

/** Allowlist projection. No personal work, payroll, bank or foreign partner records. */
export function partnerReport(source: SeasonReport, partnerId: string) {
  const projects = source.projects.filter((p) => p.partnerId === partnerId);
  ensure(projects.length > 0, "В этом сезоне нет доступных проектов", 404);
  const ids = new Set(projects.map((p) => p.id));
  return {
    schemaVersion: source.schemaVersion,
    season: source.season,
    cutoff: source.cutoff,
    sourceFingerprint: source.sourceFingerprint,
    acceptances: source.acceptances.filter((a) => a.kind === "ALLOCATION"),
    projects,
    revenue: source.revenue
      .filter((r) => ids.has(r.projectId))
      .map((r) => ({
        id: r.id,
        projectId: r.projectId,
        accountingDate: r.accountingDate,
        amount: r.amount,
      })),
    payments: source.partnerPayments
      .filter((p) => p.partnerId === partnerId)
      .map((p) => ({
        id: p.id,
        paymentDate: p.paymentDate,
        amount: p.amount,
        allocationId: p.attribution?.allocationRunId ?? null,
      })),
    balance:
      source.partnerBalances.find((p) => p.partnerId === partnerId) ?? null,
  };
}
export type PartnerReport = ReturnType<typeof partnerReport>;
export async function readSeasonReport(
  user: Principal,
  seasonId: string,
  scope: "management" | "partner",
  draft = false,
  partnerId?: string,
) {
  ensure(
    user.role !== "EMPLOYEE",
    "Сотрудникам экспорт финансовых отчётов недоступен",
    403,
  );
  if (scope === "management")
    ensure(
      user.role === "ADMIN_MANAGEMENT",
      "Отчёт доступен только руководству",
      403,
    );
  if (scope === "partner") {
    partnerId = partnerId ?? user.partnerId;
    ensure(
      partnerId &&
        (user.role === "ADMIN_MANAGEMENT" || user.partnerId === partnerId),
      "Доступ к отчёту партнёра запрещён",
      403,
    );
    ensure(!draft, "Черновой отчёт доступен только руководству", 403);
  }
  return db.$transaction(
    async (tx) => {
      const season = await tx.season.findUnique({ where: { id: seasonId } });
      ensure(season, "Сезон не найден", 404);
      let source: SeasonReport;
      if (season.status === "Закрыт") {
        const saved = await tx.seasonClosing.findFirst({
          where: { seasonId, status: "Закрыт" },
          orderBy: { createdAt: "desc" },
        });
        ensure(
          saved?.reportSnapshot && saved.reportFingerprint,
          "У закрытого сезона отсутствует утверждённый снимок отчёта. Требуется управленческая проверка",
          409,
        );
        source = saved.reportSnapshot as unknown as SeasonReport;
        const { sourceFingerprint, ...payload } = source;
        ensure(
          sourceFingerprint === saved.reportFingerprint &&
            fingerprint(payload) === sourceFingerprint,
          "Нарушена целостность снимка отчёта",
          409,
        );
      } else {
        source = await collectSeasonReport(tx, seasonId);
        if (!draft)
          ensure(
            source.closing.canClose,
            scope === "partner"
              ? "Подтверждённый отчёт ещё не готов. Обратитесь к руководству"
              : "Отчёт не подтверждён: " + source.closing.blockers.join("; "),
            409,
          );
      }
      return scope === "partner"
        ? { scope, data: partnerReport(source, partnerId!), draft: false }
        : { scope, data: source, draft: draft && season.status !== "Закрыт" };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60000,
    },
  );
}
