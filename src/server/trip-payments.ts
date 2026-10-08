import { createHash } from "node:crypto";
import { d } from "../domain/calculations";
import type { Tx } from "./calculation-data";
import { ensure } from "./errors";

export const tripPaymentKinds = {
  ADVANCE: "Аванс",
  PAYMENT: "Оплата",
  REIMBURSEMENT: "Возмещение после поездки",
  SETTLEMENT: "Дополнительная выплата",
  RETURN: "Возврат аванса",
} as const;

/** Single source for the card, closing checks and spreadsheet. Amounts come from journal lines. */
export async function tripPaymentSummary(tx: Tx, tripId: string, cutoff: Date) {
  const trip = await tx.businessTrip.findUniqueOrThrow({
    where: { id: tripId },
    include: {
      employeeIdRef: true,
      projectIdRef: true,
      Expense_businessTripId_rows: {
        where: { voided: false, accountingDate: { lte: cutoff } },
      },
      paymentLinks: {
        orderBy: { id: "asc" },
        include: {
          cashOut: {
            include: {
              journalTransactionIdRef: {
                include: { JournalTransaction_reversalOf_rows: true },
              },
            },
          },
          journal: {
            include: {
              JournalTransaction_reversalOf_rows: true,
              JournalLine_journalTransactionId_rows: {
                include: { ledgerAccountIdRef: true },
              },
            },
          },
        },
      },
      paymentReviews: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  const amounts = {
    cashPaid: d("0"),
    bankPaid: d("0"),
    advances: d("0"),
    payments: d("0"),
    reimbursements: d("0"),
    additionalPayments: d("0"),
    returns: d("0"),
  };
  const operations = trip.paymentLinks.map((link) => {
    const j = link.journal;
    const line = j.JournalLine_journalTransactionId_rows.find((l) =>
      ["BANK", "CASH"].includes(l.ledgerAccountIdRef.kind),
    );
    ensure(
      line,
      "У связанной выплаты отсутствует банковская или кассовая проводка",
      409,
    );
    const returned = link.kind === "RETURN";
    const amount = d((returned ? line.debit : line.credit).toString());
    const active =
      j.status === "POSTED" &&
      !j.reversalOf &&
      j.postingDate <= cutoff &&
      !j.JournalTransaction_reversalOf_rows.some(
        (r) => r.status === "POSTED" && r.postingDate <= cutoff,
      );
    if (active) {
      if (returned) amounts.returns = amounts.returns.plus(amount);
      else {
        const source =
          line.ledgerAccountIdRef.kind === "CASH" ? "cashPaid" : "bankPaid";
        amounts[source] = amounts[source].plus(amount);
        const kind = {
          ADVANCE: "advances",
          PAYMENT: "payments",
          REIMBURSEMENT: "reimbursements",
          SETTLEMENT: "additionalPayments",
        } as const;
        const key = kind[link.kind as keyof typeof kind];
        ensure(key, "Неизвестный вид выплаты командировки", 409);
        amounts[key] = amounts[key].plus(amount);
      }
    }
    const sourceInvalid =
      !!link.cashOut &&
      (link.cashOut.journalTransactionIdRef.status !== "POSTED" ||
        link.cashOut.journalTransactionIdRef.JournalTransaction_reversalOf_rows.some(
          (r) => r.postingDate <= cutoff,
        ));
    return {
      id: link.id,
      seasonId: trip.seasonId,
      journalTransactionId: j.id,
      date: j.postingDate,
      accountingDate: j.accountingDate,
      amount: amount.toFixed(4),
      kind: tripPaymentKinds[link.kind as keyof typeof tripPaymentKinds],
      source: line.ledgerAccountIdRef.kind === "CASH" ? "Наличные" : "Банк",
      account: line.ledgerAccountIdRef.name,
      status: active ? "Действует" : "Отменено или вне даты отчета",
      cashOutTransactionId: link.cashOutTransactionId,
      sourceInvalid: active && sourceInvalid,
      reason: link.reason,
      document: link.document,
      updatedAt: link.updatedAt,
    };
  });
  const recognized = trip.Expense_businessTripId_rows.reduce(
    (a, e) => a.plus(e.amount),
    d("0"),
  );
  const net = amounts.cashPaid.plus(amounts.bankPaid).minus(amounts.returns);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ tripId, recognized: recognized.toFixed(4), operations }),
    )
    .digest("hex");
  const known =
    trip.paymentTrackingStarted ||
    trip.paymentReviews[0]?.fingerprint === fingerprint;
  const remaining = d(recognized.toString()).minus(net);
  const warning = !known
    ? "Исторические выплаты не сверены. Отсутствие связей не означает нулевую оплату"
    : operations.some((o) => o.sourceInvalid)
      ? "Источник наличных отменен. Требуется повторная сверка"
      : net.lt(0)
        ? "Возврат превышает связанные выдачи. Требуется решение руководства"
        : "";
  return {
    id: trip.id,
    seasonId: trip.seasonId,
    employee: trip.employeeIdRef.name,
    project: trip.projectIdRef?.name ?? "Общие расходы",
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    perDiemAmount: trip.perDiemAmount.toFixed(4),
    transport: trip.transport.toFixed(4),
    hotel: trip.hotel.toFixed(4),
    other: trip.other.toFixed(4),
    recognized: recognized.toFixed(4),
    ...(Object.fromEntries(
      Object.entries(amounts).map(([k, v]) => [k, v.toFixed(4)]),
    ) as Record<keyof typeof amounts, string>),
    netPaid: net.toFixed(4),
    remaining: remaining.gt(0) ? remaining.toFixed(4) : "0.0000",
    accountableAdvance: remaining.lt(0)
      ? remaining.negated().toFixed(4)
      : "0.0000",
    known,
    warning,
    fingerprint,
    operations,
  };
}
export async function seasonTripPayments(
  tx: Tx,
  seasonId: string,
  cutoff: Date,
) {
  const trips = await tx.businessTrip.findMany({
    where: {
      seasonId,
      OR: [{ voided: false }, { paymentLinks: { some: {} } }],
    },
    orderBy: { id: "asc" },
  });
  return Promise.all(trips.map((t) => tripPaymentSummary(tx, t.id, cutoff)));
}

/** Validates explicit attribution; it never guesses a match and never writes a journal. */
export async function linkTripPayment(
  tx: Tx,
  userId: string,
  p: {
    seasonId: string;
    businessTripId: string;
    journalTransactionId: string;
    kind: string;
    cashOutTransactionId?: string;
    reason: string;
    document?: string;
  },
) {
  const trip = await tx.businessTrip.findUniqueOrThrow({
    where: { id: p.businessTripId },
  });
  ensure(
    !trip.voided && trip.seasonId === p.seasonId,
    "Командировка отменена или относится к другому сезону",
  );
  const journal = await tx.journalTransaction.findUniqueOrThrow({
    where: { id: p.journalTransactionId },
    include: {
      EmployeePayment_journalTransactionId_rows: true,
      JournalTransaction_reversalOf_rows: true,
      JournalLine_journalTransactionId_rows: {
        include: { ledgerAccountIdRef: true },
      },
    },
  });
  ensure(
    journal.seasonId === trip.seasonId &&
      journal.employeeId === trip.employeeId,
    "Выплата относится к другому сотруднику или сезону",
  );
  ensure(
    journal.status === "POSTED" &&
      !journal.reversalOf &&
      !journal.JournalTransaction_reversalOf_rows.length,
    "Связывать можно только действующую проведенную выплату",
  );
  const historical = journal.EmployeePayment_journalTransactionId_rows;
  if (["TRIP_PAYMENT", "TRIP_RETURN"].includes(journal.operation))
    ensure(
      journal.projectId === trip.projectId,
      "Проект исходной проводки отличается. Требуется сторно и новая выплата",
    );
  ensure(
    ["TRIP_PAYMENT", "TRIP_RETURN"].includes(journal.operation) ||
      (historical.length === 1 &&
        historical[0].kindSnapshot === "REIMBURSEMENT"),
    "Допустимо только возмещение или выплата командировки; зарплата и переводы не подходят",
  );
  if (historical.length)
    ensure(
      p.kind === "REIMBURSEMENT",
      "Историческое возмещение сохраняет исходный вид выплаты",
    );
  ensure(
    (journal.operation === "TRIP_RETURN") === (p.kind === "RETURN"),
    "Вид выплаты не соответствует направлению проводки",
  );
  const lines = journal.JournalLine_journalTransactionId_rows.filter((l) =>
    ["CASH", "BANK"].includes(l.ledgerAccountIdRef.kind),
  );
  ensure(
    lines.length === 1,
    "Платеж должен иметь ровно один банковский или кассовый счет",
  );
  const line = lines[0];
  ensure(
    p.kind === "RETURN"
      ? line.debit.gt(0) && line.credit.isZero()
      : line.credit.gt(0) && line.debit.isZero(),
    "Направление суммы выплаты неверно",
  );
  if (p.cashOutTransactionId) {
    const source = await tx.cashOutTransaction.findUniqueOrThrow({
      where: { id: p.cashOutTransactionId },
      include: {
        journalTransactionIdRef: {
          include: { JournalTransaction_reversalOf_rows: true },
        },
        tripPayments: {
          where: { journalTransactionId: { not: journal.id } },
          include: {
            journal: {
              include: {
                JournalTransaction_reversalOf_rows: true,
                JournalLine_journalTransactionId_rows: true,
              },
            },
          },
        },
      },
    });
    ensure(
      p.kind !== "RETURN" &&
        source.seasonId === p.seasonId &&
        source.cashAccountId === line.ledgerAccountId &&
        source.journalTransactionIdRef.postingDate <= journal.postingDate &&
        !source.journalTransactionIdRef.JournalTransaction_reversalOf_rows
          .length,
      "Источник обналичивания не соответствует кассе, дате, сезону или направлению выплаты",
    );
    // Check every date, including historical intervals before later reversals.
    const movements = new Map<number, ReturnType<typeof d>>();
    const add = (at: Date, value: ReturnType<typeof d>) =>
      movements.set(
        at.getTime(),
        (movements.get(at.getTime()) ?? d("0")).plus(value),
      );
    for (const link of source.tripPayments) {
      const j = link.journal;
      if (j.status !== "POSTED") continue;
      const amount = d(
        (
          j.JournalLine_journalTransactionId_rows.find(
            (r) => r.ledgerAccountId === source.cashAccountId,
          )?.credit ?? 0
        ).toString(),
      );
      add(j.postingDate, amount);
      for (const reversal of j.JournalTransaction_reversalOf_rows)
        if (reversal.status === "POSTED")
          add(reversal.postingDate, amount.negated());
    }
    add(journal.postingDate, d(line.credit.toString()));
    let used = d("0");
    for (const [, amount] of [...movements.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      used = used.plus(amount);
      ensure(
        used.gte(0) && used.lte(source.cashReceived),
        "Выдачи превышают наличные, полученные из указанного обналичивания, на одну из дат учета",
      );
    }
  }
  const data = {
    seasonId: p.seasonId,
    businessTripId: p.businessTripId,
    journalTransactionId: p.journalTransactionId,
    kind: p.kind,
    reason: p.reason,
    document: p.document || null,
    cashOutTransactionId: p.cashOutTransactionId || null,
  };
  return tx.tripPaymentLink.upsert({
    where: { journalTransactionId: journal.id },
    create: { ...data, createdBy: userId },
    update: data,
  });
}
