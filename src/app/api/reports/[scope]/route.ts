import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticate } from "../../../../server/auth";
import { apiError } from "../../../../server/http";
import { readSeasonReport } from "../../../../server/season-report";
import { buildWorkbook } from "../../../../server/excel-report";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ scope: string }> },
) {
  try {
    const user = await authenticate(
      request.cookies.get("financemax_session")?.value,
    );
    const scope = z
      .enum(["management", "partner"], { error: "Неизвестный вид отчёта" })
      .parse((await context.params).scope);
    const seasonId = z
      .uuid({ error: "Выберите сезон" })
      .parse(request.nextUrl.searchParams.get("seasonId"));
    const mode = z
      .enum(["final", "draft"], { error: "Неизвестный режим отчёта" })
      .parse(request.nextUrl.searchParams.get("mode") ?? "final");
    const partnerId = z
      .uuid({ error: "Выберите партнёра" })
      .optional()
      .parse(request.nextUrl.searchParams.get("partnerId") ?? undefined);
    const report = await readSeasonReport(
      user,
      seasonId,
      scope,
      mode === "draft",
      partnerId,
    );
    const file = await buildWorkbook(report.data, scope, {
      user: user.name,
      generatedAt: new Date(),
      draft: report.draft,
    });
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="FinanceMAX-${scope}-${seasonId}${scope === "partner" ? "-" + (user.role === "PARTNER" ? user.partnerId : partnerId) : ""}${report.draft ? "-draft" : ""}.xlsx"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
