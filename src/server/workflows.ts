import { manageUser } from './user-management';
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { collectSeasonReport, fingerprint } from "./season-report";
import { lockExpenseReference } from "./manual-expenses";
import { linkTripPayment, tripPaymentSummary } from "./trip-payments";
import {
  auditProjectType,
  sectionSelection,
  addSections,
  sectionCommand,
} from "./audit-sections";
import { management, hashPassword } from "./auth";
import { ensure, AppError } from "./errors";
import {
  id,
  money,
  rate,
  date,
  text,
  optionalId,
  asDate,
  command,
} from "./validation";
import type { Principal } from "../domain/authorization";
import * as f from "../domain/calculations";
import {
  accountBalance,
  employeeCalculation,
  projectEconomics,
  readiness,
  sum,
  activeJournal,
  type Tx,
} from "./calculation-data";
import {
  quarterIsCurrent,
  seasonIsCurrent,
  accepted,
  acceptanceKey,
  approvalFingerprint,
  requireCurrentAllocation,
} from "./versions";
const seasonInput = { seasonId: id };
const dateInput = { ...seasonInput, date };
const meta = (user: Principal) => ({ createdBy: user.id, updatedBy: user.id });
async function saveAllocationSources(
  tx: Tx,
  runId: string,
  data: Awaited<ReturnType<typeof projectEconomics>>,
) {
  const rows = [
    ...data.entries.map((r) => ({
      sourceId: r.id,
      sourceType: "WORK",
      amount: r.earned,
    })),
    ...data.expenses.map((r) => ({
      sourceId: r.id,
      sourceType: "EXPENSE",
      amount: r.amount,
    })),
    ...data.revenues.map((r) => ({
      sourceId: r.id,
      sourceType: "REVENUE",
      amount: r.amount,
    })),
    ...data.fees.map((r) => ({
      sourceId: r.id,
      sourceType: "CASHOUT_ALLOCATION",
      amount: r.amount,
    })),
  ];
  for (const row of rows)
    await tx.settlementSource.create({
      data: { settlementId: runId, settlementType: "ALLOCATION", ...row },
    });
}
async function projectInSeason(
  tx: Tx,
  projectId: string | undefined,
  seasonId: string,
) {
  if (projectId)
    ensure(
      await tx.projectSeason.findUnique({
        where: { projectId_seasonId: { projectId, seasonId } },
      }),
      "Проект не относится к выбранному сезону",
    );
}
async function activeEmployee(tx: Tx, employeeId: string) {
  ensure(
    await tx.employee.findFirst({ where: { id: employeeId, archived: false } }),
    "Сотрудник не найден или архивирован",
  );
}
async function systemAccount(tx: Tx, user: Principal, kind: string) {
  return (
    (await tx.ledgerAccount.findFirst({ where: { kind } })) ??
    (await tx.ledgerAccount.create({
      data: {
        name:
          kind === "EXPENSE"
            ? "Расходы"
            : kind === "REVENUE"
              ? "Доходы"
              : kind === "COMPENSATION"
                ? "Вознаграждения"
                : kind === "TRIP_CLEARING"
                  ? "Подотчетные расчеты по командировкам"
                  : "Начальные остатки",
        kind,
        ...meta(user),
      },
    }))
  );
}
async function cashAccount(tx: Tx, accountId: string, kind?: string) {
  const account = await tx.ledgerAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  ensure(
    account.active &&
      !account.archived &&
      ["BANK", "CASH"].includes(account.kind) &&
      (!kind || account.kind === kind),
    "Выберите действующий денежный счет",
  );
  ensure(
    account.currency === "UZS",
    "Для валютного денежного счета требуется отдельный подтвержденный валютный поток",
  );
  return account;
}
async function post(
  tx: Tx,
  user: Principal,
  input: {
    seasonId: string;
    date: Date;
    accountingDate?: Date;
    operation: string;
    reason: string;
    sourceId?: string;
    sourceType?: string;
    projectId?: string;
    employeeId?: string;
    partnerId?: string;
    categoryId?: string;
    reversalOf?: string;
  },
  lines: { accountId: string; debit: string; credit: string }[],
) {
  ensure(
    lines.length >= 2 &&
      f.d(sum(lines.map((l) => l.debit))).eq(sum(lines.map((l) => l.credit))),
    "Проводка не сбалансирована",
  );
  const journal = await tx.journalTransaction.create({
    data: {
      seasonId: input.seasonId,
      postingDate: input.date,
      accountingDate: input.accountingDate ?? input.date,
      operation: input.operation,
      reason: input.reason,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      projectId: input.projectId,
      employeeId: input.employeeId,
      partnerId: input.partnerId,
      categoryId: input.categoryId,
      reversalOf: input.reversalOf,
      idempotencyKey: randomUUID(),
      ...meta(user),
    },
  });
  for (const line of lines)
    if (f.d(line.debit).gt(0) || f.d(line.credit).gt(0))
      await tx.journalLine.create({
        data: {
          journalTransactionId: journal.id,
          ledgerAccountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          originalAmount: f.d(line.debit).plus(line.credit).toFixed(4),
          exchangeRate: "1",
          exchangeRateDate: input.date,
          ...meta(user),
        },
      });
  await tx.journalTransaction.update({
    where: { id: journal.id },
    data: { status: "POSTED" },
  });
  return journal;
}
async function reverse(
  tx: Tx,
  user: Principal,
  journalId: string,
  reason: string,
  postingDate: Date,
) {
  const original = await tx.journalTransaction.findUniqueOrThrow({
    where: { id: journalId },
    include: {
      JournalLine_journalTransactionId_rows: true,
      JournalTransaction_reversalOf_rows: true,
    },
  });
  ensure(
    !original.reversalOf &&
      original.JournalTransaction_reversalOf_rows.length === 0,
    "Операция уже отменена",
  );
  return post(
    tx,
    user,
    {
      seasonId: original.seasonId,
      date: postingDate,
      accountingDate: original.accountingDate,
      operation: "REVERSAL",
      reason,
      reversalOf: original.id,
      sourceType: original.sourceType ?? undefined,
      sourceId: original.sourceId ?? undefined,
      projectId: original.projectId ?? undefined,
      employeeId: original.employeeId ?? undefined,
      partnerId: original.partnerId ?? undefined,
    },
    original.JournalLine_journalTransactionId_rows.map((l) => ({
      accountId: l.ledgerAccountId,
      debit: l.credit.toString(),
      credit: l.debit.toString(),
    })),
  );
}
const derived = new Set([
  "quarter",
  "season-settlement",
  "partner-allocation",
  "manual-allocation",
  "reconciliation",
  "review",
  "close",
  "reopen",
  "accept-calculation",
  "bonus-exception",
]);
export async function executeCommand(user: Principal, raw: unknown) {
  management(user);
  const input = command.parse(raw);
  if (['user','user-password','user-update'].includes(input.operation)) return { ...await manageUser(user,input.operation,input.data), replayed: false };
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ operation: input.operation, data: input.data }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
      const receipt = await tx.commandReceipt.findUnique({
        where: { id: input.requestId },
      });
      if (receipt) {
        ensure(
          receipt.userId === user.id && receipt.requestHash === requestHash,
          "Ключ запроса уже использован для другой операции",
          409,
        );
        return { id: receipt.resultId, replayed: true };
      }
      await tx.$executeRaw`SELECT set_config('financemax.actor',${user.id},true)`;
      const reason =
        typeof input.data.reason === "string"
          ? input.data.reason
          : "Создание записи";
      await tx.$executeRaw`SELECT set_config('financemax.reason',${reason},true)`;
      if (typeof input.data.seasonId === "string") {
        const seasonId = id.parse(input.data.seasonId);
        await tx.$queryRaw`SELECT id FROM "Season" WHERE id=${seasonId}::uuid FOR UPDATE`;
        const season = await tx.season.findUniqueOrThrow({
          where: { id: seasonId },
        });
        ensure(
          season.status !== "Закрыт" || input.operation === "reopen",
          "Сезон закрыт",
          409,
        );
        if (
          typeof input.data.date === "string" &&
          input.operation !== "partner-payment"
        ) {
          const day = asDate(date.parse(input.data.date));
          ensure(
            day >= season.startDate && day <= season.endDate,
            "Дата не входит в сезон",
          );
        }
        if (!derived.has(input.operation))
          await tx.season.update({
            where: { id: seasonId },
            data: { revision: { increment: 1 }, updatedBy: user.id },
          });
      }
      if (
        typeof input.data.seasonId === "string" &&
        !derived.has(input.operation)
      ) {
        let work = ["work", "work-batch"].includes(input.operation),
          compensation = work,
          economic = [
            "work",
            "work-batch",
            "expense",
            "revenue",
            "trip",
            "cashout",
            "project",
            "project-season",
            "project-rate-correction",
          ].includes(input.operation);
        if (input.operation === "payment") {
          const category = await tx.paymentCategory.findUniqueOrThrow({
            where: { id: String(input.data.paymentCategoryId) },
          });
          work = category.kind === "SALARY";
          compensation = true;
        }
        if (input.operation === "correction") {
          const entity = String(input.data.entity);
          economic = ["work", "expense", "revenue", "trip", "cashout"].includes(
            entity,
          );
          work = entity === "work";
          compensation = work;
          if (entity === "payment") {
            const payment = await tx.employeePayment.findUniqueOrThrow({
              where: { id: String(input.data.id) },
            });
            work = payment.kindSnapshot === "SALARY";
            compensation = true;
          }
        }
        await tx.season.update({
          where: { id: input.data.seasonId },
          data: {
            workRevision: { increment: work ? 1 : 0 },
            compensationRevision: { increment: compensation ? 1 : 0 },
            economicRevision: { increment: economic ? 1 : 0 },
          },
        });
      }
      const result = await dispatch(tx, user, input.operation, input.data);
      await tx.commandReceipt.create({
        data: {
          id: input.requestId,
          userId: user.id,
          operation: input.operation,
          requestHash,
          resultId: result.id,
        },
      });
      return { id: result.id, replayed: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}
async function dispatch(
  tx: Tx,
  user: Principal,
  operation: string,
  raw: Record<string, unknown>,
): Promise<{ id: string }> {
  const sectionResult = await sectionCommand(tx, user, operation, raw);
  if (sectionResult) return sectionResult;
  switch (operation) {
    case "work-batch": {
      const p = z
        .object({
          seasonId: id,
          entries: z
            .array(z.record(z.string(), z.unknown()))
            .min(1, "Добавьте строки")
            .max(50, "Не более 50 строк"),
        })
        .parse(raw);
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      let result: { id: string } | undefined;
      for (const entry of p.entries) {
        const day = asDate(date.parse(entry.date));
        ensure(
          day >= season.startDate && day <= season.endDate,
          "Дата не входит в сезон",
        );
        result = await dispatch(tx, user, "work", {
          ...entry,
          seasonId: p.seasonId,
        });
      }
      return result!;
    }
    case "season": {
      const p = z
        .object({ name: text, startDate: date, endDate: date })
        .parse(raw);
      ensure(p.endDate >= p.startDate, "Конец сезона раньше начала");
      return tx.season.create({
        data: {
          name: p.name,
          startDate: asDate(p.startDate),
          endDate: asDate(p.endDate),
          ...meta(user),
        },
      });
    }
    case "employee":
    case "partner": {
      const p = z.object({ name: text }).parse(raw);
      return operation === "employee"
        ? tx.employee.create({ data: { name: p.name, ...meta(user) } })
        : tx.partner.create({ data: { name: p.name, ...meta(user) } });
    }
    case "person-update": {
      const p = z
        .object({
          id,
          kind: z.enum(["employee", "partner"]),
          name: text,
          archived: z.boolean(),
          reason: text,
        })
        .parse(raw);
      return p.kind === "employee"
        ? tx.employee.update({
            where: { id: p.id },
            data: { name: p.name, archived: p.archived, updatedBy: user.id },
          })
        : tx.partner.update({
            where: { id: p.id },
            data: { name: p.name, archived: p.archived, updatedBy: user.id },
          });
    }
    case "salary-rate": {
      const p = z
        .object({
          employeeId: id,
          amount: money,
          validFrom: date,
          validTo: date.optional(),
        })
        .parse(raw);
      await activeEmployee(tx, p.employeeId);
      const start = asDate(p.validFrom),
        end = p.validTo ? asDate(p.validTo) : null;
      const previous = await tx.employeeSalaryRate.findFirst({
        where: { employeeId: p.employeeId, validTo: null },
      });
      if (previous) {
        ensure(
          previous.validFrom < start,
          "Новая ставка должна начинаться позже текущей",
        );
        await tx.employeeSalaryRate.update({
          where: { id: previous.id },
          data: {
            validTo: new Date(start.getTime() - 86400000),
            updatedBy: user.id,
          },
        });
      }
      ensure(!end || end >= start, "Период ставки некорректен");
      ensure(
        !(await tx.employeeSalaryRate.findFirst({
          where: {
            employeeId: p.employeeId,
            validFrom: { lte: end ?? new Date("9999-12-31") },
            OR: [{ validTo: null }, { validTo: { gte: start } }],
          },
        })),
        "Периоды ставок пересекаются",
      );
      return tx.employeeSalaryRate.create({
        data: {
          employeeId: p.employeeId,
          amount: p.amount,
          validFrom: start,
          validTo: end,
          ...meta(user),
        },
      });
    }
    case "complexity": {
      const p = z
        .object({ name: text, hourlyRate: money, validFrom: date })
        .parse(raw);
      const level = await tx.complexityLevel.create({
        data: { name: p.name, ...meta(user) },
      });
      await tx.complexityRate.create({
        data: {
          complexityLevelId: level.id,
          hourlyRate: p.hourlyRate,
          validFrom: asDate(p.validFrom),
          ...meta(user),
        },
      });
      return level;
    }
    case "complexity-rate": {
      const p = z
        .object({ complexityLevelId: id, hourlyRate: money, validFrom: date })
        .parse(raw);
      const from = asDate(p.validFrom);
      const previous = await tx.complexityRate.findFirst({
        where: { complexityLevelId: p.complexityLevelId, validTo: null },
      });
      if (previous) {
        ensure(
          previous.validFrom < from,
          "Новая ставка должна начинаться позже текущей",
        );
        await tx.complexityRate.update({
          where: { id: previous.id },
          data: {
            validTo: new Date(from.getTime() - 86400000),
            updatedBy: user.id,
          },
        });
      }
      return tx.complexityRate.create({
        data: {
          complexityLevelId: p.complexityLevelId,
          hourlyRate: p.hourlyRate,
          validFrom: from,
          ...meta(user),
        },
      });
    }
    case "project": {
      const p = z
        .object({
          ...seasonInput,
          name: text,
          code: text,
          client: text,
          partnerId: id,
          partnerRate: rate,
          projectType: auditProjectType,
          sections: sectionSelection,
          confirmed: z.literal(true, {
            error: "Подтвердите фиксированную ставку проекта",
          }),
          startDate: date,
          endDate: date.optional(),
        })
        .parse(raw);
      ensure(
        await tx.partner.findFirst({
          where: { id: p.partnerId, archived: false },
        }),
        "Партнер не найден",
      );
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      ensure(
        asDate(p.startDate) >= season.startDate &&
          asDate(p.startDate) <= season.endDate,
        "Начало проекта не входит в сезон",
      );
      const project = await tx.project.create({
        data: {
          seasonId: p.seasonId,
          name: p.name,
          code: p.code,
          client: p.client,
          projectType: p.projectType,
          partnerId: p.partnerId,
          startDate: asDate(p.startDate),
          endDate: p.endDate ? asDate(p.endDate) : null,
          status: "Активный",
          ...meta(user),
        },
      });
      await tx.projectPartnerRate.create({
        data: {
          projectId: project.id,
          rate: p.partnerRate,
          validFrom: asDate(p.startDate),
          ...meta(user),
        },
      });
      await tx.projectSeason.create({
        data: { projectId: project.id, seasonId: p.seasonId },
      });
      await addSections(tx, user, project.id, p.sections);
      return project;
    }
    case "project-season": {
      const p = z
        .object({ ...seasonInput, projectId: id, reason: text })
        .parse(raw);
      await tx.project.findUniqueOrThrow({ where: { id: p.projectId } });
      return tx.projectSeason.upsert({
        where: {
          projectId_seasonId: { projectId: p.projectId, seasonId: p.seasonId },
        },
        create: { projectId: p.projectId, seasonId: p.seasonId },
        update: {},
      });
    }
    case "project-rate-correction": {
      const p = z
        .object({
          ...seasonInput,
          projectId: id,
          partnerRate: rate,
          reason: text,
          confirmed: z.literal(true, {
            error: "Подтвердите исправление ставки проекта",
          }),
        })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      const snapshot = await tx.projectPartnerRate.findFirst({
        where: { projectId: p.projectId },
      });
      ensure(snapshot, "Фиксированная ставка проекта не найдена");
      ensure(
        !snapshot.rate.eq(p.partnerRate),
        "Новая ставка совпадает с сохраненной",
      );
      await tx.$executeRaw`SELECT set_config('financemax.project_rate_correction',${p.projectId},true)`;
      const linked = await tx.projectSeason.findMany({
        where: { projectId: p.projectId, seasonId: { not: p.seasonId } },
      });
      for (const link of linked)
        await tx.season.update({
          where: { id: link.seasonId },
          data: {
            revision: { increment: 1 },
            economicRevision: { increment: 1 },
          },
        });
      return tx.projectPartnerRate.update({
        where: { id: snapshot.id },
        data: { rate: p.partnerRate, updatedBy: user.id },
      });
    }
    case "project-status": {
      const p = z
        .object({
          ...seasonInput,
          projectId: id,
          status: z.enum([
            "Черновик",
            "Активный",
            "Приостановлен",
            "Завершен",
            "Закрыт",
          ]),
          reason: text,
        })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      return tx.project.update({
        where: { id: p.projectId },
        data: { status: p.status, updatedBy: user.id },
      });
    }
    case "assignment": {
      const p = z
        .object({ ...seasonInput, projectId: id, employeeId: id })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      await activeEmployee(tx, p.employeeId);
      return tx.projectAssignment.create({
        data: {
          projectId: p.projectId,
          employeeId: p.employeeId,
          ...meta(user),
        },
      });
    }
    case "work": {
      const p = z
        .object({
          ...dateInput,
          projectId: id,
          projectAuditSectionId: id,
          employeeId: id,
          complexityLevelId: id,
          description: text,
          plannedHours: money,
          actualHours: money,
          correctionOf: optionalId,
        })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      await activeEmployee(tx, p.employeeId);
      ensure(
        await tx.projectAuditSection.findFirst({
          where: {
            id: p.projectAuditSectionId,
            projectId: p.projectId,
            active: true,
          },
        }),
        "Выберите действующий раздел этого проекта",
      );
      ensure(
        await tx.projectSectionAssignment.findFirst({
          where: {
            projectAuditSectionId: p.projectAuditSectionId,
            employeeId: p.employeeId,
            active: true,
          },
        }),
        "Сначала назначьте сотрудника на раздел",
      );
      ensure(
        await tx.projectAssignment.findUnique({
          where: {
            projectId_employeeId: {
              projectId: p.projectId,
              employeeId: p.employeeId,
            },
          },
        }),
        "Сначала назначьте сотрудника на проект",
      );
      const rates = await tx.complexityRate.findMany({
        where: {
          complexityLevelId: p.complexityLevelId,
          validFrom: { lte: asDate(p.date) },
          OR: [{ validTo: null }, { validTo: { gte: asDate(p.date) } }],
        },
      });
      ensure(
        rates.length === 1,
        "Не найдена однозначная ставка на дату работы",
      );
      if (p.correctionOf)
        ensure(
          await tx.workEntry.findFirst({
            where: {
              id: p.correctionOf,
              voided: true,
              seasonId: p.seasonId,
              employeeId: p.employeeId,
            },
          }),
          "Исходная запись не отменена",
        );
      return tx.workEntry.create({
        data: {
          seasonId: p.seasonId,
          projectId: p.projectId,
          employeeId: p.employeeId,
          description: p.description,
          projectAuditSectionId: p.projectAuditSectionId,
          plannedHours: p.plannedHours,
          actualHours: p.actualHours,
          accountingDate: asDate(p.date),
          complexityRateId: rates[0].id,
          rateSnapshot: rates[0].hourlyRate,
          earned: f.calculateWorkEntryEarnings(
            p.actualHours,
            rates[0].hourlyRate.toString(),
          ),
          correctionOf: p.correctionOf,
          ...meta(user),
        },
      });
    }
    case "payment-category": {
      const p = z
        .object({
          name: text,
          kind: z.enum(["SALARY", "BONUS", "OTHER", "REIMBURSEMENT", "FINAL"]),
          settlementRelevant: z.boolean(),
        })
        .parse(raw);
      ensure(
        p.kind !== "REIMBURSEMENT" || !p.settlementRelevant,
        "Возмещение расходов не уменьшает вознаграждение",
      );
      return tx.paymentCategory.create({
        data: {
          ...p,
          settlementRelevant: f.compensationEligible(
            p.kind,
            p.settlementRelevant,
          ),
          ...meta(user),
        },
      });
    }
    case "expense-category": {
      const p = z.object({ name: text }).parse(raw);
      return tx.expenseCategory.create({
        data: { name: p.name, ...meta(user) },
      });
    }
    case "payment": {
      const p = z
        .object({
          ...seasonInput,
          employeeId: id,
          paymentCategoryId: id,
          accountId: id,
          paymentDate: date,
          accountingPeriod: date,
          amount: money,
          quarterEmployeeSettlementId: optionalId,
          bonusApprovalId: optionalId,
          reason: text,
        })
        .parse(raw);
      ensure(f.d(p.amount).gt(0), "Сумма должна быть больше нуля");
      await activeEmployee(tx, p.employeeId);
      await cashAccount(tx, p.accountId);
      const category = await tx.paymentCategory.findUniqueOrThrow({
        where: { id: p.paymentCategoryId },
      });
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      ensure(
        asDate(p.accountingPeriod) >= season.startDate &&
          asDate(p.accountingPeriod) <= season.endDate,
        "Расчетный период не входит в сезон",
      );
      if (category.kind === "BONUS") {
        ensure(p.quarterEmployeeSettlementId, "Выберите квартальный расчет");
        ensure(
          await tx.quarterEmployeeSettlement.findFirst({
            where: {
              id: p.quarterEmployeeSettlementId,
              employeeId: p.employeeId,
              seasonId: p.seasonId,
            },
          }),
          "Расчет относится к другому сотруднику или сезону",
        );
      } else
        ensure(
          !p.quarterEmployeeSettlementId,
          "Ссылка на квартальный расчет разрешена только для бонуса",
        );
      if (category.kind === "BONUS") {
        const original = await tx.quarterEmployeeSettlement.findUniqueOrThrow({
          where: { id: p.quarterEmployeeSettlementId! },
        });
        const choice = await accepted(
          tx,
          p.seasonId,
          "QUARTER",
          p.employeeId,
          original.periodStart.toISOString().slice(0, 10),
        );
        const paid = await tx.employeePayment.findMany({
          where: {
            seasonId: p.seasonId,
            employeeId: p.employeeId,
            kindSnapshot: "BONUS",
            quarterEmployeeSettlementIdRef: {
              periodStart: original.periodStart,
            },
            journalTransactionIdRef: activeJournal,
          },
        });
        const total = f.d(sum(paid.map((v) => v.amount))).plus(p.amount);
        const normal =
          choice?.targetId === original.id &&
          (await quarterIsCurrent(tx, original.id)) &&
          total.lte(original.bonus.toString());
        if (!normal) {
          ensure(
            p.bonusApprovalId,
            "Требуется отдельное одобрение исключительной выплаты бонуса",
            409,
          );
          const approval = await tx.bonusExceptionApproval.findUnique({
            where: { id: p.bonusApprovalId },
            include: { payment: true },
          });
          ensure(
            approval &&
              !approval.payment &&
              approval.employeeId === p.employeeId &&
              approval.originalSettlementId === original.id &&
              approval.requestedPayment.eq(p.amount) &&
              approval.sourceRevision === season.compensationRevision - 1 &&
              approval.currentSettlementId === (choice?.targetId ?? null),
            "Одобрение исключения недействительно или уже использовано",
            409,
          );
        } else
          ensure(
            !p.bonusApprovalId,
            "Для обычной выплаты исключение не требуется",
          );
      } else
        ensure(
          !p.bonusApprovalId,
          "Одобрение исключения разрешено только для бонуса",
        );
      const salaryRate =
        category.kind === "SALARY"
          ? await tx.employeeSalaryRate.findFirst({
              where: {
                employeeId: p.employeeId,
                validFrom: { lte: asDate(p.accountingPeriod) },
                OR: [
                  { validTo: null },
                  { validTo: { gte: asDate(p.accountingPeriod) } },
                ],
              },
            })
          : null;
      ensure(
        category.kind !== "SALARY" || salaryRate,
        "Нет ставки зарплаты на расчетный период",
      );
      const target = await systemAccount(tx, user, "COMPENSATION");
      const sourceId = randomUUID();
      const journal = await post(
        tx,
        user,
        {
          seasonId: p.seasonId,
          date: asDate(p.paymentDate),
          accountingDate: asDate(p.accountingPeriod),
          operation: "PAYMENT",
          reason: p.reason,
          employeeId: p.employeeId,
          categoryId: category.id,
          sourceId,
          sourceType: "payments",
        },
        [
          { accountId: target.id, debit: p.amount, credit: "0" },
          { accountId: p.accountId, debit: "0", credit: p.amount },
        ],
      );
      return tx.employeePayment.create({
        data: {
          id: sourceId,
          seasonId: p.seasonId,
          employeeId: p.employeeId,
          paymentCategoryId: category.id,
          paymentDate: asDate(p.paymentDate),
          accountingPeriod: asDate(p.accountingPeriod),
          amount: p.amount,
          kindSnapshot: category.kind,
          bonusApprovalId: p.bonusApprovalId,
          settlementRelevantSnapshot: f.compensationEligible(
            category.kind,
            category.settlementRelevant,
          ),
          salaryRateSnapshot: salaryRate?.amount,
          quarterEmployeeSettlementId: p.quarterEmployeeSettlementId,
          journalTransactionId: journal.id,
          ...meta(user),
        },
      });
    }
    case "revenue": {
      const p = z
        .object({
          ...dateInput,
          projectId: id,
          amount: money,
          accountId: optionalId,
          comment: text,
        })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      const sourceId = randomUUID();
      let journalId: string | undefined;
      if (p.accountId) {
        await cashAccount(tx, p.accountId);
        const revenue = await systemAccount(tx, user, "REVENUE");
        journalId = (
          await post(
            tx,
            user,
            {
              seasonId: p.seasonId,
              date: asDate(p.date),
              operation: "REVENUE",
              reason: p.comment,
              projectId: p.projectId,
              sourceType: "revenues",
              sourceId,
            },
            [
              { accountId: p.accountId, debit: p.amount, credit: "0" },
              { accountId: revenue.id, debit: "0", credit: p.amount },
            ],
          )
        ).id;
      }
      return tx.projectRevenue.create({
        data: {
          id: sourceId,
          seasonId: p.seasonId,
          projectId: p.projectId,
          amount: p.amount,
          accountingDate: asDate(p.date),
          comment: p.comment,
          journalTransactionId: journalId,
          ...meta(user),
        },
      });
    }
    case "expense": {
      const p = z
        .object({
          ...dateInput,
          allocationReference: text.optional(),
          allocationOriginalTotal: money.optional(),
          projectId: optionalId,
          expenseCategoryId: id,
          amount: money,
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .default("UZS"),
          exchangeRate: z
            .string()
            .regex(/^\d+(\.\d{1,12})?$/)
            .default("1"),
          accountId: optionalId,
          comment: text,
        })
        .parse(raw);
      await projectInSeason(tx, p.projectId, p.seasonId);
      ensure(f.d(p.exchangeRate).gt(0), "Курс должен быть положительным");
      ensure(
        p.currency !== "UZS" || f.d(p.exchangeRate).eq(1),
        "Курс UZS должен быть равен 1",
      );
      const amount = f.d(p.amount).times(p.exchangeRate).toFixed(4);
      ensure(
        !!p.allocationReference === !!p.allocationOriginalTotal,
        "Укажите ссылку на исходный документ и его полную сумму в UZS вместе",
      );
      if (p.allocationReference) {
        const linked = await lockExpenseReference(
          tx,
          p.allocationReference,
          p.seasonId,
        );
        ensure(
          linked.every((e) =>
            e.allocationOriginalTotal?.eq(p.allocationOriginalTotal!),
          ),
          "Полная сумма исходного документа отличается от ранее указанной",
        );
        ensure(
          f
            .d(sum(linked.map((e) => e.amount)))
            .plus(amount)
            .lte(p.allocationOriginalTotal!),
          "Сумма отдельных расходов превышает исходный документ",
        );
      }
      const sourceId = randomUUID();
      let journalId: string | undefined;
      if (p.accountId) {
        await cashAccount(tx, p.accountId);
        const expense = await systemAccount(tx, user, "EXPENSE");
        journalId = (
          await post(
            tx,
            user,
            {
              seasonId: p.seasonId,
              date: asDate(p.date),
              operation: "EXPENSE",
              reason: p.comment,
              projectId: p.projectId,
              categoryId: p.expenseCategoryId,
              sourceType: "expenses",
              sourceId,
            },
            [
              { accountId: expense.id, debit: amount, credit: "0" },
              { accountId: p.accountId, debit: "0", credit: amount },
            ],
          )
        ).id;
      }
      return tx.expense.create({
        data: {
          id: sourceId,
          seasonId: p.seasonId,
          projectId: p.projectId,
          expenseCategoryId: p.expenseCategoryId,
          allocationReference: p.allocationReference,
          allocationOriginalTotal: p.allocationOriginalTotal,
          amount,
          originalAmount: p.amount,
          currency: p.currency,
          exchangeRate: p.exchangeRate,
          exchangeRateDate: asDate(p.date),
          accountingDate: asDate(p.date),
          comment: p.comment,
          journalTransactionId: journalId,
          ...meta(user),
        },
      });
    }
    case "trip-payment": {
      const p = z
        .object({
          ...dateInput,
          businessTripId: id,
          accountId: id,
          amount: money,
          accountingPeriod: date,
          kind: z.enum([
            "ADVANCE",
            "PAYMENT",
            "REIMBURSEMENT",
            "SETTLEMENT",
            "RETURN",
          ]),
          cashOutTransactionId: optionalId,
          document: text.optional(),
          reason: text,
        })
        .parse(raw);
      ensure(f.d(p.amount).gt(0), "Сумма должна быть положительной");
      const trip = await tx.businessTrip.findUniqueOrThrow({
        where: { id: p.businessTripId },
      });
      ensure(
        trip.seasonId === p.seasonId && !trip.voided,
        "Выберите действующую командировку этого сезона",
      );
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      ensure(
        asDate(p.accountingPeriod) >= season.startDate &&
          asDate(p.accountingPeriod) <= season.endDate,
        "Межсезонная выплата требует отдельного решения руководства",
        409,
      );
      const account = await cashAccount(tx, p.accountId);
      const clearing = await systemAccount(tx, user, "TRIP_CLEARING");
      const returned = p.kind === "RETURN";
      if (returned) {
        const state = await tripPaymentSummary(tx, trip.id, asDate(p.date));
        ensure(
          f.d(state.netPaid).gte(p.amount),
          "Возврат превышает связанные выдачи на дату платежа",
        );
      }
      const journal = await post(
        tx,
        user,
        {
          seasonId: p.seasonId,
          date: asDate(p.date),
          accountingDate: asDate(p.accountingPeriod),
          operation: returned ? "TRIP_RETURN" : "TRIP_PAYMENT",
          reason: p.reason,
          employeeId: trip.employeeId,
          projectId: trip.projectId ?? undefined,
          sourceType: "trips",
          sourceId: trip.id,
        },
        [
          {
            accountId: account.id,
            debit: returned ? p.amount : "0",
            credit: returned ? "0" : p.amount,
          },
          {
            accountId: clearing.id,
            debit: returned ? "0" : p.amount,
            credit: returned ? p.amount : "0",
          },
        ],
      );
      return linkTripPayment(tx, user.id, {
        seasonId: p.seasonId,
        businessTripId: trip.id,
        journalTransactionId: journal.id,
        kind: p.kind,
        reason: p.reason,
        document: p.document,
        cashOutTransactionId: p.cashOutTransactionId,
      });
    }
    case "trip-attribution": {
      const p = z
        .object({
          ...seasonInput,
          businessTripId: id,
          journalTransactionId: id,
          kind: z.enum([
            "ADVANCE",
            "PAYMENT",
            "REIMBURSEMENT",
            "SETTLEMENT",
            "RETURN",
          ]),
          cashOutTransactionId: optionalId,
          document: text.optional(),
          reason: text,
          confirmed: z.literal(true),
        })
        .parse(raw);
      return linkTripPayment(tx, user.id, p);
    }
    case "trip-review": {
      const p = z
        .object({
          ...seasonInput,
          businessTripId: id,
          reason: text,
          confirmed: z.literal(true),
        })
        .parse(raw);
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      const state = await tripPaymentSummary(
        tx,
        p.businessTripId,
        season.endDate,
      );
      ensure(state.seasonId === p.seasonId, "Командировка другого сезона");
      return tx.tripPaymentReview.create({
        data: {
          seasonId: p.seasonId,
          businessTripId: p.businessTripId,
          fingerprint: state.fingerprint,
          reason: p.reason,
          createdBy: user.id,
        },
      });
    }
    case "trip": {
      const p = z
        .object({
          ...seasonInput,
          employeeId: id,
          projectId: optionalId,
          destination: text,
          startDate: date,
          endDate: date,
          perDiemRate: money,
          transport: money,
          hotel: money,
          other: money,
          expenseCategoryId: id,
          comment: text,
        })
        .parse(raw);
      ensure(p.endDate >= p.startDate, "Конец командировки раньше начала");
      const tripSeason = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      ensure(
        asDate(p.startDate) >= tripSeason.startDate &&
          asDate(p.endDate) <= tripSeason.endDate,
        "Командировка выходит за границы сезона. Требуется решение руководства о распределении межсезонных затрат; операция не проведена",
        409,
      );
      await projectInSeason(tx, p.projectId, p.seasonId);
      await activeEmployee(tx, p.employeeId);
      const days =
        Math.round(
          (asDate(p.endDate).getTime() - asDate(p.startDate).getTime()) /
            86400000,
        ) + 1;
      const perDiemAmount = f.d(p.perDiemRate).times(days).toFixed(4);
      const trip = await tx.businessTrip.create({
        data: {
          seasonId: p.seasonId,
          employeeId: p.employeeId,
          projectId: p.projectId,
          destination: p.destination,
          paymentTrackingStarted: true,
          startDate: asDate(p.startDate),
          endDate: asDate(p.endDate),
          days,
          perDiemRate: p.perDiemRate,
          perDiemAmount,
          transport: p.transport,
          hotel: p.hotel,
          other: p.other,
          comment: p.comment,
          ...meta(user),
        },
      });
      const amount = sum([perDiemAmount, p.transport, p.hotel, p.other]);
      await tx.expense.create({
        data: {
          seasonId: p.seasonId,
          projectId: p.projectId,
          expenseCategoryId: p.expenseCategoryId,
          businessTripId: trip.id,
          costType: "TRIP",
          amount,
          originalAmount: amount,
          currency: "UZS",
          exchangeRate: "1",
          exchangeRateDate: asDate(p.startDate),
          accountingDate: asDate(p.startDate),
          comment: p.comment,
          ...meta(user),
        },
      });
      return trip;
    }
    case "account": {
      const p = z
        .object({
          name: text,
          kind: z.enum(["BANK", "CASH"]),
          bank: z.string().optional(),
        })
        .parse(raw);
      return tx.ledgerAccount.create({
        data: { ...p, currency: "UZS", ...meta(user) },
      });
    }
    case "transfer": {
      const p = z
        .object({
          ...dateInput,
          fromId: optionalId,
          toId: id,
          amount: money,
          reason: text,
        })
        .parse(raw);
      ensure(f.d(p.amount).gt(0), "Сумма должна быть больше нуля");
      await cashAccount(tx, p.toId);
      if (p.fromId) await cashAccount(tx, p.fromId);
      ensure(p.fromId !== p.toId, "Счета должны отличаться");
      const source = p.fromId ?? (await systemAccount(tx, user, "OPENING")).id;
      return post(
        tx,
        user,
        {
          seasonId: p.seasonId,
          date: asDate(p.date),
          operation: p.fromId ? "TRANSFER" : "OPENING",
          reason: p.reason,
          sourceType: "journal",
        },
        [
          { accountId: source, debit: "0", credit: p.amount },
          { accountId: p.toId, debit: p.amount, credit: "0" },
        ],
      );
    }
    case "cashout-method": {
      const p = z.object({ name: text, rate, validFrom: date }).parse(raw);
      ensure(f.d(p.rate).lt(1), "Ставка должна быть меньше 100%");
      const method = await tx.cashOutMethod.create({
        data: { name: p.name, ...meta(user) },
      });
      await tx.cashOutMethodRate.create({
        data: {
          cashOutMethodId: method.id,
          rate: p.rate,
          validFrom: asDate(p.validFrom),
          ...meta(user),
        },
      });
      return method;
    }
    case "cashout": {
      const p = z
        .object({
          ...dateInput,
          bankAccountId: id,
          cashAccountId: id,
          cashOutMethodId: id,
          bankOut: money,
          cashReceived: money,
          purpose: text,
          allocations: z
            .array(
              z.object({
                projectId: optionalId,
                businessTripId: optionalId,
                amount: money,
              }),
            )
            .min(1),
        })
        .parse(raw);
      await cashAccount(tx, p.bankAccountId, "BANK");
      await cashAccount(tx, p.cashAccountId, "CASH");
      const rates = await tx.cashOutMethodRate.findMany({
        where: {
          cashOutMethodId: p.cashOutMethodId,
          validFrom: { lte: asDate(p.date) },
          OR: [{ validTo: null }, { validTo: { gte: asDate(p.date) } }],
        },
      });
      ensure(
        rates.length === 1,
        "Не найдена ставка обналичивания на дату операции",
      );
      const calc = f.calculateCashOut(
        p.bankOut,
        p.cashReceived,
        rates[0].rate.toString(),
      );
      f.validateFeeAllocation(
        calc.fee,
        p.allocations.map((a) => a.amount),
      );
      for (const allocation of p.allocations) {
        await projectInSeason(tx, allocation.projectId, p.seasonId);
        if (allocation.businessTripId) {
          const trip = await tx.businessTrip.findFirst({
            where: {
              id: allocation.businessTripId,
              seasonId: p.seasonId,
              voided: false,
            },
          });
          ensure(
            trip && trip.projectId === (allocation.projectId ?? null),
            "Командировка не соответствует назначению",
          );
        }
      }
      const expense = await systemAccount(tx, user, "EXPENSE");
      const sourceId = randomUUID();
      const journal = await post(
        tx,
        user,
        {
          seasonId: p.seasonId,
          date: asDate(p.date),
          operation: "CASHOUT",
          reason: p.purpose,
          sourceType: "cashout",
          sourceId,
        },
        [
          { accountId: p.bankAccountId, debit: "0", credit: p.bankOut },
          { accountId: p.cashAccountId, debit: p.cashReceived, credit: "0" },
          { accountId: expense.id, debit: calc.fee, credit: "0" },
        ],
      );
      const cashout = await tx.cashOutTransaction.create({
        data: {
          id: sourceId,
          seasonId: p.seasonId,
          bankAccountId: p.bankAccountId,
          cashAccountId: p.cashAccountId,
          cashOutMethodRateId: rates[0].id,
          rateSnapshot: rates[0].rate,
          bankOut: p.bankOut,
          cashReceived: p.cashReceived,
          actualFee: calc.fee,
          expectedFee: calc.expectedFee,
          purpose: p.purpose,
          journalTransactionId: journal.id,
          ...meta(user),
        },
      });
      for (const allocation of p.allocations)
        await tx.cashOutAllocation.create({
          data: {
            cashOutTransactionId: cashout.id,
            ...allocation,
            ...meta(user),
          },
        });
      return cashout;
    }
    case "reconciliation": {
      const p = z
        .object({
          ...dateInput,
          ledgerAccountId: id,
          actual: money,
          explanation: z.string().max(1000).optional(),
        })
        .parse(raw);
      await cashAccount(tx, p.ledgerAccountId);
      const expected = await accountBalance(
        tx,
        p.ledgerAccountId,
        asDate(p.date),
      );
      const difference = f.d(p.actual).minus(expected);
      return tx.cashReconciliation.create({
        data: {
          seasonId: p.seasonId,
          ledgerAccountId: p.ledgerAccountId,
          date: asDate(p.date),
          expected,
          actual: p.actual,
          difference: difference.toFixed(4),
          explanation: p.explanation,
          resolved: difference.isZero(),
          ...meta(user),
        },
      });
    }
    case "resolve-reconciliation": {
      const p = z.object({ ...seasonInput, id, reason: text }).parse(raw);
      ensure(
        await tx.cashReconciliation.findFirst({
          where: { id: p.id, seasonId: p.seasonId },
        }),
        "Сверка не найдена",
      );
      return tx.cashReconciliation.update({
        where: { id: p.id },
        data: { resolved: true, explanation: p.reason, updatedBy: user.id },
      });
    }
    case "quarter":
    case "season-settlement": {
      const p = z
        .object({
          ...seasonInput,
          employeeId: id,
          periodStart: date.optional(),
        })
        .parse(raw);
      const detail = await employeeCalculation(tx, p.seasonId, p.employeeId);
      if (operation === "quarter") {
        ensure(p.periodStart, "Выберите начало квартала");
        const q = detail.quarters.find(
          (q) => q.periodStart.toISOString().slice(0, 10) === p.periodStart,
        );
        ensure(q, "Квартал не входит в сезон");
        const previous = detail.quarters[detail.quarters.indexOf(q) - 1];
        let carrySourceId: string | undefined;
        if (previous) {
          const choice = await accepted(
            tx,
            p.seasonId,
            "QUARTER",
            p.employeeId,
            previous.periodStart.toISOString().slice(0, 10),
          );
          const source = choice
            ? await tx.quarterEmployeeSettlement.findUnique({
                where: { id: choice.targetId },
              })
            : null;
          ensure(
            source && (await quarterIsCurrent(tx, source.id)),
            "Сначала рассчитайте и примите актуальную версию предыдущего квартала",
            409,
          );
          ensure(
            source.carryOut.eq(previous.carry),
            "Перенос предыдущего квартала требует пересчета",
            409,
          );
          carrySourceId = source.id;
        }
        const record = await tx.quarterEmployeeSettlement.create({
          data: {
            seasonId: p.seasonId,
            employeeId: p.employeeId,
            periodStart: q.periodStart,
            periodEnd: q.periodEnd,
            earned: q.earned,
            ktu: q.ktu,
            carryIn:
              detail.quarters[detail.quarters.indexOf(q) - 1]?.carry ?? "0",
            salary: sum(q.salaryPayments.map((p) => p.amount)),
            difference: q.difference,
            bonus: q.bonus,
            carryOut: q.carry,
            status: "Рассчитано",
            sourceRevision: detail.season.workRevision,
            carrySourceId,
            ...meta(user),
          },
        });
        for (const entry of q.workEntries)
          await tx.settlementSource.create({
            data: {
              settlementId: record.id,
              settlementType: "QUARTER",
              sourceType: "WORK",
              sourceId: entry.id,
              amount: entry.earned,
            },
          });
        for (const payment of q.salaryPayments)
          await tx.settlementSource.create({
            data: {
              settlementId: record.id,
              settlementType: "QUARTER",
              sourceType: "PAYMENT",
              sourceId: payment.id,
              amount: payment.amount,
            },
          });
        return record;
      }
      const approvedQuarters = [];
      for (const q of detail.quarters) {
        const choice = await accepted(
          tx,
          p.seasonId,
          "QUARTER",
          p.employeeId,
          q.periodStart.toISOString().slice(0, 10),
        );
        ensure(
          choice && (await quarterIsCurrent(tx, choice.targetId)),
          "Сначала примите все актуальные квартальные расчеты",
          409,
        );
        approvedQuarters.push(choice.targetId);
      }
      const s = detail.seasonResult;
      const record = await tx.seasonEmployeeSettlement.create({
        data: {
          seasonId: p.seasonId,
          employeeId: p.employeeId,
          earned: sum(detail.entries.map((e) => e.earned)),
          ktu: sum(detail.quarters.map((q) => q.ktu)),
          paid: s.paid,
          outstanding: s.outstanding,
          finalPayment: s.finalPayment,
          sourceRevision: detail.season.compensationRevision,
          roundingDifference: s.roundingDifference,
          ...meta(user),
        },
      });
      for (const sourceId of approvedQuarters)
        await tx.settlementSource.create({
          data: {
            settlementId: record.id,
            settlementType: "SEASON",
            sourceType: "QUARTER",
            sourceId,
            amount: (
              await tx.quarterEmployeeSettlement.findUniqueOrThrow({
                where: { id: sourceId },
              })
            ).ktu,
          },
        });
      for (const entry of detail.entries)
        await tx.settlementSource.create({
          data: {
            settlementId: record.id,
            settlementType: "SEASON",
            sourceType: "WORK",
            sourceId: entry.id,
            amount: entry.earned,
          },
        });
      for (const payment of detail.payments)
        await tx.settlementSource.create({
          data: {
            settlementId: record.id,
            settlementType: "SEASON",
            sourceType: "PAYMENT",
            sourceId: payment.id,
            amount: payment.amount,
          },
        });
      return record;
    }
    case "partner-allocation": {
      const p = z.object({ ...seasonInput }).parse(raw);
      const result = await projectEconomics(tx, p.seasonId);
      const run = await tx.allocationRun.create({
        data: {
          seasonId: p.seasonId,
          periodStart: result.season.startDate,
          periodEnd: result.season.endDate,
          pool: result.general,
          status: result.allocation.status,
          sourceRevision: result.season.economicRevision,
          ...meta(user),
        },
      });
      await saveAllocationSources(tx, run.id, result);
      for (const row of result.allocation.projects)
        await tx.projectAllocation.create({
          data: {
            allocationRunId: run.id,
            projectId: row.id,
            revenue: row.revenue,
            directCost: sum([row.labor, row.otherDirect]),
            allocationShare: f
              .d(sum(result.allocation.projects.map((r) => r.weight)))
              .isZero()
              ? "0"
              : f
                  .d(row.weight)
                  .div(sum(result.allocation.projects.map((r) => r.weight)))
                  .toFixed(12),
            gad: row.gad,
            weight: row.weight,
            allocated: row.allocated,
            rateSnapshot: row.partnerRate,
            net: row.net,
            entitlement: row.entitlement,
            ...meta(user),
          },
        });
      return run;
    }
    case "manual-allocation": {
      const p = z
        .object({
          ...seasonInput,
          reason: text,
          allocations: z.array(z.object({ projectId: id, amount: money })),
        })
        .parse(raw);
      const result = await projectEconomics(tx, p.seasonId);
      ensure(
        new Set(p.allocations.map((a) => a.projectId)).size ===
          result.rows.length && p.allocations.length === result.rows.length,
        "Укажите каждый проект ровно один раз",
      );
      f.validateFeeAllocation(
        result.general,
        p.allocations.map((a) => a.amount),
      );
      const run = await tx.allocationRun.create({
        data: {
          seasonId: p.seasonId,
          periodStart: result.season.startDate,
          periodEnd: result.season.endDate,
          pool: result.general,
          status: "Ручное распределение",
          overrideReason: p.reason,
          sourceRevision: result.season.economicRevision,
          ...meta(user),
        },
      });
      await saveAllocationSources(tx, run.id, result);
      for (const line of p.allocations) {
        const project = result.rows.find((r) => r.id === line.projectId);
        ensure(project, "Проект не входит в сезон");
        const gad = f.calculateProjectGrossAfterDirect(
            project.revenue,
            project.labor,
            project.otherDirect,
          ),
          net = f.d(gad).minus(line.amount).toFixed(4);
        await tx.projectAllocation.create({
          data: {
            allocationRunId: run.id,
            projectId: project.id,
            revenue: project.revenue,
            directCost: sum([project.labor, project.otherDirect]),
            allocationShare: f.d(result.general).isZero()
              ? "0"
              : f.d(line.amount).div(result.general).toFixed(12),
            gad,
            weight: f.d(gad).gt(0) ? gad : "0",
            allocated: line.amount,
            rateSnapshot: project.partnerRate,
            net,
            entitlement: f.calculateProjectPartnerEntitlement(
              net,
              project.partnerRate,
            ),
            ...meta(user),
          },
        });
      }
      return run;
    }
    case "partner-payment": {
      const p = z
        .object({
          ...dateInput,
          partnerId: id,
          accountId: id,
          amount: money,
          reason: text,
        })
        .parse(raw);
      await cashAccount(tx, p.accountId);
      ensure(f.d(p.amount).gt(0), "Сумма должна быть больше нуля");
      const allocation = await requireCurrentAllocation(tx, p.seasonId);
      ensure(
        await tx.projectAllocation.findFirst({
          where: {
            allocationRunId: allocation.id,
            projectIdRef: { partnerId: p.partnerId },
          },
        }),
        "Нет принятого начисления партнеру",
      );
      const destination = await systemAccount(tx, user, "COMPENSATION");
      const sourceId = randomUUID();
      const journal = await post(
        tx,
        user,
        {
          seasonId: p.seasonId,
          date: asDate(p.date),
          accountingDate: allocation.periodEnd,
          operation: "PARTNER_PAYMENT",
          reason: p.reason,
          partnerId: p.partnerId,
          sourceType: "partner-payments",
          sourceId,
        },
        [
          { accountId: p.accountId, debit: "0", credit: p.amount },
          { accountId: destination.id, debit: p.amount, credit: "0" },
        ],
      );
      const payment = await tx.partnerPayment.create({
        data: {
          id: sourceId,
          seasonId: p.seasonId,
          partnerId: p.partnerId,
          amount: p.amount,
          paymentDate: asDate(p.date),
          journalTransactionId: journal.id,
          ...meta(user),
        },
      });
      await tx.partnerPaymentAttribution.create({
        data: {
          paymentId: payment.id,
          allocationRunId: allocation.id,
          reason: p.reason,
          createdBy: user.id,
        },
      });
      return payment;
    }
    case "attribute-partner-payment": {
      const p = z
        .object({
          ...seasonInput,
          paymentId: id,
          reason: text,
          confirmed: z.literal(true),
        })
        .parse(raw);
      const payment = await tx.partnerPayment.findFirst({
        where: {
          id: p.paymentId,
          seasonId: p.seasonId,
          journalTransactionIdRef: activeJournal,
        },
      });
      ensure(payment, "Действующая выплата не найдена");
      const allocation = await requireCurrentAllocation(tx, p.seasonId);
      ensure(
        await tx.projectAllocation.findFirst({
          where: {
            allocationRunId: allocation.id,
            projectIdRef: { partnerId: payment.partnerId },
          },
        }),
        "В распределении нет партнера выплаты",
      );
      return tx.partnerPaymentAttribution.upsert({
        where: { paymentId: p.paymentId },
        create: {
          paymentId: p.paymentId,
          allocationRunId: allocation.id,
          reason: p.reason,
          createdBy: user.id,
        },
        update: { allocationRunId: allocation.id, reason: p.reason },
      });
    }
    case "correction": {
      const p = z
        .object({
          ...dateInput,
          entity: z.enum([
            "work",
            "expense",
            "revenue",
            "payment",
            "cashout",
            "journal",
            "trip",
          ]),
          id,
          reason: text,
        })
        .parse(raw);
      if (p.entity === "work") {
        const row = await tx.workEntry.findUniqueOrThrow({
          where: { id: p.id },
        });
        ensure(row.seasonId === p.seasonId, "Другой сезон");
        return tx.workEntry.update({
          where: { id: p.id },
          data: { voided: true, updatedBy: user.id },
        });
      }
      if (p.entity === "expense" || p.entity === "revenue") {
        const row =
          p.entity === "expense"
            ? await tx.expense.findUniqueOrThrow({ where: { id: p.id } })
            : await tx.projectRevenue.findUniqueOrThrow({
                where: { id: p.id },
              });
        ensure(row.seasonId === p.seasonId, "Другой сезон");
        if ("businessTripId" in row)
          ensure(!row.businessTripId, "Отмените командировку целиком");
        if ("allocationReference" in row && row.allocationReference)
          await lockExpenseReference(tx, row.allocationReference, p.seasonId);
        if (row.journalTransactionId)
          await reverse(
            tx,
            user,
            row.journalTransactionId,
            p.reason,
            asDate(p.date),
          );
        return p.entity === "expense"
          ? tx.expense.update({
              where: { id: p.id },
              data: { voided: true, updatedBy: user.id },
            })
          : tx.projectRevenue.update({
              where: { id: p.id },
              data: { voided: true, updatedBy: user.id },
            });
      }
      if (p.entity === "trip") {
        const row = await tx.businessTrip.findUniqueOrThrow({
          where: { id: p.id },
        });
        ensure(row.seasonId === p.seasonId, "Другой сезон");
        await tx.expense.updateMany({
          where: { businessTripId: p.id, voided: false },
          data: { voided: true, updatedBy: user.id },
        });
        return tx.businessTrip.update({
          where: { id: p.id },
          data: { voided: true, updatedBy: user.id },
        });
      }
      let journalId = p.id;
      if (p.entity === "payment")
        journalId = (
          await tx.employeePayment.findUniqueOrThrow({ where: { id: p.id } })
        ).journalTransactionId;
      if (p.entity === "cashout")
        journalId = (
          await tx.cashOutTransaction.findUniqueOrThrow({ where: { id: p.id } })
        ).journalTransactionId;
      const journal = await tx.journalTransaction.findUniqueOrThrow({
        where: { id: journalId },
      });
      ensure(journal.seasonId === p.seasonId, "Другой сезон");
      ensure(
        p.entity !== "journal" ||
          [
            "TRANSFER",
            "OPENING",
            "PARTNER_PAYMENT",
            "TRIP_PAYMENT",
            "TRIP_RETURN",
          ].includes(journal.operation),
        "Отмените исходную финансовую запись",
      );
      return reverse(tx, user, journalId, p.reason, asDate(p.date));
    }
    case "accept-calculation": {
      const p = z
        .object({
          ...seasonInput,
          kind: z.enum(["QUARTER", "SEASON", "ALLOCATION"]),
          id,
          reason: text,
          confirmed: z.literal(true),
        })
        .parse(raw);
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      const row =
        p.kind === "QUARTER"
          ? await tx.quarterEmployeeSettlement.findUniqueOrThrow({
              where: { id: p.id },
            })
          : p.kind === "SEASON"
            ? await tx.seasonEmployeeSettlement.findUniqueOrThrow({
                where: { id: p.id },
              })
            : await tx.allocationRun.findUniqueOrThrow({ where: { id: p.id } });
      ensure(row.seasonId === p.seasonId, "Расчет другого сезона");
      const revision =
        p.kind === "QUARTER"
          ? season.workRevision
          : p.kind === "SEASON"
            ? season.compensationRevision
            : season.economicRevision;
      ensure(
        row.sourceRevision === revision,
        "Расчет устарел: выполните новый расчет",
        409,
      );
      if (p.kind === "ALLOCATION")
        ensure(
          ["Рассчитано", "Ручное распределение"].includes((row as any).status),
          "Распределение требует решения руководства",
          409,
        );
      if (p.kind === "QUARTER") {
        const q = row as any;
        ensure(
          f
            .d(q.bonus.toString())
            .plus(q.carryOut.toString())
            .eq(
              f.d(q.difference.toString()).gt(0)
                ? q.difference.toString()
                : "0",
            ),
          "Историческая версия содержит ошибку округления; пересчитайте квартал",
        );
      }
      if (p.kind === "QUARTER")
        ensure(
          await quarterIsCurrent(tx, p.id, false),
          "Источник переноса устарел; пересчитайте квартал",
          409,
        );
      if (p.kind === "SEASON")
        ensure(
          await seasonIsCurrent(tx, p.id),
          "Источники сезонного расчета устарели",
          409,
        );
      const key = acceptanceKey(
        p.seasonId,
        p.kind,
        "employeeId" in row ? row.employeeId : "",
        "periodStart" in row && p.kind === "QUARTER"
          ? row.periodStart.toISOString().slice(0, 10)
          : "",
      );
      return tx.calculationAcceptance.upsert({
        where: { key },
        create: {
          key,
          seasonId: p.seasonId,
          kind: p.kind,
          targetId: p.id,
          acceptedBy: user.id,
        },
        update: { targetId: p.id, acceptedBy: user.id },
      });
    }
    case "bonus-exception": {
      const p = z
        .object({
          ...seasonInput,
          employeeId: id,
          originalSettlementId: id,
          requestedPayment: money,
          reason: text,
          confirmed: z.literal(true, {
            error: "Подтвердите исключительную выплату бонуса",
          }),
        })
        .parse(raw);
      ensure(f.d(p.requestedPayment).gt(0), "Сумма должна быть больше нуля");
      const original = await tx.quarterEmployeeSettlement.findFirst({
        where: {
          id: p.originalSettlementId,
          seasonId: p.seasonId,
          employeeId: p.employeeId,
        },
      });
      ensure(original, "Исходный расчет не найден");
      const choice = await accepted(
        tx,
        p.seasonId,
        "QUARTER",
        p.employeeId,
        original.periodStart.toISOString().slice(0, 10),
      );
      const current = choice
        ? await tx.quarterEmployeeSettlement.findUnique({
            where: { id: choice.targetId },
          })
        : null;
      const season = await tx.season.findUniqueOrThrow({
        where: { id: p.seasonId },
      });
      const bonus = current?.bonus ?? original.bonus;
      return tx.bonusExceptionApproval.create({
        data: {
          seasonId: p.seasonId,
          employeeId: p.employeeId,
          originalSettlementId: original.id,
          currentSettlementId: current?.id,
          approvedBonus: bonus,
          requestedPayment: p.requestedPayment,
          difference: f
            .d(p.requestedPayment)
            .minus(bonus.toString())
            .toFixed(4),
          explanation: p.reason,
          authorizedBy: user.id,
          sourceRevision: season.compensationRevision,
        },
      });
    }
    case "review": {
      const p = z
        .object({
          ...seasonInput,
          name: z.enum(f.requiredClosingChecks),
          resolved: z.boolean(),
          reason: text,
        })
        .parse(raw);
      const review = await tx.seasonClosing.create({
        data: {
          seasonId: p.seasonId,
          status: "На сверке",
          reason: p.reason,
          ...meta(user),
        },
      });
      await tx.seasonClosingCheck.create({
        data: {
          seasonClosingId: review.id,
          name: p.name,
          resolved: p.resolved,
          explanation: p.reason,
          approvalFingerprint: await approvalFingerprint(tx, p.seasonId),
          ...meta(user),
        },
      });
      return review;
    }
    case "close": {
      const p = z
        .object({ ...seasonInput, reason: text, confirmed: z.literal(true) })
        .parse(raw);
      const checks = await readiness(tx, p.seasonId);
      ensure(
        checks.canClose,
        "Сезон не готов: " + checks.blockers.join(", "),
        409,
      );
      const report = await collectSeasonReport(tx, p.seasonId);
      report.season.status = "Закрыт";
      const { sourceFingerprint: previousFingerprint, ...payload } = report;
      report.sourceFingerprint = fingerprint(payload);
      await tx.seasonClosing.create({
        data: {
          seasonId: p.seasonId,
          status: "Закрыт",
          reason: p.reason,
          createdBy: user.id,
          reportSnapshot: report as unknown as Prisma.InputJsonValue,
          reportFingerprint: report.sourceFingerprint,
        },
      });
      return tx.season.update({
        where: { id: p.seasonId },
        data: { status: "Закрыт", updatedBy: user.id },
      });
    }
    case "reopen": {
      const p = z
        .object({ ...seasonInput, reason: text, confirmed: z.literal(true) })
        .parse(raw);
      return tx.season.update({
        where: { id: p.seasonId },
        data: {
          status: "На сверке",
          revision: { increment: 1 },
          updatedBy: user.id,
        },
      });
    }
    default:
      throw new AppError(404, "Операция не найдена");
  }
}


