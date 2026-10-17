import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { AppError } from '../utils/errors';

/** Field-level validation errors (rule 15) in a shape the web forms can show next to inputs. */
function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: req.id } });
};

export function createErrorHandler(logger: Logger, isProduction: boolean): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid.',
          fields: zodFields(err),
          requestId: req.id,
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, fields: err.fields, requestId: req.id },
      });
      return;
    }
    // Body-parser errors (malformed JSON, payload too large) carry a status.
    const status =
      typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) logger.error({ err, requestId: req.id }, 'Unhandled error');
    res.status(status).json({
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        // Never leak stack traces or internals in production (TDD 6.2).
        message:
          status === 500
            ? 'Something went wrong on our side. Please try again.'
            : isProduction
              ? 'The request could not be processed.'
              : String(err?.message ?? 'Bad request'),
        requestId: req.id,
      },
    });
  };
}
