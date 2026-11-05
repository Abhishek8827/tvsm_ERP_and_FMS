import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Bell in the top bar (Admin only: the Admin is the only one who decides things). It opens the
 * Approvals page; the red dot shows when anything is waiting there. It reads the same overview
 * the Dashboard uses, so it adds no extra request on the Dashboard.
 */
export function NotificationBell() {
  const { role } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => api("/api/dashboard/overview"),
    enabled: role === "admin",
    refetchInterval: 60_000,
    retry: false,
  });
  if (role !== "admin") return null;
  const p = q.data?.pending;
  const waiting = p
    ? (p.cancellations ?? 0) + (p.vouchers ?? 0) + (p.reversals ?? 0)
    : 0;
  return (
    <Link
      to="/approvals"
      aria-label={
        waiting ? `Approvals: ${waiting} waiting` : "Approvals: nothing waiting"
      }
      title={
        waiting
          ? `${waiting} waiting for a decision`
          : "Nothing is waiting for a decision"
      }
      className="relative flex h-10 w-10 items-center justify-center rounded-xl text-ink transition-colors hover:bg-blue-100"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {waiting > 0 && (
        <span
          data-testid="bell-dot"
          className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white"
        />
      )}
    </Link>
  );
}
