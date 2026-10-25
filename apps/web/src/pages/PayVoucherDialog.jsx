import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AUTHORISERS, formatINR } from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
import { errorText, parseRupees, todayInput } from "../lib/rupees";
import { Button, Dialog, Input, Select, useToast } from "../components/ui";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

/** Shared by the voucher page and the vouchers list so both pay the same way (same idempotent API). */
export function PaymentDialog({ voucher, open, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const banks = useQuery({
    queryKey: ["banks", "options"],
    queryFn: () => api("/api/banks/options"),
    enabled: open,
  });
  const key = useRef(newIdempotencyKey());
  const [f, setF] = useState({
    date: todayInput(),
    amount: "",
    mode: "bank",
    bankId: "",
    authorisedBy: "",
    details: "",
    remark: "",
  });
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const amount = parseRupees(f.amount);
  const list = banks.data?.banks ?? [];
  const pay = useMutation({
    mutationFn: () =>
      api(`/api/vouchers/${voucher.id}/payments`, {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          date: f.date,
          amountPaise: amount.paise,
          mode: f.mode,
          bankId: f.mode === "bank" ? f.bankId : undefined,
          authorisedBy: f.authorisedBy,
          details: f.details || undefined,
          remark: f.remark || undefined,
        },
      }),
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({
        queryKey: ["voucher", voucher.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      await queryClient.invalidateQueries({ queryKey: ["expense-payments"] });
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      notify("Payment recorded.", "success");
      setF((p) => ({ ...p, amount: "", details: "", remark: "" }));
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
    amount.paise > 0 &&
    !amount.error &&
    f.authorisedBy &&
    (f.mode === "cash" || f.bankId);
  return (
    <Dialog
      open={open}
      title={`Pay ${voucher.number}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={pay.isPending}
          >
            Cancel
          </Button>
          <Button
            loading={pay.isPending}
            disabled={!ready}
            onClick={() => pay.mutate()}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          Balance due: <b>{money(voucher.balanceDuePaise)}</b>
        </p>
        <Input
          label="Payment date"
          type="date"
          max={todayInput()}
          value={f.date}
          error={errors.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          onChange={(e) => set({ amount: e.target.value })}
        />
        <Select
          label="Paid from"
          value={f.mode}
          onChange={(e) => set({ mode: e.target.value })}
          options={[
            { value: "bank", label: "Bank account (online)" },
            { value: "cash", label: "Cash in hand" },
          ]}
        />
        {f.mode === "bank" && (
          <Select
            label="Bank account"
            value={f.bankId}
            error={errors.bankId}
            onChange={(e) => set({ bankId: e.target.value })}
            options={[
              {
                value: "",
                label: list.length ? "Choose a bank" : "No bank account yet",
              },
              ...list.map((b) => ({
                value: b.id,
                label: `${b.name}${b.last4 ? ` ••••${b.last4}` : ""}`,
              })),
            ]}
          />
        )}
        <Select
          label="Payment authorised by"
          value={f.authorisedBy}
          error={errors.authorisedBy}
          onChange={(e) => set({ authorisedBy: e.target.value })}
          options={[
            { value: "", label: "Choose" },
            ...AUTHORISERS.map((a) => ({ value: a, label: a })),
          ]}
        />
        <Input
          label="Payment details (UTR / cheque no., optional)"
          value={f.details}
          onChange={(e) => set({ details: e.target.value })}
        />
        <Input
          label="Remark (optional)"
          value={f.remark}
          onChange={(e) => set({ remark: e.target.value })}
        />
      </div>
    </Dialog>
  );
}
