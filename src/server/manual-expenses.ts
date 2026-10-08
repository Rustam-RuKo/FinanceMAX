import type { Tx } from "./calculation-data";
import { d } from "../domain/calculations";
import { ensure } from "./errors";
export async function lockExpenseReference(
  tx: Tx,
  reference: string,
  seasonId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"expense-reference:" + reference}))`;
  const linked = await tx.expense.findMany({
    where: { allocationReference: reference, voided: false },
    include: { seasonIdRef: true },
  });
  ensure(
    !linked.some((e) => e.seasonIdRef.status === "Закрыт"),
    "Ссылка расхода относится к закрытому сезону. Требуется управленческое повторное открытие связанных сезонов",
    409,
  );
  const ids = [
    ...new Set(linked.map((e) => e.seasonId).filter((id) => id !== seasonId)),
  ];
  if (ids.length)
    await tx.season.updateMany({
      where: { id: { in: ids } },
      data: { revision: { increment: 1 } },
    });
  return linked;
}
export async function expenseReferenceChecks(tx: Tx, seasonId: string) {
  const own = await tx.expense.findMany({
    where: { seasonId, voided: false, allocationReference: { not: null } },
    select: { allocationReference: true },
  });
  const checks = [];
  for (const reference of [
    ...new Set(own.map((e) => e.allocationReference!)),
  ].sort()) {
    const parts = await tx.expense.findMany({
      where: { allocationReference: reference, voided: false },
      orderBy: { id: "asc" },
    });
    const expected = parts[0]?.allocationOriginalTotal?.toString() ?? "0";
    const actual = parts
      .reduce((s, p) => s.plus(p.amount.toString()), d("0"))
      .toFixed(4);
    checks.push({
      reference,
      expected,
      actual,
      difference: d(actual).minus(expected).toFixed(4),
      resolved:
        parts.every((p) => p.allocationOriginalTotal?.eq(expected)) &&
        d(actual).eq(expected),
      parts: parts.map((p) => ({
        id: p.id,
        seasonId: p.seasonId,
        amount: p.amount.toString(),
        explanation: p.comment,
      })),
    });
  }
  return checks;
}
