import { AppError } from '../utils/errors.js';
import { recordAudit } from '../services/audit.js';

/**
 * Authentication for every protected route (TDD 4.1, prompt rule 12):
 *  1. A Firebase ID token must be present and valid (signature, expiry, not revoked).
 *  2. The person must exist in OUR database for this school and be active.
 *  3. The role that counts is the DATABASE role. The custom claim in the token must agree with
 *     it, otherwise the token is stale (e.g. role was changed) and the client is told to refresh.
 * A role or tenant sent by the browser (headers, body, query) is never read.
 */
export function createAuthenticate(deps) {
  const { verifyToken, userStore, tenantId, logger } = deps;

  return async function authenticate(req, _res, next) {
    try {
      const header = req.header('authorization') ?? '';
      const match = /^Bearer (.+)$/.exec(header);
      if (!match) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in to continue.');

      let decoded;
      try {
        decoded = await verifyToken(match[1]);
      } catch (err) {
        logger.warn({ requestId: req.id, code: err?.code }, 'Token rejected');
        throw new AppError(
          'INVALID_TOKEN',
          401,
          'Your session is not valid. Please sign in again.',
        );
      }

      const user = await userStore.findByFirebaseUid(tenantId, decoded.uid);
      if (!user) {
        throw new AppError(
          'NO_ACCOUNT',
          403,
          'This login is not set up for the school system. Please contact the Admin.',
        );
      }
      if (!user.isActive) {
        await recordAudit(
          deps,
          { id: req.id, ip: req.ip, user: undefined },
          {
            action: 'login_blocked',
            entity: 'user',
            entityId: String(user._id),
            reason: 'Deactivated account tried to use the system',
          },
        );
        throw new AppError(
          'ACCOUNT_DISABLED',
          403,
          'This account has been deactivated. Please contact the Admin.',
        );
      }
      if (decoded.role !== user.role || decoded.tenantId !== user.tenantId) {
        // 401 on purpose: the web client force-refreshes the token once and retries.
        throw new AppError('CLAIMS_STALE', 401, 'Your access was updated. Please sign in again.');
      }

      req.user = {
        id: user._id,
        uid: decoded.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
