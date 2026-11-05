import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Button, Card, Input, useToast } from "../../components/ui";
import { errorText } from "../../lib/rupees";

function TcNumberingForm({ data, onSaved }) {
  const { notify } = useToast();
  const [bookNo, setBookNo] = useState(data.tcBookNo);
  const [startSl, setStartSl] = useState(String(data.tcStartSl));
  const save = useMutation({
    mutationFn: () =>
      api("/api/certificates/settings", {
        method: "PUT",
        body: { tcBookNo: bookNo.trim(), tcStartSl: Number(startSl) },
      }),
    onSuccess: async () => {
      notify("Saved.", "success");
      await onSaved();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const valid =
    bookNo.trim() && Number.isInteger(Number(startSl)) && Number(startSl) >= 1;
  return (
    <Card title="Transfer Certificate numbering">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Input
          label="Book No."
          value={bookNo}
          onChange={(e) => setBookNo(e.target.value)}
        />
        <Input
          label={`First Sl. No. of ${data.fy}`}
          type="number"
          min="1"
          value={startSl}
          disabled={data.startLocked}
          hint={
            data.startLocked
              ? "Locked: a TC is already issued this year."
              : "The first TC of the year gets this number; after that it goes up by one."
          }
          onChange={(e) => setStartSl(e.target.value)}
        />
      </div>
      <div className="mt-4">
        <Button
          disabled={!valid}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

export function TcNumberingSettings() {
  const qc = useQueryClient();
  const s = useQuery({
    queryKey: ["cert-settings"],
    queryFn: () => api("/api/certificates/settings"),
  });
  if (s.isLoading) return <p className="text-sm text-ink-muted">Loading...</p>;
  if (s.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {errorText(s.error)}
      </p>
    );
  return (
    <TcNumberingForm
      key={`${s.data.tcBookNo}|${s.data.tcStartSl}|${s.data.startLocked}`}
      data={s.data}
      onSaved={() => qc.invalidateQueries({ queryKey: ["cert-settings"] })}
    />
  );
}
