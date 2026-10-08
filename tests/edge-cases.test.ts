import { test } from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/domain/calculations.js";
test("negative quarter followed by positive quarter carries no employee debt", () => {
  const first = f.quarterFromEntitlement("20000000", "30000000");
  assert.equal(first.difference, "-10000000.0000");
  const next = f.quarterFromEntitlement("40000000", "30000000", first.carry);
  assert.equal(next.bonus, "5000000.0000");
  assert.equal(next.carry, "5000000.0000");
});
test("two-stage allocation with mixed signs conserves four-decimal pool", () => {
  const result = f.calculatePartnerAllocation(
    [
      {
        id: "a",
        partnerId: "A",
        revenue: "1",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.3",
      },
      {
        id: "b",
        partnerId: "A",
        revenue: "2",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.4",
      },
      {
        id: "c",
        partnerId: "B",
        revenue: "2",
        labor: "0",
        otherDirect: "0",
        partnerRate: "0.6",
      },
      {
        id: "d",
        partnerId: "B",
        revenue: "0",
        labor: "1",
        otherDirect: "0",
        partnerRate: "0.6",
      },
    ],
    "0.0007",
  );
  assert.equal(
    result.projects.reduce((s, p) => s.plus(p.allocated), f.d("0")).toFixed(4),
    "0.0007",
  );
  assert.equal(result.projects.find((p) => p.id === "d")?.allocated, "0.0000");
});
test("partner entitlement does not imply cash payment; excess paid is analytical", () => {
  const p = f.calculatePartnerSeasonSettlement(["100"], ["120"]);
  assert.equal(p.remaining, "-20.0000");
  assert.equal(p.payable, "0");
  assert.equal(
    f.calculatePartnerSeasonSettlement(["100"], []).remaining,
    "100.0000",
  );
});
test("cash balance uses journal entries including reversals", () => {
  assert.equal(
    f.calculateCashBalance([
      { debit: "100", credit: "0" },
      { debit: "0", credit: "20" },
      { debit: "20", credit: "0" },
    ]),
    "100.0000",
  );
});
test("season summary separates labor economics from payroll cash flow", () => {
  const s = f.calculateSeasonSummary({
    revenues: ["100"],
    labor: ["20"],
    direct: ["10"],
    general: ["5"],
    cashOutFees: ["2"],
    compensation: ["50"],
    partnerPayments: ["8"],
  });
  assert.equal(s.economicResult, "63.0000");
  assert.equal(s.compensationPaid, "50.0000");
  assert.equal(s.direct, "30.0000");
});
test("complete readiness requires every named section", () => {
  assert.equal(
    f.calculateSeasonClosingReadiness([{ name: "Банк", resolved: true }])
      .canClose,
    false,
  );
  assert.equal(
    f.calculateSeasonClosingReadiness(
      f.requiredClosingChecks.map((name) => ({ name, resolved: true })),
    ).canClose,
    true,
  );
});
test("final payments use half-up instead of truncation", () => {
  assert.equal(f.payable("478723.5"), "478724");
  assert.equal(f.payable("478723.404255"), "478723");
});
test("allocation result is deterministic regardless of input ordering", () => {
  const weights = [
    { id: "c", weight: "1" },
    { id: "a", weight: "1" },
    { id: "b", weight: "1" },
  ];
  assert.deepEqual(
    f.allocate("0.0002", weights),
    f.allocate("0.0002", [...weights].reverse()),
  );
});
