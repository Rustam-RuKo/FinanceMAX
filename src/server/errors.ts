export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  message: string,
  status = 422,
): asserts value {
  if (!value) throw new AppError(status, message);
}
