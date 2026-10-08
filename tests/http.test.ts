import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { requiredClosingChecks } from "../src/domain/calculations";
import { createServer } from "node:net";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth";
import { executeCommand } from "./section-fixtures";
import type { Principal } from "../src/domain/authorization";
after(() => db.$disconnect());
test("HTTP production: аутентификация, все права, CSRF, исключения, CSP и выход", async () => {
  assert.match(
    process.env.TEST_DATABASE_NAME ?? "",
    /^financemax_test_[a-f0-9]{32}$/,
  );
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const base = `http://127.0.0.1:${port}`,
    password = "Http-isolated-test-2026";
  const users = [];
  for (const role of [
    "ADMIN_MANAGEMENT",
    "ADMIN_MANAGEMENT",
    "EMPLOYEE",
    "EMPLOYEE",
    "PARTNER",
    "PARTNER",
  ] as const)
    users.push(
      await db.user.create({
        data: {
          name: "HTTP " + role,
          email: randomUUID() + "@test.local",
          role,
          passwordHash: await hashPassword(password),
          demo: true,
        },
      }),
    );
  const admin: Principal = { id: users[0].id, role: "ADMIN_MANAGEMENT" };
  const run = async (operation: string, data: Record<string, unknown>) =>
    (await executeCommand(admin, { operation, requestId: randomUUID(), data }))
      .id;
  const seasonId = await run("season", {
    name: "HTTP изолированно",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  const employee = await run("employee", {
      name: "HTTP свой",
      userId: users[2].id,
    }),
    otherEmployee = await run("employee", {
      name: "HTTP чужой",
      userId: users[3].id,
    });
  const partner = await run("partner", {
      name: "HTTP свой",
      userId: users[4].id,
    }),
    otherPartner = await run("partner", {
      name: "HTTP чужой",
      userId: users[5].id,
    });
  await db.employee.update({
    where: { id: employee },
    data: { userId: users[2].id },
  });
  await db.employee.update({
    where: { id: otherEmployee },
    data: { userId: users[3].id },
  });
  await db.partner.update({
    where: { id: partner },
    data: { userId: users[4].id },
  });
  await db.partner.update({
    where: { id: otherPartner },
    data: { userId: users[5].id },
  });
  const output = createWriteStream(".runtime/http-production.log");
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: { ...process.env, APP_ORIGIN: base, NODE_ENV: "production" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.pipe(output);
  server.stderr.pipe(output);
  let count = 0;
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(base + "/login")).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(ready, "Сервер production не запустился");
    const login = async (email: string, pass = password) =>
      fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass }),
      });
    const cookies: string[] = [];
    for (const u of users) {
      const r = await login(u.email);
      assert.equal(r.status, 200);
      const c = r.headers.get("set-cookie")!;
      assert.ok(
        c.includes("HttpOnly") &&
          c.includes("Secure") &&
          c.includes("SameSite=lax"),
      );
      cookies.push(c.split(";")[0]);
      count++;
    }
    const check = async (
      resource: string,
      cookie: string | undefined,
      status = 200,
    ) => {
      const r = await fetch(base + "/api/v1/" + resource, {
        headers: cookie ? { Cookie: cookie } : {},
      });
      assert.equal(r.status, status, resource + " " + (await r.clone().text()));
      count++;
      return r.json();
    };
    await check("journal", undefined, 401);
    const resources = [
      "dashboard",
      "lookups",
      "projects",
      "employees",
      "partners",
      "rates",
      "work",
      "payments",
      "quarters",
      "expenses",
      "trips",
      "accounts",
      "cashout",
      "journal",
      "allocations",
      "season-settlements",
      "reconciliations",
      "readiness",
      "partner-payments",
      "bonus-approvals",
      "audit",
      "audit-templates",
      "users",
    ];
    for (const r of resources)
      for (const c of cookies.slice(0, 2))
        await check(r + "?seasonId=" + seasonId, c);
    for (const c of [cookies[2], cookies[4]])
      for (const r of resources)
        await check(r + "?seasonId=" + seasonId, c, 403);
    await check(
      `employee-detail?seasonId=${seasonId}&employeeId=${employee}`,
      cookies[2],
    );
    await check(
      `employee-detail?seasonId=${seasonId}&employeeId=${otherEmployee}`,
      cookies[2],
      403,
    );
    await check(
      `partner-detail?seasonId=${seasonId}&partnerId=${partner}`,
      cookies[4],
    );
    await check(
      `partner-detail?seasonId=${seasonId}&partnerId=${otherPartner}`,
      cookies[4],
      403,
    );
    await check("exports?seasonId=" + seasonId, cookies[2], 403);
    for (const c of cookies.slice(0, 2))
      await check("audit-sections?seasonId=" + seasonId, c);
    await check("audit-sections?seasonId=" + seasonId, cookies[2]);
    await check(
      "audit-sections?seasonId=" + seasonId + "&employeeId=" + otherEmployee,
      cookies[2],
      403,
    );
    await check("audit-sections?seasonId=" + seasonId, cookies[4], 403);
    const report = async (scope: string, cookie: string, extra = "") =>
      fetch(base + `/api/reports/${scope}?seasonId=${seasonId}${extra}`, {
        headers: { Cookie: cookie },
      });
    for (const c of [cookies[2], cookies[3]])
      for (const scope of ["management", "partner"]) {
        assert.equal((await report(scope, c, "&mode=draft")).status, 403);
        count++;
      }
    assert.equal(
      (await report("management", cookies[4], "&mode=draft")).status,
      403,
    );
    count++;
    assert.equal(
      (await report("partner", cookies[4], `&partnerId=${otherPartner}`))
        .status,
      403,
    );
    count++;
    assert.equal((await report("partner", cookies[4])).status, 409);
    count++;
    assert.equal((await report("management", cookies[0])).status, 409);
    count++;
    assert.equal((await report("management", "")).status, 401);
    count++;
    for (const c of cookies.slice(0, 2)) {
      const r = await report("management", c, "&mode=draft");
      assert.equal(r.status, 200);
      assert.match(r.headers.get("content-type")!, /spreadsheetml/);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(bytes[0], 80);
      assert.equal(bytes[1], 75);
      count++;
    }
    for (const [i, id] of [partner, otherPartner].entries()) {
      const projectId = await run("project", {
        seasonId,
        partnerId: id,
        name: `Закрытый проект ${i + 1}`,
        code: randomUUID(),
        client: "HTTP клиент",
        partnerRate: "0.5",
        startDate: "2026-01-01",
        confirmed: true,
      });
      await run("revenue", {
        seasonId,
        projectId,
        date: "2026-05-01",
        amount: "100",
        comment: "Доход HTTP-сценария",
      });
    }
    const cash = await run("account", { name: "Закрытая касса", kind: "CASH" });
    await run("transfer", {
      seasonId,
      date: "2026-01-01",
      toId: cash,
      amount: "1000",
      reason: "Начальный остаток",
    });
    const allocationId = await run("partner-allocation", { seasonId });
    await run("accept-calculation", {
      seasonId,
      kind: "ALLOCATION",
      id: allocationId,
      reason: "Подтверждено",
      confirmed: true,
    });
    for (const partnerId of [partner, otherPartner])
      await run("partner-payment", {
        seasonId,
        partnerId,
        date: "2026-12-31",
        accountId: cash,
        amount: "50",
        reason: "Полная выплата",
      });
    await run("reconciliation", {
      seasonId,
      date: "2026-12-31",
      ledgerAccountId: cash,
      actual: "900",
      explanation: "Сверено",
    });
    for (const name of requiredClosingChecks)
      await run("review", {
        seasonId,
        name,
        resolved: true,
        reason: "Проверено",
      });
    await run("close", { seasonId, reason: "HTTP снимок", confirmed: true });
    for (const [index, cookie] of cookies.entries()) {
      if (index === 2 || index === 3) continue;
      const scope = index < 2 ? "management" : "partner",
        r = await report(scope, cookie);
      assert.equal(r.status, 200);
      const book = new ExcelJS.Workbook();
      assert.match(
        r.headers.get("content-disposition")!,
        new RegExp("FinanceMAX-" + scope + "-" + seasonId),
      );
      if (scope === "partner")
        assert.ok(
          r.headers
            .get("content-disposition")!
            .includes(index === 4 ? partner : otherPartner),
        );
      await book.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
      assert.equal(book.worksheets.length, index < 2 ? 21 : 8);
      if (index >= 4) {
        const json = JSON.stringify(book.model);
        assert.ok(json.includes(`Закрытый проект ${index === 4 ? 1 : 2}`));
        assert.ok(!json.includes(`Закрытый проект ${index === 4 ? 2 : 1}`));
        assert.ok(!json.includes("Закрытая касса"));
      }
      count++;
    }
    const selectedPartner = await report(
      "partner",
      cookies[0],
      `&partnerId=${otherPartner}`,
    );
    assert.equal(selectedPartner.status, 200);
    assert.ok(
      selectedPartner.headers
        .get("content-disposition")!
        .includes(otherPartner),
    );
    count++;
    const tripSeason = await run("season", {
      name: "HTTP командировки",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const expenseCategory = await run("expense-category", {
      name: "Поездки HTTP",
    });
    const trip = await run("trip", {
      seasonId: tripSeason,
      employeeId: employee,
      destination: "Бухара",
      startDate: "2026-02-01",
      endDate: "2026-02-01",
      perDiemRate: "100",
      transport: "0",
      hotel: "0",
      other: "0",
      expenseCategoryId: expenseCategory,
      comment: "Проверка HTTP",
    });
    for (const c of cookies.slice(0, 2)) {
      const r = await fetch(base + "/api/v1/commands", {
        method: "POST",
        headers: {
          Cookie: c,
          Origin: base,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "trip-payment",
          requestId: randomUUID(),
          data: {
            seasonId: tripSeason,
            businessTripId: trip,
            date: "2026-02-01",
            accountingPeriod: "2026-02-01",
            accountId: cash,
            amount: "50",
            kind: "PAYMENT",
            reason: "Частичная оплата HTTP",
          },
        }),
      });
      assert.equal(r.status, 201);
      count++;
      await check(`trip-detail?seasonId=${tripSeason}&id=${trip}`, c);
    }
    const command = async (cookie: string, operation: string, origin = base) =>
      fetch(base + "/api/v1/commands", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation,
          requestId: randomUUID(),
          data: {
            seasonId,
            employeeId: employee,
            originalSettlementId: randomUUID(),
            requestedPayment: "10",
            reason: "Недопустимо",
            confirmed: true,
          },
        }),
      });
    for (const c of [cookies[2], cookies[4]]) {
      assert.equal((await command(c, "bonus-exception")).status, 403);
      assert.equal((await command(c, "accept-calculation")).status, 403);
      for (const operation of [
        "trip-payment",
        "trip-attribution",
        "trip-review",
        "audit-template",
        "project-type",
        "section-add",
        "section-update",
        "section-assignment",
        "work-section-attribution",
        "work-batch",
      ]) {
        assert.equal((await command(c, operation)).status, 403);
        count++;
      }
      await check(`trip-detail?seasonId=${seasonId}&id=${employee}`, c, 403);
      count += 2;
    }
    assert.equal(
      (await command(cookies[0], "bonus-exception", "https://foreign.invalid"))
        .status,
      403,
    );
    count++;
    for (let i = 0; i < 10; i++)
      await login("unknown-limit@test.local", "incorrect");
    assert.equal(
      (await login("unknown-limit@test.local", "incorrect")).status,
      429,
    );
    assert.equal((await login(users[0].email)).status, 200);
    count += 2;
    const page = await fetch(base + "/dashboard?seasonId=" + seasonId, {
      headers: { Cookie: cookies[0] },
    });
    assert.equal(page.status, 200);
    const csp = page.headers.get("content-security-policy")!;
    assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.ok((await page.text()).includes(`nonce="${nonce}"`));
    count++;
    assert.equal(
      (
        await fetch(base + "/api/auth/logout", {
          method: "POST",
          headers: { Cookie: cookies[2], Origin: base },
        })
      ).status,
      200,
    );
    await check(
      `employee-detail?seasonId=${seasonId}&employeeId=${employee}`,
      cookies[2],
      401,
    );
    const accountCommand=async(cookie:string,operation:string,data:Record<string,unknown>)=>fetch(base+'/api/v1/commands',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({operation,requestId:randomUUID(),data})});
    for(const op of ['user','user-password','user-update']){assert.equal((await accountCommand(cookies[4],op,{})).status,403);count++;}
    const accountPassword='Isolated-HTTP-Password!';
    const createdAccount=await accountCommand(cookies[0],'user',{name:'HTTP учетная запись',email:'account-http@test.local',role:'EMPLOYEE',password:accountPassword,confirmPassword:accountPassword});
    assert.equal(createdAccount.status,201);const targetAccount=(await createdAccount.json()).id;count++;
    const beforeReset=await login('account-http@test.local',accountPassword);assert.equal(beforeReset.status,200);const oldCookie=beforeReset.headers.get('set-cookie')!.split(';')[0];count++;
    const replacement='HTTP-Replacement-Password!';assert.equal((await accountCommand(cookies[0],'user-password',{id:targetAccount,password:replacement,confirmPassword:replacement})).status,201);count++;
    await check('me',oldCookie,401);assert.equal((await login('account-http@test.local',accountPassword)).status,401);count++;
    const afterReset=await login('account-http@test.local',replacement);assert.equal(afterReset.status,200);count++;
    assert.equal((await accountCommand(cookies[0],'user-update',{id:targetAccount,email:'account-http@test.local',role:'EMPLOYEE',active:false})).status,201);count++;
    await check('me',afterReset.headers.get('set-cookie')!.split(';')[0],401);assert.equal((await login('account-http@test.local',replacement)).status,401);count++;
    console.log(`HTTP_CHECKS_PASSED=${count}`);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    output.end();
  }
});

