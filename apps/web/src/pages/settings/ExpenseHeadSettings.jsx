import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import {
  Badge,
  Button,
  Card,
  Input,
  Table,
  useToast,
} from "../../components/ui";
import { errorText } from "../../lib/rupees";

/** Admin: expense heads. A deactivated head stays on old vouchers. */
export function ExpenseHeadSettings() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["expense-heads"],
    queryFn: () => api("/api/expense-heads"),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["expense-heads"] });
  const add = useMutation({
    mutationFn: () =>
      api("/api/expense-heads", { method: "POST", body: { name } }),
    onSuccess: async () => {
      setName("");
      setError("");
      await refresh();
      notify("Head added.", "success");
    },
    onError: (e) => setError(e.fields?.name ?? e.message),
  });
  const toggle = useMutation({
    mutationFn: (h) =>
      api(`/api/expense-heads/${h.id}`, {
        method: "PATCH",
        body: { active: !h.active },
      }),
    onSuccess: refresh,
    onError: (e) => notify(errorText(e), "error"),
  });
  const columns = [
    { key: "name", header: "Head", render: (h) => h.name },
    {
      key: "status",
      header: "Status",
      render: (h) =>
        h.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Not in use</Badge>
        ),
    },
    {
      key: "act",
      header: "",
      render: (h) =>
        h.system ? (
          <Badge tone="info">Made by the system: fills petty cash</Badge>
        ) : (
          <Button
            variant="secondary"
            loading={toggle.isPending && toggle.variables?.id === h.id}
            onClick={() => toggle.mutate(h)}
          >
            {h.active ? "Stop using" : "Use again"}
          </Button>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Add a head">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) add.mutate();
          }}
        >
          <Input
            label="Head name"
            value={name}
            error={error}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            loading={add.isPending}
            disabled={name.trim().length < 2}
          >
            Add head
          </Button>
        </form>
      </Card>
      <Table
        columns={columns}
        rows={query.data?.heads}
        rowKey={(h) => h.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No heads yet"
        emptyDescription="Add the first head above, for example the kind of expense you make most often."
      />
    </div>
  );
}
