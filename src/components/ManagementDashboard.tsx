"use client";
import Link from "next/link";
import type { dashboardInsights } from "../server/dashboard";
type Insights = Awaited<ReturnType<typeof dashboardInsights>>;
type Account = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  balance: string;
  lastReconciliation?: {
    date: string;
    actual: string;
    difference: string;
    resolved: boolean;
  };
};
const number = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : Number(String(v)).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
export function ManagementDashboard({
  data,
  seasonId,
}: {
  data: Record<string, unknown>;
  seasonId: string;
}) {
  const totals = (data.totals ?? {}) as Record<string, string>,
    insights = data.insights as Insights | undefined,
    accounts = (data.accounts ?? []) as Account[];
  if (!insights) return null;
  const cash = accounts
    .filter((a) => a.kind === "CASH" && a.currency === "UZS")
    .reduce((v, a) => v + Number(a.balance), 0);
  const metrics = [
    ["Доход сезона", totals.revenue, "revenues"],
    ["Экономический результат", totals.economicResult, "projects"],
    ["Общие расходы", totals.general, "expenses"],
    ["Деньги в кассе", cash, "cash"],
  ];
  const secondary = [
    ["Труд", totals.labor, "work"],
    ["Выплачено сотрудникам", totals.compensationPaid, "payments"],
    ["Стоимость обналичивания", totals.cashOutFees, "cashout"],
    ["Выплачено партнёрам", totals.partnerPaid, "partner-payments"],
    ["Осталось партнёрам", insights.partnerRemaining, "partner-payments"],
  ];
  const href = (path: string) => `/${path}?seasonId=${seasonId}`;
  const chartMax = Math.max(
    1,
    ...insights.monthly.flatMap((m) => [Number(m.revenue), Number(m.expense)]),
  );
  return (
    <div className="management-dashboard">
      <div className="season-state">
        <span
          className={insights.review.canClose ? "status-good" : "status-review"}
        >
          {insights.seasonStatus}
        </span>
        <Link href={href("reconciliation")}>
          Сверка:{" "}
          {insights.review.canClose
            ? "условия закрытия выполнены"
            : `${insights.review.blockers.length} блокирующих причин`}{" "}
          →
        </Link>
      </div>
      <div className="primary-metrics">
        {metrics.map(([label, value, path]) => (
          <Link className="metric" key={label} href={href(String(path))}>
            <span>{label}</span>
            <strong>{number(value)}</strong>
            <small>UZS · источники →</small>
          </Link>
        ))}
      </div>
      <div className="secondary-metrics">
        {secondary.map(([label, value, path]) => (
          <Link key={label} href={href(path)}>
            <span>{label}</span>
            <b>
              {number(value)} <small>UZS</small>
            </b>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel dashboard-chart">
          <div className="panel-heading">
            <h2>Доходы и расходы</h2>
            <span>Экономика сезона · UZS</span>
          </div>
          <p className="chart-legend">
            <span>● Доходы</span>
            <span>● Расходы с трудом и комиссией</span>
          </p>
          <div className="monthly-chart">
            {insights.monthly.map((m) => (
              <div className="month-column" key={m.month}>
                <div className="month-bars">
                  <div
                    className="revenue-bar"
                    style={{
                      height: `${(Math.max(0, Number(m.revenue)) / chartMax) * 100}%`,
                    }}
                  />
                  <div
                    className="expense-bar"
                    style={{
                      height: `${(Math.max(0, Number(m.expense)) / chartMax) * 100}%`,
                    }}
                  />
                </div>
                <span>{m.month.slice(5)}</span>
                <div className="chart-tooltip">
                  {m.month}: доход {number(m.revenue)}, расходы{" "}
                  {number(m.expense)}, результат {number(m.result)}
                </div>
              </div>
            ))}
          </div>
          <details>
            <summary>Точные значения по месяцам</summary>
            <table>
              <thead>
                <tr>
                  <th>Месяц</th>
                  <th>Доход</th>
                  <th>Расходы</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {insights.monthly.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{number(m.revenue)}</td>
                    <td>{number(m.expense)}</td>
                    <td>{number(m.result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="panel attention-panel">
          <div className="panel-heading">
            <h2>Требует внимания</h2>
            <span>{insights.attention.length}</span>
          </div>
          {insights.attention.length ? (
            <ul>
              {insights.attention.map((a, i) => (
                <li key={i}>
                  <Link href={a.href}>
                    {a.message}
                    <span> →</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="success">Блокирующих замечаний нет</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Проекты</h2>
            <Link href={href("projects")}>Все проекты →</Link>
          </div>
          <div className="compact-stats">
            <span>
              <b>{insights.projectCounts.active}</b> активных
            </span>
            <span>
              <b>{insights.projectCounts.completed}</b> завершенных
            </span>
            <span>
              <b>{insights.projectCounts.attention}</b> требуют внимания
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Проект / партнёр</th>
                  <th>Доход</th>
                  <th>Результат*</th>
                  <th>Разделы с часами</th>
                </tr>
              </thead>
              <tbody>
                {[...insights.projects]
                  .sort(
                    (a, b) =>
                      Number(b.needsAttention) - Number(a.needsAttention) ||
                      Number(b.revenue) - Number(a.revenue),
                  )
                  .slice(0, 5)
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`${href("projects")}&recordId=${p.id}`}>
                          {p.name}
                        </Link>
                        <small>
                          {p.projectType} · {p.partner}
                        </small>
                      </td>
                      <td>{number(p.revenue)}</td>
                      <td>{number(p.economicResult)}</td>
                      <td>
                        {p.withWork} из {p.sectionCount}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <small>
            * Операционная экономика. Принятые обязательства — в расчетах
            партнёров.
          </small>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Прогресс аудита</h2>
            <Link href={href("audit-sections")}>Разделы →</Link>
          </div>
          <p>Выбранные разделы активных проектов</p>
          <div className="audit-progress">
            {[
              ["Выбрано", insights.auditProgress.selected],
              ["Есть назначение", insights.auditProgress.assigned],
              ["Есть рабочее время", insights.auditProgress.withWork],
              ["Нет рабочего времени", insights.auditProgress.withoutWork],
            ].map(([label, value]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <small>Фактические часы не означают завершение раздела.</small>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Загрузка сотрудников</h2>
            <span>{insights.month} · текущий месяц</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Проекты</th>
                  <th>Разделы</th>
                  <th>Часы</th>
                  <th>Заработано</th>
                </tr>
              </thead>
              <tbody>
                {insights.workload.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`${href("employees")}&recordId=${e.id}`}>
                        {e.name}
                      </Link>
                      {Number(e.actualHours) === 0 && (
                        <small>Нет часов в текущем месяце</small>
                      )}
                    </td>
                    <td>{e.projects}</td>
                    <td>{e.sections}</td>
                    <td>{number(e.actualHours)}</td>
                    <td>{number(e.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Деньги и сверка</h2>
            <Link href={href("reconciliations")}>История →</Link>
          </div>
          {["BANK", "CASH"].map((kind) => (
            <div className="money-group" key={kind}>
              <h3>{kind === "BANK" ? "Банк" : "Касса"}</h3>
              {accounts
                .filter((a) => a.kind === kind)
                .map((a) => (
                  <div className="money-row" key={a.id}>
                    <div>
                      <Link href={`${href("journal")}&accountId=${a.id}`}>
                        {a.name}
                      </Link>
                      <small>
                        Последняя сверка:{" "}
                        {a.lastReconciliation?.date?.slice(0, 10) ?? "нет"}
                      </small>
                    </div>
                    <div>
                      <b>
                        {number(a.balance)} {a.currency}
                      </b>
                      <small>
                        Факт: {number(a.lastReconciliation?.actual)} · разница:{" "}
                        {number(a.lastReconciliation?.difference)}
                      </small>
                      <span
                        className={
                          a.lastReconciliation?.resolved &&
                          Number(a.lastReconciliation.difference) === 0
                            ? "success"
                            : "warning"
                        }
                      >
                        {a.lastReconciliation?.resolved &&
                        Number(a.lastReconciliation.difference) === 0
                          ? "Сверено на указанную дату"
                          : "Требует сверки"}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
