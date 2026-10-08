import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { db } from "../src/server/db.js";
import { hashPassword } from "../src/server/auth.js";
import { executeCommand } from "../src/server/workflows.js";
import type { Principal } from "../src/domain/authorization.js";
import { assertDemoTarget } from "./production-safety.mjs";
assertDemoTarget(process.env, process.argv);
if (process.env.NODE_ENV === "production")
  throw new Error("Демо-данные запрещены в production");
if (!process.argv.includes("--demo"))
  throw new Error(
    "Добавьте --demo для явно обозначенной демонстрационной базы",
  );
if (await db.user.findFirst()) {
  console.log("База не пуста; демо-данные не изменены.");
  await db.$disconnect();
  process.exit(0);
}
const password =
  process.env.DEMO_PASSWORD ?? randomBytes(18).toString("base64url");
const passwordHash = await hashPassword(password);
const people = [
  ["sobir", "Собир Сафаев", "ADMIN_MANAGEMENT"],
  ["atabek", "Атабек Нурматов", "ADMIN_MANAGEMENT"],
  ["katerina", "Катерина", "ADMIN_MANAGEMENT"],
  ["karina", "Карина Григорьянц", "PARTNER"],
  ["akilbek", "Акилбек Ишев", "PARTNER"],
  ["aziza", "Азиза Рахимова", "EMPLOYEE"],
  ["timur", "Тимур Алиев", "EMPLOYEE"],
  ["dilshod", "Дильшод Каримов", "EMPLOYEE"],
] as const;
const users = [];
for (const [login, name, role] of people)
  users.push(
    await db.user.create({
      data: {
        name,
        email: `${login}@demo.local`,
        passwordHash,
        role,
        demo: true,
      },
    }),
  );
const admin: Principal = { id: users[0].id, role: "ADMIN_MANAGEMENT" };
const run = async (operation: string, data: Record<string, unknown>) =>
  (await executeCommand(admin, { operation, requestId: randomUUID(), data }))
    .id;
const seasonId = await run("season", {
  name: "ДЕМО · Сезон 2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
});
const partners = [];
for (const u of users.filter((u) => u.role === "PARTNER")) {
  const id = await run("partner", { name: u.name });
  await db.partner.update({
    where: { id },
    data: { userId: u.id, updatedBy: admin.id },
  });
  partners.push(id);
}
const employees = [];
for (const u of users.filter((u) => u.role === "EMPLOYEE")) {
  const id = await run("employee", { name: u.name });
  await db.employee.update({
    where: { id },
    data: { userId: u.id, updatedBy: admin.id },
  });
  employees.push(id);
  await run("salary-rate", {
    employeeId: id,
    amount: "10000000",
    validFrom: "2026-01-01",
  });
}
const level = await run("complexity", {
  name: "Уровень 3",
  hourlyRate: "300000",
  validFrom: "2026-01-01",
});
const bank = await run("account", {
  name: "Основной расчетный счет · ДЕМО",
  kind: "BANK",
  bank: "Демонстрационный банк",
});
const cash = await run("account", {
  name: "Основная касса · ДЕМО",
  kind: "CASH",
});
await run("transfer", {
  seasonId,
  date: "2026-01-01",
  toId: bank,
  amount: "300000000",
  reason: "Демонстрационный начальный остаток",
});
const salary = await run("payment-category", {
  name: "Фиксированная зарплата",
  kind: "SALARY",
  settlementRelevant: true,
});
await run("payment-category", {
  name: "Квартальный бонус",
  kind: "BONUS",
  settlementRelevant: true,
});
await run("payment-category", {
  name: "Возмещение командировки",
  kind: "REIMBURSEMENT",
  settlementRelevant: false,
});
await run("payment-category", {
  name: "Сезонная выплата",
  kind: "FINAL",
  settlementRelevant: true,
});
await run("payment-category", {
  name: "Дополнительная премия",
  kind: "OTHER",
  settlementRelevant: true,
});
const expenseCategory = await run("expense-category", {
  name: "Операционные расходы",
});
const travelCategory = await run("expense-category", { name: "Командировки" });
const projects = [];
for (let i = 0; i < 2; i++) {
  const id = await run("project", {
    seasonId,
    name: i
      ? "Аудит финансовой отчетности"
      : "Аудит производственного предприятия",
    code: `ДЕМО-2026-0${i + 1}`,
    client: i ? "Самарканд Текстиль" : "Ташкент Индустрия",
    partnerId: partners[i],
    projectType: i ? "INTERNATIONAL" : "INDUSTRIAL",
    sections: [{ code: "ДЕМО", name: "Проверка документов" }],
    partnerRate: i ? "0.25" : "0.30",
    confirmed: true,
    startDate: "2026-01-01",
  });
  projects.push(id);
  await run("revenue", {
    seasonId,
    date: "2026-03-20",
    projectId: id,
    amount: i ? "180000000" : "240000000",
    accountId: bank,
    comment: "Демонстрационный доход по договору",
  });
}
for (let i = 0; i < employees.length; i++) {
  const section = await db.projectAuditSection.findFirstOrThrow({
    where: { projectId: projects[i % 2] },
  });
  await run("section-assignment", {
    projectAuditSectionId: section.id,
    reason: "Назначение демонстрационного сценария",
    seasonId,
    projectId: projects[i % 2],
    employeeId: employees[i],
  });
  await run("work", {
    projectAuditSectionId: section.id,
    seasonId,
    date: "2026-03-15",
    projectId: projects[i % 2],
    employeeId: employees[i],
    complexityLevelId: level,
    description: "Проверка первичных документов и аналитические процедуры",
    plannedHours: "60",
    actualHours: i === 0 ? "100" : "50",
  });
  await run("payment", {
    seasonId,
    employeeId: employees[i],
    paymentCategoryId: salary,
    accountId: bank,
    paymentDate: "2026-04-03",
    accountingPeriod: "2026-03-01",
    amount: "10000000",
    reason: "Зарплата за март",
  });
}
await run("expense", {
  seasonId,
  date: "2026-03-05",
  expenseCategoryId: expenseCategory,
  amount: "12000000",
  currency: "UZS",
  exchangeRate: "1",
  accountId: bank,
  comment: "Аренда офиса — общие расходы",
});
const trip = await run("trip", {
  seasonId,
  employeeId: employees[0],
  projectId: projects[0],
  destination: "Самарканд",
  startDate: "2026-03-10",
  endDate: "2026-03-12",
  perDiemRate: "200000",
  transport: "400000",
  hotel: "600000",
  other: "0",
  expenseCategoryId: travelCategory,
  comment: "Выездная аудиторская проверка",
});
const method = await run("cashout-method", {
  name: "Дивиденды · ДЕМО",
  rate: "0.06",
  validFrom: "2026-01-01",
});
await run("cashout", {
  seasonId,
  date: "2026-03-09",
  bankAccountId: bank,
  cashAccountId: cash,
  cashOutMethodId: method,
  bankOut: "10000000",
  cashReceived: "9400000",
  purpose: "Финансирование выездных расходов",
  allocations: [
    { projectId: projects[0], businessTripId: trip, amount: "600000" },
  ],
});
for (const employeeId of employees) {
  await run("quarter", { seasonId, employeeId, periodStart: "2026-01-01" });
  await run("season-settlement", { seasonId, employeeId });
}
await run("partner-allocation", { seasonId });
await run("reconciliation", {
  seasonId,
  date: "2026-03-31",
  ledgerAccountId: cash,
  actual: "9350000",
  explanation: "Демонстрационное расхождение для проверки",
});
await mkdir(".runtime", { recursive: true });
await writeFile(
  ".runtime/demo-accounts.txt",
  `ТОЛЬКО ДЕМО. Не использовать в production.\nПароль: ${password}\n\n${users.map((u) => `${u.name}: ${u.email}`).join("\n")}\n`,
);
await writeFile(
  ".runtime/demo-ids.json",
  JSON.stringify(
    {
      seasonId,
      partners,
      employees,
      projects,
      bank,
      cash,
      level,
      salary,
      expenseCategory,
      method,
    },
    null,
    2,
  ),
);
console.log(
  "Демонстрационные данные созданы. Данные входа: .runtime/demo-accounts.txt",
);
await db.$disconnect();
