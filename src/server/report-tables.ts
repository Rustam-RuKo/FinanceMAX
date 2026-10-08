import { d, calculateCashOut } from "../domain/calculations";
import type { SeasonReport, PartnerReport } from "./season-report";
import { legacySectionName } from "../domain/audit-templates";

export type Cell =
  string | number | Date | null | undefined | { toString(): string };
type Kind = "text" | "money" | "date" | "rate";
type Column = { title: string; kind: Kind };
export type ReportTable = {
  name: string;
  title: string;
  columns: Column[];
  rows: Cell[][];
};
const table = (
  name: string,
  headers: string,
  rows: Cell[][],
  title = name,
): ReportTable => {
  const columns = headers.split("|").map((h) => {
    const [title, kind = "text"] = h.split(":");
    return { title, kind: kind as Kind };
  });
  // Sum only additive details, never balances, mixed month/quarter levels or carry chains.
  if (
    !["01.", "10.", "13.", "16.", "18.", "20."].includes(name.slice(0, 3)) &&
    rows.length &&
    !name.includes("ИТОГ СЕЗОНА")
  ) {
    const sums = columns.map((c, i) =>
      i === 0
        ? "ИТОГО"
        : c.kind === "money" &&
            (name.startsWith("15.")
              ? rows.every((r) => r[i] != null)
              : rows.some((r) => r[i] != null))
          ? total(rows.map((r) => r[i]))
          : null,
    );
    rows = [...rows, sums];
  }
  return { name, title, columns, rows };
};
const total = (xs: Cell[]) =>
  xs
    .reduce<ReturnType<typeof d>>(
      (s, x) => s.plus(x?.toString() ?? "0"),
      d("0"),
    )
    .toFixed(4);
const kindName: Record<string, string> = {
  SALARY: "Зарплата",
  BONUS: "Квартальная премия",
  FINAL: "Итоговая выплата",
  OTHER: "Прочая выплата",
  REIMBURSEMENT: "Возмещение расходов",
};
export function managementTables(s: SeasonReport): ReportTable[] {
  const project = (id: string | null) => s.projects.find((p) => p.id === id);
  const name = (id: string | null) => project(id)?.name ?? "Общие расходы";
  const fees = s.cashouts.flatMap(
    (c) => c.CashOutAllocation_cashOutTransactionId_rows,
  );
  const expenseRows = (direct: boolean) =>
    s.expenses
      .filter((e) => !!e.projectId === direct)
      .map(
        (e) =>
          [
            e.accountingDate,
            name(e.projectId),
            e.expenseCategoryIdRef.name,
            e.amount,
            e.comment,
            e.id,
          ] as Cell[],
      );
  const feeRows = (direct: boolean) =>
    fees
      .filter((e) => !!e.projectId === direct)
      .map(
        (e) =>
          [
            s.cashouts.find((c) => c.id === e.cashOutTransactionId)
              ?.journalTransactionIdRef.accountingDate,
            name(e.projectId),
            "Комиссия обналичивания",
            e.amount,
            "Включена в расходы один раз",
            e.id,
          ] as Cell[],
      );
  const employees = new Map([
    ...s.work.map((w) => [w.employeeId, w.employeeIdRef.name] as const),
    ...s.payments.map((p) => [p.employeeId, p.employeeIdRef.name] as const),
  ]);
  const balanceRows = (kind: string): Cell[][] =>
    s.balances
      .filter((a) => a.kind === kind)
      .flatMap((a) => {
        const movements = s.journals
          .filter((j) => new Date(j.postingDate) <= new Date(s.cutoff))
          .flatMap((j) =>
            j.JournalLine_journalTransactionId_rows.filter(
              (l) => l.ledgerAccountId === a.id,
            ).map(
              (l) =>
                [
                  a.name,
                  j.postingDate,
                  j.reason,
                  l.debit,
                  l.credit,
                  null,
                  j.id,
                ] as Cell[],
            ),
          );
        return [
          [
            a.name,
            s.season.startDate,
            "Начальный остаток",
            null,
            null,
            a.opening,
            null,
          ],
          ...movements,
          [a.name, s.cutoff, "Конечный остаток", null, null, a.closing, null],
        ];
      });
  const partnerRows = s.partnerBalances.map((b) => {
    const ps = s.projects.filter((p) => p.partnerId === b.partnerId);
    return [
      b.name,
      ps.length,
      total(ps.map((p) => p.revenue)),
      total(ps.map((p) => p.direct)),
      total(ps.map((p) => p.allocation?.gad)),
      ps
        .reduce(
          (s, p) => s.plus(p.allocation?.allocationShare?.toString() ?? "0"),
          d("0"),
        )
        .toFixed(12),
      total(ps.map((p) => p.allocation?.allocated)),
      total(ps.map((p) => p.allocation?.net)),
      b.entitlement,
      b.payable,
      b.roundingDifference,
      b.paid,
      b.remaining,
      b.unallocated,
    ];
  });
  const allocationRows = s.projects.map((p) => [
    p.code,
    p.name,
    p.partner,
    p.rate,
    p.revenue,
    p.direct,
    p.allocation?.gad,
    p.allocation?.allocationShare,
    p.allocation?.allocated,
    p.allocation?.net,
    p.allocation?.entitlement,
    p.allocation?.allocationRunId ?? "Нет принятого актуального расчёта",
  ]);
  const earnings: Cell[][] = [];
  for (const [id, n] of employees) {
    const entries = s.work.filter((w) => w.employeeId === id),
      months = [
        ...new Set(entries.map((w) => String(w.accountingDate).slice(0, 7))),
      ].sort();
    for (const month of months)
      earnings.push([
        n,
        "Месяц",
        month,
        total(
          entries
            .filter((w) => String(w.accountingDate).startsWith(month))
            .map((w) => w.earned),
        ),
      ]);
    for (const q of s.quarters.filter((q) => q.employeeId === id))
      earnings.push([
        n,
        "Квартал",
        String(q.periodStart).slice(0, 10),
        q.earned,
      ]);
    earnings.push([
      n,
      "Сезон",
      s.season.name,
      total(entries.map((w) => w.earned)),
    ]);
  }
  const summary: Cell[][] = [
    ...[
      ["Доходы", s.totals.revenue],
      ["Фактический заработок (в прямых расходах)", s.totals.labor],
      ["Прямые расходы, включая труд и комиссию", s.totals.direct],
      ["Общие расходы, включая комиссию", s.totals.general],
      ["Обналичивание (справочно, уже в расходах)", s.totals.cashOutFees],
      ["Экономический результат", s.totals.economicResult],
      ["КТУ принятых кварталов", total(s.quarters.map((q) => q.ktu))],
      ["Компенсация сотрудникам", s.totals.compensationPaid],
      ["Выплаты партнёрам", s.totals.partnerPaid],
      [
        "Невыплачено партнёрам",
        total(s.partnerBalances.map((p) => p.remaining)),
      ],
      [
        "Итоговые обязательства сотрудникам",
        total(s.settlements.map((p) => p.finalPayment)),
      ],
    ].map(([k, v]) => [k, v]),
    ...Object.entries(kindName).map(([k, n]) => [
      n,
      total(
        s.payments.filter((p) => p.kindSnapshot === k).map((p) => p.amount),
      ),
    ]),
    ...s.balances.map((a) => ["Остаток: " + a.name, a.closing]),
  ];
  return [
    table("01. СВОДКА", "Показатель|Сумма UZS:money", summary),
    table(
      "02. ПРОЕКТЫ",
      "Код|Проект|Клиент|Партнёр|Ставка:rate|Доход:money|Труд:money|Прочие прямые:money|Комиссия:money|Прямые всего:money|ГАД:money|Общие распределённые:money|Чистый результат:money|Доход партнёра:money|Статус|Источник|Тип проекта|Количество выбранных разделов",
      s.projects.map((p) => [
        p.code,
        p.name,
        p.client,
        p.partner,
        p.rate,
        p.revenue,
        p.labor,
        p.other,
        p.fee,
        p.direct,
        p.allocation?.gad,
        p.allocation?.allocated,
        p.allocation?.net,
        p.allocation?.entitlement,
        p.status,
        p.id,
        p.projectType ?? "Тип не указан",
        (s.auditSections ?? []).filter((section) => section.projectId === p.id)
          .length,
      ]),
    ),
    table(
      "03. ДОХОДЫ",
      "Дата:date|Проект|Клиент|Сумма UZS:money|Счёт поступления|Сезон|Основание|Источник",
      s.revenue.map((r) => [
        r.accountingDate,
        name(r.projectId),
        project(r.projectId)?.client,
        r.amount,
        s.journals
          .find((j) => j.id === r.journalTransactionId)
          ?.JournalLine_journalTransactionId_rows.filter((l) =>
            d(String(l.debit)).gt(0),
          )
          .map((l) => l.ledgerAccountIdRef.name)
          .join(", ") ?? "Без платёжной проводки",
        s.season.name,
        r.comment,
        r.id,
      ]),
    ),
    table(
      "04. ПРЯМЫЕ РАСХОДЫ",
      "Дата:date|Проект|Вид|Сумма UZS:money|Основание|Источник",
      [
        ...s.work.map((w) => [
          w.accountingDate,
          name(w.projectId),
          "Фактический заработок",
          w.earned,
          w.description,
          w.id,
        ]),
        ...expenseRows(true),
        ...feeRows(true),
      ],
    ),
    table(
      "05. ОБЩИЕ РАСХОДЫ",
      "Дата:date|Назначение|Вид|Сумма UZS:money|Основание|Источник",
      [...expenseRows(false), ...feeRows(false)],
    ),
    table(
      "06. ПАРТНЕРЫ",
      "Партнёр|Проектов|Доход:money|Прямые:money|ГАД:money|Доля:rate|Общие:money|Чистый:money|Начислено:money|К выплате UZS:money|Округление:money|Выплачено:money|Остаток:money|Без привязки:money",
      partnerRows,
    ),
    table(
      "07. РАСЧЕТЫ ПАРТНЕРОВ",
      "Код|Проект|Партнёр|Фиксированная ставка:rate|Доход:money|Прямые:money|ГАД:money|Доля:rate|Общие:money|Чистый:money|Начислено:money|Версия",
      allocationRows,
    ),
    table(
      "08. СОТРУДНИКИ",
      "Сотрудник|Заработок:money|КТУ:money|Учтённые выплаты:money|Остаток:money|К выплате:money",
      [...employees].map(([id, n]) => {
        const e = s.settlements.find((e) => e.employeeId === id);
        return [
          n,
          total(s.work.filter((w) => w.employeeId === id).map((w) => w.earned)),
          e?.ktu,
          e?.paid,
          e?.outstanding,
          e?.finalPayment,
        ];
      }),
    ),
    table(
      "09. РАБОЧЕЕ ВРЕМЯ",
      "Сотрудник|Проект|Задача|Сложность|Историческая ставка:money|План часов:money|Факт часов:money|Заработок:money|Дата:date|Сезон|Источник|Код раздела|Раздел аудита",
      s.work.map((w) => [
        w.employeeIdRef.name,
        name(w.projectId),
        w.description,
        w.complexityRateIdRef.complexityLevelIdRef.name,
        w.rateSnapshot,
        w.plannedHours,
        w.actualHours,
        w.earned,
        w.accountingDate,
        s.season.name,
        w.id,
        w.auditSection?.codeSnapshot ?? "",
        w.auditSection?.nameSnapshot ?? legacySectionName,
      ]),
    ),
    table(
      "10. ФАКТИЧЕСКИЙ ЗАРАБОТОК",
      "Сотрудник|Уровень итога|Период|Заработок:money",
      earnings,
    ),
    table(
      "11. ЗАРПЛАТЫ И ВЫПЛАТЫ",
      "Дата:date|Учётный период:date|Сотрудник|Вид|Категория|Сумма:money|Расчёт|Разрешение исключения|Источник",
      s.payments.map((p) => [
        p.paymentDate,
        p.accountingPeriod,
        p.employeeIdRef.name,
        kindName[p.kindSnapshot] ?? p.paymentCategoryIdRef.name,
        p.paymentCategoryIdRef.name,
        p.amount,
        p.quarterEmployeeSettlementId,
        p.bonusApprovalId,
        p.id,
      ]),
    ),
    table(
      "12. КТУ",
      "Сотрудник|Начало:date|Конец:date|Заработок:money|КТУ:money|Версия",
      s.quarters.map((q) => [
        q.employeeIdRef.name,
        q.periodStart,
        q.periodEnd,
        q.earned,
        q.ktu,
        q.id,
      ]),
    ),
    table(
      "13. КВАРТАЛЬНЫЕ РАСЧЕТЫ",
      "Сотрудник|Начало:date|Конец:date|Заработок:money|КТУ:money|Входящий перенос:money|База:money|Зарплата:money|Разница:money|Премия:money|Перенос:money|Версия|Принят:date|Источник переноса",
      s.quarters.map((q) => [
        q.employeeIdRef.name,
        q.periodStart,
        q.periodEnd,
        q.earned,
        q.ktu,
        q.carryIn,
        d(String(q.earned))
          .plus(String(q.ktu))
          .plus(String(q.carryIn))
          .toFixed(4),
        q.salary,
        q.difference,
        q.bonus,
        q.carryOut,
        q.id,
        s.acceptances.find((a) => a.id === q.id)?.acceptedAt,
        q.carrySourceId,
      ]),
    ),
    table(
      "14. СЕЗОННЫЕ РАСЧЕТЫ",
      "Сотрудник|Заработок:money|КТУ:money|Учтённые выплаты:money|Разница:money|К выплате:money|Округление:money|Версия",
      s.settlements.map((e) => [
        e.employeeIdRef.name,
        e.earned,
        e.ktu,
        e.paid,
        e.outstanding,
        e.finalPayment,
        e.roundingDifference,
        e.id,
      ]),
      "СЕЗОННЫЕ РАСЧЕТЫ СОТРУДНИКОВ",
    ),
    table(
      "15. КОМАНДИРОВКИ",
      "Сотрудник|Проект|Место|Начало:date|Конец:date|Суточные:money|Транспорт:money|Проживание:money|Прочие:money|Наличная часть:money|Безналичная часть:money|Авансы:money|Возмещения:money|Возвращенные средства:money|Остаток к выплате:money|Подотчетный остаток:money|Комиссия:money|Всего затрат:money|Сверка|Источник",
      s.trips.map((t) => {
        const payment = s.tripPayments?.find((p) => p.id === t.id);
        const known = payment?.known;
        const fee = total(
          fees.filter((f) => f.businessTripId === t.id).map((f) => f.amount),
        );
        return [
          t.employeeIdRef.name,
          name(t.projectId),
          t.destination,
          t.startDate,
          t.endDate,
          t.perDiemAmount,
          t.transport,
          t.hotel,
          t.other,
          known ? payment.cashPaid : null,
          known ? payment.bankPaid : null,
          known ? payment.advances : null,
          known ? payment.reimbursements : null,
          known ? payment.returns : null,
          known ? payment.remaining : null,
          known ? payment.accountableAdvance : null,
          fee,
          total([
            payment?.recognized ??
              total([t.perDiemAmount, t.transport, t.hotel, t.other]),
            fee,
          ]),
          (t.voided
            ? "Отменена; исходные компоненты сохранены справочно. "
            : "") +
            (payment?.warning ||
              (known
                ? "По связанным проводкам"
                : "Исторические выплаты не сверены; суммы неизвестны")),
          t.id,
        ];
      }),
    ),
    table(
      "16. НАЛИЧНЫЕ",
      "Счёт|Дата:date|Операция|Приход:money|Расход:money|Остаток:money|Источник",
      balanceRows("CASH"),
    ),
    table(
      "17. ОБНАЛИЧИВАНИЕ",
      "Дата:date|Способ|Источник|Снято:money|Получено:money|Комиссия:money|Факт ставка:rate|Ожидаемая комиссия:money|Разница:money|Назначение|Распределение",
      s.cashouts.map((c) => [
        c.journalTransactionIdRef.postingDate,
        c.cashOutMethodRateIdRef.cashOutMethodIdRef.name,
        c.id,
        c.bankOut,
        c.cashReceived,
        c.actualFee,
        calculateCashOut(
          String(c.bankOut),
          String(c.cashReceived),
          String(c.rateSnapshot),
        ).actualRate,
        c.expectedFee,
        d(String(c.actualFee)).minus(String(c.expectedFee)).toFixed(4),
        c.purpose,
        c.CashOutAllocation_cashOutTransactionId_rows.map(
          (a) => name(a.projectId) + ": " + a.amount,
        ).join("; "),
      ]),
    ),
    table(
      "18. БАНК",
      "Счёт|Дата:date|Операция|Приход:money|Расход:money|Остаток:money|Источник",
      balanceRows("BANK"),
    ),
    table(
      "19. ФИНАНСОВЫЙ ЖУРНАЛ",
      "Дата проводки:date|Учётная дата:date|Счёт|Дебет:money|Кредит:money|Основание|Источник|Сторно записи",
      s.journals.flatMap((j) =>
        j.JournalLine_journalTransactionId_rows.map((l) => [
          j.postingDate,
          j.accountingDate,
          l.ledgerAccountIdRef.name,
          l.debit,
          l.credit,
          j.reason,
          j.id,
          j.reversalOf,
        ]),
      ),
    ),
    table(
      "20. СВЕРКА",
      "Проверка|Результат|Ожидалось:money|Фактически:money|Разница:money|Источник / пояснение",
      [
        ...s.closing.checks.map((c) => [
          c.name,
          c.status,
          null,
          null,
          null,
          s.closing.blockers.filter((b) => b.includes(c.name)).join("; "),
        ]),
        ...s.reconciliations.map((r) => [
          s.balances.find((a) => a.id === r.ledgerAccountId)?.name ??
            r.ledgerAccountId,
          r.resolved ? "Сверено" : "Требует решения",
          r.expected,
          r.actual,
          r.difference,
          r.explanation,
        ]),
        ...s.acceptances.map((a) => [
          "Принятая версия",
          (
            {
              QUARTER: "Квартальный расчёт",
              SEASON: "Сезонный расчёт",
              ALLOCATION: "Распределение партнёров",
            } as Record<string, string>
          )[a.kind],
          null,
          null,
          null,
          a.id,
        ]),
        ...s.expenseReferences.map((r) => [
          "Ручное разделение расхода",
          r.resolved ? "Сверено" : "Требует решения",
          r.expected,
          r.actual,
          r.difference,
          r.reference + "; части: " + r.parts.map((p) => p.id).join("; "),
        ]),
        [
          "Отпечаток утверждения",
          s.approvalFingerprint,
          null,
          null,
          null,
          null,
        ],
      ],
    ),
    table(
      "21. РАЗДЕЛЫ АУДИТА",
      "Проект|Тип проекта|Код раздела|Название раздела|Сотрудники|Плановые часы:money|Фактические часы:money|Фактически заработано:money|Сезон",
      (s.auditSections ?? []).map((section) => [
        section.project,
        section.projectType,
        section.code,
        section.name,
        section.employees,
        section.plannedHours,
        section.actualHours,
        section.earned,
        s.season.name,
      ]),
    ),
  ];
}
export function partnerTables(s: PartnerReport): ReportTable[] {
  const b = s.balance,
    p = s.projects;
  const summary: Cell[][] = [
    ["Начисленный доход", b?.entitlement],
    ["К выплате UZS", b?.payable],
    ["Округление выплаты", b?.roundingDifference],
    ["Действующие выплаты", b?.paid],
    ["Остаток", b?.remaining],
    ["Выплаты без привязки", b?.unallocated],
  ];
  return [
    table("01. СВОДКА", "Показатель|Сумма UZS:money", summary),
    table(
      "02. МОИ ПРОЕКТЫ",
      "Код|Проект|Клиент|Ставка:rate|Доход:money|Прямые:money|Общие:money|Чистый:money|Начислено:money|Источник",
      p.map((p) => [
        p.code,
        p.name,
        p.client,
        p.rate,
        p.revenue,
        p.direct,
        p.allocation?.allocated,
        p.allocation?.net,
        p.allocation?.entitlement,
        p.id,
      ]),
    ),
    table(
      "03. ДОХОДЫ ПО ПРОЕКТАМ",
      "Дата:date|Проект|Сумма:money|Источник",
      s.revenue.map((r) => [
        r.accountingDate,
        p.find((p) => p.id === r.projectId)?.name,
        r.amount,
        r.id,
      ]),
    ),
    table(
      "04. ПРЯМЫЕ РАСХОДЫ",
      "Проект|Труд суммарно:money|Прочие прямые:money|Комиссия:money|Всего:money",
      p.map((p) => [p.name, p.labor, p.other, p.fee, p.direct]),
    ),
    table(
      "05. РАСПРЕДЕЛЕННЫЕ РАСХОДЫ",
      "Проект|ГАД:money|Доля:rate|Распределено:money|Версия",
      p.map((p) => [
        p.name,
        p.allocation?.gad,
        p.allocation?.allocationShare,
        p.allocation?.allocated,
        p.allocation?.allocationRunId,
      ]),
    ),
    table(
      "06. РАСЧЕТ МОЕГО ДОХОДА",
      "Проект|Доход:money|Прямые:money|Общие:money|Чистый:money|Фиксированная ставка:rate|Начислено:money|Версия",
      p.map((p) => [
        p.name,
        p.revenue,
        p.direct,
        p.allocation?.allocated,
        p.allocation?.net,
        p.rate,
        p.allocation?.entitlement,
        p.allocation?.allocationRunId,
      ]),
    ),
    table(
      "07. МОИ ВЫПЛАТЫ",
      "Дата:date|Сумма:money|Версия начисления|Источник",
      s.payments.map((p) => [p.paymentDate, p.amount, p.allocationId, p.id]),
    ),
    table("08. ИТОГ СЕЗОНА", "Показатель|Сумма UZS:money", summary),
  ];
}
