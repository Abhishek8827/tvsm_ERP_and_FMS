import { AppError } from "../utils/errors.js";

/**
 * Server-side RBAC (rule 12). Use AFTER authenticate. A wrong-role call returns 403 no matter
 * what the UI shows. Every route declares the roles it allows explicitly, nothing is "open by default".
 */
export function requireRole(...allowed) {
  if (allowed.length === 0)
    throw new Error("requireRole needs at least one role");
  return (req, _res, next) => {
    if (!req.user)
      return next(
        new AppError("UNAUTHENTICATED", 401, "Please sign in to continue."),
      );
    if (!allowed.includes(req.user.role)) {
      return next(
        new AppError(
          "FORBIDDEN",
          403,
          "You do not have permission to do this.",
        ),
      );
    }
    next();
  };
}
