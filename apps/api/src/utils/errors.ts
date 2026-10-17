/** Application error with a stable machine code and a human-readable message (rule 3). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found.`);
