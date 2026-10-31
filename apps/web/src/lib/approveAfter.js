import { api } from "../api/client";

/**
 * The Admin asks and approves in one go (the Principal is read-only since 2026-10-31).
 * The request is saved FIRST; then this approves it. If the approval step fails the request stays
 * waiting (the Admin can approve it from the list), so the error is handed back, not thrown.
 */
export async function approveAfter(created, approvePath) {
  try {
    return {
      result: await api(approvePath, { method: "POST", body: {} }),
      approveError: null,
    };
  } catch (approveError) {
    return { result: created, approveError };
  }
}
