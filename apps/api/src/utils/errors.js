/** Application error with a stable machine code and a human-readable message (rule 3). */
export class AppError extends Error {
  code;
  status;
  fields;
  constructor(code, status, message, fields) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.name = "AppError";
  }
}
export const notFound = (what = "Resource") =>
  new AppError("NOT_FOUND", 404, `${what} not found.`);
