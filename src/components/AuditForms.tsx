"use client";
import { useRef, useState } from "react";
import { projectTypes } from "../domain/audit-templates";
import type { FormSpec } from "./forms";
type Option = {
  id: string;
  name: string;
  projectId?: string;
  projectType?: string;
  code?: string;
  assignments?: { employeeId: string; defaultComplexityLevelId?: string }[];
};
type Props = {
  spec: FormSpec;
  options: Record<string, Option[]>;
  seasonId: string;
  onSaved: () => void;
  onCancel: () => void;
};
export function AuditForm({
  spec,
  options,
  seasonId,
  onSaved,
  onCancel,
}: Props) {
  const [step, setStep] = useState(1),
    [type, setType] = useState(""),
    [project, setProject] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [custom, setCustom] = useState<{ code: string; name: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [entries, setEntries] = useState<Record<string, string>[]>([
    {
      rowKey: crypto.randomUUID(),
      employeeId: "",
      projectId: "",
      projectAuditSectionId: "",
      description: "",
      complexityLevelId: "",
      plannedHours: "0",
      actualHours: "0",
      date: "",
    },
  ]);
  const receipt = useRef({ payload: "", id: crypto.randomUUID() });
  const work = spec.operation === "work",
    creating = spec.operation === "project";
  const effectiveType = creating
    ? type
    : options.projects?.find((p) => p.id === project)?.projectType;
  const templates = (options.auditTemplates ?? []).filter(
    (t) => t.projectType === effectiveType,
  );
  const list = templates.filter((t) =>
    `${t.code} ${t.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const patch = (i: number, key: string, value: string) =>
    setEntries((rows) =>
      rows.map((r, n) =>
        n === i
          ? {
              ...r,
              [key]: value,
              ...(["employeeId", "projectId"].includes(key)
                ? { projectAuditSectionId: "" }
                : {}),
            }
          : r,
      ),
    );
  const select = (
    name: string,
    label: string,
    values: Option[],
    value?: string,
    onChange?: (v: string) => void,
  ) => (
    <label>
      {label}
      <select
        name={name}
        required
        value={value}
        defaultValue={
          value === undefined && name === "seasonId" ? seasonId : undefined
        }
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        <option value="">Выберите…</option>
        {values.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="dialog-backdrop">
      <section
        className="dialog audit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
      >
        <button className="secondary close" onClick={onCancel}>
          Закрыть
        </button>
        <h2>{spec.title}</h2>
        {creating && (
          <p className="eyebrow">
            Шаг {step} из 2 ·{" "}
            {step === 1 ? "Основная информация" : "Разделы аудита"}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (creating && step === 1) {
              setStep(2);
              return;
            }
            setError("");
            setBusy(true);
            try {
              const f = new FormData(e.currentTarget),
                data: Record<string, unknown> = {};
              for (const [k, v] of f.entries()) if (v) data[k] = v;
              if (work) {
                data.entries = entries.map((entry, i) => ({
                  ...entry,
                  date: String(f.get(`date-${i}`) ?? ""),
                }));
                data.seasonId = seasonId;
              } else {
                data.sections = [
                  ...templates
                    .filter((t) => selected.includes(t.id))
                    .map((t) => ({ templateId: t.id })),
                  ...custom,
                ];
                if (creating) {
                  data.projectType = type;
                  data.confirmed = f.get("confirmed") === "on";
                } else data.projectId = project;
              }
              const payload = JSON.stringify(data);
              if (receipt.current.payload !== payload)
                receipt.current = { payload, id: crypto.randomUUID() };
              const response = await fetch("/api/v1/commands", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: work ? "work-batch" : spec.operation,
                  data,
                  requestId: receipt.current.id,
                }),
              });
              const result = await response.json();
              if (!response.ok)
                throw Error(result.error?.message ?? "Не удалось сохранить");
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Ошибка сохранения");
            } finally {
              setBusy(false);
            }
          }}
        >
          {work ? (
            <>
              <p className="wide">
                Сезон выбран на странице. Доступны только активные разделы с
                назначением сотрудника. Все строки сохраняются одной операцией.
              </p>
              <div className="wide work-grid">
                {entries.map((row, i) => (
                  <fieldset key={row.rowKey}>
                    <legend>Запись {i + 1}</legend>
                    <div className="work-fields">
                      {select(
                        `employee-${i}`,
                        "Сотрудник",
                        options.employees ?? [],
                        row.employeeId,
                        (v) => patch(i, "employeeId", v),
                      )}
                      {select(
                        `project-${i}`,
                        "Проект",
                        options.projects ?? [],
                        row.projectId,
                        (v) => patch(i, "projectId", v),
                      )}
                      {select(
                        `section-${i}`,
                        "Раздел аудита",
                        (options.projectSections ?? []).filter(
                          (s) =>
                            s.projectId === row.projectId &&
                            s.assignments?.some(
                              (a) => a.employeeId === row.employeeId,
                            ),
                        ),
                        row.projectAuditSectionId,
                        (v) => patch(i, "projectAuditSectionId", v),
                      )}
                      <label>
                        Задача
                        <input
                          required
                          value={row.description}
                          onChange={(e) =>
                            patch(i, "description", e.target.value)
                          }
                        />
                      </label>
                      {select(
                        `level-${i}`,
                        "Уровень сложности",
                        options.levels ?? [],
                        row.complexityLevelId,
                        (v) => patch(i, "complexityLevelId", v),
                      )}
                      {[
                        ["plannedHours", "План часов"],
                        ["actualHours", "Факт часов"],
                        ["date", "Дата"],
                      ].map(([k, label]) => (
                        <label key={k}>
                          {label}
                          <input
                            required
                            type={k === "date" ? "date" : "number"}
                            min={k === "date" ? undefined : "0"}
                            step={k === "date" ? undefined : "0.0001"}
                            name={`${k}-${i}`}
                            value={k === "date" ? undefined : row[k]}
                            defaultValue={k === "date" ? row[k] : undefined}
                            onChange={(e) => patch(i, k, e.target.value)}
                          />
                        </label>
                      ))}
                      <label>
                        Исправляемая отмененная запись · необязательно
                        <input
                          value={row.correctionOf ?? ""}
                          onChange={(e) =>
                            patch(i, "correctionOf", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    {entries.length > 1 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setEntries((rows) => rows.filter((_, n) => n !== i))
                        }
                      >
                        Убрать строку
                      </button>
                    )}
                  </fieldset>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                disabled={entries.length >= 50}
                onClick={() =>
                  setEntries((rows) => [
                    ...rows,
                    {
                      ...rows[rows.length - 1],
                      rowKey: crypto.randomUUID(),
                      description: "",
                      actualHours: "0",
                    },
                  ])
                }
              >
                Добавить строку
              </button>
              <p>
                Заработок рассчитывается сервером: фактические часы ×
                историческая ставка.
              </p>
            </>
          ) : (
            <>
              <div
                className="wide audit-basics"
                style={{ display: creating && step === 2 ? "none" : "grid" }}
              >
                {(creating
                  ? spec.fields
                  : spec.fields.filter((f) => f.name !== "projectId")
                ).map((f) =>
                  f.type === "select" ? (
                    <div key={f.name}>
                      {select(f.name, f.label, options[f.options ?? ""] ?? [])}
                    </div>
                  ) : (
                    <label key={f.name}>
                      {f.label}
                      <input
                        name={f.name}
                        type={
                          f.type === "checkbox"
                            ? "checkbox"
                            : f.type === "date"
                              ? "date"
                              : "text"
                        }
                        required={!f.optional}
                        defaultValue={f.value}
                      />
                    </label>
                  ),
                )}
                {creating
                  ? select(
                      "projectType",
                      "Тип проекта",
                      Object.entries(projectTypes).map(([id, name]) => ({
                        id,
                        name,
                      })),
                      type,
                      (v) => {
                        setType(v);
                        setSelected([]);
                      },
                    )
                  : select(
                      "projectId",
                      "Проект",
                      options.projects ?? [],
                      project,
                      (v) => {
                        setProject(v);
                        setSelected([]);
                      },
                    )}
              </div>
              {(!creating || step === 2) && (
                <div className="wide section-picker">
                  <h3>Выберите необходимые разделы</h3>
                  <div className="picker-toolbar">
                    <input
                      aria-label="Поиск разделов"
                      placeholder="Поиск по коду или названию"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelected(templates.map((t) => t.id))}
                    >
                      Выбрать все
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelected([])}
                    >
                      Снять все
                    </button>
                    <strong>
                      Выбрано {selected.length} из {templates.length}
                    </strong>
                  </div>
                  <div className="section-options">
                    {list.map((t) => (
                      <label
                        className={selected.includes(t.id) ? "selected" : ""}
                        key={t.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(t.id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, t.id]
                                : ids.filter((id) => id !== t.id),
                            )
                          }
                        />
                        <b>{t.code}</b>
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                  {!effectiveType && (
                    <p>Сначала назначьте тип проекта, чтобы выбрать шаблон.</p>
                  )}
                  {custom.map((c, i) => (
                    <div className="custom-section" key={i}>
                      <label>
                        Код
                        <input
                          required
                          value={c.code}
                          onChange={(e) =>
                            setCustom((rows) =>
                              rows.map((r, n) =>
                                n === i ? { ...r, code: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Название
                        <input
                          required
                          value={c.name}
                          onChange={(e) =>
                            setCustom((rows) =>
                              rows.map((r, n) =>
                                n === i ? { ...r, name: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setCustom((rows) => rows.filter((_, n) => n !== i))
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
                      setCustom((rows) => [...rows, { code: "", name: "" }])
                    }
                  >
                    Добавить свой раздел
                  </button>
                  <p>Собственные разделы сохраняются только в этом проекте.</p>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="error wide" role="alert">
              {error}
            </p>
          )}
          <div className="wide actions">
            {creating && step === 2 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setStep(1)}
              >
                Назад
              </button>
            )}
            <button disabled={busy}>
              {busy
                ? "Сохранение…"
                : creating && step === 1
                  ? "Далее: разделы аудита"
                  : "Сохранить"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
