import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
if (!process.env.TEST_FILE) {
  const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {stdio:"inherit",env:process.env,windowsHide:true});
  if(build.status!==0)process.exit(build.status??1);
  let failed = false;
  for (const file of readdirSync("tests").filter((n) =>
    n.endsWith(".test.ts") && (!process.argv.includes("--http") || n==="http.test.ts"),
  )) {
    const r = spawnSync(process.execPath, ["scripts/test.mjs"], {
      env: { ...process.env, TEST_FILE: file },
      stdio: "inherit",
    });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
const suffix = randomUUID().replaceAll("-", "");
const name = "financemax_test_" + suffix,
  role = "fm_test_" + suffix,
  password = randomBytes(32).toString("hex");
const migration = new URL(adminUrl);
migration.pathname = "/" + name;
const runtime = new URL(migration);
runtime.username = role;
runtime.password = password;
const env = {
  ...process.env,
  DATABASE_URL: runtime.toString(),
  MIGRATION_DATABASE_URL: migration.toString(),
  TEST_DATABASE_NAME: name,
};
let code = 1,
  owner;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$executeRawUnsafe(
    `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`,
  );
  const migrate = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, stdio: "inherit" },
  );
  if (migrate.status !== 0) throw Error("Миграция не выполнена");
  owner = new PrismaClient({
    datasources: { db: { url: migration.toString() } },
  });
  await owner.$executeRawUnsafe(
    `GRANT CONNECT ON DATABASE "${name}" TO "${role}"`,
  );
  await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await owner.$executeRawUnsafe(
    `GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO "${role}"`,
  );
  await owner.$executeRawUnsafe(`GRANT DELETE ON "Session" TO "${role}"`);
  await owner.$executeRawUnsafe(
    `REVOKE ALL ON "_prisma_migrations" FROM "${role}"`,
  );
  const diff = spawnSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-url",
      migration.toString(),
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    { env, encoding: "utf8" },
  );
  console.log("Schema diff:", diff.stdout, diff.stderr);
  if (diff.status !== 0) throw Error("Схема расходится с БД");
  writeFileSync(
    ".runtime/last-test-database.json",
    JSON.stringify({ name, role }),
  );
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-concurrency=1",
      "tests/" + process.env.TEST_FILE,
    ],
    { env, stdio: "inherit" },
  );
  code = result.status ?? 1;
} finally {
  await owner?.$disconnect();
  if (!/^financemax_test_[a-f0-9]{32}$/.test(name))
    throw Error("Недопустимое имя тестовой БД");
  await admin.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
  );
  await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
  await admin.$disconnect();
}
process.exitCode = code;
