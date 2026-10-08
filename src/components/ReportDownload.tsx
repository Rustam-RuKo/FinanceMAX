"use client";
import { useState } from "react";
export function ReportDownload({
  seasonId,
  partner = false,
  partners = [],
}: {
  seasonId: string;
  partner?: boolean;
  partners?: { id: string; name: string }[];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [partnerId, setPartnerId] = useState("");
  async function download(scope: "management" | "partner", draft = false) {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        seasonId,
        mode: draft ? "draft" : "final",
      });
      if (!partner && scope === "partner") query.set("partnerId", partnerId);
      const response = await fetch(`/api/reports/${scope}?${query}`);
      if (!response.ok) {
        const data = await response.json();
        throw Error(data.error?.message ?? "Отчёт недоступен");
      }
      if (
        !response.headers.get("content-type")?.includes("spreadsheetml.sheet")
      )
        throw Error("Сервер вернул неверный формат отчёта");
      const filename = response.headers
        .get("content-disposition")
        ?.match(/filename="([A-Za-z0-9_.-]+\.xlsx)"/)?.[1];
      if (!filename) throw Error("Сервер не указал имя файла отчёта");
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Не удалось связаться с сервером отчётов"
          : e instanceof Error
            ? e.message
            : "Не удалось сформировать отчёт",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <h2>Сезонные отчёты Excel</h2>
      <p>
        Отчёт формируется за выбранный сезон. Подтверждённый экспорт требует
        актуальных принятых расчётов и сверки.
      </p>
      {partner ? (
        <button
          disabled={busy || !seasonId}
          onClick={() => download("partner")}
        >
          Скачать мой отчёт
        </button>
      ) : (
        <>
          <button
            disabled={busy || !seasonId}
            onClick={() => download("management", true)}
          >
            Черновик руководства
          </button>{" "}
          <button
            disabled={busy || !seasonId}
            onClick={() => download("management")}
          >
            Подтверждённый отчёт
          </button>
          <p>
            <label>
              Партнёр{" "}
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
              >
                <option value="">Выберите партнёра</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>{" "}
            <button
              disabled={busy || !seasonId || !partnerId}
              onClick={() => download("partner")}
            >
              Отчёт партнёра
            </button>
          </p>
        </>
      )}
      {busy && <p role="status">Формирование отчёта…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
