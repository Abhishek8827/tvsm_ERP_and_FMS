import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { formatINR } from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { errorText, parseRupees, todayInput } from "../lib/rupees";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from "../components/ui";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

function EntryDialog({ open, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const heads = useQuery({
    queryKey: ["expense-heads"],
    queryFn: () => api("/api/expense-heads"),
    enabled: open,
  });
  const key = useRef(newIdempotencyKey());
  const empty = {
    date: todayInput(),
    headId: "",
    payeeName: "",
    particulars: "",
    amount: "",
  };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const amount = parseRupees(f.amount);
  const active = (heads.data?.heads ?? []).filter((h) => h.active);
  const save = useMutation({
    mutationFn: () =>
      api("/api/petty", {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          date: f.date,
          headId: f.headId || undefined,
          payeeName: f.payeeName,
          particulars: f.particulars,
          amountPaise: amount.paise,
        },
      }),
    onSuccess: async (e) => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ["petty"] });
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      notify(`Petty cash entry no. ${e.seq} saved.`, "success");
      setF(empty);
      setErrors({});
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), "error");
    },
  });
  const ready =
    f.payeeName.trim() &&
    f.particulars.trim() &&
    !amount.error &&
    amount.paise > 0;
  return (
    <Dialog
      open={open}
      title="New petty cash entry"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!ready}
            onClick={() => save.mutate()}
          >
            Save entry
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Date"
          type="date"
          max={todayInput()}
          value={f.date}
          error={errors.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <Select
          label="Head (optional)"
          value={f.headId}
          error={errors.headId}
          onChange={(e) => set({ headId: e.target.value })}
          options={[
            { value: "", label: "No head" },
            ...active.map((h) => ({ value: h.id, label: h.name })),
          ]}
        />
        <Input
          label="Payee name"
          value={f.payeeName}
          error={errors.payeeName}
          onChange={(e) => set({ payeeName: e.target.value })}
        />
        <Input
          label="Particulars"
          value={f.particulars}
          error={errors.particulars}
          onChange={(e) => set({ particulars: e.target.value })}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          hint="Under ₹500. ₹500 or more needs an expense voucher."
          onChange={(e) => set({ amount: e.target.value })}
        />
      </div>
    </Dialog>
  );
}

/** Top-up = a transfer from cash in hand to petty cash (not an expense, not income). */
function TopUpDialog({ open, onClose, cashPaise }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState("");
  const amount = parseRupees(amountText);
  const top = useMutation({
    mutationFn: () =>
      api("/api/transfers", {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          from: "cash",
          to: "petty",
          amountPaise: amount.paise,
          note: "Petty cash top-up",
        },
      }),
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ["petty"] });
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      notify("Petty cash topped up from cash in hand.", "success");
      setAmountText("");
      setError("");
      onClose();
    },
    onError: (e) => {
      setError(e.fields?.amountPaise ?? e.message);
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), "error");
    },
  });
  return (
    <Dialog
      open={open}
      title="Top up petty cash"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={top.isPending}
          >
            Cancel
          </Button>
          <Button
            loading={top.isPending}
            disabled={!(amount.paise > 0) || !!amount.error}
            onClick={() => top.mutate()}
          >
            Move to petty cash
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          Money moves from cash in hand
          {cashPaise !== undefined ? ` (${money(cashPaise)})` : ""} to petty
          cash.
        </p>
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={amountText}
          error={amount.error ?? error}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function RegisterView({ isAdmin }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adding, setAdding] = useState(false);
  const [topping, setTopping] = useState(false);
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState("");
  const balance = useQuery({
    queryKey: ["petty", "summary"],
    queryFn: () => api("/api/petty/summary"),
  });
  const overview = useQuery({
    queryKey: ["money", "overview"],
    queryFn: () => api("/api/money/overview"),
  });
  const list = useQuery({
    queryKey: ["petty", "list", { page, pageSize, from, to }],
    queryFn: () =>
      api(
        `/api/petty?${new URLSearchParams({ page, pageSize, ...(from && { from }), ...(to && { to }) })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const reverse = useMutation({
    mutationFn: () =>
      api(`/api/petty/${reversing}/reverse`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["petty"] });
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      notify("Entry reversed. The amount is back in petty cash.", "success");
      setReversing(null);
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const d = list.data;
  const columns = [
    { key: "no", header: "Serial no.", render: (e) => e.seq },
    { key: "date", header: "Date", render: (e) => e.date },
    { key: "head", header: "Head", render: (e) => e.headName ?? "-" },
    { key: "payee", header: "Payee", render: (e) => e.payeeName },
    { key: "part", header: "Particulars", render: (e) => e.particulars },
    {
      key: "amt",
      header: "Amount",
      align: "right",
      render: (e) => money(e.amountPaise),
    },
    {
      key: "act",
      header: "",
      render: (e) =>
        e.status === "reversed" ? (
          <Badge tone="danger" title={e.reversalReason ?? ""}>
            Reversed
          </Badge>
        ) : isAdmin ? (
          <Button
            variant="secondary"
            onClick={() => {
              setReason("");
              setReversing(e.id);
            }}
          >
            Reverse
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Petty cash remaining"
          value={balance.data ? money(balance.data.balancePaise) : "-"}
        />
        {isAdmin && (
          <StatCard
            label="Cash in hand"
            value={overview.data ? money(overview.data.cashPaise) : "-"}
            caption="Petty cash is topped up from here"
          />
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        {isAdmin && (
          <>
            <Button onClick={() => setAdding(true)}>New entry</Button>
            <Button variant="secondary" onClick={() => setTopping(true)}>
              Top up from cash
            </Button>
          </>
        )}
      </div>
      <Table
        columns={columns}
        rows={d?.rows}
        rowKey={(e) => e.id}
        loading={list.isPending}
        error={list.isError ? list.error.message : undefined}
        onRetry={() => void list.refetch()}
        emptyTitle="No petty cash entries"
        emptyDescription={
          isAdmin
            ? "Set the opening petty cash on the Bank & Cash screen, then add entries under ₹500."
            : undefined
        }
      />
      {d && d.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={d.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      {isAdmin && (
        <EntryDialog open={adding} onClose={() => setAdding(false)} />
      )}
      {isAdmin && (
        <TopUpDialog
          open={topping}
          onClose={() => setTopping(false)}
          cashPaise={overview.data?.cashPaise}
        />
      )}
      <ConfirmDialog
        open={!!reversing}
        tone="danger"
        title="Reverse this petty cash entry?"
        description="The entry stays on record, marked Reversed, and the amount goes back to petty cash."
        confirmLabel="Reverse entry"
        requireReason
        onReasonChange={setReason}
        loading={reverse.isPending}
        onConfirm={() => reverse.mutate()}
        onCancel={() => setReversing(null)}
      />
    </div>
  );
}

export function PettyCash() {
  const { role } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Petty Cash</h1>
        <p className="text-sm text-ink-muted">
          Expenses under ₹500. No voucher number and no approval, only a serial
          number.
        </p>
      </div>
      <RegisterView isAdmin={role === "admin"} />
    </div>
  );
}
