/**
 * The one place that talks to Meta's WhatsApp Cloud API. It never throws: it answers
 * { ok: true, messageId } or { ok: false, error } so a WhatsApp problem can never break a receipt.
 * The access token is only used in the Authorization header and is never logged or returned.
 */
export function makeWhatsappClient(
  env,
  { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {},
) {
  const configured = !!(
    env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN
  );
  return {
    configured,
    async send(payload) {
      if (!configured) return { ok: false, error: "WhatsApp is not set up" };
      const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.messages?.[0]?.id)
          return { ok: true, messageId: body.messages[0].id };
        const msg = body?.error?.message ?? `WhatsApp answered ${res.status}`;
        return { ok: false, error: String(msg).slice(0, 300) };
      } catch (err) {
        const timedOut =
          err?.name === "TimeoutError" || err?.name === "AbortError";
        return {
          ok: false,
          error: timedOut
            ? "WhatsApp did not answer in time"
            : "Could not reach WhatsApp",
        };
      }
    },
  };
}
