import { NextRequest, NextResponse } from "next/server";
import { logout } from "../../../../server/auth";
import { apiError, checkOrigin } from "../../../../server/http";
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    await logout(request.cookies.get("financemax_session")?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("financemax_session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
