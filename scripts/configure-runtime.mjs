import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
if (!process.argv.includes("--apply-reviewed-migration"))
  throw Error(
    "Требуется флаг --apply-reviewed-migration после проверки миграции",
  );
const source = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!source) throw Error("Укажите MIGRATION_DATABASE_URL");
const url = new URL(source),
  database = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+$/.test(database)) throw Error("Недопустимое имя базы");
const admin = new PrismaClient({ datasources: { db: { url: source } } });
const role = "financemax_runtime";
const existingRuntime = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
const password =
  existingRuntime?.username === role
    ? decodeURIComponent(existingRuntime.password)
    : randomBytes(32).toString("hex");
mkdirSync(".runtime", { recursive: true });
try {
  const backup = path.resolve(
    ".runtime",
    `before-remediation-${Date.now()}.dump`,
  );
  const dump = spawnSync(
    path.join(
      process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin",
      "pg_dump.exe",
    ),
    ["--format=custom", "--file", backup, "--dbname", database],
    {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (dump.status !== 0)
    throw Error("Резервная копия не создана: " + dump.stderr);
  console.log("Резервная копия:", backup);
  const diff = spawnSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-url",
      source,
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      env: { ...process.env, MIGRATION_DATABASE_URL: source },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (diff.status !== 0) throw Error("Не удалось проверить diff");
  writeFileSync(".runtime/pre-apply-schema-diff.sql", diff.stdout);
  if (/DROP (TABLE|COLUMN|CONSTRAINT)/i.test(diff.stdout))
    throw Error("Diff содержит удаление; требуется дополнительная проверка");
  const migrated = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, MIGRATION_DATABASE_URL: source },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (migrated.status !== 0) throw Error("Миграция не завершена");
  const present =
    await admin.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname=${role}`;
  if (!present.length)
    await admin.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password.replaceAll("'", "''")}'`,
    );
  await admin.$executeRawUnsafe(
    `ALTER ROLE "${role}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
  );
  await admin.$executeRawUnsafe(
    `GRANT CONNECT ON DATABASE "${database}" TO "${role}"`,
  );
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO "${role}"`,
  );
  await admin.$executeRawUnsafe(`GRANT DELETE ON "Session" TO "${role}"`);
  await admin.$executeRawUnsafe(
    `REVOKE ALL ON "_prisma_migrations" FROM "${role}"`,
  );
  const runtime = new URL(source);
  runtime.username = role;
  runtime.password = password;
  let env = readFileSync(".env", "utf8").replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL="${runtime}"`,
  );
  if (/^MIGRATION_DATABASE_URL=/m.test(env))
    env = env.replace(
      /^MIGRATION_DATABASE_URL=.*$/m,
      `MIGRATION_DATABASE_URL="${source}"`,
    );
  else env += `\nMIGRATION_DATABASE_URL="${source}"\n`;
  writeFileSync(".env", env);
  const client = new PrismaClient({
    datasources: { db: { url: runtime.toString() } },
  });
  try {
    const [r] = await client.$queryRawUnsafe(
      "SELECT current_user AS role,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
    );
    console.log("Роль приложения:", r);
    await client.season.count();
  } finally {
    await client.$disconnect();
  }
  console.log(
    "Миграция применена; приложение использует отдельную ограниченную роль. Пароли записаны только в локальный .env.",
  );
} finally {
  await admin.$disconnect();
}
