import { createHash } from "node:crypto";
import { AppError } from "./errors";
const buckets = new Map<string, { count: number; until: number }>();
export function checkLoginRate(
  email: string,
  client: string,
  now = Date.now(),
) {
  for (const [key, value] of buckets)
    if (value.until <= now) buckets.delete(key);
  const key = createHash("sha256")
    .update(email.trim().toLowerCase() + "\0" + client)
    .digest("hex");
  const prior = buckets.get(key);
  if (prior && prior.count >= 10)
    throw new AppError(
      429,
      "Слишком много попыток входа для этой учетной записи. Повторите через минуту",
    );
  if (!prior && buckets.size >= 10000)
    buckets.delete(buckets.keys().next().value!);
  buckets.set(key, {
    count: (prior?.count ?? 0) + 1,
    until: prior?.until ?? now + 60000,
  });
}
