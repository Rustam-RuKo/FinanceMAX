export type Field = {
  name: string;
  label: string;
  type?:
    "password" | "date" | "select" | "checkbox" | "allocations" | "textarea";
  options?: string;
  optional?: boolean;
  value?: string;
};
export type FormSpec = {
  operation: string;
  title: string;
  fields: Field[];
  critical?: boolean;
};
const field = (
  name: string,
  label: string,
  type?: Field["type"],
  options?: string,
  optional = false,
  value?: string,
): Field => ({ name, label, type, options, optional, value });
const season = field("seasonId", "Сезон", "select", "seasons");
const day = field("date", "Дата", "date");
const reason = field("reason", "Основание / причина", "textarea");
const employee = field("employeeId", "Сотрудник", "select", "employees");
const project = field("projectId", "Проект", "select", "projects");
const amount = field("amount", "Сумма, UZS", undefined, undefined, false, "0");
const account = field("accountId", "Счет оплаты", "select", "accounts");
const from = field("validFrom", "Действует с", "date");
export const navigation = [
  ["dashboard", "Главная"],
  ["projects", "Проекты"],
  ["audit-sections", "Разделы аудита"],
  ["employees", "Сотрудники"],
  ["partners", "Партнеры"],
  ["work", "Рабочее время"],
  ["payments", "Зарплаты и выплаты"],
  ["trips", "Командировки"],
  ["expenses", "Расходы"],
  ["cash", "Наличные"],
  ["cashout", "Обналичивание"],
  ["bank", "Банк"],
  ["journal", "Финансовый журнал"],
  ["quarters", "Квартальные расчеты"],
  ["season-settlements", "Сезонный расчет"],
  ["reports", "Отчеты"],
  ["settings", "Настройки"],
] as const;
export const forms: Record<string, FormSpec[]> = {
  "audit-templates": [
    {
      operation: "audit-template",
      title: "Создать / изменить шаблон",
      fields: [
        field(
          "id",
          "Идентификатор изменяемого шаблона",
          undefined,
          undefined,
          true,
        ),
        field("projectType", "Тип проекта", "select", "projectTypes"),
        field("code", "Код"),
        field("name", "Название"),
        field("sortOrder", "Порядок"),
        field("active", "Активен", "checkbox"),
        field("description", "Описание", undefined, undefined, true),
        reason,
      ],
    },
  ],
  "audit-sections": [
    {
      operation: "section-add",
      title: "Добавить разделы проекта",
      fields: [season, project, reason],
    },
    {
      operation: "section-assignment",
      title: "Назначение на раздел",
      fields: [
        season,
        project,
        field("projectAuditSectionId", "Раздел", "select", "projectSections"),
        employee,
        field("plannedHours", "План часов", undefined, undefined, true),
        field(
          "defaultComplexityLevelId",
          "Уровень сложности по умолчанию",
          "select",
          "levels",
          true,
        ),
        field("active", "Назначение активно", "checkbox"),
        reason,
      ],
    },
    {
      operation: "section-update",
      title: "Порядок / архив раздела",
      fields: [
        season,
        project,
        field(
          "projectAuditSectionId",
          "Раздел",
          "select",
          "allProjectSections",
        ),
        field("sortOrder", "Порядок"),
        field("active", "Раздел активен", "checkbox"),
        reason,
      ],
    },
    {
      operation: "work-section-attribution",
      title: "Отнести историческую работу к разделу",
      critical: true,
      fields: [
        season,
        project,
        field("workEntryId", "Идентификатор исторической работы"),
        field("projectAuditSectionId", "Раздел", "select", "projectSections"),
        reason,
        field(
          "confirmed",
          "Подтверждаю отнесение с записью в аудит",
          "checkbox",
        ),
      ],
    },
  ],
  settings: [],
  seasons: [
    {
      operation: "season",
      title: "Новый сезон",
      fields: [
        field("name", "Название"),
        field("startDate", "Начало", "date"),
        field("endDate", "Окончание", "date"),
      ],
    },
  ],
  employees: [
    {
      operation: "employee",
      title: "Добавить сотрудника",
      fields: [field("name", "ФИО")],
    },
    {
      operation: "salary-rate",
      title: "Ставка зарплаты",
      fields: [
        employee,
        amount,
        from,
        field("validTo", "Действует по", "date", undefined, true),
      ],
    },
    {
      operation: "person-update",
      title: "Изменить / архивировать",
      critical: true,
      fields: [
        field("id", "Сотрудник", "select", "allEmployees"),
        field("kind", "Тип", "select", "employeeKind"),
        field("name", "ФИО"),
        field("archived", "В архиве", "checkbox"),
        reason,
      ],
    },
  ],
  partners: [
    {
      operation: "partner",
      title: "Добавить партнера",
      fields: [field("name", "ФИО")],
    },
    {
      operation: "person-update",
      title: "Изменить / архивировать",
      critical: true,
      fields: [
        field("id", "Партнер", "select", "allPartners"),
        field("kind", "Тип", "select", "partnerKind"),
        field("name", "ФИО"),
        field("archived", "В архиве", "checkbox"),
        reason,
      ],
    },
    {
      operation: "partner-payment",
      title: "Выплата партнеру",
      critical: true,
      fields: [
        season,
        day,
        field("partnerId", "Партнер", "select", "partners"),
        account,
        amount,
        reason,
      ],
    },
  ],
  rates: [
    {
      operation: "complexity",
      title: "Новый уровень сложности",
      fields: [
        field("name", "Название"),
        field("hourlyRate", "Ставка в час, UZS"),
        from,
      ],
    },
    {
      operation: "complexity-rate",
      title: "Новая историческая ставка",
      fields: [
        field("complexityLevelId", "Уровень сложности", "select", "levels"),
        field("hourlyRate", "Ставка в час, UZS"),
        from,
      ],
    },
  ],
  projects: [
    {
      operation: "project-type",
      title: "Назначить тип проекта",
      fields: [
        season,
        project,
        field("projectType", "Тип проекта", "select", "projectTypes"),
        reason,
      ],
    },
    {
      operation: "project",
      title: "Новый проект",
      critical: true,
      fields: [
        season,
        field("name", "Название"),
        field("code", "Внутренний код"),
        field("client", "Клиент"),
        field("partnerId", "Партнер", "select", "partners"),
        field(
          "partnerRate",
          "Фиксированная доля партнера на весь проект (0–1)",
          undefined,
          undefined,
          false,
          "0.3",
        ),
        field("startDate", "Начало", "date"),
        field("endDate", "Окончание", "date", undefined, true),
        field(
          "confirmed",
          "Подтверждаю фиксированную ставку на весь проект",
          "checkbox",
        ),
      ],
    },
    {
      operation: "project-rate-correction",
      title: "Исправить ошибочно введенную ставку партнера",
      critical: true,
      fields: [
        season,
        project,
        field("partnerRate", "Исправленная фиксированная доля (0–1)"),
        reason,
        field(
          "confirmed",
          "Подтверждаю исправление ошибки с сохранением аудита",
          "checkbox",
        ),
      ],
    },
    {
      operation: "assignment",
      title: "Назначить сотрудника",
      fields: [season, project, employee],
    },
    {
      operation: "project-status",
      title: "Изменить статус",
      fields: [
        season,
        project,
        field("status", "Статус", "select", "projectStatuses"),
        reason,
      ],
    },
    {
      operation: "revenue",
      title: "Доход проекта",
      critical: true,
      fields: [
        season,
        day,
        project,
        amount,
        { ...account, optional: true },
        field("comment", "Комментарий", "textarea"),
      ],
    },
  ],
  work: [
    {
      operation: "work",
      title: "Добавить рабочее время",
      fields: [
        season,
        day,
        project,
        employee,
        field("complexityLevelId", "Уровень сложности", "select", "levels"),
        field("description", "Задача", "textarea"),
        field("plannedHours", "Плановые часы"),
        field("actualHours", "Фактические часы"),
        field(
          "correctionOf",
          "Идентификатор отмененной записи",
          undefined,
          undefined,
          true,
        ),
      ],
    },
  ],
  payments: [
    {
      operation: "payment",
      title: "Провести выплату",
      critical: true,
      fields: [
        season,
        employee,
        field("paymentCategoryId", "Категория", "select", "paymentCategories"),
        account,
        field("paymentDate", "Дата выплаты", "date"),
        field("accountingPeriod", "Расчетный месяц (первое число)", "date"),
        amount,
        field(
          "quarterEmployeeSettlementId",
          "Исходный квартальный расчет",
          "select",
          "quarters",
          true,
        ),
        reason,
      ],
    },
    {
      operation: "payment-category",
      title: "Категория выплаты",
      fields: [
        field("name", "Название"),
        field("kind", "Тип выплаты", "select", "paymentKinds"),
        field("settlementRelevant", "Учитывать в компенсации", "checkbox"),
      ],
    },
  ],
  quarters: [
    {
      operation: "quarter",
      title: "Сохранить расчет квартала",
      fields: [
        season,
        employee,
        field("periodStart", "Первый день квартала", "date"),
      ],
    },
  ],
  expenses: [
    {
      operation: "expense",
      title: "Добавить расход",
      critical: true,
      fields: [
        season,
        day,
        { ...project, optional: true },
        field("expenseCategoryId", "Категория", "select", "expenseCategories"),
        field("amount", "Сумма в валюте операции"),
        field("currency", "Валюта", undefined, undefined, false, "UZS"),
        field("exchangeRate", "Курс в UZS", undefined, undefined, false, "1"),
        field(
          "allocationReference",
          "Для частей межсезонного расхода — ссылка на исходный документ",
          undefined,
          undefined,
          true,
        ),
        field(
          "allocationOriginalTotal",
          "Полная сумма исходного документа в UZS (не сумма части)",
          undefined,
          undefined,
          true,
        ),
        { ...account, optional: true },
        field("comment", "Комментарий", "textarea"),
      ],
    },
    {
      operation: "expense-category",
      title: "Категория расходов",
      fields: [field("name", "Название")],
    },
  ],
  trips: [
    {
      operation: "trip",
      title: "Новая командировка",
      fields: [
        season,
        employee,
        { ...project, optional: true },
        field("destination", "Место назначения"),
        field("startDate", "Начало", "date"),
        field("endDate", "Окончание", "date"),
        field("perDiemRate", "Суточные, UZS"),
        field("transport", "Транспорт, UZS"),
        field("hotel", "Проживание, UZS"),
        field("other", "Прочие расходы, UZS"),
        field("expenseCategoryId", "Категория", "select", "expenseCategories"),
        field("comment", "Комментарий", "textarea"),
      ],
    },
  ],
  bank: [
    {
      operation: "account",
      title: "Добавить счет",
      fields: [
        field("name", "Название"),
        field("kind", "Тип счета", "select", "accountKinds"),
        field("bank", "Банк", undefined, undefined, true),
      ],
    },
    {
      operation: "transfer",
      title: "Перевод / начальный остаток",
      critical: true,
      fields: [
        season,
        day,
        field(
          "fromId",
          "Счет списания (пусто — начальный остаток)",
          "select",
          "accounts",
          true,
        ),
        field("toId", "Счет зачисления", "select", "accounts"),
        amount,
        reason,
      ],
    },
  ],
  cash: [
    {
      operation: "reconciliation",
      title: "Провести сверку кассы / банка",
      fields: [
        season,
        day,
        field("ledgerAccountId", "Счет", "select", "accounts"),
        field("actual", "Фактический остаток, UZS"),
        field("explanation", "Объяснение", "textarea", undefined, true),
      ],
    },
    {
      operation: "resolve-reconciliation",
      title: "Объяснить расхождение",
      critical: true,
      fields: [season, field("id", "Идентификатор сверки"), reason],
    },
  ],
  cashout: [
    {
      operation: "cashout",
      title: "Провести обналичивание",
      critical: true,
      fields: [
        season,
        day,
        field("bankAccountId", "Банковский счет", "select", "banks"),
        field("cashAccountId", "Касса", "select", "cashAccounts"),
        field("cashOutMethodId", "Способ", "select", "methods"),
        field("bankOut", "Списано с банка, UZS"),
        field("cashReceived", "Фактически получено, UZS"),
        field("purpose", "Назначение", "textarea"),
        field(
          "allocations",
          "Распределение фактической стоимости",
          "allocations",
        ),
      ],
    },
    {
      operation: "cashout-method",
      title: "Новый способ",
      fields: [
        field("name", "Название"),
        field("rate", "Ставка (0–1)", undefined, undefined, false, "0.06"),
        from,
      ],
    },
  ],
  allocations: [
    {
      operation: "partner-allocation",
      title: "Рассчитать партнеров",
      fields: [season],
    },
    {
      operation: "manual-allocation",
      title: "Ручное распределение",
      critical: true,
      fields: [
        season,
        reason,
        field(
          "allocations",
          "Каждый проект и сумма распределения",
          "allocations",
        ),
      ],
    },
  ],
  "season-settlements": [
    {
      operation: "season-settlement",
      title: "Сохранить сезонный расчет",
      fields: [season, employee],
    },
  ],
  reconciliation: [
    {
      operation: "review",
      title: "Проверить раздел",
      fields: [
        season,
        field("name", "Раздел проверки", "select", "checks"),
        field("resolved", "Проверка выполнена", "checkbox"),
        reason,
      ],
    },
    {
      operation: "close",
      title: "Закрыть сезон",
      critical: true,
      fields: [
        season,
        reason,
        field("confirmed", "Подтверждаю закрытие сезона", "checkbox"),
      ],
    },
    {
      operation: "reopen",
      title: "Открыть для коррекции",
      critical: true,
      fields: [
        season,
        reason,
        field("confirmed", "Подтверждаю открытие для коррекции", "checkbox"),
      ],
    },
  ],
  journal: [
    {
      operation: "correction",
      title: "Отменить операцию / запись",
      critical: true,
      fields: [
        season,
        day,
        field("entity", "Тип исходной записи", "select", "correctionKinds"),
        field("id", "Идентификатор исходной записи"),
        reason,
      ],
    },
  ],
};
export const staticOptions: Record<string, { id: string; name: string }[]> = {
  projectTypes: [
    { id: "INDUSTRIAL", name: "Производственное предприятие" },
    { id: "INTERNATIONAL", name: "Международный проект" },
  ],
  roles: [
    { id: "ADMIN_MANAGEMENT", name: "Управление" },
    { id: "PARTNER", name: "Партнер" },
    { id: "EMPLOYEE", name: "Сотрудник" },
  ],
  employeeKind: [{ id: "employee", name: "Сотрудник" }],
  partnerKind: [{ id: "partner", name: "Партнер" }],
  accountKinds: [
    { id: "BANK", name: "Банк" },
    { id: "CASH", name: "Наличные" },
  ],
  paymentKinds: [
    { id: "SALARY", name: "Фиксированная зарплата" },
    { id: "BONUS", name: "Квартальный бонус" },
    { id: "OTHER", name: "Прочая выплата" },
    { id: "REIMBURSEMENT", name: "Возмещение расходов" },
    { id: "FINAL", name: "Сезонная выплата" },
  ],
  projectStatuses: [
    "Черновик",
    "Активный",
    "Приостановлен",
    "Завершен",
    "Закрыт",
  ].map((id) => ({ id, name: id })),
  correctionKinds: [
    ["work", "Рабочее время"],
    ["expense", "Расход"],
    ["revenue", "Доход"],
    ["payment", "Выплата сотруднику"],
    ["cashout", "Обналичивание"],
    ["journal", "Перевод / выплата партнеру"],
    ["trip", "Командировка"],
  ].map(([id, name]) => ({ id, name })),
  checks: [
    "Проекты",
    "Доходы",
    "Расходы",
    "Рабочее время",
    "Расчеты сотрудников",
    "Расчеты партнеров",
    "Командировки",
    "Банк",
    "Наличные",
    "Обналичивание",
    "Сверка кассы",
    "Необъясненные расхождения",
  ].map((id) => ({ id, name: id })),
};

for (const [section, kind] of [
  ["quarters", "QUARTER"],
  ["season-settlements", "SEASON"],
  ["allocations", "ALLOCATION"],
]) {
  forms[section].push({
    operation: "accept-calculation",
    title: "Принять версию расчета",
    critical: true,
    fields: [
      season,
      field("kind", "Тип расчета", "select", "accept" + kind),
      field("id", "Идентификатор версии"),
      reason,
    ],
  });
}
forms.projects.push({
  operation: "project-season",
  title: "Продолжить проект в сезоне",
  critical: true,
  fields: [
    season,
    field("projectId", "Проект за все сезоны", "select", "allProjects"),
    reason,
  ],
});
forms.payments.push({
  operation: "bonus-exception",
  title: "Одобрить исключительную выплату бонуса",
  critical: true,
  fields: [
    season,
    employee,
    field(
      "originalSettlementId",
      "Исходный квартальный расчет",
      "select",
      "quarters",
    ),
    field("requestedPayment", "Запрошенная выплата, UZS"),
    reason,
  ],
});
forms.payments
  .find((f) => f.operation === "payment")!
  .fields.push(
    field(
      "bonusApprovalId",
      "Отдельное одобрение исключения",
      "select",
      "bonusApprovals",
      true,
    ),
  );
(forms["partner-payments"] ??= []).push({
  operation: "attribute-partner-payment",
  title: "Отнести выплату к принятому начислению",
  critical: true,
  fields: [
    season,
    field("paymentId", "Идентификатор действующей выплаты"),
    reason,
  ],
});

for (const specs of Object.values(forms))
  for (const spec of specs)
    if (
      [
        "accept-calculation",
        "project-season",
        "bonus-exception",
        "attribute-partner-payment",
      ].includes(spec.operation)
    )
      spec.fields.push(
        field("confirmed", "Явно подтверждаю решение руководства", "checkbox"),
      );

staticOptions.acceptQUARTER = [{ id: "QUARTER", name: "Квартальный расчет" }];
staticOptions.acceptSEASON = [{ id: "SEASON", name: "Сезонный расчет" }];
staticOptions.acceptALLOCATION = [
  { id: "ALLOCATION", name: "Распределение партнеров" },
];

const trip = field("businessTripId", "Командировка", "select", "trips");
const tripKind = field("kind", "Вид выплаты", "select", "tripPaymentKinds");
const tripSource = field(
  "cashOutTransactionId",
  "Источник обналичивания (идентификатор, если применимо)",
  undefined,
  undefined,
  true,
);
const tripDocument = field(
  "document",
  "Подтверждающий документ / ссылка",
  undefined,
  undefined,
  true,
);
forms.trips.push(
  {
    operation: "trip-payment",
    title: "Выплата / возврат по командировке",
    critical: true,
    fields: [
      season,
      trip,
      day,
      field("accountingPeriod", "Дата учета", "date"),
      amount,
      tripKind,
      account,
      tripSource,
      reason,
      tripDocument,
    ],
  },
  {
    operation: "trip-attribution",
    title: "Отнести существующую выплату (без новой проводки)",
    critical: true,
    fields: [
      season,
      trip,
      field(
        "journalTransactionId",
        "Идентификатор существующей финансовой операции",
      ),
      tripKind,
      tripSource,
      reason,
      tripDocument,
      field(
        "confirmed",
        "Подтверждаю явное отнесение выплаты и сохранение аудита",
        "checkbox",
      ),
    ],
  },
  {
    operation: "trip-review",
    title: "Подтвердить полноту исторических выплат",
    critical: true,
    fields: [
      season,
      trip,
      reason,
      field(
        "confirmed",
        "Подтверждаю полноту сведений по первичным документам",
        "checkbox",
      ),
    ],
  },
);
staticOptions.tripPaymentKinds = [
  { id: "ADVANCE", name: "Аванс" },
  { id: "PAYMENT", name: "Оплата" },
  { id: "REIMBURSEMENT", name: "Возмещение после поездки" },
  { id: "SETTLEMENT", name: "Дополнительная выплата" },
  { id: "RETURN", name: "Возврат аванса" },
];

