"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { AuditForm } from "./AuditForms";
import { UserManagement } from './UserManagement';
import { ManagementDashboard } from "./ManagementDashboard";
import { ReportDownload } from "./ReportDownload";
import type { Principal } from "../domain/authorization";
import { forms, navigation, staticOptions, type FormSpec } from "./forms";
type Row = Record<string, unknown>;
type Data = { items?: Row[]; hasMore?: boolean; [key: string]: unknown };
type Option = { id: string; name: string; kind?: string };
const partnerBalanceLabels: Record<string, string> = {
  entitlement: "Точное начисление",
  payable: "Утвержденная сумма к выплате",
  paid: "Фактически выплачено",
  remaining: "Остаток к выплате",
  roundingDifference: "Разница округления",
};
const isPartnerBalance = (row: Row) =>
  "entitlement" in row && "roundingDifference" in row;
const labels: Record<string, string> = {
  active: "Активен",
  projectType: "Тип проекта",
  partner: "Партнер",
  sectionCode: "Код раздела",
  sectionName: "Раздел аудита",
  progress: "Состояние раздела",
  assignedPlannedHours: "План назначения",
  employees: "Сотрудники",
  sections: "Разделы",
  month: "Месяц",
  level: "Уровень сложности",
  sortOrder: "Порядок",
  journalTransactionId: "Финансовая операция",
  employee: "Сотрудник",
  kind: "Вид операции",
  recognized: "Утвержденная стоимость",
  advances: "Выданный аванс",
  cashPaid: "Выплачено наличными",
  bankPaid: "Выплачено через банк",
  reimbursements: "Возмещено после поездки",
  additionalPayments: "Дополнительные выплаты",
  returns: "Возвращенный остаток аванса",
  remaining: "Остаток к выплате",
  accountableAdvance: "Подотчетный остаток (не зарплатный долг)",
  netPaid: "Выдано за вычетом возвратов",
  warning: "Предупреждение сверки",
  document: "Подтверждающий документ",
  account: "Денежный счет",
  source: "Способ оплаты",
  cashOutTransactionId: "Источник обналичивания",
  correctionStatus: "Состояние записи",
  sourceStatus: "Актуальность",
  season: "Сезон",
  partnerRate: "Фиксированная ставка партнера",
  allocationRunId: "Версия распределения",
  bonusApprovalId: "Одобрение исключения",
  originalSettlementId: "Исходный квартальный расчет",
  currentSettlementId: "Текущий квартальный расчет",
  approvedBonus: "Одобренный бонус",
  requestedPayment: "Запрошенная выплата",
  authorizedBy: "Руководитель",
  unallocated: "Не отнесено к начислению",
  roundingDifference: "Разница округления",
  carrySourceId: "Источник входящего переноса",
  allocationShare: "Доля распределения",
  directCost: "Прямые расходы",
  id: "Идентификатор",
  name: "Название",
  code: "Код",
  client: "Клиент",
  status: "Статус",
  startDate: "Начало",
  endDate: "Окончание",
  archived: "В архиве",
  hourlyRate: "Ставка в час",
  validFrom: "Действует с",
  validTo: "Действует по",
  amount: "Сумма",
  balance: "Остаток",
  accountingDate: "Дата учета",
  description: "Задача",
  plannedHours: "Плановые часы",
  actualHours: "Фактические часы",
  rateSnapshot: "Ставка",
  fixedPartnerRate: "Фиксированная доля партнера",
  earned: "Фактически заработано",
  voided: "Отменено",
  paymentDate: "Дата выплаты",
  accountingPeriod: "Расчетный период",
  periodStart: "Начало периода",
  periodEnd: "Конец периода",
  ktu: "КТУ 30%",
  carryIn: "Входящий перенос",
  base: "Расчетная сумма",
  salary: "Зарплата за квартал",
  difference: "Разница",
  bonus: "Квартальный бонус",
  carryOut: "Перенос в следующий квартал",
  carry: "Перенос",
  paid: "Выплачено",
  outstanding: "Остаток к расчету",
  finalPayment: "Сезонная выплата",
  destination: "Место назначения",
  days: "Дней",
  perDiemRate: "Ставка суточных",
  perDiemAmount: "Суточные",
  transport: "Транспорт",
  hotel: "Проживание",
  other: "Прочие расходы",
  comment: "Комментарий",
  currency: "Валюта",
  originalAmount: "Сумма в валюте",
  exchangeRate: "Курс",
  exchangeRateDate: "Дата курса",
  bankOut: "Списано с банка",
  cashReceived: "Получено наличными",
  actualFee: "Фактическая стоимость",
  expectedFee: "Ожидаемая стоимость",
  expectedRate: "Ожидаемый процент",
  actualRate: "Фактический процент",
  purpose: "Назначение",
  date: "Дата",
  expected: "Расчетный остаток",
  actual: "Фактический остаток",
  resolved: "Сверка подтверждена",
  explanation: "Объяснение",
  postingDate: "Дата операции",
  operation: "Тип операции",
  reason: "Основание",
  gad: "Доход за вычетом прямых расходов",
  weight: "База распределения",
  allocated: "Общие расходы распределены",
  net: "Чистый результат",
  entitlement: "Начислено",
  rate: "Доля партнера",
  payable: "К выплате",
  revenue: "Доход",
  labor: "Заработок сотрудников",
  direct: "Прямые расходы с трудом",
  general: "Общие расходы",
  cashOutFees: "Обналичивание (включено в расходы)",
  economicResult: "Экономический результат",
  compensationPaid: "Компенсации выплачены",
  partnerPaid: "Партнерам выплачено",
  createdAt: "Создано",
  updatedAt: "Изменено",
  sourceRevision: "Версия исходных данных",
  project: "Проект",
  employeeId: "Сотрудник",
  partnerId: "Партнер",
  projectId: "Проект",
  ledgerAccountId: "Счет",
  bank: "Банк",
  debit: "Приход / дебет",
  credit: "Расход / кредит",
  otherDirect: "Прочие прямые расходы",
};
const referenceLabels: Record<string, string> = {
  employeeIdRef: "Сотрудник",
  partnerIdRef: "Партнер",
  projectIdRef: "Проект",
  complexityLevelIdRef: "Уровень сложности",
  paymentCategoryIdRef: "Категория",
  expenseCategoryIdRef: "Категория",
  bankAccountIdRef: "Банк",
  cashAccountIdRef: "Касса",
  ledgerAccountIdRef: "Счет",
  createdByRef: "Автор",
  cashOutMethodIdRef: "Способ",
};
const translations: Record<string, string> = {
  TRIP_PAYMENT: "Выплата по командировке",
  TRIP_RETURN: "Возврат аванса командировки",
  BANK: "Банк",
  CASH: "Наличные",
  POSTED: "Проведено",
  DRAFT: "Черновик",
  PAYMENT: "Выплата сотруднику",
  PARTNER_PAYMENT: "Выплата партнеру",
  TRANSFER: "Перевод",
  OPENING: "Начальный остаток",
  REVERSAL: "Сторно",
  CASHOUT: "Обналичивание",
  EXPENSE: "Расход",
  REVENUE: "Доход",
  SALARY: "Зарплата",
  BONUS: "Бонус",
  FINAL: "Сезонная выплата",
  OTHER: "Прочее",
  REIMBURSEMENT: "Возмещение",
};
const columns: Record<string, string[]> = {
  "audit-sections": [
    "project",
    "projectType",
    "code",
    "name",
    "status",
    "employees",
    "assignedPlannedHours",
    "plannedHours",
    "actualHours",
    "earned",
    "progress",
  ],
  "audit-templates": [
    "id",
    "projectType",
    "code",
    "name",
    "sortOrder",
    "active",
    "description",
  ],
  seasons: ["name", "startDate", "endDate", "status"],
  employees: ["name", "archived"],
  partners: ["name", "archived"],
  projects: [
    "code",
    "name",
    "client",
    "projectType",
    "partnerIdRef",
    "fixedPartnerRate",
    "status",
  ],
  rates: ["complexityLevelIdRef", "hourlyRate", "validFrom", "validTo"],
  "salary-rates": ["employeeId", "amount", "validFrom", "validTo"],
  work: [
    "employeeIdRef",
    "projectIdRef",
    "accountingDate",
    "description",
    "sectionCode",
    "sectionName",
    "level",
    "plannedHours",
    "actualHours",
    "rateSnapshot",
    "earned",
    "voided",
  ],
  payments: [
    "employeeIdRef",
    "paymentCategoryIdRef",
    "paymentDate",
    "accountingPeriod",
    "amount",
    "correctionStatus",
  ],
  quarters: [
    "employeeIdRef",
    "periodStart",
    "earned",
    "ktu",
    "carryIn",
    "base",
    "salary",
    "difference",
    "bonus",
    "carryOut",
    "status",
    "sourceStatus",
  ],
  "season-settlements": [
    "employeeIdRef",
    "earned",
    "ktu",
    "paid",
    "outstanding",
    "finalPayment",
    "sourceStatus",
  ],
  expenses: [
    "accountingDate",
    "projectIdRef",
    "expenseCategoryIdRef",
    "amount",
    "currency",
    "comment",
    "voided",
  ],
  revenues: ["accountingDate", "projectId", "amount", "comment"],
  trips: [
    "employeeIdRef",
    "destination",
    "startDate",
    "endDate",
    "days",
    "perDiemAmount",
    "transport",
    "hotel",
    "other",
  ],
  accounts: [
    "name",
    "bank",
    "currency",
    "balance",
    "date",
    "actual",
    "difference",
  ],
  cashout: [
    "date",
    "bankAccountIdRef",
    "cashAccountIdRef",
    "bankOut",
    "expectedRate",
    "expectedFee",
    "cashReceived",
    "actualFee",
    "actualRate",
    "purpose",
    "correctionStatus",
  ],
  reconciliations: [
    "date",
    "ledgerAccountIdRef",
    "expected",
    "actual",
    "difference",
    "resolved",
    "explanation",
  ],
  journal: ["postingDate", "operation", "reason", "createdByRef", "status"],
  allocations: [
    "projectIdRef",
    "revenue",
    "directCost",
    "gad",
    "allocationShare",
    "allocated",
    "net",
    "rateSnapshot",
    "entitlement",
    "sourceStatus",
  ],
  "partner-payments": [
    "paymentDate",
    "partnerIdRef",
    "amount",
    "correctionStatus",
  ],
  "cashout-methods": ["cashOutMethodIdRef", "rate", "validFrom", "validTo"],
};
const titles: Record<string, string> = {
  "audit-templates": "Шаблоны разделов аудита",
  seasons: "Сезоны",
  rates: "Уровни сложности и ставки",
  "salary-rates": "История зарплат",
  reconciliation: "Сверка сезона",
  allocations: "Расчеты партнеров",
  revenues: "Доходы проектов",
  reconciliations: "Сверки остатков",
  "partner-payments": "Выплаты партнерам",
  "bonus-approvals": "Одобрения исключительных бонусов",
  "cashout-methods": "Способы обналичивания",
  ...Object.fromEntries(navigation),
};
function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object")
    return "name" in value ? String((value as Row).name) : "Связанные записи";
  const text = String(value);
  if (translations[text]) return translations[text];
  if (/^\d{4}-\d\d-\d\d/.test(text))
    return new Date(text).toLocaleDateString("ru-RU", { timeZone: "UTC" });
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const [whole, fraction] = text.split(".");
    return (
      whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") +
      (fraction && !/^0+$/.test(fraction)
        ? "," + fraction.replace(/0+$/, "")
        : "")
    );
  }
  return text;
}
async function get(resource: string, params: URLSearchParams) {
  const response = await fetch(`/api/v1/${resource}?${params}`, {
    cache: "no-store",
  });
  const data = await response.json();
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Войдите в систему");
  }
  if (!response.ok)
    throw new Error(data.error?.message ?? "Не удалось загрузить данные");
  return data as Data;
}
function Table({
  rows,
  resource,
  onOpen,
}: {
  rows: Row[];
  resource?: string;
  onOpen?: (row: Row) => void;
}) {
  const tableLabels = rows.some(isPartnerBalance)
    ? { ...labels, ...partnerBalanceLabels }
    : labels;
  const keys =
    resource && columns[resource]
      ? columns[resource]
      : [...new Set(rows.flatMap((r) => Object.keys(r)))]
          .filter((k) => labels[k] || referenceLabels[k])
          .slice(0, 13);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{tableLabels[k] ?? referenceLabels[k]}</th>
            ))}
            {onOpen && <th>Подробности</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {keys.map((k) => (
                <td
                  key={k}
                  className={
                    [
                      "amount",
                      "earned",
                      "ktu",
                      "bonus",
                      "carryOut",
                      "salary",
                      "bankOut",
                      "actualFee",
                      "allocated",
                      "entitlement",
                      "balance",
                      "net",
                    ].includes(k)
                      ? "numeric"
                      : ""
                  }
                >
                  {k === "journalTransactionId" &&
                  typeof row[k] === "string" ? (
                    <Link
                      href={`/journal?recordId=${encodeURIComponent(String(row[k]))}&seasonId=${encodeURIComponent(String(row.seasonId ?? ""))}`}
                    >
                      {display(row[k])}
                    </Link>
                  ) : (
                    display(row[k])
                  )}
                </td>
              ))}
              {onOpen && (
                <td>
                  <button className="link" onClick={() => onOpen(row)}>
                    Открыть →
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="empty">Записей пока нет. Добавьте первую запись.</p>
      )}
    </div>
  );
}
function RecordDetail({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <Table rows={value as Row[]} />;
  if (!value || typeof value !== "object") return <p>{display(value)}</p>;
  const row = value as Row;
  const detailLabels = isPartnerBalance(row)
    ? { ...labels, ...partnerBalanceLabels }
    : labels;
  return (
    <>
      {typeof row.sourceType === "string" &&
        typeof row.sourceId === "string" && (
          <p>
            <Link
              href={`/${row.sourceType}?recordId=${row.sourceId}&seasonId=${row.seasonId ?? ""}`}
            >
              Открыть исходную финансовую запись →
            </Link>
          </p>
        )}
      <dl className="details">
        {Object.entries(row)
          .filter(
            ([k, v]) =>
              (labels[k] || referenceLabels[k]) &&
              !Array.isArray(v) &&
              !(k === "partnerId" && row.partner),
          )
          .map(([k, v]) => (
            <div key={k}>
              <dt>{detailLabels[k] ?? referenceLabels[k]}</dt>
              <dd>{display(v)}</dd>
            </div>
          ))}
      </dl>
      {Object.entries(row)
        .filter(([, v]) => Array.isArray(v) && v.length > 0)
        .map(([k, v]) => (
          <section key={k}>
            <h3>
              {(
                {
                  auditSections: "Разделы аудита",
                  sectionEmployees: "Сотрудники и разделы",
                  months: "Итоги по месяцам",
                  periods: "Показатели по сезонам",
                  operations: "Связанные финансовые операции и документы",
                  entries: "Исходные рабочие записи",
                  work: "Рабочее время",
                  workEntries: "Исходные рабочие записи",
                  salaryPayments: "Зарплата за квартал",
                  payments: "Выплаты",
                  quarters: "Квартальные расчеты",
                  expenses: "Расходы",
                  revenues: "Доходы",
                  cashout: "Обналичивание",
                  projects: "Проекты",
                  JournalLine_journalTransactionId_rows: "Проводки",
                  CashOutAllocation_cashOutTransactionId_rows:
                    "Распределение стоимости",
                  ProjectAssignment_projectId_rows: "Назначения",
                } as Record<string, string>
              )[k] ?? "Связанные записи"}
            </h3>
            <Table
              rows={v as Row[]}
              resource={
                k === "entries"
                  ? "work"
                  : k === "auditSections"
                    ? "audit-sections"
                    : undefined
              }
            />
          </section>
        ))}
      {["seasonResult", "totals", "calculation", "carrySource"].map((k) =>
        row[k] ? (
          <section key={k}>
            <h3>Итог расчета</h3>
            <RecordDetail value={row[k]} />
          </section>
        ) : null,
      )}
    </>
  );
}
function EntryForm({
  spec,
  options,
  seasonId,
  onSaved,
  onCancel,
}: {
  spec: FormSpec;
  options: Record<string, Option[]>;
  seasonId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const commandKey = useRef({ payload: "", id: crypto.randomUUID() });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [allocations, setAllocations] = useState([
    { projectId: "", businessTripId: "", amount: "0" },
  ]);
  return (
    <div className="dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        className="dialog"
      >
        <button className="close secondary" onClick={onCancel}>
          Закрыть
        </button>
        <h2>{spec.title}</h2>
        {spec.operation === "bonus-exception" && (
          <p className="warning">
            Внимание: выплата может превышать начисленный бонус или относиться к
            замененному расчету. Историческое начисление не изменится;
            фактическая выплата будет учтена при окончательной сверке. Укажите
            обязательное обоснование.
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (
              spec.critical &&
              !window.confirm(
                "Подтвердите операцию. История будет сохранена в финансовом журнале и аудите.",
              )
            )
              return;
            setBusy(true);
            const form = new FormData(e.currentTarget);
            const data: Record<string, unknown> = {};
            for (const f of spec.fields) {
              if (f.type === "allocations") {
                data[f.name] = allocations.map((a) => ({
                  projectId: a.projectId || undefined,
                  ...(spec.operation === "cashout"
                    ? { businessTripId: a.businessTripId || undefined }
                    : {}),
                  amount: a.amount,
                }));
              } else if (f.type === "checkbox")
                data[f.name] = form.get(f.name) === "on";
              else {
                const value = String(form.get(f.name) ?? "");
                if (value || !f.optional) data[f.name] = value;
              }
            }
            try {
              const payload = JSON.stringify(data);
              if (commandKey.current.payload !== payload)
                commandKey.current = { payload, id: crypto.randomUUID() };
              const response = await fetch("/api/v1/commands", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: spec.operation,
                  requestId: commandKey.current.id,
                  data,
                }),
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error?.message ?? "Ошибка операции");
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Ошибка операции");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            {spec.fields.map((f) =>
              f.type === "allocations" ? (
                <fieldset className="wide" key={f.name}>
                  <legend>{f.label}</legend>
                  {allocations.map((a, i) => (
                    <div className="allocation" key={i}>
                      <label>
                        Проект
                        <select
                          value={a.projectId}
                          onChange={(e) =>
                            setAllocations((rows) =>
                              rows.map((r, n) =>
                                n === i
                                  ? { ...r, projectId: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        >
                          <option value="">Общие расходы</option>
                          {options.projects?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {spec.operation === "cashout" && (
                        <label>
                          Командировка
                          <select
                            value={a.businessTripId}
                            onChange={(e) =>
                              setAllocations((rows) =>
                                rows.map((r, n) =>
                                  n === i
                                    ? { ...r, businessTripId: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            <option value="">Без командировки</option>
                            {options.trips?.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        Стоимость, UZS
                        <input
                          value={a.amount}
                          onChange={(e) =>
                            setAllocations((rows) =>
                              rows.map((r, n) =>
                                n === i ? { ...r, amount: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setAllocations((rows) =>
                            rows.filter((_, n) => n !== i),
                          )
                        }
                      >
                        Убрать
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setAllocations((rows) => [
                        ...rows,
                        { projectId: "", businessTripId: "", amount: "0" },
                      ])
                    }
                  >
                    Добавить назначение
                  </button>
                  <p>
                    Сумма строк должна точно совпадать с фактической стоимостью.
                  </p>
                </fieldset>
              ) : (
                <label
                  key={f.name}
                  className={f.type === "textarea" ? "wide" : ""}
                >
                  {f.label}
                  {f.optional ? " · необязательно" : ""}
                  {f.type === "select" ? (
                    <select
                      name={f.name}
                      onChange={
                        f.name === "projectId"
                          ? (e) => setSelectedProject(e.target.value)
                          : undefined
                      }
                      required={!f.optional}
                      defaultValue={
                        f.name === "seasonId" ? seasonId : undefined
                      }
                    >
                      <option value="">Выберите…</option>
                      {options[f.options ?? ""]
                        ?.filter(
                          (o) =>
                            f.name !== "projectAuditSectionId" ||
                            (o as Option & { projectId?: string }).projectId ===
                              selectedProject,
                        )
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea name={f.name} required={!f.optional} />
                  ) : (
                    <input
                      name={f.name}
                      onChange={
                        f.name === "projectId"
                          ? (e) => setSelectedProject(e.target.value)
                          : undefined
                      }
                      type={
                        f.type === "checkbox"
                          ? "checkbox"
                          : f.type === "date"
                            ? "date"
                            : f.type === "password"
                              ? "password"
                              : "text"
                      }
                      defaultValue={f.value}
                      defaultChecked={
                        f.type === "checkbox" && f.name === "active"
                      }
                      required={!f.optional && f.type !== "checkbox"}
                    />
                  )}
                </label>
              ),
            )}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
            <button className="secondary" type="button" onClick={onCancel}>
              Отмена
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
export default function Workspace({
  user,
  section,
}: {
  user: Principal & { name: string };
  section: string;
}) {
  const management = user.role === "ADMIN_MANAGEMENT";
  const [seasonId, setSeason] = useState(""),
    [seasons, setSeasons] = useState<Option[]>([]),
    [options, setOptions] = useState<Record<string, Option[]>>(staticOptions);
  const [data, setData] = useState<Data>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(true),
    [reload, setReload] = useState(0),
    [spec, setSpec] = useState<FormSpec | null>(null),
    [detail, setDetail] = useState<unknown>(null),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(0);
  useEffect(() => {
    get("seasons", new URLSearchParams())
      .then((result) => {
        const values = result.items as unknown as Option[];
        setSeasons(values);
        setSeason(
          new URLSearchParams(location.search).get("seasonId") ||
            values[0]?.id ||
            "",
        );
      })
      .catch((e) => setError(e.message));
    setFilters(Object.fromEntries(new URLSearchParams(location.search)));
  }, []);
  const resource =
    section === "cash" || section === "bank" ? "accounts" : section;
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      ...filters,
      page: String(page),
      ...(seasonId ? { seasonId } : {}),
    });
    const load = async () => {
      if (management) {
        const opts = await get("lookups", params);
        const next = { ...staticOptions, ...opts } as unknown as Record<
          string,
          Option[]
        >;
        next.banks = next.accounts?.filter((a) => a.kind === "BANK");
        next.cashAccounts = next.accounts?.filter((a) => a.kind === "CASH");
        const [allEmployees, allPartners] = await Promise.all([
          get("employees", new URLSearchParams()),
          get("partners", new URLSearchParams()),
        ]);
        next.allEmployees = allEmployees.items as unknown as Option[];
        next.allPartners = allPartners.items as unknown as Option[];
        if (!cancelled) setOptions(next);
      }
      if (
        !seasonId &&
        [
          "dashboard",
          "quarters",
          "season-settlements",
          "reconciliation",
        ].includes(section)
      )
        return {};
      if (!management) {
        params.set(
          user.role === "EMPLOYEE" ? "employeeId" : "partnerId",
          user.employeeId ?? user.partnerId ?? "",
        );
        return get(
          user.role === "EMPLOYEE" ? "employee-detail" : "partner-detail",
          params,
        );
      }
      if (["settings", "reports"].includes(section)) return {};
      return get(section === "reconciliation" ? "readiness" : resource, params);
    };
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    section,
    seasonId,
    page,
    filters,
    reload,
    management,
    resource,
    user.employeeId,
    user.partnerId,
    user.role,
  ]);
  async function openRow(row: Row, allTime = false) {
    try {
      const params = new URLSearchParams({ seasonId });
      if (["quarters", "season-settlements"].includes(resource)) {
        params.set("id", String(row.id));
        params.set("kind", resource === "quarters" ? "quarter" : "season");
        setDetail(await get("settlement-detail", params));
      } else if (resource === "audit-sections") {
        params.set("id", String(row.id));
        setDetail(await get("audit-section-detail", params));
      } else if (resource === "employees") {
        params.set("employeeId", String(row.employeeId ?? row.id));
        setDetail(await get("employee-detail", params));
      } else if (resource === "allocations") {
        params.set("id", String(row.id));
        setDetail(await get("allocation-detail", params));
      } else if (resource === "partners") {
        params.set("partnerId", String(row.id));
        setDetail(await get("partner-detail", params));
      } else if (resource === "trips") {
        params.set("id", String(row.id));
        setDetail(await get("trip-detail", params));
      } else if (resource === "projects") {
        params.set("projectId", String(row.id));
        if (allTime) params.set("scope", "all");
        setDetail(await get("project-detail", params));
      } else setDetail(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }
  const SelectedForm =
    spec && ["project", "work", "section-add"].includes(spec.operation)
      ? AuditForm
      : EntryForm;
  const title = management
    ? (titles[section] ?? "Финансовые данные")
    : user.role === "EMPLOYEE"
      ? "Мои показатели"
      : "Мои проекты и расчеты";
  return (
    <div className="app">
      <aside>
        <Link className="brand" href="/dashboard">
          ФМ{" "}
          <span>
            ФинансМАКС<small>Финансовое управление</small>
          </span>
        </Link>
        <nav>
          {(management
            ? navigation
            : ([
                [
                  "dashboard",
                  user.role === "EMPLOYEE" ? "Мои показатели" : "Мои расчеты",
                ],
              ] as const)
          ).map(([url, label]) => (
            <Link
              key={url}
              className={section === url ? "active" : ""}
              href={`/${url}${seasonId ? "?seasonId=" + seasonId : ""}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="user">
          <strong>{user.name}</strong>
          <small>
            {management
              ? "Управление"
              : user.role === "PARTNER"
                ? "Партнер"
                : "Сотрудник"}
          </small>
          <button
            className="link"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              location.href = "/login";
            }}
          >
            Выйти
          </button>
        </div>
      </aside>
      <main>
        {user.role === "PARTNER" && (
          <ReportDownload seasonId={seasonId} partner />
        )}
        <header>
          <div>
            <div className="eyebrow">АУДИТ · ФИНАНСЫ · УЧЕТ</div>
            <h1>{title}</h1>
          </div>
          <label className="season-picker">
            Расчетный сезон
            <select
              value={seasonId}
              onChange={(e) => {
                setSeason(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Выберите сезон</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        {management && ['settings','employees','partners'].includes(section) && <UserManagement compact={section !== 'settings'} defaultRole={section === 'partners' ? 'PARTNER' : 'EMPLOYEE'} />} 
        {management && (
          <div className="subnav">
            <Link href={`/seasons?seasonId=${seasonId}`}>Сезоны</Link>
            <Link href={`/rates?seasonId=${seasonId}`}>Сложность и ставки</Link>
            <Link href={`/allocations?seasonId=${seasonId}`}>
              Расчеты партнеров
            </Link>
            <Link href={`/bonus-approvals?seasonId=${seasonId}`}>
              Одобрения исключений
            </Link>
            <Link href={`/partner-payments?seasonId=${seasonId}`}>
              Выплаты партнерам
            </Link>
            <Link href={`/reconciliation?seasonId=${seasonId}`}>
              Сверка сезона
            </Link>
            <Link href={`/revenues?seasonId=${seasonId}`}>Доходы</Link>
            <Link href={`/reconciliations?seasonId=${seasonId}`}>
              Сверки остатков
            </Link>
            <Link href={`/salary-rates?seasonId=${seasonId}`}>
              История зарплат
            </Link>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}

        {management && (
          <div className="toolbar">
            {["quarters", "season-settlements", "allocations"].includes(
              section,
            ) && (
              <button
                className="secondary"
                onClick={() => {
                  setPage(0);
                  setFilters({
                    ...filters,
                    history: filters.history === "1" ? "0" : "1",
                  });
                }}
              >
                {filters.history === "1"
                  ? "Только принятые версии"
                  : "История и непринятые версии"}
              </button>
            )}
            {forms[section]?.map((f) => (
              <button key={f.operation} onClick={() => setSpec(f)}>
                {f.title}
              </button>
            ))}
          </div>
        )}
        {management &&
          !["dashboard", "reconciliation", "settings", "reports"].includes(
            section,
          ) && (
            <form
              className="filters"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(0);
                setFilters(
                  Object.fromEntries(new FormData(e.currentTarget)) as Record<
                    string,
                    string
                  >,
                );
              }}
            >
              <input
                name="q"
                placeholder="Поиск по записям"
                aria-label="Поиск"
              />
              {[
                "projects",
                "employees",
                "partners",
                ...(section === "journal" ? ["accounts", "users"] : []),
              ].map((key) => (
                <select
                  key={key}
                  name={
                    (
                      {
                        projects: "projectId",
                        employees: "employeeId",
                        partners: "partnerId",
                        accounts: "accountId",
                        users: "createdBy",
                      } as Record<string, string>
                    )[key]
                  }
                  aria-label={
                    key === "projects"
                      ? "Проект"
                      : key === "employees"
                        ? "Сотрудник"
                        : key === "partners"
                          ? "Партнер"
                          : key === "accounts"
                            ? "Счет"
                            : "Автор"
                  }
                >
                  <option value="">
                    {key === "projects"
                      ? "Все проекты"
                      : key === "employees"
                        ? "Все сотрудники"
                        : key === "partners"
                          ? "Все партнеры"
                          : key === "accounts"
                            ? "Все счета"
                            : "Все авторы"}
                  </option>
                  {options[key]?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ))}
              <label>
                С<input name="from" type="date" />
              </label>
              <label>
                По
                <input name="to" type="date" />
              </label>
              {section === "journal" && (
                <>
                  <select name="operation" aria-label="Тип операции">
                    <option value="">Все операции</option>
                    {[
                      "PAYMENT",
                      "PARTNER_PAYMENT",
                      "TRANSFER",
                      "OPENING",
                      "REVERSAL",
                      "CASHOUT",
                      "EXPENSE",
                      "REVENUE",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {translations[v]}
                      </option>
                    ))}
                  </select>
                  <select name="categoryId" aria-label="Категория">
                    <option value="">Все категории</option>
                    {[
                      ...(options.paymentCategories ?? []),
                      ...(options.expenseCategories ?? []),
                    ].map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button className="secondary">Применить</button>
            </form>
          )}
        {busy ? (
          <p className="empty" role="status">
            Загрузка данных…
          </p>
        ) : !management ? (
          <RecordDetail value={data} />
        ) : section === "dashboard" ? (
          <ManagementDashboard data={data} seasonId={seasonId} />
        ) : section === "reconciliation" ? (
          <>
            <p>
              Закрытие доступно только после проверки всех разделов и устранения
              блокирующих расхождений.
            </p>
            <Table rows={(data.checks ?? []) as Row[]} />
            <ul>
              {((data.blockers ?? []) as string[]).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <Table rows={(data.partnerBalances ?? []) as Row[]} />
            <p className={data.canClose ? "success" : "warning"}>
              {data.canClose
                ? "Сезон готов к закрытию"
                : "Есть разделы, блокирующие закрытие"}
            </p>
          </>
        ) : section === "settings" ? (
          <div className="panel">
            <h2>Справочники и исторические ставки</h2>
            <p>
              Изменения ставок сохраняются отдельными периодами. Старые
              начисления используют сохраненные значения.
            </p>
            <Link href="/audit-templates">Шаблоны разделов аудита</Link> ·{" "}
            <Link href="/rates">Уровни сложности</Link> ·{" "}
            <Link href="/cashout-methods">Способы обналичивания</Link> ·{" "}
            <Link href="/audit">Журнал аудита</Link>
          </div>
        ) : section === "reports" ? (
          <div className="panel">
            <ReportDownload
              seasonId={seasonId}
              partners={options.allPartners}
            />
            <Link href={`/quarters?seasonId=${seasonId}`}>
              Квартальные расчеты
            </Link>{" "}
            ·{" "}
            <Link href={`/season-settlements?seasonId=${seasonId}`}>
              Сезонные расчеты
            </Link>{" "}
            ·{" "}
            <Link href={`/allocations?seasonId=${seasonId}`}>
              Расчеты партнеров
            </Link>
          </div>
        ) : (
          <>
            <Table
              resource={resource}
              rows={(data.items ?? []) as Row[]}
              onOpen={openRow}
            />
            <div className="pagination">
              <button
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ← Назад
              </button>
              <span>Страница {page + 1}</span>
              <button
                className="secondary"
                disabled={!data.hasMore}
                onClick={() => setPage(page + 1)}
              >
                Далее →
              </button>
            </div>
            {["bank", "cash"].includes(section) && (
              <p>
                Остатки рассчитаны из проводок. Для просмотра движения откройте{" "}
                <Link href={`/journal?seasonId=${seasonId}`}>
                  финансовый журнал
                </Link>
                ; для проверки —{" "}
                <Link href={`/reconciliations?seasonId=${seasonId}`}>
                  историю сверок
                </Link>
                .
              </p>
            )}
          </>
        )}
        <footer>
          Все суммы в UZS, если не указано иное. История изменений сохраняется.
        </footer>
      </main>
      {spec && (
        <SelectedForm
          spec={spec}
          options={options}
          seasonId={seasonId}
          onCancel={() => setSpec(null)}
          onSaved={() => {
            setSpec(null);
            setNotice("Операция сохранена. История обновлена.");
            setReload((n) => n + 1);
            if (spec.operation === "season") location.reload();
          }}
        />
      )}
      {!!detail && (
        <div className="dialog-backdrop">
          <section
            className="dialog detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Подробности расчета"
          >
            <button className="secondary close" onClick={() => setDetail(null)}>
              Закрыть
            </button>
            <h2>Подробности и исходные записи</h2>
            {resource === "projects" && (
              <>
                <Link
                  href={`/audit-sections?projectId=${String((detail as Row).id)}&seasonId=${seasonId}`}
                >
                  Разделы: назначения и управление →
                </Link>
                <button onClick={() => openRow(detail as Row, true)}>
                  История проекта за все сезоны
                </button>
              </>
            )}
            <RecordDetail value={detail} />
          </section>
        </div>
      )}
    </div>
  );
}


