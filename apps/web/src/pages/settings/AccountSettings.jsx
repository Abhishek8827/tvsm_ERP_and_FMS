import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatINR, paiseToRupeesString } from "@erp/shared";
import { api } from "../../api/client";
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Select,
  Spinner,
  Table,
  useToast,
} from "../../components/ui";
import { errorText, parseRupees } from "../../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MODE_LABEL = { upi: "UPI / QR" };
const stamp = (at) =>
  new Date(at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

function FixedAssetsDialog({ onClose }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["report-settings"],
    queryFn: () => api("/api/reports/settings"),
  });
  const [fixed, setFixed] = useState(null);
  const [capital, setCapital] = useState(null);
  const [reason, setReason] = useState("");
  const fixedText = fixed ?? paiseToRupeesString(q.data?.fixedAssetsPaise ?? 0);
  const capitalText = capital ?? paiseToRupeesString(q.data?.capitalPaise ?? 0);
  const f = parseRupees(fixedText);
  const c = parseRupees(capitalText);
  const save = useMutation({
    mutationFn: () =>
      api("/api/reports/settings", {
        method: "PUT",
        body: {
          fixedAssetsRupees: fixedText,
          capitalRupees: capitalText,
          reason,
        },
      }),
    onSuccess: () => {
      notify("Opening balances saved", "success");
      void qc.invalidateQueries({ queryKey: ["report-settings"] });
      void qc.invalidateQueries({ queryKey: ["report"] });
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const bad = f.error || c.error || reason.trim().length < 3;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Opening balances"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="opening-form"
            disabled={!!bad || save.isPending || !q.data}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        Fixed assets and the capital / reserve fund are entered once. Every
        change is kept with its reason.
      </p>
      {q.isPending && <Spinner label="Loading" />}
      {q.isError && (
        <ErrorState
          message={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <form
          id="opening-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!bad) save.mutate();
          }}
        >
          <Input
            label="Fixed assets (₹)"
            inputMode="decimal"
            value={fixedText}
            error={f.error}
            onChange={(e) => setFixed(e.target.value)}
          />
          <Input
            label="Capital / reserve fund (₹)"
            inputMode="decimal"
            value={capitalText}
            error={c.error}
            onChange={(e) => setCapital(e.target.value)}
          />
          <Input
            label="Reason for this entry"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {q.data.history.length > 0 && (
            <ul className="max-h-32 overflow-auto text-xs text-ink-muted">
              {q.data.history.map((h) => (
                <li key={`${h.at}`}>
                  {stamp(h.at)}, {h.byName ?? "Admin"}: assets{" "}
                  {money(h.fixedAssetsPaise)}, capital {money(h.capitalPaise)},{" "}
                  {h.reason}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </Dialog>
  );
}

/**
 * Admin: where every account starts. Opening balances (cash, petty cash, banks), the bank accounts
 * themselves, and the fixed assets / capital used by the Balance Sheet. Each change is audited.
 */
export function AccountSettings() {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({
    queryKey: ["money", "overview"],
    queryFn: () => api("/api/money/overview"),
  });
  if (q.isPending) return <Spinner label="Loading accounts" />;
  if (q.isError)
    return (
      <ErrorState
        message={errorText(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const o = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Opening balances"
        subtitle="Where cash, petty cash and each bank account start. Changes keep the old figure and your reason."
        actions={
          <Button onClick={() => setDialog("opening")}>
            Edit opening balances
          </Button>
        }
      >
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Cash in hand</dt>
            <dd className="tabular-nums">{money(o.openingCashPaise)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Petty cash</dt>
            <dd className="tabular-nums">{money(o.openingPettyPaise)}</dd>
          </div>
          {o.banks.map((b) => (
            <div key={b.id} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{b.name}</dt>
              <dd className="tabular-nums">{money(b.openingPaise)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card
        title="Bank accounts"
        actions={
          <Button variant="secondary" onClick={() => setDialog("bank")}>
            Add bank account
          </Button>
        }
      >
        <BankSettings overview={o} />
      </Card>
      <Card
        title="Fixed assets and capital"
        subtitle="Entered once for the Balance Sheet. Every change is kept with its reason."
        actions={
          <Button variant="secondary" onClick={() => setDialog("fixed")}>
            Edit fixed assets and capital
          </Button>
        }
      >
        <FixedAssetsSummary />
      </Card>
      {dialog === "bank" && <BankDialog open onClose={() => setDialog(null)} />}
      {dialog === "opening" && (
        <OpeningDialog open overview={o} onClose={() => setDialog(null)} />
      )}
      {dialog === "fixed" && (
        <FixedAssetsDialog onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function FixedAssetsSummary() {
  const q = useQuery({
    queryKey: ["report-settings"],
    queryFn: () => api("/api/reports/settings"),
  });
  if (q.isPending) return <Spinner label="Loading" />;
  if (q.isError)
    return (
      <ErrorState
        message={errorText(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Fixed assets</dt>
        <dd className="tabular-nums">{money(q.data.fixedAssetsPaise)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-ink-muted">Capital / reserve fund</dt>
        <dd className="tabular-nums">{money(q.data.capitalPaise)}</dd>
      </div>
    </dl>
  );
}
