import ExcelJS from "exceljs";
import { d } from "../domain/calculations";
import { ensure } from "./errors";
import type { SeasonReport, PartnerReport } from "./season-report";
import { managementTables, partnerTables, type Cell } from "./report-tables";
export { managementTables, partnerTables } from "./report-tables";
export function excelNumber(value: Cell): number | null {
  if (value === undefined || value === null) return null;
  const decimal = d(value.toString()),
    n = Number(decimal.toString());
  ensure(
    Number.isFinite(n) && d(String(n)).eq(decimal) && decimal.precision() <= 15,
    "Сумма превышает точность Excel. Экспорт остановлен без округления исходных данных",
    409,
  );
  return n;
}
export async function buildWorkbook(
  data: SeasonReport | PartnerReport,
  scope: "management" | "partner",
  meta: { user: string; generatedAt: Date; draft: boolean },
) {
  const tables =
    scope === "management"
      ? managementTables(data as SeasonReport)
      : partnerTables(data as PartnerReport);
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.user;
  wb.created = meta.generatedAt;
  wb.modified = meta.generatedAt;
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name, {
      properties: { tabColor: { argb: "FF245B91" } },
      views: [{ state: "normal", showGridLines: false }],
    });
    ws.addRow([t.title]);
    ws.getRow(1).font = {
      name: "Arial",
      size: 15,
      bold: true,
      color: { argb: "FF173B60" },
    };
    ws.addRow([
      meta.draft
        ? "ЧЕРНОВИК — НЕ УТВЕРЖДЁН. НЕ ДЛЯ ОКОНЧАТЕЛЬНЫХ РАСЧЁТОВ"
        : "Подтверждённый сезонный отчёт",
    ]);
    ws.addRow([
      "Сезон",
      data.season.name,
      "Начало",
      new Date(data.season.startDate),
      "Отсечение",
      new Date(data.cutoff),
    ]);
    ws.addRow(["Сформирован", meta.generatedAt, "Пользователь", meta.user]);
    ws.addRow(["Отпечаток источников", data.sourceFingerprint]);
    ws.addRow([
      "Принятые версии",
      scope === "management"
        ? `См. лист «20. СВЕРКА»: ${data.acceptances.length} версий`
        : data.acceptances.map((a) => a.id).join("; "),
    ]);
    ws.addRow([
      "Статус сезона",
      data.season.status,
      "Валюта",
      "UZS; внутренняя точность 0,0001",
    ]);
    ws.addRow([
      meta.draft
        ? (data as SeasonReport).closing.blockers.join("; ")
        : "Суммы выплат отделены от начисленных затрат. Комиссии уже включены в расходы.",
    ]);
    ws.addRow(t.columns.map((c) => c.title));
    for (const row of t.rows)
      ws.addRow(
        row.map((v, i) =>
          v === null || v === undefined
            ? null
            : i === 0 && v === "ИТОГО"
              ? "ИТОГО"
              : t.columns[i].kind === "money" || t.columns[i].kind === "rate"
                ? excelNumber(v)
                : t.columns[i].kind === "date"
                  ? new Date(String(v))
                  : typeof v === "number"
                    ? v
                    : String(v),
        ),
      );
    ws.getRow(9).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    for (let i = 1; i <= t.columns.length; i++)
      ws.getCell(9, i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF245B91" },
      };
    ws.getRow(9).height = 42;
    ws.getRow(9).alignment = {
      wrapText: true,
      vertical: "middle",
      horizontal: "center",
    };
    t.columns.forEach((c, i) => {
      const column = ws.getColumn(i + 1);
      column.width =
        t.columns.length === 2 && i === 0
          ? 66
          : c.kind === "text"
            ? 34
            : c.kind === "date"
              ? 16
              : 22;
      for (let r = 10; r <= ws.rowCount; r++) {
        const cell = ws.getCell(r, i + 1);
        cell.font = { name: "Arial", size: 10 };
        cell.alignment = {
          wrapText: c.kind === "text",
          vertical: "middle",
          horizontal:
            c.kind === "money" || c.kind === "rate" ? "right" : "left",
        };
        if (c.kind === "money")
          cell.numFmt = '#,##0.0000;[Red](#,##0.0000);"—"';
        if (c.kind === "rate") cell.numFmt = "0.0000000000%";
        if (c.kind === "date") cell.numFmt = "dd.mm.yyyy";
        if (r % 2 === 0)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF0F6FC" },
          };
      }
    });
    for(let i=3;i<=6;i++)ws.getColumn(i).width=Math.max(16,ws.getColumn(i).width??0);
    for (const address of ["D3", "F3", "B4"])
      ws.getCell(address).numFmt =
        address === "B4" ? "dd.mm.yyyy hh:mm" : "dd.mm.yyyy";
    for (const r of [1, 2, 8]) {
      ws.mergeCells(r, 1, r, Math.max(6, t.columns.length));
      ws.getRow(r).alignment = { wrapText: true, vertical: "middle" };
      ws.getRow(r).height = r === 8 ? 48 : 30;
    }
    for (const r of [5, 6])
      ws.mergeCells(r, 2, r, Math.max(6, t.columns.length));
    ws.getRow(2).font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: meta.draft ? "FF9C3500" : "FF173B60" },
    };
    ws.getRow(8).font = {
      name: "Arial",
      size: 10,
      italic: true,
      color: { argb: "FF555555" },
    };
    for (let r = 10; r <= ws.rowCount; r++) {
      ws.getRow(r).height = 30;
      if (ws.getCell(r, 1).value === "ИТОГО") {
        ws.getRow(r).font = {
          name: "Arial",
          size: 10,
          bold: true,
          color: { argb: "FF173B60" },
        };
        for (let i = 1; i <= t.columns.length; i++)
          ws.getCell(r, i).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFDDEBF7" },
          };
      }
    }
    if (t.rows.length)
      ws.autoFilter = {
        from: { row: 9, column: 1 },
        to: { row: ws.rowCount, column: t.columns.length },
      };
    ws.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:9",
      printArea: `A1:${ws.getColumn(Math.max(6, t.columns.length)).letter}${ws.rowCount}`,
    };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
