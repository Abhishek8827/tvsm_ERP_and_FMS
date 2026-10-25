import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Dialog,
  Input,
  Pagination,
  Select,
  Table,
  useToast,
} from "../components/ui";
import { errorText } from "../lib/rupees";

const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "principal", label: "Principal" },
  { value: "admin", label: "Admin" },
];
const roleName = (r) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

/** Admin: create accounts, reset passwords, change role, switch an account off or on. */
export function UsersSettings() {
  const { notify } = useToast();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { type: 'create' | 'reset' | 'role', user? }
  const query = useQuery({
    queryKey: ["users", page],
    queryFn: () => api(`/api/users?page=${page}&pageSize=25`),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }) =>
      api(`/api/users/${id}`, { method: "PATCH", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notify("Saved.", "success");
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const done = async (msg) => {
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    notify(msg, "success");
    setDialog(null);
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (u) => <span className="font-medium">{u.name}</span>,
    },
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "role", header: "Role", render: (u) => roleName(u.role) },
    {
      key: "status",
      header: "Status",
      render: (u) =>
        u.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="danger">Off</Badge>
        ),
    },
    {
      key: "last",
      header: "Last login",
      render: (u) =>
        u.lastLoginAt
          ? new Date(u.lastLoginAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })
          : "Never",
    },
    {
      key: "act",
      header: "",
      render: (u) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setDialog({ type: "reset", user: u })}
          >
            Reset password
          </Button>
          <Button
            variant="secondary"
            onClick={() => setDialog({ type: "role", user: u })}
          >
            Change role
          </Button>
          {u.id !== me?.id && (
            <Button
              variant="secondary"
              loading={patch.isPending && patch.variables?.id === u.id}
              onClick={() =>
                patch.mutate({ id: u.id, body: { isActive: !u.isActive } })
              }
            >
              {u.isActive ? "Switch off" : "Switch on"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Users &amp; Settings
          </h1>
          <p className="text-sm text-ink-muted">
            Logins for the Admin, Principal and Cashiers. Passwords are never
            shown anywhere.
          </p>
        </div>
        <Button onClick={() => setDialog({ type: "create" })}>Add user</Button>
      </div>
      <Table
        columns={columns}
        rows={query.data?.rows}
        rowKey={(u) => u.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No users yet"
      />
      {query.data && query.data.total > 25 && (
        <Pagination
          page={page}
          pageSize={25}
          total={query.data.total}
          onPageChange={setPage}
        />
      )}
      {dialog?.type === "create" && (
        <CreateDialog onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.type === "reset" && (
        <ResetDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.type === "role" && (
        <RoleDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

const pwError = (p) => (p.length < 8 ? "At least 8 characters" : undefined);

function CreateDialog({ onClose, onDone }) {
  const { notify } = useToast();
  const [f, setF] = useState({
    name: "",
    email: "",
    role: "cashier",
    password: "",
  });
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api("/api/users", { method: "POST", body: f }),
    onSuccess: () => onDone("User created."),
    onError: (e) => {
      setFields(e.fields ?? {});
      notify(errorText(e), "error");
    },
  });
  const ready =
    f.name.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) &&
    !pwError(f.password);
  return (
    <Dialog
      open
      title="Add user"
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
            Create user
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Full name"
          value={f.name}
          error={fields.name}
          onChange={set("name")}
        />
        <Input
          label="Email (used to sign in)"
          type="email"
          value={f.email}
          error={fields.email}
          onChange={set("email")}
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={f.role}
          onChange={set("role")}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={f.password}
          hint="At least 8 characters. Tell it to the person; it cannot be seen again."
          error={f.password ? pwError(f.password) : undefined}
          onChange={set("password")}
        />
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose, onDone }) {
  const { notify } = useToast();
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/api/users/${user.id}/reset-password`, {
        method: "POST",
        body: { password },
      }),
    onSuccess: () =>
      onDone(
        `Password changed for ${user.name}. They are signed out everywhere.`,
      ),
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Dialog
      open
      title={`Reset password: ${user.name}`}
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
            disabled={!!pwError(password)}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Set new password
          </Button>
        </>
      }
    >
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        error={password ? pwError(password) : undefined}
        onChange={(e) => setPassword(e.target.value)}
      />
    </Dialog>
  );
}

function RoleDialog({ user, onClose, onDone }) {
  const { notify } = useToast();
  const [role, setRole] = useState(user.role);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/users/${user.id}`, { method: "PATCH", body: { role } }),
    onSuccess: () => onDone("Role changed. The person must sign in again."),
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Dialog
      open
      title={`Change role: ${user.name}`}
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
            disabled={role === user.role}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Change role
          </Button>
        </>
      }
    >
      <Select
        label="Role"
        options={ROLE_OPTIONS}
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
    </Dialog>
  );
}
