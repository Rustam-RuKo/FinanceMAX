import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { financeDb?: PrismaClient };
export const db = globalDb.financeDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.financeDb = db;
