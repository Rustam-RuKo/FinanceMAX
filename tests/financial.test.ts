import { test } from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/domain/calculations.js";
test("actual work and multi-project monthly earnings", () => {
  assert.equal(f.workEarnings("50", "300000"), "15000000.0000");
  assert.equal(
    f.monthlyEarnings(
      [
        { accountingMonth: "2026-01", earned: "15000000" },
        { accountingMonth: "2026-01", earned: "10000000" },
        { accountingMonth: "2026-01", earned: "5000000" },
      ],
      "2026-01",
    ),
    "30000000.0000",
  );
});
test("exact prescribed Q1 and Q2 example", () => {
  const q1 = f.quarterFromEntitlement("40000000", "30000000");
  assert.equal(q1.bonus, "5000000.0000");
  assert.equal(q1.carry, "5000000.0000");
  const q2 = f.calculateEmployeeQuarter("50000000", "60000000", q1.carry);
  assert.equal(q2.ktu, "15000000.0000");
  assert.equal(q2.base, "70000000.0000");
  assert.equal(q2.bonus, "5000000.0000");
  assert.equal(q2.carry, "5000000.0000");
});
test("negative and zero quarter never create debt", () => {
  for (const salary of ["130", "200"]) {
    const q = f.calculateEmployeeQuarter("100", salary);
    assert.equal(q.bonus, "0.0000");
    assert.equal(q.carry, "0.0000");
    assert.equal(q.debt, "0");
  }
});
const payment = (
  kind: f.Compensation["kind"],
  amount: string,
  month = "2026-03",
): f.Compensation => ({
  kind,
  amount,
  accountingMonth: month,
  paymentDate: "2026-04-03",
  relevant: kind !== "REIMBURSEMENT",
});
test("salary accounting month and bonus origin", () => {
  const ps = [
    payment("SALARY", "30"),
    payment("BONUS", "5"),
    payment("REIMBURSEMENT", "20"),
  ];
  assert.equal(f.salaryForPeriod(ps, ["2026-03"]), "30.0000");
  assert.equal(f.salaryForPeriod(ps, ["2026-04"]), "0.0000");
});
test("season no carry double count; reimbursements excluded; full payout", () => {
  const s = f.calculateEmployeeSeason(
    "100",
    ["30"],
    [
      payment("SALARY", "100"),
      payment("BONUS", "12"),
      payment("REIMBURSEMENT", "500"),
    ],
  );
  assert.equal(s.finalPayment, "18");
  assert.equal(s.entitlement, "130.0000");
  assert.equal(
    f.calculateEmployeeSeason(
      "100",
      ["30"],
      [
        payment("SALARY", "100"),
        payment("BONUS", "12"),
        payment("FINAL", "18"),
      ],
    ).finalPayment,
    "0",
  );
});
test("negative season is analytical only", () => {
  const s = f.calculateEmployeeSeason(
    "100",
    ["30"],
    [payment("SALARY", "200")],
  );
  assert.equal(s.outstanding, "-70.0000");
  assert.equal(s.finalPayment, "0");
  assert.equal(s.debt, "0");
});
test("two partners 600/400 allocation and project rates", () => {
  const r = f.calculatePartnerAllocation(
    [
      {
        id: "a",
        partnerId: "A",
        revenue: "700",
        labor: "100",
        otherDirect: "0",
        partnerRate: "0.5",
      },
      {
        id: "b",
        partnerId: "B",
        revenue: "400",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.25",
      },
    ],
    "200",
  );
  assert.equal(r.partners.A, "120.0000");
  assert.equal(r.partners.B, "80.0000");
  assert.equal(r.projects[0].entitlement, "240.0000");
  assert.equal(r.projects[1].entitlement, "80.0000");
});
test("within-partner rates and negative projects", () => {
  const r = f.calculatePartnerAllocation(
    [
      {
        id: "a",
        partnerId: "A",
        revenue: "60",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.5",
      },
      {
        id: "b",
        partnerId: "A",
        revenue: "40",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.25",
      },
      {
        id: "c",
        partnerId: "B",
        revenue: "0",
        labor: "10",
        otherDirect: "0",
        partnerRate: "0.5",
      },
    ],
    "20",
  );
  assert.equal(r.projects[0].entitlement, "24.0000");
  assert.equal(r.projects[1].entitlement, "8.0000");
  assert.equal(r.projects[2].net, "-10.0000");
  assert.equal(r.projects[2].entitlement, "0.0000");
});
test("zero denominator requires manual resolution", () =>
  assert.equal(
    f.calculatePartnerAllocation([], "0").status,
    "Требует ручного решения",
  ));
test("allocation rounding exactly conserves source with stable ties", () => {
  const r = f.allocate("1", [
    { id: "c", weight: "1" },
    { id: "b", weight: "1" },
    { id: "a", weight: "1" },
  ]);
  assert.equal(r.a, "0.3334");
  assert.equal(f.d(r.a).plus(r.b).plus(r.c).toFixed(4), "1.0000");
});
test("cash-out identity and expected versus actual", () => {
  const c = f.calculateCashOut("100000000", "95000000", "0.06");
  assert.equal(c.fee, "5000000.0000");
  assert.equal(
    f.d(c.bankMovement).plus(c.cashMovement).plus(c.fee).toFixed(),
    "0",
  );
  assert.equal(f.expectedWithdrawal("450000", "0.06"), "478723");
  assert.equal(
    f.calculateCashOut("482000", "450000", "0.06").fee,
    "32000.0000",
  );
});
test("fee attribution and cash reconciliation", () => {
  f.validateFeeAllocation("5", ["2", "3"]);
  assert.throws(() => f.validateFeeAllocation("5", ["5", "5"]));
  assert.equal(
    f.reconcileCash("200000000", ["100000000"], ["30000000"], "264000000")
      .difference,
    "-6000000.0000",
  );
});
test("unresolved closing checks block closure", () => {
  assert.equal(
    f.closingChecks([{ name: "Касса", resolved: false }]).canClose,
    false,
  );
  assert.equal(f.closingChecks([]).canClose, false);
});
test("invalid financial inputs are rejected", () => {
  assert.throws(() => f.workEarnings("-1", "100"));
  assert.throws(() => f.expectedWithdrawal("100", "1"));
  assert.throws(() => f.d("NaN"));
  assert.throws(() =>
    f.allocate("1", [
      { id: "a", weight: "1" },
      { id: "a", weight: "1" },
    ]),
  );
});
