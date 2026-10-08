export const protectedNames = ["Собир Сафаев", "Атабек Нурматов", "Катерина", "Карина Григорьянц", "Акилбек Ишев"];
const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
export const isProtected = (name) => protectedNames.some((value) => normalize(value) === normalize(name));
export function assertDryRun(args) {
  if (args.some((arg) => arg !== "--dry-run")) throw Error("Разрешён только --dry-run. Удаление и --apply не реализованы.");
}
export function assertDemoTarget(env, args) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw Error("Не задан адрес отдельной демонстрационной базы"); }
  if (env.NODE_ENV === "production" || env.FINANCEMAX_ENV !== "demo" || !args.includes("--demo") ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^\/financemax_demo(?:_[a-zA-Z0-9]+)?$/.test(url.pathname))
    throw Error("Демо разрешено только при FINANCEMAX_ENV=demo, --demo и отдельной локальной базе financemax_demo[_идентификатор]");
}
export function classify(table, row, users = []) {
  const user = users.find((u) => u.id === row.userId);
  if (isProtected(row.name) || isProtected(user?.name)) return { group: "KEEP", reason: "Обязательное сохранение по указанию руководства" };
  if (["AuditSectionTemplate", "PaymentCategory", "ExpenseCategory", "ComplexityLevel", "ComplexityRate"].includes(table))
    return { group: "KEEP", reason: "Справочник: исключён из будущего автоматического удаления; ставки требуют отдельной проверки" };
  if (table === "Season" && /закры|closed/i.test(row.status ?? "")) return { group: "REVIEW REQUIRED", reason: "Закрытый сезон: требуется отдельное решение руководства" };
  if (row.demo === true || user?.demo === true || /(?:демо|demo|test|тест|browser|fixture)/i.test([row.name, row.code, row.client].filter(Boolean).join(" ")))
    return { group: "REMOVE CANDIDATE", reason: "Явный demo/test-маркер; кандидат, не разрешение на удаление" };
  return { group: "REVIEW REQUIRED", reason: "Недостаточно доказательств происхождения; реалистичное имя/сумма не доказывает реальность" };
}
