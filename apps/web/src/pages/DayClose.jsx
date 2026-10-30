import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { formatINR } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Input,
  Pagination,
  Spinner,
  StatCard,
  Table,
  useToast,
} from "../components/ui";
import { errorText, parseRupees } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const signed = (p) => (p > 0 ? `+${money(p)}` : money(p));
const fmtDate = (d) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

/** Today's closing: the Cashier counts the cash; the figures to compare with come from the server. */
function TodayCard({ role }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const q = useQuery({
    queryKey: ["day-close", "summary"],
    queryFn: () => api("/api/day-close/summary"),
    refetchInterval: 30_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["day-close"] });
  const parsed = parseRupees(counted);
  const close = useMutation({
    mutationFn: () =>
      api("/api/day-close", {
        method: "POST",
        body: {
          date: q.data.date,
          countedCashPaise: parsed.paise,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      setConfirm(false);
      setCounted("");
      setReason("");
      await refresh();
      notify("Day closed.", "success");
    },
    onError: (e) => {
      setConfirm(false);
      notify(errorText(e), "error");
    },
  });
  const reopenDay = useMutation({
    mutationFn: () =>
      api(`/api/day-close/${q.data.date}/reopen`, {
        method: "POST",
        body: { reason: reopenReason.trim() },
      }),
    onSuccess: async () => {
      setReopen(false);
      await refresh();
      notify("Day reopened. Fees can be collected again.", "success");
    },
    onError: (e) => {
      setReopen(false);
      notify(errorText(e), "error");
    },
  });

  if (q.isPending) return <Spinner label="Loading today's figures" />;
  if (q.isError)
    return (
      <ErrorState
        message={errorText(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const d = q.data;
  const closed = d.record?.status === "closed";
  const diff =
    parsed.error || counted.trim() === ""
      ? null
      : parsed.paise - d.expectedCashPaise;
  const needsReason = diff !== null && diff !== 0;
  const ready = diff !== null && (!needsReason || reason.trim().length >= 3);

  return (
    <Card
      title={`Day Close: ${fmtDate(d.date)}`}
      subtitle="One close for the whole school. Closing stops fee collection for the day."
      actions={
        closed ? (
          <Badge tone="success">Closed</Badge>
        ) : (
          <Badge tone="warning">Open</Badge>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Expected cash"
          value={money(d.expectedCashPaise)}
          caption={`Cash receipts ${money(d.cashReceiptPaise)}${d.cashCancelledPaise ? ` − cancelled ${money(d.cashCancelledPaise)}` : ""}`}
        />
        <StatCard
          label="UPI / QR"
          value={money(d.upiPaise)}
          caption="Goes to the bank"
        />
        <StatCard
          label="Receipts today"
          value={d.receiptCount}
          caption={`${d.cancelledCount} cancelled today`}
        />
      </div>

      {closed ? (
        <div className="mt-4 rounded-lg border border-line bg-app p-4 text-sm">
          <p>
            Closed by <b>{d.record.closedByName}</b>. Counted{" "}
            {money(d.record.countedCashPaise)}, expected{" "}
            {money(d.record.expectedCashPaise)}
            {d.record.differencePaise !== 0 && (
              <>
                , difference{" "}
                <b className="text-danger">
                  {signed(d.record.differencePaise)}
                </b>{" "}
                ({d.record.differenceReason})
              </>
            )}
            .
          </p>
          {role === "admin" && (
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setReopen(true)}>
                Reopen this day
              </Button>
            </div>
          )}
        </div>
      ) : role === "cashier" ? (
        <div className="mt-4 flex max-w-md flex-col gap-3">
          <Input
            label="Cash counted in the drawer (₹)"
            inputMode="decimal"
            value={counted}
            error={parsed.error}
            onChange={(e) => setCounted(e.target.value)}
          />
          {diff !== null && (
            <p
              className={`text-sm ${diff === 0 ? "text-success" : "text-danger"}`}
            >
              {diff === 0
                ? "Cash matches."
                : `Difference: ${signed(diff)} (counted − expected)`}
            </p>
          )}
          {needsReason && (
            <Input
              label="Reason for the difference (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <div>
            <Button disabled={!ready} onClick={() => setConfirm(true)}>
              Close the day
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          The day is still open. The Cashier closes it after counting the cash.
        </p>
      )}

      <ConfirmDialog
        open={confirm}
        title="Close the day?"
        description={`Counted ${money(parsed.paise)} against expected ${money(d.expectedCashPaise)}. After this, fees cannot be collected today unless the Admin reopens the day.`}
        confirmLabel="Close the day"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={reopen}
        title="Reopen this day?"
        description="Fees can be collected again. The reopen and your reason are recorded."
        confirmLabel="Reopen"
        requireReason
        onReasonChange={setReopenReason}
        loading={reopenDay.isPending}
        onConfirm={() => reopenDay.mutate()}
        onCancel={() => setReopen(false)}
      />
    </Card>
  );
}

export function DayClose() {
  const { role } = useAuth();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["day-close", "list", page],
    queryFn: () => api(`/api/day-close?page=${page}&pageSize=25`),
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: "date", header: "Date", render: (r) => fmtDate(r.date) },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "closed" ? (
          <Badge tone="success">Closed</Badge>
        ) : (
          <Badge tone="warning">Reopened</Badge>
        ),
    },
    {
      key: "exp",
      header: "Expected cash",
      align: "right",
      render: (r) => money(r.expectedCashPaise),
    },
    {
      key: "cnt",
      header: "Counted",
      align: "right",
      render: (r) => money(r.countedCashPaise),
    },
    {
      key: "diff",
      header: "Difference",
      align: "right",
      render: (r) =>
        r.differencePaise === 0 ? (
          "-"
        ) : (
          <span className="text-danger">{signed(r.differencePaise)}</span>
        ),
    },
    {
      key: "upi",
      header: "UPI / QR",
      align: "right",
      render: (r) => money(r.upiPaise),
    },
    { key: "by", header: "Closed by", render: (r) => r.closedByName ?? "-" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Day Close</h1>
      <TodayCard role={role} />
      <Card title="Past closings">
        <Table
          columns={columns}
          rows={list.data?.rows}
          rowKey={(r) => r.date}
          loading={list.isPending}
          error={list.isError ? errorText(list.error) : null}
          onRetry={() => void list.refetch()}
          emptyTitle="No day has been closed yet"
        />
        {list.data && list.data.total > 25 && (
          <div className="mt-3">
            <Pagination
              page={page}
              pageSize={25}
              total={list.data.total}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
