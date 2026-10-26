import {
  maskPhone,
  normalizePhone,
  receiptParams,
  tcParams,
  templatePayload,
} from "./whatsapp.js";

/**
 * Sends a fee receipt / Transfer Certificate notice on WhatsApp and records the result.
 * Rules: never throws to the caller (a WhatsApp problem must not break a receipt), one message per
 * document, and nothing is sent or recorded when WhatsApp is not set up.
 */
export function makeWhatsappService({
  store,
  client,
  env,
  studentStore,
  receiptStore,
  certificateStore,
  logger,
}) {
  const lang = env.WHATSAPP_TEMPLATE_LANG;

  const TEMPLATES = {
    receipt: { name: env.WHATSAPP_TEMPLATE_RECEIPT, params: receiptParams },
    tc: { name: env.WHATSAPP_TEMPLATE_TC, params: tcParams },
  };

  async function deliver({ tenantId, kind, refId, to, data }) {
    const t = TEMPLATES[kind];
    const out = await client.send(
      templatePayload({ to, template: t.name, lang, params: t.params(data) }),
    );
    const patch = out.ok
      ? {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: out.messageId,
          lastError: null,
        }
      : { status: "failed", lastError: out.error };
    if (!out.ok)
      logger?.warn({ kind, refId, error: out.error }, "WhatsApp send failed");
    return store.finish(tenantId, kind, refId, patch);
  }

  /** First send for a new document. Safe to call twice: the second call does nothing. */
  async function sendFirst({
    tenantId,
    kind,
    refId,
    refNumber,
    phoneText,
    data,
    actor,
  }) {
    if (!client.configured) return null;
    try {
      const to = normalizePhone(phoneText);
      const { doc, created } = await store.createOnce(tenantId, {
        kind,
        refId: String(refId),
        refNumber: String(refNumber ?? ""),
        to: to ?? undefined,
        status: to ? "queued" : "skipped",
        lastError: to
          ? undefined
          : "No valid mobile number on the student record",
        createdBy: actor?.id ? String(actor.id) : undefined,
        createdByName: actor?.name,
      });
      if (!created || !to) return doc;
      const taken = await store.beginAttempt(tenantId, kind, String(refId));
      if (!taken) return doc;
      return await deliver({ tenantId, kind, refId: String(refId), to, data });
    } catch (err) {
      logger?.error({ err, kind, refId }, "WhatsApp step crashed");
      return null;
    }
  }

  const sendReceipt = (tenantId, receipt, actor) =>
    sendFirst({
      tenantId,
      kind: "receipt",
      refId: receipt._id,
      refNumber: receipt.number,
      phoneText: receipt.student?.contactNo,
      data: receipt,
      actor,
    });

  const sendTc = (tenantId, tc, student, actor) =>
    sendFirst({
      tenantId,
      kind: "tc",
      refId: tc._id,
      refNumber: tc.slNo,
      phoneText: student?.contactNo,
      data: tc,
      actor,
    });

  /** Loads the document again (and the phone as it is NOW, so a corrected number is used). */
  async function load(tenantId, kind, refId) {
    if (kind === "receipt") {
      const r = await receiptStore.findById(tenantId, refId);
      return r ? { phoneText: r.student?.contactNo, data: r } : null;
    }
    const tc = await certificateStore.getTc(tenantId, refId);
    if (!tc || tc.status !== "issued") return null;
    const s = await studentStore.findById(tenantId, String(tc.studentId));
    return { phoneText: s?.contactNo, data: tc };
  }

  /** Returns { result: 'sent'|'failed'|'skipped'|'busy'|'missing'|'off', message }. */
  async function retry(tenantId, kind, refId) {
    if (!client.configured) return { result: "off" };
    const existing = await store.get(tenantId, kind, refId);
    if (!existing) return { result: "missing" };
    if (existing.status === "sent")
      return { result: "busy", message: existing };
    const src = await load(tenantId, kind, refId);
    if (!src) return { result: "missing" };
    const to = normalizePhone(src.phoneText);
    if (!to) {
      const m = await store.finish(tenantId, kind, refId, {
        status: "skipped",
        to: null,
        lastError: "No valid mobile number on the student record",
      });
      return { result: "skipped", message: m };
    }
    const taken = await store.beginAttempt(tenantId, kind, refId, { to });
    if (!taken) return { result: "busy", message: existing };
    const m = await deliver({ tenantId, kind, refId, to, data: src.data });
    return { result: m.status, message: m };
  }

  const status = (tenantId, kind, refId) => store.get(tenantId, kind, refId);

  return { configured: client.configured, sendReceipt, sendTc, retry, status };
}

/** What a screen may see: never the full number, never provider internals. */
export const shapeWhatsapp = (m) =>
  m
    ? {
        kind: m.kind,
        refId: m.refId,
        status: m.status,
        to: maskPhone(m.to),
        attempts: m.attempts,
        error: m.status === "sent" ? null : (m.lastError ?? null),
        sentAt: m.sentAt ?? null,
        lastAttemptAt: m.lastAttemptAt ?? null,
      }
    : null;
