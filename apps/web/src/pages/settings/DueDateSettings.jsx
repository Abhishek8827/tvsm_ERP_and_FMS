import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getFinancialYear } from "@erp/shared";
import { api } from "../../api/client";
import {
  Button,
  Card,
  ErrorState,
  Input,
  Spinner,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/rupees";

export const DUE_DATE_PHRASE = "CHANGE DUE DATE";

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
};

/**
 * Admin: the day of the month on which monthly fees fall due (default the 10th).
 * This is a serious setting: it decides when a month turns "due", when the grace days and late fee
 * start, and so the "due" figure printed on receipts. Months already due are never touched.
 */
export function DueDateSettings() {
  const fy = getFinancialYear(new Date());
  const chart = useQuery({
    queryKey: ["fee-structure", fy],
    queryFn: async () => {
      try {
        return await api(`/api/fee-structure/${fy}`);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });
  if (chart.isPending) return <Spinner label="Loading due date" />;
  if (chart.isError)
    return (
      <ErrorState
        message={errorText(chart.error)}
        onRetry={() => void chart.refetch()}
      />
    );
  if (chart.data === null)
    return (
      <Card title="Fee due date">
        <p className="text-sm text-ink-muted">
          There is no fee structure for {fy} yet, so there is no due date to
          change.
        </p>
      </Card>
    );
  return <DueDateForm fy={fy} current={chart.data.dueDay} />;
}

function DueDateForm({ fy, current }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(String(current));
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const next = Number(day);
  const dayOk = Number.isInteger(next) && next >= 1 && next <= 28;
  const changed = dayOk && next !== current;
  const ready =
    changed && reason.trim().length >= 5 && phrase === DUE_DATE_PHRASE;
  const save = useMutation({
    mutationFn: () =>
      api(`/api/fee-structure/${fy}/due-day`, {
        method: "PUT",
        body: { dueDay: next, reason: reason.trim(), confirm: phrase },
      }),
    onSuccess: async (out) => {
      setReason("");
      setPhrase("");
      await queryClient.invalidateQueries();
      notify(
        `Due date is now the ${ordinal(out.dueDay)} of every month (${out.chargesMoved} upcoming month${out.chargesMoved === 1 ? "" : "s"} moved).`,
        "success",
      );
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Card
      title="Fee due date"
      subtitle={`Monthly fees fall due on the ${ordinal(current)} of every month (${fy}).`}
    >
      <div className="flex max-w-lg flex-col gap-4">
        <div
          role="alert"
          className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-ink"
        >
          <p className="font-semibold">
            Be careful: this changes money figures.
          </p>
          <ul className="mt-1 list-disc pl-5">
            <li>
              It decides when a month becomes "due", and when grace days and the
              late fee start.
            </li>
            <li>
              The "due" amount printed on new receipts can be different from
              before.
            </li>
            <li>
              Only months that are not yet due move to the new day. Past months
              stay as they are.
            </li>
            <li>Receipts already issued never change.</li>
          </ul>
        </div>
        <Input
          label="Due day of the month (1 to 28)"
          inputMode="numeric"
          value={day}
          error={day !== "" && !dayOk ? "Use a day from 1 to 28" : undefined}
          onChange={(e) => setDay(e.target.value)}
        />
        <Input
          label="Why are you changing it?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Input
          label={`Type ${DUE_DATE_PHRASE} to confirm`}
          autoComplete="off"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <div>
          <Button
            disabled={!ready}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Change due date
          </Button>
        </div>
      </div>
    </Card>
  );
}
