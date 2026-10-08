// Explicitly adapt pre-section financial fixtures to the new input contract.
// Tests of missing/foreign sections call the production command directly instead.
import { executeCommand as command } from "../src/server/workflows";
import { db } from "../src/server/db";
import { randomUUID } from "node:crypto";
import type { Principal } from "../src/domain/authorization";
export async function executeCommand(user: Principal, input: any) {
  if (user.role !== "ADMIN_MANAGEMENT") return command(user, input);
  const data = { ...input.data };
  if (input.operation === "project" && !data.projectType)
    data.projectType = "INDUSTRIAL";
  if (input.operation === "work" && !data.projectAuditSectionId) {
    let section = await db.projectAuditSection.findFirst({
      where: { projectId: data.projectId, codeSnapshot: "ТЕСТ" },
    });
    if (!section) {
      await command(user, {
        operation: "section-add",
        requestId: randomUUID(),
        data: {
          seasonId: data.seasonId,
          projectId: data.projectId,
          reason: "Раздел финансового тестового сценария",
          sections: [{ code: "ТЕСТ", name: "Работы тестового сценария" }],
        },
      });
      section = await db.projectAuditSection.findFirstOrThrow({
        where: { projectId: data.projectId, codeSnapshot: "ТЕСТ" },
      });
    }
    if (
      !(await db.projectSectionAssignment.findFirst({
        where: {
          projectAuditSectionId: section.id,
          employeeId: data.employeeId,
        },
      }))
    )
      await command(user, {
        operation: "section-assignment",
        requestId: randomUUID(),
        data: {
          seasonId: data.seasonId,
          projectId: data.projectId,
          projectAuditSectionId: section.id,
          employeeId: data.employeeId,
          reason: "Назначение тестового сценария",
        },
      });
    data.projectAuditSectionId = section.id;
  }
  return command(user, { ...input, data });
}
