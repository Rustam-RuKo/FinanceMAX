import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth";
/** Opt-in, disposable test fixture. The parent test harness always drops this database afterwards. */
export async function openBrowserFixture(
  seasonId: string,
  partnerId: string,
  adminEmail: string,
) {
  if (
    !/^financemax_test_[a-f0-9]{32}$/.test(process.env.TEST_DATABASE_NAME ?? "")
  )
    throw Error("Только одноразовая тестовая база");
  const stop = ".runtime/phase6-browser-stop";
  if (existsSync(stop)) rmSync(stop);
  const password = "Scenario-password-2026",
    email = "partner-browser@test.local";
  const user = await db.user.create({
    data: {
      name: "Партнер браузерной проверки",
      email,
      passwordHash: await hashPassword(password),
      role: "PARTNER",
      demo: true,
    },
  });
  await db.partner.update({
    where: { id: partnerId },
    data: { userId: user.id },
  });
  const base = "http://localhost:3316";
  const out = createWriteStream(".runtime/phase6-browser-server.log");
  mkdirSync(".runtime/phase6-browser-downloads", { recursive: true });
  const proxy = createServer((req, res) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: 3317,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          if (req.url?.startsWith("/api/reports/")) chunks.push(chunk);
          res.write(chunk);
        });
        response.on("end", () => {
          if (req.url?.startsWith("/api/reports/")) {
            const bytes = Buffer.concat(chunks);
            const disposition = String(
              response.headers["content-disposition"] ?? "",
            );
            const filename = disposition.match(
              /filename="([A-Za-z0-9_.-]+\.xlsx)"/,
            )?.[1];
            if (response.statusCode === 200 && filename)
              writeFileSync(
                ".runtime/phase6-browser-downloads/" + filename,
                bytes,
              );
            appendFileSync(
              ".runtime/phase6-browser-responses.jsonl",
              JSON.stringify({
                url: req.url,
                status: response.statusCode,
                filename,
                bytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              }) + "\n",
            );
          }
          res.end();
        });
      },
    );
    upstream.on("error", () => {
      res.statusCode = 502;
      res.end("Тестовый сервер запускается");
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) =>
    proxy.listen(3316, "127.0.0.1", resolve),
  );
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3317",
    ],
    {
      env: { ...process.env, APP_ORIGIN: base },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  server.stdout.pipe(out);
  server.stderr.pipe(out);
  try {
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(base + "/login")
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    writeFileSync(
      ".runtime/phase6-browser-fixture.json",
      JSON.stringify({
        base,
        seasonId,
        partnerId,
        adminEmail,
        partnerEmail: email,
        password,
      }),
    );
    console.log("БРАУЗЕРНАЯ_БАЗА_ГОТОВА", base);
    const deadline = Date.now() + 20 * 60 * 1000;
    while (!existsSync(stop) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 1000));
  } finally {
    proxy.close();
    server.kill();
    out.end();
  }
}
