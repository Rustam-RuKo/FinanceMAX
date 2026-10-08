import "./validation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new AppError(503, "Не настроен адрес приложения");
  if (request.headers.get("origin") !== expected)
    throw new AppError(403, "Источник запроса не разрешен");
}
export function apiError(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { message: error.message } },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: { message: error.issues.map((i) => i.message).join("; ") } },
      { status: 422 },
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025")
      return NextResponse.json(
        { error: { message: "Запись не найдена" } },
        { status: 404 },
      );
    if (["P2002", "P2034", "P2003", "P2004"].includes(error.code))
      return NextResponse.json(
        {
          error: {
            message:
              "Операция конфликтует с существующими данными. Проверьте значения и повторите запрос.",
          },
        },
        { status: 409 },
      );
  }
  console.error(
    "request_failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    {
      error: {
        message:
          "Не удалось выполнить операцию. Проверьте данные и доступность базы.",
      },
    },
    { status: 500 },
  );
}
export async function body(request: Request) {
  const value = await request.text();
  if (value.length > 100000) throw new AppError(413, "Слишком большой запрос");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AppError(400, "Некорректный формат запроса");
  }
}
