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

function BankDialog({ open, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ name: "", last4: "", opening: "", upi: false });
  const [errors, setErrors] = useState({});
  const opening = parseRupees(f.opening);
  const save = useMutation({
    mutationFn: () =>
      api("/api/banks", {
        method: "POST",
        body: {
          name: f.name,
          last4: f.last4 || undefined,
          openingPaise: opening.paise || undefined,
          defaultForModes: f.upi ? ["upi"] : [],
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      await queryClient.invalidateQueries({ queryKey: ["banks"] });
      notify("Bank account added.", "success");
      setF({ name: "", last4: "", opening: "", upi: false });
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), "error");
    },
  });
  return (
    <Dialog
      open={open}
      title="Add bank account"
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
            disabled={f.name.trim().length < 2 || !!opening.error}
            onClick={() => save.mutate()}
          >
            Add bank
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Bank name"
          value={f.name}
          error={errors.name}
          onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
        />
        <Input
          label="Last 4 digits of account (optional)"
          maxLength={4}
          inputMode="numeric"
          value={f.last4}
          error={errors.last4}
          onChange={(e) =>
            setF((p) => ({ ...p, last4: e.target.value.replace(/\D/g, "") }))
          }
        />
        <Input
          label="Opening balance (₹)"
          inputMode="decimal"
          value={f.opening}
          error={opening.error}
          hint="Can be set only now. Later changes are transfers."
          onChange={(e) => setF((p) => ({ ...p, opening: e.target.value }))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.upi}
            onChange={(e) => setF((p) => ({ ...p, upi: e.target.checked }))}
          />{" "}
          Pre-select for UPI / QR receipts
        </label>
      </div>
    </Dialog>
  );
}

function OpeningDialog({ open, overview, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const options = [
    { value: "cash", label: "Cash in hand", paise: overview.openingCashPaise },
    { value: "petty", label: "Petty cash", paise: overview.openingPettyPaise },
    ...overview.banks.map((b) => ({
      value: `bank:${b.id}`,
      label: b.name,
      paise: b.openingPaise,
    })),
  ];
  const [account, setAccount] = useState("cash");
  const current = options.find((o) => o.value === account)?.paise ?? 0;
  const [text, setText] = useState(String(current / 100));
  const [reason, setReason] = useState("");
  const amount = parseRupees(text);
  const save = useMutation({
    mutationFn: () =>
      api("/api/money/opening", {
        method: "PUT",
        body: { account, amountPaise: amount.paise, reason: reason.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      await queryClient.invalidateQueries({ queryKey: ["petty"] });
      notify("Opening balance changed.", "success");
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Dialog
      open={open}
      title="Edit opening balance"
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
            disabled={
              !!amount.error ||
              amount.paise === current ||
              reason.trim().length < 3
            }
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          The balance moves by the difference. The old figure and your reason
          stay on record, and the change is audited.
        </p>
        <Select
          label="Account"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setText(
              String(
                (options.find((o) => o.value === e.target.value)?.paise ?? 0) /
                  100,
              ),
            );
          }}
          options={options}
        />
        <p className="text-xs text-ink-muted">
          Current opening: {formatINR(current)}
        </p>
        <Input
          label="New opening balance (₹)"
          inputMode="decimal"
          value={text}
          error={amount.error}
          onChange={(e) => setText(e.target.value)}
        />
        <Input
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Dialog>
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

function BankSettings({ overview }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (b) =>
      api(`/api/banks/${b.id}`, {
        method: "PATCH",
        body: { active: !b.active },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["money"] }),
    onError: (e) => notify(errorText(e), "error"),
  });
  const modes = useMutation({
    mutationFn: ({ bank, mode }) =>
      api(`/api/banks/${bank.id}`, {
        method: "PATCH",
        body: {
          defaultForModes: bank.defaultForModes.includes(mode)
            ? bank.defaultForModes.filter((m) => m !== mode)
            : [...bank.defaultForModes, mode],
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["money"] }),
    onError: (e) => notify(errorText(e), "error"),
  });
  const columns = [
    {
      key: "name",
      header: "Bank",
      render: (b) => `${b.name}${b.last4 ? ` ••••${b.last4}` : ""}`,
    },
    {
      key: "bal",
      header: "Balance",
      align: "right",
      render: (b) => money(b.balancePaise),
    },
    {
      key: "def",
      header: "Default for receipts",
      render: (b) =>
        ["upi"].map((m) => (
          <label
            key={m}
            className="mr-3 inline-flex items-center gap-1 text-sm"
          >
            <input
              type="checkbox"
              checked={b.defaultForModes.includes(m)}
              onChange={() => modes.mutate({ bank: b, mode: m })}
            />{" "}
            {MODE_LABEL[m]}
          </label>
        )),
    },
    {
      key: "st",
      header: "",
      render: (b) => (
        <Button variant="secondary" onClick={() => toggle.mutate(b)}>
          {b.active ? "Stop using" : "Use again"}
        </Button>
      ),
    },
  ];
  return (
    <Table
      columns={columns}
      rows={overview.banks}
      rowKey={(b) => b.id}
      emptyTitle="No bank account yet"
      emptyDescription="Add the school's bank accounts to receive UPI / QR money and to pay expenses."
    />
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
          <Button variant="secondary" onClick={() => setDialog("bank")}>
            Add bank account
          </Button>
          <Button variant="secondary" onClick={() => setDialog("opening")}>
            Edit opening balances
          </Button>
        </div>
      )}
      {isAdmin && (
        <Card title="Bank accounts">
          <BankSettings overview={q.data} />
        </Card>
      )}
      <Card
        title="Transfers"
        subtitle="Cash ⇄ bank and petty cash top-ups. A transfer moves money; it is not income or expense."
      >
        <TransfersTable banks={q.data.banks} />
      </Card>
      {isAdmin && dialog === "bank" && (
        <BankDialog open onClose={() => setDialog(null)} />
      )}
      {isAdmin && dialog === "opening" && (
        <OpeningDialog open overview={q.data} onClose={() => setDialog(null)} />
      )}
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
        <p className="text-sm text-ink-muted">
          Cash in hand, petty cash and every bank account.
        </p>
      </div>
      <StaffView isAdmin={role === "admin"} />
    </div>
  );
}
