import { WhatsappMessage } from "../models/WhatsappMessage.js";

/** A "queued" row older than this is treated as stuck (server stopped mid-send) and may be retried. */
export const STALE_QUEUED_MS = 5 * 60_000;

export function makeWhatsappStore() {
  return {
    get: (tenantId, kind, refId) =>
      WhatsappMessage.findOne({ tenantId, kind, refId }).lean(),

    /**
     * Creates the row for a document the first time only. Returns { doc, created }. A second call
     * (a retried request, a double click) finds the row and creates nothing: one message per
     * receipt / certificate.
     */
    async createOnce(tenantId, data) {
      const r = await WhatsappMessage.findOneAndUpdate(
        { tenantId, kind: data.kind, refId: data.refId },
        { $setOnInsert: { tenantId, attempts: 0, ...data } },
        { upsert: true, new: true, includeResultMetadata: true },
      );
      return {
        doc: r.value.toObject(),
        created: !r.lastErrorObject?.updatedExisting,
      };
    },

    /**
     * Takes the right to send: only one caller wins. Allowed from failed / skipped, or from a stuck
     * queued row. Returns the updated row, or null when someone else is already sending / it was
     * already sent.
     */
    beginAttempt(tenantId, kind, refId, { to, now = new Date() } = {}) {
      return WhatsappMessage.findOneAndUpdate(
        {
          tenantId,
          kind,
          refId,
          $or: [
            { status: { $in: ["failed", "skipped"] } },
            {
              status: "queued",
              lastAttemptAt: { $lt: new Date(now.getTime() - STALE_QUEUED_MS) },
            },
            { status: "queued", attempts: 0 },
          ],
        },
        {
          $set: { status: "queued", lastAttemptAt: now, ...(to ? { to } : {}) },
          $inc: { attempts: 1 },
        },
        { new: true },
      ).lean();
    },

    finish: (tenantId, kind, refId, patch) =>
      WhatsappMessage.findOneAndUpdate(
        { tenantId, kind, refId },
        { $set: patch },
        { new: true },
      ).lean(),
  };
}
