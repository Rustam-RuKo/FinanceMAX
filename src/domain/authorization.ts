export type Principal = {
  id: string;
  role: "ADMIN_MANAGEMENT" | "PARTNER" | "EMPLOYEE";
  employeeId?: string;
  partnerId?: string;
};
export function requireManagement(user: Principal) {
  if (user.role !== "ADMIN_MANAGEMENT") throw new Error("Недостаточно прав");
}
export function financialScope(user: Principal): {
  employeeId?: string;
  partnerId?: string;
} {
  if (user.role === "ADMIN_MANAGEMENT") return {};
  if (user.role === "EMPLOYEE" && user.employeeId)
    return { employeeId: user.employeeId };
  if (user.role === "PARTNER" && user.partnerId)
    return { partnerId: user.partnerId };
  throw new Error("Доступ запрещен");
}
export function exportScope(user: Principal) {
  if (user.role === "EMPLOYEE") throw new Error("Экспорт недоступен");
  return financialScope(user);
}
