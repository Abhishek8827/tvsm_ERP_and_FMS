import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import {
  Button,
  Card,
  ErrorState,
  Input,
  Spinner,
  useToast,
} from "../../components/ui";
import { errorText, parseRupees, todayInput } from "../../lib/rupees";

function TransportForm({ data }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    opening: String(data.transportOpeningPaise / 100),
    startDate: data.transportStartDate ?? todayInput(),
    heads: data.transportHeads,
    reason: "",
  });
  const amount = parseRupees(f.opening);
  const save = useMutation({
    mutationFn: () =>
      api("/api/cashbook/settings", {
        method: "PUT",
        body: {
          openingRupees: f.opening,
          startDate: f.startDate,
          heads: f.heads,
          reason: f.reason.trim(),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["cashbook"] });
      await qc.invalidateQueries({ queryKey: ["cashbook-settings"] });
      notify("Transport account saved.", "success");
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const toggle = (h) =>
    setF((x) => ({
      ...x,
      heads: x.heads.includes(h)
        ? x.heads.filter((y) => y !== h)
        : [...x.heads, h],
    }));
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Account starts on"
        type="date"
        value={f.startDate}
        onChange={(e) => setF({ ...f, startDate: e.target.value })}
      />
      <Input
        label="Opening amount on that date (₹)"
        inputMode="decimal"
        value={f.opening}
        error={amount.error}
        onChange={(e) => setF({ ...f, opening: e.target.value })}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">
          Expense heads that are transport expense
        </legend>
        {data.expenseHeads.length === 0 && (
          <p className="text-sm text-ink-muted">No expense heads exist yet.</p>
        )}
        {data.expenseHeads.map((h) => (
          <label key={h} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.heads.includes(h)}
              onChange={() => toggle(h)}
            />
            {h}
          </label>
        ))}
      </fieldset>
      <Input
        label="Reason for this change (required)"
        value={f.reason}
        onChange={(e) => setF({ ...f, reason: e.target.value })}
      />
      <p className="text-xs text-ink-muted">
        Every change is kept in the history and the audit log. Income of this
        account is the bus-fee receipts (cash and online).
      </p>
      <div className="flex justify-end gap-2">
        <Button
          loading={save.isPending}
          disabled={
            !!amount.error || f.reason.trim().length < 3 || !f.startDate
          }
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** Admin: the school's transport vendor account (start date, opening amount, expense heads). */
export function TransportAccountSettings() {
  const q = useQuery({
    queryKey: ["cashbook-settings"],
    queryFn: () => api("/api/cashbook/settings"),
  });
  return (
    <Card
      title="Transport account"
      subtitle="Shown on the Cashbook. Income of this account is the bus-fee receipts."
    >
      {q.isPending && <Spinner label="Loading" />}
      {q.isError && (
        <ErrorState
          message={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <TransportForm
          key={`${q.data.transportStartDate}|${q.data.transportOpeningPaise}|${q.data.transportHeads.join(",")}`}
          data={q.data}
        />
      )}
    </Card>
  );
}
