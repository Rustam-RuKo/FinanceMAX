import { z } from "zod";
import { id, text, money, optionalId } from "./validation";
import { ensure } from "./errors";
import type { Tx } from "./calculation-data";
import type { Principal } from "../domain/authorization";
import { d } from "../domain/calculations";
import { projectTypeName } from "../domain/audit-templates";
export const auditProjectType = z.enum(["INDUSTRIAL", "INTERNATIONAL"], {
  error: "Выберите тип проекта",
});
export const sectionSelection = z
  .array(
    z.object({
      templateId: optionalId,
      code: text.optional(),
      name: text.optional(),
    }),
  )
  .max(100, "Не более 100 разделов")
  .default([]);
export async function addSections(
  tx: Tx,
  user: Principal,
  projectId: string,
  raw: unknown,
) {
  const selected = sectionSelection.parse(raw),
    project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  let order =
    (
      await tx.projectAuditSection.aggregate({
        where: { projectId },
        _max: { sortOrder: true },
      })
    )._max.sortOrder ?? 0;
  const result = [];
  for (const item of selected) {
    const template = item.templateId
      ? await tx.auditSectionTemplate.findUnique({
          where: { id: item.templateId },
        })
      : null;
    if (item.templateId)
      ensure(
        template?.active && template.projectType === project.projectType,
        "Шаблон не соответствует типу проекта или архивирован",
      );
    const code = template?.code ?? item.code,
      name = template?.name ?? item.name;
    ensure(code && name, "Укажите код и название своего раздела");
    result.push(
      await tx.projectAuditSection.create({
        data: {
          projectId,
          templateId: template?.id,
          codeSnapshot: code,
          nameSnapshot: name,
          sortOrder: ++order,
          createdBy: user.id,
        },
      }),
    );
  }
  return result;
}
async function projectScope(tx: Tx, projectId: string, seasonId: string) {
  ensure(
    await tx.projectSeason.findUnique({
      where: { projectId_seasonId: { projectId, seasonId } },
    }),
    "Проект не относится к выбранному сезону",
  );
  const links = await tx.projectSeason.findMany({
    where: {
      projectId,
      seasonId: { not: seasonId },
      season: { status: { not: "Закрыт" } },
    },
  });
  for (const link of links)
    await tx.season.update({
      where: { id: link.seasonId },
      data: { revision: { increment: 1 } },
    });
}
export async function sectionCommand(
  tx: Tx,
  user: Principal,
  operation: string,
  raw: Record<string, unknown>,
): Promise<{ id: string } | null> {
  if (operation === "audit-template") {
    const p = z
      .object({
        id: optionalId,
        projectType: auditProjectType,
        code: text,
        name: text,
        sortOrder: z.coerce.number().int().min(0),
        active: z.boolean().default(true),
        description: text.optional(),
        reason: text,
      })
      .parse(raw);
    const { id: templateId, reason, ...data } = p;
    return templateId
      ? tx.auditSectionTemplate.update({ where: { id: templateId }, data })
      : tx.auditSectionTemplate.create({ data });
  }
  if (
    ![
      "project-type",
      "section-add",
      "section-update",
      "section-assignment",
      "work-section-attribution",
    ].includes(operation)
  )
    return null;
  const scope = z
    .object({ seasonId: id, projectId: id, reason: text })
    .parse(raw);
  await projectScope(tx, scope.projectId, scope.seasonId);
  if (operation === "project-type")
    return tx.project.update({
      where: { id: scope.projectId },
      data: {
        projectType: auditProjectType.parse(raw.projectType),
        updatedBy: user.id,
      },
    });
  if (operation === "section-add") {
    const rows = await addSections(tx, user, scope.projectId, raw.sections);
    ensure(rows.length, "Выберите хотя бы один раздел");
    return rows[0];
  }
  const sectionId = id.parse(raw.projectAuditSectionId);
  const section = await tx.projectAuditSection.findUnique({
    where: { id: sectionId },
  });
  ensure(
    section?.projectId === scope.projectId,
    "Раздел не принадлежит выбранному проекту",
  );
  if (operation === "section-update") {
    const p = z
      .object({
        active: z.boolean(),
        sortOrder: z.coerce.number().int().min(0),
      })
      .parse(raw);
    return tx.projectAuditSection.update({ where: { id: sectionId }, data: p });
  }
  ensure(section.active, "Раздел архивирован");
  if (operation === "section-assignment") {
    const p = z
      .object({
        employeeId: id,
        plannedHours: money.optional(),
        defaultComplexityLevelId: optionalId,
        active: z.boolean().default(true),
      })
      .parse(raw);
    ensure(
      await tx.employee.findFirst({
        where: { id: p.employeeId, archived: false },
      }),
      "Сотрудник не найден или архивирован",
    );
    if (p.defaultComplexityLevelId)
      ensure(
        await tx.complexityLevel.findFirst({
          where: { id: p.defaultComplexityLevelId, active: true },
        }),
        "Уровень сложности недоступен",
      );
    await tx.projectAssignment.upsert({
      where: {
        projectId_employeeId: {
          projectId: scope.projectId,
          employeeId: p.employeeId,
        },
      },
      create: {
        projectId: scope.projectId,
        employeeId: p.employeeId,
        createdBy: user.id,
      },
      update: {},
    });
    return tx.projectSectionAssignment.upsert({
      where: {
        projectAuditSectionId_employeeId: {
          projectAuditSectionId: sectionId,
          employeeId: p.employeeId,
        },
      },
      create: { ...p, projectAuditSectionId: sectionId, createdBy: user.id },
      update: {
        ...p,
        plannedHours: p.plannedHours ?? null,
        defaultComplexityLevelId: p.defaultComplexityLevelId ?? null,
      },
    });
  }
  const workId = id.parse(raw.workEntryId);
  ensure(raw.confirmed === true, "Подтвердите отнесение исторической записи");
  const entry = await tx.workEntry.findUnique({ where: { id: workId } });
  ensure(
    entry &&
      entry.projectId === scope.projectId &&
      entry.seasonId === scope.seasonId &&
      !entry.projectAuditSectionId &&
      !entry.voided,
    "Доступна только действующая историческая запись этого проекта и сезона без раздела",
  );
  ensure(
    await tx.projectSectionAssignment.findFirst({
      where: {
        projectAuditSectionId: sectionId,
        employeeId: entry.employeeId,
        active: true,
      },
    }),
    "Сначала назначьте сотрудника на раздел",
  );
  await tx.$executeRaw`SELECT set_config('financemax.section_attribution',${entry.id},true)`;
  return tx.workEntry.update({
    where: { id: entry.id },
    data: { projectAuditSectionId: sectionId, updatedBy: user.id },
  });
}
export async function auditSectionRows(
  tx: Tx,
  seasonId?: string,
  projectId?: string,
  employeeId?: string,
) {
  const sections = await tx.projectAuditSection.findMany({
    where: {
      projectId,
      project: seasonId ? { seasons: { some: { seasonId } } } : undefined,
      ...(employeeId
        ? {
            OR: [
              { assignments: { some: { employeeId } } },
              { workEntries: { some: { employeeId, seasonId } } },
            ],
          }
        : {}),
    },
    include: {
      project: true,
      assignments: {
        where: { ...(employeeId ? { employeeId } : {}), active: true },
        include: { employee: true },
      },
      workEntries: { where: { seasonId, employeeId, voided: false } },
    },
    orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  return sections.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    project: s.project.name,
    projectType: projectTypeName(s.project.projectType),
    code: s.codeSnapshot,
    name: s.nameSnapshot,
    sortOrder: s.sortOrder,
    active: s.active,
    status: s.active ? "Активен" : "Архив",
    employees: s.assignments.map((a) => a.employee.name).join(", "),
    employeeIds: s.assignments.map((a) => a.employeeId),
    plannedHours: s.workEntries
      .reduce((v, w) => v.plus(w.plannedHours.toString()), d("0"))
      .toFixed(4),
    actualHours: s.workEntries
      .reduce((v, w) => v.plus(w.actualHours.toString()), d("0"))
      .toFixed(4),
    earned: s.workEntries
      .reduce((v, w) => v.plus(w.earned.toString()), d("0"))
      .toFixed(4),
    assignedPlannedHours: s.assignments
      .reduce((v, a) => v.plus(a.plannedHours?.toString() ?? 0), d("0"))
      .toFixed(4),
    hasWork: s.workEntries.length > 0,
    progress: s.workEntries.length
      ? "Есть рабочее время"
      : s.assignments.length
        ? "Есть назначение"
        : "Без назначения",
  }));
}
