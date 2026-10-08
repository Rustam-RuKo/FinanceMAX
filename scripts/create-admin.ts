import "dotenv/config";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth";
const email = process.env.ADMIN_EMAIL,
  name = process.env.ADMIN_NAME,
  password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password)
  throw new Error(
    "Укажите ADMIN_EMAIL, ADMIN_NAME и ADMIN_PASSWORD в окружении",
  );
if (await db.user.count())
  throw new Error(
    "Первый администратор создается только в пустой базе. Далее используйте интерфейс управления.",
  );
await db.user.create({
  data: {
    email: email.toLowerCase(),
    name,
    passwordHash: await hashPassword(password),
    role: "ADMIN_MANAGEMENT",
  },
});
console.log("Первый администратор создан.");
await db.$disconnect();
