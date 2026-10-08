import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { AppError, ensure } from "./errors";
import type { Principal } from "../domain/authorization";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  ensure(
    password.length >= 10 && password.length <= 256,
    "Пароль должен содержать от 10 до 256 символов",
  );
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  if (password.length > 256) return false;
  const [algorithm, salt, encoded] = hash.split(":");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const dummyHash = hashPassword(randomBytes(24).toString("hex"));
export async function login(email: string, password: string) {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  const hash = user?.passwordHash ?? (await dummyHash);
  const valid = await verifyPassword(password, hash);
  if (
    !user ||
    !user.active ||
    !valid ||
    (user.lockedUntil && user.lockedUntil > new Date())
  ) {
    if (user && !valid) {
      const updated = await db.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
      });
      if (updated.failedLogins >= 5)
        await db.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
        });
    }
    throw new AppError(
      401,
      "Неверные данные входа или вход временно ограничен",
    );
  }
  const token = randomBytes(32).toString("hex");
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
    const current=await tx.user.findUniqueOrThrow({where:{id:user.id}});
    ensure(current.active && current.passwordHash===hash && current.email===email.trim().toLowerCase() && !(current.lockedUntil && current.lockedUntil>new Date()),'Учетная запись изменена. Войдите снова',401);
    await tx.user.update({where:{id:user.id},data:{failedLogins:0,lockedUntil:null}});
    await tx.session.create({data:{userId:user.id,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+8*60*60*1000)}});
  });  return token;
}
export async function authenticate(
  token: string | undefined,
): Promise<Principal & { name: string }> {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "Войдите в систему");
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active)
    throw new AppError(401, "Сессия истекла. Войдите снова");
  const user = session.user;
  const [employee, partner] = await Promise.all([
    db.employee.findUnique({ where: { userId: user.id } }),
    db.partner.findUnique({ where: { userId: user.id } }),
  ]);
  if (employee?.archived || partner?.archived)
    throw new AppError(403, "Учетная запись архивирована");
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    employeeId: employee?.id,
    partnerId: partner?.id,
  };
}
export async function logout(token: string | undefined) {
  if (token)
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
export function ownEmployee(user: Principal, id: string) {
  if (
    user.role !== "ADMIN_MANAGEMENT" &&
    (user.role !== "EMPLOYEE" || user.employeeId !== id)
  )
    throw new AppError(403, "Доступ к данным сотрудника запрещен");
}
export function ownPartner(user: Principal, id: string) {
  if (
    user.role !== "ADMIN_MANAGEMENT" &&
    (user.role !== "PARTNER" || user.partnerId !== id)
  )
    throw new AppError(403, "Доступ к данным партнера запрещен");
}
export function management(user: Principal) {
  if (user.role !== "ADMIN_MANAGEMENT")
    throw new AppError(403, "Доступ разрешен только руководству");
}


