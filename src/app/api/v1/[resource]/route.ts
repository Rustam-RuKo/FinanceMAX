import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../../../server/auth";
import { readResource } from "../../../../server/queries";
import { executeCommand } from "../../../../server/workflows";
import { apiError, body, checkOrigin } from "../../../../server/http";
import { AppError } from "../../../../server/errors";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    const user = await authenticate(
      request.cookies.get("financemax_session")?.value,
    );
    const { resource } = await context.params;
    return NextResponse.json(
      await readResource(user, resource, request.nextUrl.searchParams),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    checkOrigin(request);
    const user = await authenticate(
      request.cookies.get("financemax_session")?.value,
    );
    if ((await context.params).resource !== "commands")
      throw new AppError(404, "Операция не найдена");
    return NextResponse.json(await executeCommand(user, await body(request)), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
