import { createHash } from "node:crypto";
import type { Tx } from "./calculation-data";
import { ensure } from "./errors";
import * as f from "../domain/calculations";
export const acceptanceKey = (
  seasonId: string,
  kind: string,
  employeeId = "",
  periodStart = "",
) => [seasonId, kind, employeeId, periodStart].join(":");
export async function accepted(
  tx: Tx,
  seasonId: string,
  kind: string,
  employeeId = "",
  periodStart = "",
) {
  return tx.calculationAcceptance.findUnique({
    where: { key: acceptanceKey(seasonId, kind, employeeId, periodStart) },
  });
}
export async function acceptedIds(
  tx: Tx,
  seasonId: string | undefined,
  kind: string,
) {
  return (
    await tx.calculationAcceptance.findMany({ where: { seasonId, kind } })
  ).map((a) => a.targetId);
}
export async function quarterIsCurrent(
  tx: Tx,
  id: string,
  requireAccepted = true,
): Promise<boolean> {
  const q = await tx.quarterEmployeeSettlement.findUnique({ where: { id } });
  if (!q) return false;
  const season = await tx.season.findUniqueOrThrow({
    where: { id: q.seasonId },
  });
  if (q.sourceRevision !== season.workRevision) return false;
  const choice = await accepted(
    tx,
    q.seasonId,
    "QUARTER",
    q.employeeId,
    q.periodStart.toISOString().slice(0, 10),
  );
  if (requireAccepted && choice?.targetId !== id) return false;
  if (q.periodStart.getTime() === season.startDate.getTime())
    return !q.carrySourceId && q.carryIn.isZero();
  if (!q.carrySourceId) return false;
  const previous = await tx.quarterEmployeeSettlement.findUnique({
    where: { id: q.carrySourceId },
  });
  return (
    !!previous &&
    previous.employeeId === q.employeeId &&
    previous.seasonId === q.seasonId &&
    previous.periodEnd.getTime() + 86400000 === q.periodStart.getTime() &&
    previous.carryOut.eq(q.carryIn) &&
    (await quarterIsCurrent(tx, previous.id))
  );
}
export async function seasonIsCurrent(tx: Tx, id: string): Promise<boolean> {
  const s = await tx.seasonEmployeeSettlement.findUnique({ where: { id } });
  if (!s) return false;
  const season = await tx.season.findUniqueOrThrow({
    where: { id: s.seasonId },
  });
  if (s.sourceRevision !== season.compensationRevision) return false;
  const sources = await tx.settlementSource.findMany({
    where: { settlementId: id, sourceType: "QUARTER" },
  });
  const quarters = await tx.quarterEmployeeSettlement.findMany({
    where: { id: { in: sources.map((r) => r.sourceId) } },
    orderBy: { periodStart: "asc" },
  });
  return (
    quarters.length > 0 &&
    quarters[0].periodStart.getTime() === season.startDate.getTime() &&
    quarters.at(-1)!.periodEnd.getTime() === season.endDate.getTime() &&
    (await Promise.all(quarters.map((q) => quarterIsCurrent(tx, q.id)))).every(
      Boolean,
    )
  );
}
export async function approvalFingerprint(tx: Tx, seasonId: string) {
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } });
  const versions = await tx.calculationAcceptance.findMany({
    where: { seasonId },
    orderBy: { key: "asc" },
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        revision: season.revision,
        versions: versions.map((v) => [
          v.key,
          v.targetId,
          v.updatedAt.toISOString(),
        ]),
      }),
    )
    .digest("hex");
}
export async function partnerBalances(tx: Tx, seasonId: string) {
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } });
  const chosen = await accepted(tx, seasonId, "ALLOCATION");
  const run = chosen
    ? await tx.allocationRun.findUnique({ where: { id: chosen.targetId } })
    : null;
  const rows = run
    ? await tx.projectAllocation.findMany({
        where: { allocationRunId: run.id },
        include: { projectIdRef: { include: { partnerIdRef: true } } },
      })
    : [];
  const payments = await tx.partnerPayment.findMany({
    where: {
      seasonId,
      journalTransactionIdRef: {
        status: "POSTED",
        reversalOf: null,
        JournalTransaction_reversalOf_rows: { none: {} },
      },
    },
    include: { attribution: true, partnerIdRef: true },
  });
  const partners = new Map(
    rows.map((r) => [
      r.projectIdRef.partnerId,
      r.projectIdRef.partnerIdRef.name,
    ]),
  );
  payments.forEach((p) => partners.set(p.partnerId, p.partnerIdRef.name));
  const balances = [...partners].map(([partnerId, name]) => {
    const entitlement = rows
      .filter((r) => r.projectIdRef.partnerId === partnerId)
      .reduce((s, r) => s.plus(r.entitlement.toString()), f.d("0"));
    const payable = f.d(f.payable(entitlement.toFixed()));
    const own = payments.filter((p) => p.partnerId === partnerId);
    const valid = own.filter((p) => p.attribution?.allocationRunId === run?.id);
    const paid = valid.reduce((s, p) => s.plus(p.amount.toString()), f.d("0"));
    const unallocated = own
      .filter((p) => p.attribution?.allocationRunId !== run?.id)
      .reduce((s, p) => s.plus(p.amount.toString()), f.d("0"));
    return {
      partnerId,
      name,
      entitlement: entitlement.toFixed(4),
      payable: payable.toFixed(4),
      roundingDifference: payable.minus(entitlement).toFixed(4),
      paid: paid.toFixed(4),
      remaining: payable.minus(paid).toFixed(4),
      unallocated: unallocated.toFixed(4),
    };
  });
  const blockers: string[] = [];
  if (
    !run ||
    run.sourceRevision !== season.economicRevision ||
    !["Рассчитано", "Ручное распределение"].includes(run.status)
  )
    blockers.push("Нет принятого актуального распределения партнеров");
  for (const p of balances) {
    if (f.d(p.remaining).gt(0))
      blockers.push(`Партнер ${p.name}: не выплачено ${p.remaining} UZS`);
    if (f.d(p.remaining).lt(0))
      blockers.push(
        `Партнер ${p.name}: необъясненная переплата ${f.d(p.remaining).negated().toFixed(4)} UZS`,
      );
    if (f.d(p.unallocated).gt(0))
      blockers.push(
        `Партнер ${p.name}: ${p.unallocated} UZS не отнесено к принятому начислению`,
      );
  }
  return { run, balances, blockers };
}
export async function requireCurrentAllocation(tx: Tx, seasonId: string) {
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } }),
    choice = await accepted(tx, seasonId, "ALLOCATION");
  const run = choice
    ? await tx.allocationRun.findUnique({ where: { id: choice.targetId } })
    : null;
  ensure(
    run &&
      run.sourceRevision === season.economicRevision &&
      ["Рассчитано", "Ручное распределение"].includes(run.status),
    "Примите актуальное распределение партнеров",
    409,
  );
  return run;
}

export async function currentProjectAllocation(
  tx: Tx,
  seasonId: string,
  projectId: string,
) {
  const choice = await accepted(tx, seasonId, "ALLOCATION");
  if (!choice) return null;
  const season = await tx.season.findUniqueOrThrow({ where: { id: seasonId } });
  return tx.projectAllocation.findFirst({
    where: {
      projectId,
      allocationRunId: choice.targetId,
      allocationRunIdRef: {
        sourceRevision: season.economicRevision,
        status: { in: ["Рассчитано", "Ручное распределение"] },
      },
    },
  });
}
