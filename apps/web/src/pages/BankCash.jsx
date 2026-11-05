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
import { accountLabel, errorText, parseRupees } from "../lib/rupees";
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Pagination,
  Select,
  Spinner,
  StatCard,
  Table,
  useToast,
} from "../components/ui";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MODE_LABEL = { upi: "UPI / QR" };

/** Read-only balances: cash, petty cash and every bank account. */
function Balances({ data }) {
  return (
    <div className="flex flex-col gap-4">
      {data.unassignedReceiptsPaise > 0 && (
        <div
          role="alert"
          className="rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-ink"
        >
          {money(data.unassignedReceiptsPaise)} of UPI / QR receipts have no
          bank account chosen, so they are not counted in any bank balance.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Cash in hand" value={money(data.cashPaise)} />
        <StatCard label="Petty cash" value={money(data.pettyPaise)} />
        {data.banks.map((b) => (
          <StatCard
            key={b.id}
            label={`${b.name}${b.last4 ? ` ••••${b.last4}` : ""}${b.active ? "" : " (not in use)"}`}
            value={money(b.balancePaise)}
            caption={
              b.defaultForModes.length
                ? `Default for ${b.defaultForModes.map((m) => MODE_LABEL[m]).join(" + ")}`
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function TransferDialog({ open, onClose, overview }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const banks = (overview?.banks ?? []).filter((b) => b.active);
  const accounts = [
    { value: "cash", label: "Cash in hand" },
    { value: "petty", label: "Petty cash" },
    ...banks.map((b) => ({ value: `bank:${b.id}`, label: b.name })),
  ];
  const [f, setF] = useState({ from: "cash", to: "", amount: "", note: "" });
  const [errors, setErrors] = useState({});
  const amount = parseRupees(f.amount);
  const save = useMutation({
    mutationFn: () =>
      api("/api/transfers", {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          from: f.from,
          to: f.to,
          amountPaise: amount.paise,
          note: f.note || undefined,
        },
      }),
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      await queryClient.invalidateQueries({ queryKey: ["petty"] });
      notify(
        "Transfer saved. It is not counted as income or expense.",
        "success",
      );
      setF({ from: "cash", to: "", amount: "", note: "" });
      setErrors({});
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), "error");
    },
  });
  return (
    <Dialog
      open={open}
      title="Transfer between accounts"
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
            disabled={!f.to || !(amount.paise > 0) || !!amount.error}
            onClick={() => save.mutate()}
          >
            Transfer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="From"
          value={f.from}
          error={errors.from}
          onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))}
          options={accounts}
        />
        <Select
          label="To"
          value={f.to}
          error={errors.to}
          onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))}
          options={[
            { value: "", label: "Choose" },
            ...accounts.filter((a) => a.value !== f.from),
          ]}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))}
        />
        <Input
          label="Note (optional)"
          value={f.note}
          onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))}
        />
      </div>
    </Dialog>
  );
}

function TransfersTable({ banks }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const q = useQuery({
    queryKey: ["money", "transfers", page, pageSize],
    queryFn: () => api(`/api/transfers?page=${page}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: "date", header: "Date", render: (t) => t.date },
    { key: "from", header: "From", render: (t) => accountLabel(t.from, banks) },
    { key: "to", header: "To", render: (t) => accountLabel(t.to, banks) },
    {
      key: "amt",
      header: "Amount",
      align: "right",
      render: (t) => money(t.amountPaise),
    },
    { key: "note", header: "Note", render: (t) => t.note || "-" },
    { key: "by", header: "By", render: (t) => t.byName ?? "-" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Table
        columns={columns}
        rows={q.data?.rows}
        rowKey={(t) => t.transferId}
        loading={q.isPending}
        error={q.isError ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
        emptyTitle="No transfers yet"
        emptyDescription="Cash deposited to a bank, a bank withdrawal or a petty cash top-up appears here."
      />
      {q.data && q.data.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={q.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

function StaffView({ isAdmin }) {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({
    queryKey: ["money", "overview"],
    queryFn: () => api("/api/money/overview"),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <Spinner label="Loading balances" />;
  if (q.isError)
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  return (
    <div className="flex flex-col gap-4">
      <Balances data={q.data} />
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("transfer")}>Transfer money</Button>
        </div>
      )}
      <Card title="Transfers">
        <TransfersTable banks={q.data.banks} />
      </Card>
      {isAdmin && dialog === "transfer" && (
        <TransferDialog
          open
          overview={q.data}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export function BankCash() {
  const { role } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Bank & Cash</h1>
      </div>
      <StaffView isAdmin={role === "admin"} />
    </div>
  );
}
