import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportScope,
  financialScope,
  requireManagement,
} from "../src/domain/authorization.js";
test("employees cannot export or mutate management data", () => {
  const user = { id: "u", role: "EMPLOYEE" as const, employeeId: "e" };
  assert.throws(() => exportScope(user));
  assert.throws(() => requireManagement(user));
  assert.deepEqual(financialScope(user), { employeeId: "e" });
});
test("partner scope is mandatory; missing identity fails closed", () => {
  assert.deepEqual(exportScope({ id: "u", role: "PARTNER", partnerId: "p" }), {
    partnerId: "p",
  });
  assert.throws(() => financialScope({ id: "u", role: "PARTNER" }));
});
