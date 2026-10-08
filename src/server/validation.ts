import { z } from "zod";
z.config(z.locales.ru());
export const id = z.string().uuid("Некорректный идентификатор");
export const money = z
  .string()
  .regex(
    /^\d{1,16}(\.\d{1,4})?$/,
    "Укажите неотрицательную сумму, до 4 знаков после запятой",
  );
export const rate = z
  .string()
  .regex(/^(0(\.\d{1,12})?|1(\.0{1,12})?)$/, "Ставка должна быть от 0 до 1");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату")
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Некорректная дата",
  );
export const text = z
  .string()
  .trim()
  .min(1, "Заполните поле")
  .max(1000, "Не более 1000 символов");
export const optionalId = z.preprocess(
  (v) => (v === "" ? undefined : v),
  id.optional(),
);
export const command = z.object({
  operation: text,
  requestId: id,
  data: z.record(z.string(), z.unknown()),
});
export const asDate = (value: string) => new Date(value + "T00:00:00.000Z");
export const sumStrings = (values: { toString(): string }[]) =>
  values.map((v) => v.toString());
