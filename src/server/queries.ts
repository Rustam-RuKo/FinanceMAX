type PrismaDecimal = { toString(): string };
import { tripPaymentSummary } from "./trip-payments";
import { auditSectionRows } from "./audit-sections";
import { dashboardInsights } from "./dashboard";
import { projectTypeName, legacySectionName } from "../domain/audit-templates";
import { db as database } from "./db";
import type { Tx } from "./calculation-data";
import {
  currentProjectAllocation,
  quarterIsCurrent,
  seasonIsCurrent,
  accepted,
  acceptedIds,
  partnerBalances,
} from "./versions";
import { management, ownEmployee, ownPartner } from "./auth";
import { ensure, AppError } from "./errors";
import type { Principal } from "../domain/authorization";
import { id, date } from "./validation";
import {
  employeeCalculation,
  projectEconomics,
  accountBalance,
  readiness,
  activeJournal,
  sum,
} from "./calculation-data";
import * as f from "../domain/calculations";
export const serialize = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));
async function readResourceData(
  db: Tx,
  user: Principal,
  resource: string,
  params: URLSearchParams,
) {
  const seasonId = params.get("seasonId")
    ? id.parse(params.get("seasonId"))
    : undefined;
  const employeeId = params.get("employeeId")
    ? id.parse(params.get("employeeId"))
    : undefined;
  const partnerId = params.get("partnerId")
    ? id.parse(params.get("partnerId"))
    : undefined;
  const projectId = params.get("projectId")
    ? id.parse(params.get("projectId"))
    : undefined;
  const history = params.get("history") === "1";
  if (resource === "me") return { user };
  if (resource === "seasons")
    return {
      items: await db.season.findMany({
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          status: true,
        },
        orderBy: { startDate: "desc" },
        take: 100,
      }),
    };
  if (resource === "employee-detail") {
    ensure(seasonId && employeeId, "Выберите сезон и сотрудника");
    ownEmployee(user, employeeId);
    const result = await employeeCalculation(db, seasonId, employeeId);
    const sections = await db.projectAuditSection.findMany({
      where: { workEntries: { some: { seasonId, employeeId } } },
    });
    const levels = await db.complexityRate.findMany({
      where: { id: { in: result.entries.map((w) => w.complexityRateId) } },
      include: { complexityLevelIdRef: true },
    });
    const projects = await db.project.findMany({
      where: { id: { in: result.entries.map((w) => w.projectId) } },
      select: { id: true, name: true },
    });
    const months = [
      ...new Set(
        result.entries.map((w) => w.accountingDate.toISOString().slice(0, 7)),
      ),
    ];
    return serialize({
      ...result,
      entries: result.entries.map((w) => ({
        ...w,
        projectIdRef: projects.find((p) => p.id === w.projectId),
        sectionCode:
          sections.find((s) => s.id === w.projectAuditSectionId)
            ?.codeSnapshot ?? "—",
        sectionName:
          sections.find((s) => s.id === w.projectAuditSectionId)
            ?.nameSnapshot ?? legacySectionName,
        level: levels.find((l) => l.id === w.complexityRateId)
          ?.complexityLevelIdRef.name,
      })),
      months: months.map((month) => ({
        month,
        earned: sum(
          result.entries
            .filter((w) => w.accountingDate.toISOString().startsWith(month))
            .map((w) => w.earned),
        ),
      })),
    });
  }
  if (resource === "audit-sections" || resource === "audit-section-detail") {
    ensure(seasonId, "Выберите сезон");
    if (user.role === "EMPLOYEE")
      ownEmployee(user, employeeId ?? user.employeeId ?? "");
    else management(user);
    const own = user.role === "EMPLOYEE" ? user.employeeId : undefined;
    const rows = await auditSectionRows(db, seasonId, projectId, own);
    if (resource === "audit-sections") return serialize({ items: rows });
    const row = rows.find((r) => r.id === params.get("id"));
    ensure(row, "Раздел недоступен", 404);
    return serialize({
      ...row,
      work: await db.workEntry.findMany({
        where: {
          projectAuditSectionId: row.id,
          seasonId,
          employeeId: own,
          voided: false,
        },
        include: { employeeIdRef: { select: { name: true } } },
      }),
    });
  }
  if (resource === "partner-detail") {
    ensure(seasonId && partnerId, "Выберите сезон и партнера");
    ownPartner(user, partnerId);
    const partner = await db.partner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { id: true, name: true },
    });
    const season = await db.season.findUniqueOrThrow({
      where: { id: seasonId },
    });
    const chosen = await accepted(db, seasonId, "ALLOCATION");
    const run = await db.allocationRun.findFirst({
      where: {
        seasonId,
        ...(chosen ? { id: chosen.targetId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    const rows = run
      ? await db.projectAllocation.findMany({
          where: { allocationRunId: run.id, projectIdRef: { partnerId } },
          include: {
            projectIdRef: { select: { id: true, name: true, code: true } },
          },
        })
      : [];
    const payments = await db.partnerPayment.findMany({
      where: { seasonId, partnerId, journalTransactionIdRef: activeJournal },
    });
    const settlement = await partnerBalances(db, seasonId);
    const balance = settlement.balances.find((p) => p.partnerId === partnerId);
    return serialize({
      partner,
      status: run
        ? chosen && run.sourceRevision === season.economicRevision
          ? run.status
          : "Не принят или требует перерасчета"
        : "Расчет не выполнен",
      projects: rows.map((r) => ({
        id: r.projectId,
        project: r.projectIdRef.name,
        revenue: r.revenue,
        directCost: r.directCost,
        allocationShare: r.allocationShare,
        gad: r.gad,
        allocated: r.allocated,
        net: r.net,
        rate: r.rateSnapshot,
        entitlement: r.entitlement,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        date: p.paymentDate,
        amount: p.amount,
      })),
      reconciliation: settlement.balances.filter(
        (p) => p.partnerId === partnerId,
      ),
      // Display the accepted obligation; do not subtract payments from exact entitlement again.
      totals:
        settlement.run && balance
          ? {
              entitlement: balance.entitlement,
              payable: balance.payable,
              paid: balance.paid,
              remaining: balance.remaining,
              roundingDifference: balance.roundingDifference,
            }
          : null,
    });
  }
  management(user);
  if (resource === 'users') return { items: await db.user.findMany({select:{id:true,name:true,email:true,role:true,active:true},orderBy:{name:'asc'}}) };

  if (resource === "trip-detail") {
    const tripId = id.parse(params.get("id"));
    const trip = await db.businessTrip.findUniqueOrThrow({
      where: { id: tripId },
      include: { seasonIdRef: true },
    });
    ensure(
      !seasonId || trip.seasonId === seasonId,
      "Командировка другого сезона",
    );
    const state = await tripPaymentSummary(
      db,
      tripId,
      trip.seasonIdRef.endDate,
    );
    return state.known
      ? state
      : {
          ...state,
          cashPaid: null,
          bankPaid: null,
          advances: null,
          payments: null,
          reimbursements: null,
          additionalPayments: null,
          returns: null,
          remaining: null,
          accountableAdvance: null,
          netPaid: null,
        };
  }
  if (["quarters", "season-settlements", "allocations"].includes(resource))
    ensure(seasonId, "Выберите сезон");
  if (resource === "allocation-detail") {
    const record = await db.projectAllocation.findUniqueOrThrow({
      where: { id: id.parse(params.get("id")) },
    });
    const sources = await db.settlementSource.findMany({
      where: { settlementId: record.allocationRunId },
    });
    const sourceIds = (kind: string) =>
      sources.filter((s) => s.sourceType === kind).map((s) => s.sourceId);
    const [entries, expenses, revenues, cashout] = await Promise.all([
      db.workEntry.findMany({
        where: { id: { in: sourceIds("WORK") }, projectId: record.projectId },
      }),
      db.expense.findMany({
        where: {
          id: { in: sourceIds("EXPENSE") },
          OR: [{ projectId: record.projectId }, { projectId: null }],
        },
      }),
      db.projectRevenue.findMany({
        where: {
          id: { in: sourceIds("REVENUE") },
          projectId: record.projectId,
        },
      }),
      db.cashOutAllocation.findMany({
        where: {
          id: { in: sourceIds("CASHOUT_ALLOCATION") },
          OR: [{ projectId: record.projectId }, { projectId: null }],
        },
      }),
    ]);
    return serialize({ ...record, entries, expenses, revenues, cashout });
  }
  if (resource === "settlement-detail") {
    const settlementId = id.parse(params.get("id"));
    const kind = params.get("kind");
    const snapshot =
      kind === "quarter"
        ? await db.quarterEmployeeSettlement.findUniqueOrThrow({
            where: { id: settlementId },
          })
        : await db.seasonEmployeeSettlement.findUniqueOrThrow({
            where: { id: settlementId },
          });
    const sources = await db.settlementSource.findMany({
      where: { settlementId },
    });
    const [entries, payments] = await Promise.all([
      db.workEntry.findMany({
        where: {
          id: {
            in: sources
              .filter((s) => s.sourceType === "WORK")
              .map((s) => s.sourceId),
          },
        },
        include: { projectIdRef: { select: { name: true } } },
      }),
      db.employeePayment.findMany({
        where: {
          id: {
            in: sources
              .filter((s) => s.sourceType === "PAYMENT")
              .map((s) => s.sourceId),
          },
        },
      }),
    ]);
    const carrySource =
      "carrySourceId" in snapshot && snapshot.carrySourceId
        ? await db.quarterEmployeeSettlement.findUnique({
            where: { id: snapshot.carrySourceId },
          })
        : null;
    return serialize({ ...snapshot, entries, payments, carrySource });
  }
  if (resource === "lookups") {
    const [
      seasons,
      employees,
      partners,
      projects,
      levels,
      paymentCategories,
      expenseCategories,
      accounts,
      methods,
      trips,
      quarters,
      users,
    ] = await Promise.all([
      db.season.findMany({ orderBy: { startDate: "desc" }, take: 100 }),
      db.employee.findMany({
        where: { archived: false },
        orderBy: { name: "asc" },
        take: 1000,
      }),
      db.partner.findMany({ where: { archived: false }, take: 1000 }),
      db.project.findMany({
        where: { seasons: { some: { seasonId } } },
        take: 1000,
      }),
      db.complexityLevel.findMany({ where: { active: true }, take: 1000 }),
      db.paymentCategory.findMany({ take: 1000 }),
      db.expenseCategory.findMany({ where: { active: true }, take: 1000 }),
      db.ledgerAccount.findMany({
        where: { active: true, kind: { in: ["BANK", "CASH"] } },
        take: 1000,
      }),
      db.cashOutMethod.findMany({ where: { active: true }, take: 1000 }),
      db.businessTrip.findMany({
        where: { seasonId, voided: false },
        take: 1000,
      }),
      db.quarterEmployeeSettlement.findMany({
        where: { seasonId },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.user.findMany({ select: { id: true, name: true }, take: 1000 }),
    ]);
    return serialize({
      auditTemplates: await db.auditSectionTemplate.findMany({
        where: { active: true },
        orderBy: [{ projectType: "asc" }, { sortOrder: "asc" }],
      }),
      allProjectSections: (
        await db.projectAuditSection.findMany({
          where: { project: { seasons: { some: { seasonId } } } },
          orderBy: { sortOrder: "asc" },
        })
      ).map((s) => ({ ...s, name: `${s.codeSnapshot} · ${s.nameSnapshot}` })),
      projectSections: (
        await db.projectAuditSection.findMany({
          where: { active: true, project: { seasons: { some: { seasonId } } } },
          include: { assignments: { where: { active: true } } },
          orderBy: { sortOrder: "asc" },
        })
      ).map((s) => ({ ...s, name: `${s.codeSnapshot} · ${s.nameSnapshot}` })),
      allProjects: await db.project.findMany({
        select: { id: true, name: true },
      }),
      seasons,
      employees,
      partners,
      projects,
      levels,
      paymentCategories,
      expenseCategories,
      accounts,
      methods,
      trips: trips.map((t) => ({
        ...t,
        name: `${t.destination} · ${employees.find((e) => e.id === t.employeeId)?.name ?? "Сотрудник"} · ${t.startDate.toISOString().slice(0, 10)} · ${t.id.slice(0, 8)}`,
      })),
      bonusApprovals: (
        await db.bonusExceptionApproval.findMany({
          where: { seasonId, payment: null },
        })
      ).map((a) => ({ ...a, name: `${a.id} · ${a.requestedPayment} UZS` })),
      quarters: quarters.map((q) => ({
        ...q,
        name: `${employees.find((e) => e.id === q.employeeId)?.name ?? "Сотрудник"} · ${q.periodStart.toISOString().slice(0, 10)}`,
      })),
      users,
    });
  }
  if (resource === "readiness") {
    ensure(seasonId, "Выберите сезон");
    return readiness(db, seasonId);
  }
  if (resource === "dashboard") {
    ensure(seasonId, "Выберите сезон");
    const reportingSeason = await db.season.findUniqueOrThrow({
      where: { id: seasonId },
    });
    const cutoff = reportingSeason.endDate;
    const feeAllocations = await db.cashOutAllocation.findMany({
      where: {
        cashOutTransactionIdRef: {
          seasonId,
          journalTransactionIdRef: activeJournal,
        },
      },
    });
    const [
      revenues,
      entries,
      expenses,
      fees,
      payments,
      partnerPayments,
      accounts,
      projects,
    ] = await Promise.all([
      db.projectRevenue.findMany({ where: { seasonId, voided: false } }),
      db.workEntry.findMany({ where: { seasonId, voided: false } }),
      db.expense.findMany({ where: { seasonId, voided: false } }),
      db.cashOutTransaction.findMany({
        where: { seasonId, journalTransactionIdRef: activeJournal },
      }),
      db.employeePayment.findMany({
        where: { seasonId, journalTransactionIdRef: activeJournal },
      }),
      db.partnerPayment.findMany({
        where: { seasonId, journalTransactionIdRef: activeJournal },
      }),
      db.ledgerAccount.findMany({
        where: { kind: { in: ["BANK", "CASH"] }, active: true },
      }),
      db.project.count({
        where: { seasons: { some: { seasonId } }, status: "Активный" },
      }),
    ]);
    return {
      totals: f.calculateSeasonSummary({
        revenues: revenues.map((r) => r.amount.toString()),
        labor: entries.map((e) => e.earned.toString()),
        direct: expenses
          .filter((e) => e.projectId)
          .map((e) => e.amount.toString()),
        general: expenses
          .filter((e) => !e.projectId)
          .map((e) => e.amount.toString()),
        cashOutFees: fees.map((e) => e.actualFee.toString()),
        directCashOutFees: feeAllocations
          .filter((e) => e.projectId)
          .map((e) => e.amount.toString()),
        generalCashOutFees: feeAllocations
          .filter((e) => !e.projectId)
          .map((e) => e.amount.toString()),
        compensation: payments
          .filter((p) =>
            f.compensationEligible(
              p.kindSnapshot,
              p.settlementRelevantSnapshot,
            ),
          )
          .map((p) => p.amount.toString()),
        partnerPayments: partnerPayments.map((p) => p.amount.toString()),
      }),
      activeProjects: projects,
      insights: await dashboardInsights(db, seasonId),
      accounts: await Promise.all(
        accounts.map(async (a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          bank: a.bank,
          currency: a.currency,
          balance: await accountBalance(db, a.id, cutoff),
          lastReconciliation: await db.cashReconciliation.findFirst({
            where: { ledgerAccountId: a.id, seasonId },
            orderBy: { date: "desc" },
          }),
        })),
      ),
    };
  }
  if (resource === "project-detail") {
    ensure(projectId, "Выберите проект");
    const identity = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { partnerIdRef: true, seasons: { include: { season: true } } },
    });
    const auditSections = await auditSectionRows(
      db,
      params.get("scope") === "all" ? undefined : seasonId,
      projectId,
    );
    const assignedEmployees = await db.employee.findMany({
      where: { id: { in: auditSections.flatMap((s) => s.employeeIds) } },
      select: { id: true, name: true },
    });
    const identityFields = {
      client: identity.client,
      projectType: projectTypeName(identity.projectType),
      partner: identity.partnerIdRef.name,
      status: identity.status,
      season: identity.seasons.map((s) => s.season.name).join(", "),
      auditSections,
      sectionEmployees: [
        ...new Set(auditSections.flatMap((s) => s.employeeIds)),
      ].map((employee) => ({
        employee:
          assignedEmployees.find((e) => e.id === employee)?.name ?? "Сотрудник",
        sections: auditSections
          .filter((s) => s.employeeIds.includes(employee))
          .map((s) => `${s.code} ${s.name}`)
          .join(", "),
      })),
    };
    if (params.get("scope") === "all") {
      const project = await db.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { seasons: true, ProjectPartnerRate_projectId_rows: true },
      });
      const periods = [];
      for (const membership of project.seasons) {
        const economic = await projectEconomics(db, membership.seasonId);
        periods.push({
          season: economic.season.name,
          ...economic.rows.find((p) => p.id === projectId),
          calculation: await currentProjectAllocation(
            db,
            membership.seasonId,
            projectId,
          ),
        });
      }
      return serialize({
        ...identityFields,
        id: project.id,
        name: project.name,
        periods,
        totals: {
          revenue: sum(periods.map((p) => f.d(p.revenue ?? "0"))),
          labor: sum(periods.map((p) => f.d(p.labor ?? "0"))),
          otherDirect: sum(periods.map((p) => f.d(p.otherDirect ?? "0"))),
        },
        fixedPartnerRate:
          project.ProjectPartnerRate_projectId_rows[0]?.rate.toString(),
      });
    }
    ensure(seasonId, "Выберите сезон");
    const economics = await projectEconomics(db, seasonId);
    const project = economics.rows.find((p) => p.id === projectId);
    ensure(project, "Проект не найден", 404);
    return serialize({
      ...identityFields,
      ...project,
      gad: f.calculateProjectGrossAfterDirect(
        project.revenue,
        project.labor,
        project.otherDirect,
      ),
      calculation: await currentProjectAllocation(db, seasonId, projectId),
      work: economics.entries.filter((e) => e.projectId === projectId),
      expenses: economics.expenses.filter((e) => e.projectId === projectId),
      revenues: economics.revenues.filter((e) => e.projectId === projectId),
      cashout: economics.fees.filter((e) => e.projectId === projectId),
    });
  }
  const page = Math.max(
    0,
    Math.min(100000, Number(params.get("page") ?? "0") || 0),
  );
  const take = 50;
  const pagination = {
    take: take + 1,
    skip: page * take,
    orderBy: { createdAt: "desc" as const },
  };
  const q = (params.get("q") ?? "").slice(0, 150);
  const search = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const from = params.get("from")
      ? new Date(date.parse(params.get("from")))
      : undefined,
    to = params.get("to") ? new Date(date.parse(params.get("to"))) : undefined;
  const period = from || to ? { gte: from, lte: to } : undefined;
  const base = {
    seasonId,
    ...(params.get("recordId") ? { id: id.parse(params.get("recordId")) } : {}),
  };
  let items: unknown[];
  switch (resource) {
    case "employees":
      items = await db.employee.findMany({
        ...pagination,
        where: { name: search },
      });
      break;
    case "partners":
      items = await db.partner.findMany({
        ...pagination,
        where: { name: search },
      });
      break;
    case "projects":
      items = (
        await db.project.findMany({
          ...pagination,
          where: {
            ...(params.get("recordId")
              ? { id: id.parse(params.get("recordId")) }
              : {}),
            seasons: { some: { seasonId } },
            partnerId,
            name: search,
          },
          include: {
            partnerIdRef: { select: { name: true } },
            ProjectPartnerRate_projectId_rows: true,
            ProjectAssignment_projectId_rows: {
              include: { employeeIdRef: { select: { name: true } } },
            },
          },
        })
      ).map(({ ProjectPartnerRate_projectId_rows: rates, ...project }) => ({
        ...project,
        projectType: projectTypeName(project.projectType),
        fixedPartnerRate: rates[0]
          ? f.d(rates[0].rate.toString()).times(100).toFixed(4) + " %"
          : "Не установлена",
      }));
      break;
    case "audit-templates":
      items = (
        await db.auditSectionTemplate.findMany({
          orderBy: [{ projectType: "asc" }, { sortOrder: "asc" }],
        })
      ).map((t) => ({ ...t, projectType: projectTypeName(t.projectType) }));
      break;
    case "rates":
      items = await db.complexityRate.findMany({
        ...pagination,
        include: { complexityLevelIdRef: { select: { name: true } } },
      });
      break;
    case "salary-rates":
      items = await db.employeeSalaryRate.findMany({
        ...pagination,
        where: { employeeId },
      });
      break;
    case "work":
      items = (
        await db.workEntry.findMany({
          ...pagination,
          where: {
            ...base,
            employeeId,
            projectId,
            description: search,
            accountingDate: period,
          },
          include: {
            auditSection: true,
            complexityRateIdRef: { include: { complexityLevelIdRef: true } },
            employeeIdRef: { select: { name: true } },
            projectIdRef: { select: { name: true } },
          },
        })
      ).map((w) => ({
        ...w,
        sectionCode: w.auditSection?.codeSnapshot ?? "—",
        sectionName: w.auditSection?.nameSnapshot ?? legacySectionName,
        level: w.complexityRateIdRef.complexityLevelIdRef.name,
      }));
      break;
    case "payments":
      items = await db.employeePayment.findMany({
        ...pagination,
        where: { ...base, employeeId, accountingPeriod: period },
        include: {
          employeeIdRef: { select: { name: true } },
          paymentCategoryIdRef: { select: { name: true } },
          journalTransactionIdRef: {
            select: {
              JournalTransaction_reversalOf_rows: { select: { id: true } },
            },
          },
        },
      });
      break;
    case "quarters":
      items = await db.quarterEmployeeSettlement.findMany({
        ...pagination,
        where: {
          ...base,
          employeeId,
          ...(!history
            ? { id: { in: await acceptedIds(db, seasonId, "QUARTER") } }
            : {}),
        },
        include: { employeeIdRef: { select: { name: true } } },
      });
      break;
    case "season-settlements":
      items = await db.seasonEmployeeSettlement.findMany({
        ...pagination,
        where: {
          ...base,
          employeeId,
          ...(!history
            ? { id: { in: await acceptedIds(db, seasonId, "SEASON") } }
            : {}),
        },
        include: { employeeIdRef: { select: { name: true } } },
      });
      break;
    case "expenses":
      items = await db.expense.findMany({
        ...pagination,
        where: {
          ...base,
          projectId: params.get("scope") === "general" ? null : projectId,
          comment: search,
          accountingDate: period,
        },
        include: {
          expenseCategoryIdRef: { select: { name: true } },
          projectIdRef: { select: { name: true } },
        },
      });
      break;
    case "revenues":
      items = await db.projectRevenue.findMany({
        ...pagination,
        where: { ...base, projectId, accountingDate: period },
      });
      break;
    case "trips":
      items = await db.businessTrip.findMany({
        ...pagination,
        where: { ...base, employeeId, projectId, destination: search },
        include: { employeeIdRef: { select: { name: true } } },
      });
      break;
    case "accounts":
      items = await Promise.all(
        (
          await db.ledgerAccount.findMany({
            ...pagination,
            where: { kind: { in: ["BANK", "CASH"] }, name: search },
          })
        ).map(async (a) => ({
          ...a,
          balance: await accountBalance(
            db,
            a.id,
            seasonId
              ? (await db.season.findUniqueOrThrow({ where: { id: seasonId } }))
                  .endDate
              : new Date(),
          ),
          ...(await (async () => {
            const r = await db.cashReconciliation.findFirst({
              where: { ledgerAccountId: a.id, seasonId },
              orderBy: { date: "desc" },
            });
            return {
              date: r?.date,
              actual: r?.actual,
              difference: r?.difference,
            };
          })()),
        })),
      );
      break;
    case "cashout":
      items = await db.cashOutTransaction.findMany({
        ...pagination,
        where: { ...base, purpose: search },
        include: {
          journalTransactionIdRef: {
            select: {
              postingDate: true,
              JournalTransaction_reversalOf_rows: { select: { id: true } },
            },
          },
          CashOutAllocation_cashOutTransactionId_rows: true,
          bankAccountIdRef: { select: { name: true } },
          cashAccountIdRef: { select: { name: true } },
        },
      });
      break;
    case "cashout-methods":
      items = await db.cashOutMethodRate.findMany({
        ...pagination,
        include: { cashOutMethodIdRef: { select: { name: true } } },
      });
      break;
    case "reconciliations":
      items = await db.cashReconciliation.findMany({
        ...pagination,
        where: base,
        include: { ledgerAccountIdRef: { select: { name: true } } },
      });
      break;
    case "journal": {
      const accountId = params.get("accountId")
        ? id.parse(params.get("accountId"))
        : undefined;
      const createdBy = params.get("createdBy")
        ? id.parse(params.get("createdBy"))
        : undefined;
      const categoryId = params.get("categoryId")
        ? id.parse(params.get("categoryId"))
        : undefined;
      items = await db.journalTransaction.findMany({
        ...pagination,
        where: {
          ...base,
          projectId,
          employeeId,
          partnerId,
          createdBy,
          categoryId,
          postingDate: period,
          reason: search,
          operation: params.get("operation") || undefined,
          ...(accountId
            ? {
                JournalLine_journalTransactionId_rows: {
                  some: { ledgerAccountId: accountId },
                },
              }
            : {}),
        },
        include: {
          createdByRef: { select: { name: true } },
          JournalLine_journalTransactionId_rows: {
            include: {
              ledgerAccountIdRef: { select: { name: true, kind: true } },
            },
          },
          JournalTransaction_reversalOf_rows: { select: { id: true } },
        },
      });
      break;
    }
    case "allocations":
      items = await db.projectAllocation.findMany({
        ...pagination,
        where: {
          allocationRunIdRef: { seasonId },
          ...(!history
            ? {
                allocationRunId: {
                  in: await acceptedIds(db, seasonId, "ALLOCATION"),
                },
              }
            : {}),
          projectIdRef: { partnerId },
        },
        include: {
          projectIdRef: { select: { name: true } },
          allocationRunIdRef: {
            select: { status: true, sourceRevision: true },
          },
        },
      });
      break;
    case "partner-payments":
      items = await db.partnerPayment.findMany({
        ...pagination,
        where: { ...base, partnerId },
        include: {
          partnerIdRef: { select: { name: true } },
          attribution: true,
          journalTransactionIdRef: {
            include: { JournalTransaction_reversalOf_rows: true },
          },
        },
      });
      break;
    case "bonus-approvals":
      items = await db.bonusExceptionApproval.findMany({
        ...pagination,
        where: { seasonId, employeeId },
        include: { payment: true, employee: { select: { name: true } } },
      });
      break;
    case "audit":
      items = await db.auditLog.findMany({
        ...pagination,
        where: {
          entityId: params.get("id") ? id.parse(params.get("id")) : undefined,
        },
        include: { createdByRef: { select: { name: true } } },
      });
      break;
    default:
      throw new AppError(404, "Раздел не найден");
  }
  if (resource === "cashout")
    items = items.map((value) => {
      const r = value as {
        bankOut: PrismaDecimal;
        cashReceived: PrismaDecimal;
        rateSnapshot: PrismaDecimal;
      };
      return {
        ...r,
        expectedRate:
          f.d(r.rateSnapshot.toString()).times(100).toFixed(4) + " %",
        actualRate:
          f
            .d(
              f.calculateCashOut(
                r.bankOut.toString(),
                r.cashReceived.toString(),
                r.rateSnapshot.toString(),
              ).actualRate,
            )
            .times(100)
            .toFixed(4) + " %",
      };
    });
  items = items.map((value) => {
    const r = value as Record<string, unknown>;
    const journal = (r.journalTransactionIdRef ?? r) as Record<string, unknown>;
    return {
      ...r,
      ...(journal.postingDate ? { date: journal.postingDate } : {}),
      correctionStatus:
        r.voided ||
        (Array.isArray(journal.JournalTransaction_reversalOf_rows) &&
          journal.JournalTransaction_reversalOf_rows.length)
          ? "Отменено"
          : r.attribution &&
              String((r.attribution as Record<string, unknown>).updatedAt) !==
                String((r.attribution as Record<string, unknown>).createdAt)
            ? "Исправлено: отнесено к новой версии"
            : "Действует",
    };
  });
  if (
    seasonId &&
    ["quarters", "season-settlements", "allocations"].includes(resource)
  ) {
    const season = await db.season.findUniqueOrThrow({
      where: { id: seasonId },
    });
    const kind =
      resource === "quarters"
        ? "QUARTER"
        : resource === "season-settlements"
          ? "SEASON"
          : "ALLOCATION";
    const currentIds = await acceptedIds(db, seasonId, kind);
    items = await Promise.all(
      items.map(async (value) => {
        const row = value as Record<string, unknown>;
        const revision =
          row.sourceRevision ??
          (row.allocationRunIdRef as Record<string, unknown> | undefined)
            ?.sourceRevision;
        return {
          ...row,
          sourceStatus: !currentIds.includes(
            String(resource === "allocations" ? row.allocationRunId : row.id),
          )
            ? "История / не принят"
            : (
                  kind === "QUARTER"
                    ? await quarterIsCurrent(db, String(row.id))
                    : kind === "SEASON"
                      ? await seasonIsCurrent(db, String(row.id))
                      : revision === season.economicRevision
                )
              ? "Принят, актуален"
              : "Принят, требует перерасчета",
        };
      }),
    );
  }
  if (resource === "quarters")
    items = items.map((value) => {
      const r = value as {
        earned: PrismaDecimal;
        ktu: PrismaDecimal;
        carryIn: PrismaDecimal;
        salary: PrismaDecimal;
      };
      return {
        ...r,
        base: f.quarterFromEntitlement(
          f.d(r.earned.toString()).plus(r.ktu.toString()).toFixed(4),
          r.salary.toString(),
          r.carryIn.toString(),
        ).base,
      };
    });
  return serialize({
    items: items.slice(0, take),
    page,
    hasMore: items.length > take,
  });
}

export async function readResource(
  user: Principal,
  resource: string,
  params: URLSearchParams,
) {
  return database.$transaction(
    (tx) => readResourceData(tx, user, resource, params),
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
}

