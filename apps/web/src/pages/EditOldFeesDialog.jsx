import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatINR, getFinancialYear } from "@erp/shared";
import { api } from "../api/client";
import { Button, Dialog, Input, Select, useToast } from "../components/ui";
import { errorText, parseRupees, todayInput } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

/** The last few financial years, newest first ("2026-27"). */
function sessions() {
  const start = Number(getFinancialYear(new Date()).slice(0, 4));
  return Array.from({ length: 4 }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

/**
 * Admin only. Corrects the OLD fee (the balance brought from before this system) of one student:
 * the Admin types the NEW TOTAL. Nothing already paid or issued is touched; the correction is a
 * new audited entry, and a total below what was already paid is refused by the server.
 */
export function EditOldFeesDialog({ student, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [fy, setFy] = useState(getFinancialYear(new Date()));
  const [category, setCategory] = useState("school");
  const [total, setTotal] = useState("");
  const [date, setDate] = useState(todayInput());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});

  const now = useQuery({
    queryKey: ["fee-details", student.id, { fy, old: true }],
    queryFn: () => api(`/api/students/${student.id}/fee-details?fy=${fy}`),
  });
  const line =
    now.data?.summary?.[category === "school" ? "oldSchool" : "oldTransport"];
  const amount = parseRupees(total);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/students/${student.id}/old-fee-adjustments`, {
        method: "POST",
        body: {
          fy,
          category,
          newTotalPaise: amount.paise,
          effectiveDate: date,
          reason: reason.trim(),
        },
      }),
    onSuccess: async () => {
      for (const key of [
        "fees-database",
        "fee-details",
        "dues",
        "ledger",
        "dashboard",
      ])
        await queryClient.invalidateQueries({ queryKey: [key] });
      notify("Old fee corrected.", "success");
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), "error");
    },
  });
  const ready =
    total.trim() !== "" && !amount.error && date && reason.trim().length >= 3;

  return (
    <Dialog
      open
      title={`Edit Old Fees: ${student.name}`}
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
            disabled={!ready}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save correction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Academic session"
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            options={sessions().map((y) => ({ value: y, label: y }))}
          />
          <Select
            label="Fee category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: "school", label: "Old school fee" },
              { value: "transport", label: "Old bus fee" },
            ]}
          />
        </div>
        <div
          className="rounded-lg border border-line bg-app p-3 text-sm"
          data-testid="old-now"
        >
          {now.isPending && "Loading the current old fee…"}
          {now.isError && (
            <span className="text-danger">{errorText(now.error)}</span>
          )}
          {line && (
            <>
              <p>
                Old fee now: <b>{money(line.billedPaise)}</b>
                {line.importedPaise !== line.billedPaise && (
                  <span className="text-ink-muted">
                    {" "}
                    (imported {money(line.importedPaise)})
                  </span>
                )}
              </p>
              <p>
                Already paid or rebated:{" "}
                <b>{money(line.paidPaise + line.concessionPaise)}</b>. The new
                total cannot be lower than this.
              </p>
            </>
          )}
        </div>
        <Input
          label="New total old fee (₹)"
          inputMode="decimal"
          value={total}
          error={amount.error ?? errors.newTotalPaise}
          onChange={(e) => setTotal(e.target.value)}
        />
        <Input
          label="Effective date"
          type="date"
          max={todayInput()}
          value={date}
          error={errors.effectiveDate}
          onChange={(e) => setDate(e.target.value)}
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
