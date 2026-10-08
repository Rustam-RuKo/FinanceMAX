import { Decimal } from "decimal.js";
Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export type Amount = string;
export const d = (v: Amount): Decimal => {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error("Некорректное число");
  const n = new Decimal(v);
  if (!n.isFinite()) throw new Error("Некорректное число");
  return n;
};
const nonnegative = (v: Amount) => {
  const n = d(v);
  if (n.isNegative()) throw new Error("Значение не может быть отрицательным");
  return n;
};
const sum = (values: Amount[]) => values.reduce((a, b) => a.plus(d(b)), d("0"));
export const payable = (v: Amount) => d(v).toDecimalPlaces(0).toFixed(0);
export const workEarnings = (hours: Amount, rateSnapshot: Amount) =>
  nonnegative(hours).times(nonnegative(rateSnapshot)).toFixed(4);
export const monthlyEarnings = (
  entries: { accountingMonth: string; earned: Amount }[],
  month: string,
) =>
  sum(
    entries.filter((e) => e.accountingMonth === month).map((e) => e.earned),
  ).toFixed(4);
export function quarterFromEntitlement(
  entitlement: Amount,
  salary: Amount,
  carry: Amount = "0",
) {
  const base = nonnegative(entitlement).plus(nonnegative(carry));
  const difference = base.minus(nonnegative(salary));
  const positive = Decimal.max(difference, 0);
  const bonus = positive.div(2).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return {
    base: base.toFixed(4),
    difference: difference.toFixed(4),
    bonus: bonus.toFixed(4),
    carry: positive.minus(bonus).toFixed(4),
    debt: "0",
  };
}
export function calculateEmployeeQuarter(
  earned: Amount,
  salary: Amount,
  carry: Amount = "0",
) {
  const ktu = nonnegative(earned).times("0.30");
  return {
    earned,
    ktu: ktu.toFixed(4),
    ...quarterFromEntitlement(d(earned).plus(ktu).toFixed(4), salary, carry),
  };
}
export interface Compensation {
  kind: "SALARY" | "BONUS" | "OTHER" | "REIMBURSEMENT" | "FINAL";
  amount: Amount;
  accountingMonth: string;
  paymentDate: string;
  relevant: boolean;
  settlementId?: string;
}
export function compensationEligible(kind: string, relevant: boolean) {
  return (
    kind !== "REIMBURSEMENT" &&
    (["SALARY", "BONUS", "FINAL"].includes(kind) || relevant)
  );
}
export function salaryForPeriod(payments: Compensation[], months: string[]) {
  return sum(
    payments
      .filter((p) => p.kind === "SALARY" && months.includes(p.accountingMonth))
      .map((p) => p.amount),
  ).toFixed(4);
}
export function calculateEmployeeSeason(
  earned: Amount,
  quarterKtu: Amount[],
  payments: Compensation[],
) {
  const entitlement = nonnegative(earned).plus(sum(quarterKtu));
  const paid = sum(
    payments
      .filter((p) => compensationEligible(p.kind, p.relevant))
      .map((p) => p.amount),
  );
  const outstanding = entitlement.minus(paid);
  return {
    entitlement: entitlement.toFixed(4),
    paid: paid.toFixed(4),
    outstanding: outstanding.toFixed(4),
    finalPayment: payable(Decimal.max(outstanding, 0).toFixed()),
    roundingDifference: d(payable(Decimal.max(outstanding, 0).toFixed()))
      .minus(Decimal.max(outstanding, 0))
      .toFixed(4),
    debt: "0",
    refund: "0",
  };
}
export function allocate(
  pool: Amount,
  weights: { id: string; weight: Amount }[],
): Record<string, Amount> {
  const total = nonnegative(pool);
  if (total.decimalPlaces() > 4)
    throw new Error("Точность суммы превышает 4 знака");
  if (new Set(weights.map((w) => w.id)).size !== weights.length)
    throw new Error("Повторный идентификатор");
  const denominator = sum(weights.map((w) => nonnegative(w.weight).toFixed()));
  if (denominator.isZero()) throw new Error("Требует ручного решения");
  const units = total.times(10000);
  const rows = weights.map((w) => {
    const exact = units.times(d(w.weight)).div(denominator);
    return {
      id: w.id,
      units: exact.floor(),
      fraction: exact.minus(exact.floor()),
    };
  });
  let remaining = units.minus(rows.reduce((a, r) => a.plus(r.units), d("0")));
  rows.sort(
    (a, b) =>
      b.fraction.comparedTo(a.fraction) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const row of rows) {
    if (remaining.gt(0)) {
      row.units = row.units.plus(1);
      remaining = remaining.minus(1);
    }
  }
  return Object.fromEntries(
    rows.map((r) => [r.id, r.units.div(10000).toFixed(4)]),
  );
}
export interface ProjectEconomics {
  id: string;
  partnerId: string;
  revenue: Amount;
  labor: Amount;
  otherDirect: Amount;
  partnerRate: Amount;
}
export function calculatePartnerAllocation(
  projects: ProjectEconomics[],
  generalPool: Amount,
) {
  if (new Set(projects.map((p) => p.id)).size !== projects.length)
    throw new Error("Повторный проект");
  const rows = projects.map((p) => {
    const rate = nonnegative(p.partnerRate);
    if (rate.gt(1)) throw new Error("Ставка должна быть от 0 до 1");
    const gad = d(
      calculateProjectGrossAfterDirect(p.revenue, p.labor, p.otherDirect),
    );
    return {
      ...p,
      gad: gad.toFixed(4),
      weight: Decimal.max(gad, 0).toFixed(4),
    };
  });
  const partnerIds = [...new Set(rows.map((r) => r.partnerId))].sort();
  const partnerWeights = partnerIds.map((id) => ({
    id,
    weight: sum(
      rows.filter((r) => r.partnerId === id).map((r) => r.weight),
    ).toFixed(4),
  }));
  if (sum(partnerWeights.map((p) => p.weight)).isZero())
    return {
      status: "Требует ручного решения" as const,
      projects: rows.map((r) => ({
        ...r,
        allocated: "0.0000",
        net: r.gad,
        entitlement: "0.0000",
        unresolved: true,
      })),
      partners: {} as Record<string, Amount>,
    };
  const partners = allocate(generalPool, partnerWeights);
  const allocations: Record<string, string> = {};
  for (const partner of partnerWeights) {
    const own = rows.filter((r) => r.partnerId === partner.id);
    Object.assign(
      allocations,
      d(partner.weight).isZero()
        ? Object.fromEntries(own.map((r) => [r.id, "0.0000"]))
        : allocate(
            partners[partner.id],
            own.map((r) => ({ id: r.id, weight: r.weight })),
          ),
    );
  }
  return {
    status: "Рассчитано" as const,
    partners,
    projects: rows.map((r) => {
      const net = d(r.gad).minus(allocations[r.id]);
      return {
        ...r,
        allocated: allocations[r.id],
        net: net.toFixed(4),
        entitlement: calculateProjectPartnerEntitlement(
          net.toFixed(4),
          r.partnerRate,
        ),
      };
    }),
  };
}
export function calculateCashOut(
  bank: Amount,
  cash: Amount,
  rateSnapshot: Amount,
) {
  const b = nonnegative(bank),
    c = nonnegative(cash),
    rate = nonnegative(rateSnapshot);
  if (b.isZero() || c.gt(b) || rate.gte(1))
    throw new Error("Некорректные параметры обналичивания");
  const fee = b.minus(c);
  return {
    bankMovement: b.negated().toFixed(4),
    cashMovement: c.toFixed(4),
    fee: fee.toFixed(4),
    actualRate: fee.div(b).toFixed(12),
    expectedCash: b.times(d("1").minus(rate)).toFixed(4),
    expectedFee: b.times(rate).toFixed(4),
  };
}
export function expectedWithdrawal(cash: Amount, rate: Amount) {
  const r = nonnegative(rate);
  if (r.gte(1)) throw new Error("Ставка должна быть меньше 100%");
  return payable(nonnegative(cash).div(d("1").minus(r)).toFixed());
}
export function validateFeeAllocation(fee: Amount, lines: Amount[]) {
  if (!sum(lines.map((x) => nonnegative(x).toFixed())).eq(nonnegative(fee)))
    throw new Error("Распределение не совпадает с расходом");
}
export function reconcileCash(
  opening: Amount,
  inflows: Amount[],
  outflows: Amount[],
  actual: Amount,
) {
  const expected = d(opening).plus(sum(inflows)).minus(sum(outflows));
  return {
    expected: expected.toFixed(4),
    actual: nonnegative(actual).toFixed(4),
    difference: d(actual).minus(expected).toFixed(4),
  };
}
export function closingChecks(checks: { name: string; resolved: boolean }[]) {
  return {
    canClose: checks.length > 0 && checks.every((c) => c.resolved),
    blockers: checks.filter((c) => !c.resolved).map((c) => c.name),
  };
}

// Public canonical service names; compatibility exports above retain existing callers.
export const calculateWorkEntryEarnings = workEarnings;
export const calculateEmployeeMonthlyEarnings = monthlyEarnings;
export const calculateEmployeeQuarterSettlement = calculateEmployeeQuarter;
export const calculateEmployeeSeasonSettlement = calculateEmployeeSeason;
export function calculateProjectGrossAfterDirect(
  revenue: Amount,
  labor: Amount,
  otherDirect: Amount,
) {
  return nonnegative(revenue)
    .minus(nonnegative(labor))
    .minus(nonnegative(otherDirect))
    .toFixed(4);
}
export function calculateProjectPartnerEntitlement(net: Amount, rate: Amount) {
  const r = nonnegative(rate);
  if (r.gt(1)) throw new Error("Ставка должна быть от 0 до 1");
  return Decimal.max(d(net), 0).times(r).toFixed(4);
}
export function calculatePartnerSeasonSettlement(
  entitlements: Amount[],
  payments: Amount[],
) {
  const earned = sum(entitlements),
    paid = sum(payments);
  return {
    earned: earned.toFixed(4),
    paid: paid.toFixed(4),
    remaining: earned.minus(paid).toFixed(4),
    payable: payable(Decimal.max(earned.minus(paid), 0).toFixed()),
  };
}
export function calculateCashBalance(
  lines: { debit: Amount; credit: Amount }[],
) {
  return lines
    .reduce(
      (a, l) => a.plus(nonnegative(l.debit)).minus(nonnegative(l.credit)),
      d("0"),
    )
    .toFixed(4);
}
export function calculateSeasonSummary(input: {
  revenues: Amount[];
  labor: Amount[];
  direct: Amount[];
  general: Amount[];
  cashOutFees: Amount[];
  directCashOutFees?: Amount[];
  generalCashOutFees?: Amount[];
  compensation: Amount[];
  partnerPayments: Amount[];
}) {
  const revenue = sum(input.revenues),
    labor = sum(input.labor),
    direct = sum(input.direct).plus(sum(input.directCashOutFees ?? [])),
    general = sum(input.general).plus(sum(input.generalCashOutFees ?? [])),
    fees = sum(input.cashOutFees);
  return {
    revenue: revenue.toFixed(4),
    labor: labor.toFixed(4),
    direct: direct.plus(labor).toFixed(4),
    general: general.toFixed(4),
    cashOutFees: fees.toFixed(4),
    economicResult: revenue
      .minus(labor)
      .minus(direct)
      .minus(general)
      .minus(input.directCashOutFees || input.generalCashOutFees ? 0 : fees)
      .toFixed(4),
    compensationPaid: sum(input.compensation).toFixed(4),
    partnerPaid: sum(input.partnerPayments).toFixed(4),
  };
}
export const requiredClosingChecks = [
  "Проекты",
  "Доходы",
  "Расходы",
  "Рабочее время",
  "Расчеты сотрудников",
  "Расчеты партнеров",
  "Командировки",
  "Банк",
  "Наличные",
  "Обналичивание",
  "Сверка кассы",
  "Необъясненные расхождения",
] as const;
export function calculateSeasonClosingReadiness(
  checks: { name: string; resolved: boolean; blocking?: boolean }[],
) {
  const rows = requiredClosingChecks.map((name) => {
    const check = checks.find((c) => c.name === name);
    return {
      name,
      resolved: check?.resolved ?? false,
      status: check?.resolved
        ? "Готово"
        : check?.blocking === false
          ? "Требует внимания"
          : "Блокирует закрытие",
    };
  });
  return { ...closingChecks(rows), checks: rows };
}
