import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login } from "../../../../server/auth";
import { apiError, body, checkOrigin } from "../../../../server/http";
import { AppError } from "../../../../server/errors";
import { checkLoginRate } from "../../../../server/login-rate-limit";
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const p = z
      .object({
        email: z.string().email("Введите адрес электронной почты").max(254),
        password: z.string().min(1, "Введите пароль").max(256),
      })
      .parse(await body(request));
    const client =
      process.env.TRUST_PROXY === "true"
        ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "direct")
        : "direct";
    checkLoginRate(p.email, client);
    const token = await login(p.email, p.password);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("financemax_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 28800,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
