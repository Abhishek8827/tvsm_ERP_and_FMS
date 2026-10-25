import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { classLabel, formatINR } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Dialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  Table,
  useToast,
} from "../components/ui";
import { errorText } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const monthLabel = (ym) =>
  ym ? `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "-";
const STATE = {
  on: <Badge tone="success">On bus</Badge>,
  stopped: <Badge tone="neutral">Stopped</Badge>,
  pending: <Badge tone="warning">Not entered yet</Badge>,
};
const refresh = async (qc) => {
  for (const key of [
    "transport",
    "fees-database",
    "dues",
    "ledger",
    "dashboard",
  ])
    await qc.invalidateQueries({ queryKey: [key] });
};

/**
 * Transport: students on the school bus. The Admin enters a scholar number, the village is taken
 * from the student's address, and the bus fee is charged from the chosen month (June by default).
 * The Admin can stop it from a month. Everyone else can only look.
 */
export function Transport() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [adding, setAdding] = useState(null); // null | '' | scholar number to prefill
  const [stopping, setStopping] = useState(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["transport", { q, state, page, pageSize }],
    queryFn: () => {
      const p = new URLSearchParams({ page, pageSize });
      if (q) p.set("q", q);
      if (state) p.set("state", state);
      return api(`/api/transport?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const rows = d?.rows?.map((r, i) => ({
    ...r,
    _n: (page - 1) * pageSize + i + 1,
  }));
  const columns = [
    { key: "sno", header: "S.No", render: (r) => r._n },
    { key: "adm", header: "Sch. ID", render: (r) => r.admissionNo },
    {
      key: "name",
      header: "Student",
      render: (r) => (
        <Link
          className="font-medium text-brand hover:underline"
          to={`/students/${r.id}`}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "class",
      header: "Class",
      render: (r) =>
        `${classLabel(r.classKey)}${r.section ? ` - ${r.section}` : ""}`,
    },
    { key: "address", header: "Address", render: (r) => r.address || "-" },
    { key: "village", header: "Village", render: (r) => r.village || "-" },
    {
      key: "fee",
      header: "Fee / month",
      align: "right",
      render: (r) => (r.monthlyPaise == null ? "-" : money(r.monthlyPaise)),
    },
    { key: "from", header: "From", render: (r) => monthLabel(r.transportFrom) },
    {
      key: "until",
      header: "Status",
      render: (r) => (
        <div>
          {STATE[r.state]}
          {r.state === "stopped" && r.transportUntil && (
            <p className="mt-1 text-xs text-ink-muted">
              Last month charged: {monthLabel(r.transportUntil)}
            </p>
          )}
        </div>
      ),
    },
  ];
  if (isAdmin)
    columns.push({
      key: "act",
      header: "",
      render: (r) =>
        r.state === "on" ? (
          <Button variant="secondary" onClick={() => setStopping(r)}>
            Stop
          </Button>
        ) : r.state === "pending" ? (
          <Button onClick={() => setAdding(r.admissionNo)}>Enter</Button>
        ) : null,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Transport</h1>
          <p className="text-sm text-ink-muted">
            Students on the school bus. The bus fee is charged only for these
            students, from the month shown.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setAdding("")}>Add student to bus</Button>
        )}
      </div>
      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, Sch. ID, address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Show"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "", label: "All" },
            { value: "on", label: "On bus now" },
            { value: "stopped", label: "Stopped" },
            { value: "pending", label: "Not entered yet (old list)" },
          ]}
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No transport students"
        emptyDescription={
          isAdmin
            ? 'Use "Add student to bus" and enter a scholar number.'
            : "The Admin has not entered any student for these filters."
        }
      />
      {d && d.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={d.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      {adding !== null && (
        <AddDialog initial={adding} onClose={() => setAdding(null)} />
      )}
      {stopping && (
        <StopDialog student={stopping} onClose={() => setStopping(null)} />
      )}
    </div>
  );
}

function AddDialog({ initial, onClose }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(initial);
  const [no, setNo] = useState(initial.trim());
  const [pickedVillage, setVillage] = useState(null);
  const [pickedFrom, setFrom] = useState(null);
  useEffect(() => {
    const t = window.setTimeout(() => setNo(text.trim()), 400);
    return () => window.clearTimeout(t);
  }, [text]);
  const lookup = useQuery({
    queryKey: ["transport-lookup", no],
    enabled: no.length > 0,
    retry: false,
    queryFn: () => api(`/api/transport/lookup/${encodeURIComponent(no)}`),
  });
  const s = text.trim() === no ? (lookup.data ?? null) : null;
  // Until the Admin picks, the village comes from the address and the month is the default.
  const village =
    pickedVillage ?? (s ? s.village || s.suggestedVillage || "" : "");
  const from = pickedFrom ?? s?.defaultFromMonth ?? "";
  const blocked = s && (s.state === "on" || s.status !== "active");
  const save = useMutation({
    mutationFn: () =>
      api("/api/transport/enroll", {
        method: "POST",
        body: { studentId: s.id, village, fromMonth: from },
      }),
    onSuccess: async () => {
      await refresh(qc);
      notify("Student added to the bus.", "success");
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const fee = s?.villages.find((v) => v.name === village)?.monthlyPaise;
  return (
    <Dialog
      open
      title="Add student to bus"
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
            disabled={!s || blocked || !village || !from}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Add to bus
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <Input
            label="Scholar number (Sch. ID)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text.trim() !== no || (no && lookup.isPending) ? (
            <p className="mt-1 text-xs text-ink-muted">Searching…</p>
          ) : lookup.isError ? (
            <p className="mt-1 text-xs text-danger">
              {lookup.error?.status === 404
                ? "Scholar number not found."
                : errorText(lookup.error)}
            </p>
          ) : null}
        </div>
        {s && (
          <>
            <dl className="grid gap-x-4 gap-y-1 rounded-lg border border-line bg-app p-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-ink-muted">Student</dt>
                <dd className="font-medium">{s.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Class</dt>
                <dd>
                  {classLabel(s.classKey)}
                  {s.section ? ` - ${s.section}` : ""}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-ink-muted">Address (village)</dt>
                <dd>{s.address || "-"}</dd>
              </div>
            </dl>
            {s.state === "on" && (
              <Badge tone="warning">Already on the bus</Badge>
            )}
            {s.status !== "active" && (
              <Badge tone="warning">This student is {s.status}</Badge>
            )}
            {s.villages.length === 0 && (
              <p className="text-sm text-danger">
                The fee chart has no village fees. Add them in Fee Structure
                first.
              </p>
            )}
            {!s.suggestedVillage && !s.village && s.villages.length > 0 && (
              <p className="text-sm text-ink-muted">
                The address did not match one village. Choose the village below.
              </p>
            )}
            <Select
              label="Village"
              value={village}
              onChange={(e) => setVillage(e.target.value)}
              options={[
                { value: "", label: "Choose village" },
                ...s.villages.map((v) => ({
                  value: v.name,
                  label: `${v.name} (${money(v.monthlyPaise)} / month)`,
                })),
              ]}
            />
            <Select
              label="Bus fee starts from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              options={s.months.map((m) => ({
                value: m,
                label: monthLabel(m),
              }))}
            />
            {fee != null && from && (
              <p className="text-xs text-ink-muted">
                {money(fee)} a month is charged from {monthLabel(from)}. Months
                up to this month are posted now; later months post
                automatically.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function StopDialog({ student, onClose }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [reason, setReason] = useState("");
  // Offer the months of the year from the month he started.
  const months = useQuery({
    queryKey: ["transport-lookup", student.admissionNo],
    queryFn: () =>
      api(`/api/transport/lookup/${encodeURIComponent(student.admissionNo)}`),
  });
  const options = (months.data?.months ?? []).filter(
    (m) => m >= student.transportFrom,
  );
  const save = useMutation({
    mutationFn: () =>
      api("/api/transport/stop", {
        method: "POST",
        body: { studentId: student.id, fromMonth: from, reason: reason.trim() },
      }),
    onSuccess: async (res) => {
      await refresh(qc);
      notify(
        res.removedMonths > 0
          ? `Bus stopped. ${res.removedMonths} unpaid month(s) removed.`
          : "Bus stopped.",
        "success",
      );
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Dialog
      open
      title={`Stop bus: ${student.name}`}
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
            variant="danger"
            disabled={!from || reason.trim().length < 3}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Stop bus
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="No bus fee from this month"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          options={[
            {
              value: "",
              label: months.isPending ? "Loading…" : "Choose month",
            },
            ...options.map((m) => ({ value: m, label: monthLabel(m) })),
          ]}
        />
        <Input
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-ink-muted">
          Unpaid bus fee of this month and later is removed. If one of those
          months is already paid or rebated, cancel that receipt / rebate first.
        </p>
      </div>
    </Dialog>
  );
}
