import type { Tx } from "./calculation-data";
import {
  projectEconomics,
  readiness,
  activeJournal,
  sum,
} from "./calculation-data";
import { partnerBalances } from "./versions";
import { auditSectionRows } from "./audit-sections";
import { projectTypeName } from "../domain/audit-templates";
import { d } from "../domain/calculations";
export async function dashboardInsights(tx: Tx, seasonId: string) {
  const [economics, review, partners, sections, projects, employees, fees] =
    await Promise.all([
      projectEconomics(tx, seasonId),
      readiness(tx, seasonId),
      partnerBalances(tx, seasonId),
      auditSectionRows(tx, seasonId),
      tx.project.findMany({
        where: { seasons: { some: { seasonId } } },
        include: { partnerIdRef: true },
      }),
      tx.employee.findMany({ where: { archived: false } }),
      tx.cashOutTransaction.findMany({
        where: { seasonId, journalTransactionIdRef: activeJournal },
        include: { journalTransactionIdRef: true },
      }),
    ]);
  const monthly = [];
  for (
    let cursor = new Date(
      Date.UTC(
        economics.season.startDate.getUTCFullYear(),
        economics.season.startDate.getUTCMonth(),
        1,
      ),
    );
    cursor <= economics.season.endDate;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    const month = cursor.toISOString().slice(0, 7),
      inMonth = (date: Date) => date.toISOString().startsWith(month);
    const revenue = sum(
      economics.revenues
        .filter((r) => inMonth(r.accountingDate))
        .map((r) => r.amount),
    );
    const expense = sum([
      ...economics.entries
        .filter((w) => inMonth(w.accountingDate))
        .map((w) => w.earned),
      ...economics.expenses
        .filter((e) => inMonth(e.accountingDate))
        .map((e) => e.amount),
      ...fees
        .filter((f) => inMonth(f.journalTransactionIdRef.accountingDate))
        .map((f) => f.actualFee),
    ]);
    monthly.push({
      month,
      revenue,
      expense,
      result: d(revenue).minus(expense).toFixed(4),
    });
  }
  const attention = review.blockers.map((message) => ({
    message,
    href: `/reconciliation?seasonId=${seasonId}`,
  }));
  const projectRows = projects.map((p) => {
    const own = sections.filter((s) => s.projectId === p.id && s.active),
      economic = economics.rows.find((r) => r.id === p.id)!;
    if (!own.length)
      attention.push({
        message: `Проект «${p.name}»: не выбраны разделы`,
        href: `/projects?recordId=${p.id}&seasonId=${seasonId}`,
      });
    for (const s of own.filter((s) => !s.employeeIds.length))
      attention.push({
        message: `${p.name} · ${s.code}: нет назначенного сотрудника`,
        href: `/audit-sections?projectId=${p.id}&seasonId=${seasonId}`,
      });
    const allocation = economics.allocation.projects.find((r) => r.id === p.id);
    return {
      id: p.id,
      name: p.name,
      projectType: projectTypeName(p.projectType),
      partner: p.partnerIdRef.name,
      status: p.status,
      revenue: economic.revenue,
      economicResult: allocation?.net ?? null,
      sectionCount: own.length,
      withWork: own.filter((s) => s.hasWork).length,
      needsAttention: !own.length || own.some((s) => !s.employeeIds.length),
    };
  });
  const month = new Date().toISOString().slice(0, 7);
  const workload = employees.map((e) => {
    const own = sections.filter(
        (s) =>
          s.active &&
          s.employeeIds.includes(e.id) &&
          projects.some((p) => p.id === s.projectId && p.status === "Активный"),
      ),
      work = economics.entries.filter(
        (w) =>
          w.employeeId === e.id &&
          w.accountingDate.toISOString().startsWith(month),
      );
    return {
      id: e.id,
      name: e.name,
      projects: new Set(own.map((s) => s.projectId)).size,
      sections: own.length,
      actualHours: sum(work.map((w) => w.actualHours)),
      earned: sum(work.map((w) => w.earned)),
    };
  });
  const active = sections.filter(
    (s) =>
      s.active &&
      projects.some((p) => p.id === s.projectId && p.status === "Активный"),
  );
  return {
    monthly,
    review,
    attention,
    month,
    workload,
    projects: projectRows,
    projectCounts: {
      active: projects.filter((p) => p.status === "Активный").length,
      completed: projects.filter((p) =>
        ["Завершен", "Закрыт"].includes(p.status),
      ).length,
      attention: projectRows.filter((p) => p.needsAttention).length,
    },
    auditProgress: {
      selected: active.length,
      assigned: active.filter((s) => s.employeeIds.length).length,
      withWork: active.filter((s) => s.hasWork).length,
      withoutWork: active.filter((s) => !s.hasWork).length,
    },
    partnerRemaining: partners.balances
      .reduce(
        (v, p) => v.plus(d(p.remaining).gt(0) ? p.remaining : "0"),
        d("0"),
      )
      .toFixed(4),
    seasonStatus:
      economics.season.status === "Закрыт"
        ? "Закрыт"
        : review.canClose
          ? "Готов к закрытию"
          : review.blockers.length
            ? "Есть расхождения"
            : "На сверке",
  };
}
