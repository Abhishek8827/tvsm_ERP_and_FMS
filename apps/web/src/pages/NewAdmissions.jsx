import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CLASSES, STREAMS, classLabel, formatINR } from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  Dialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  Spinner,
  Table,
  useToast,
} from "../components/ui";
import { errorText, parseRupees, todayInput } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const CLASS_OPTIONS = CLASSES.map((c) => ({ value: c.key, label: c.label }));
const STATUS_OPTIONS = [
  { value: "pending", label: "Decision Pending" },
  { value: "admitted", label: "Admitted" },
  { value: "cancelled", label: "Cancelled" },
];
const STATUS_FILTER = [{ value: "", label: "All statuses" }, ...STATUS_OPTIONS];
const STATUS_TONE = {
  pending: "warning",
  admitted: "success",
  cancelled: "danger",
};
const PAY_TONE = { paid: "success", partial: "warning", unpaid: "danger" };
const PAY_LABEL = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
const fmtDate = (d) =>
  d
    ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "-";

const EMPTY = {
  name: "",
  fatherName: "",
  motherName: "",
  classKey: "",
  stream: "",
  gender: "",
  dateOfBirth: "",
  contactNo: "",
  address: "",
  category: "",
  nationality: "",
  caste: "",
  samagraId: "",
  pen: "",
  aparId: "",
  aadhaar: "",
  formSubmittedOn: "",
  collectedBy: "",
};
const MORE_FIELDS = [
  ["nationality", "Nationality"],
  ["caste", "Caste"],
  ["samagraId", "Samagra ID"],
  ["pen", "PEN"],
  ["aparId", "APAAR ID"],
  ["aadhaar", "Aadhaar"],
];

/** Sends only what was filled in (empty boxes are left out, the server treats them as "not given"). */
const clean = (f) =>
  Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== "" && v !== undefined),
  );

function PayBadge({ part }) {
  return <Badge tone={PAY_TONE[part.status]}>{PAY_LABEL[part.status]}</Badge>;
}

/** New Admissions: forms handed in by families, their fees and decision. Not students yet. */
export function NewAdmissions() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canEnter = role === "admin" || role === "cashier";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("current");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { type: 'form' | 'pay' | 'status' | 'view' | 'session', row? }
  const settings = useQuery({
    queryKey: ["admissions", "settings"],
    queryFn: () => api("/api/admissions/settings"),
  });
  const sessionParam = scope === "all" ? "all" : (settings.data?.session ?? "");
  const list = useQuery({
    queryKey: ["admissions", "list", sessionParam, status, search, page],
    queryFn: () => {
      const p = new URLSearchParams({ page, pageSize: 25 });
      if (sessionParam) p.set("session", sessionParam);
      if (status) p.set("status", status);
      if (search.trim()) p.set("q", search.trim());
      return api(`/api/admissions?${p}`);
    },
    enabled: settings.isSuccess,
    placeholderData: keepPreviousData,
  });
  const close = () => setDialog(null);

  const columns = [
    {
      key: "no",
      header: "Form no.",
      render: (r) => <span className="font-medium">{r.formNo}</span>,
    },
    {
      key: "name",
      header: "Child",
      render: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-ink-muted">{r.fatherName ?? ""}</p>
        </div>
      ),
    },
    { key: "class", header: "Class", render: (r) => classLabel(r.classKey) },
    {
      key: "date",
      header: "Form date",
      render: (r) => fmtDate(r.formSubmittedOn),
    },
    {
      key: "form",
      header: "Form fee",
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span>{money(r.dues.form.duePaise)}</span>
          <PayBadge part={r.dues.form} />
        </div>
      ),
    },
    {
      key: "adm",
      header: "Admission fee",
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span>{money(r.dues.admission.duePaise)}</span>
          <PayBadge part={r.dues.admission} />
        </div>
      ),
    },
    {
      key: "got",
      header: "Collected",
      align: "right",
      render: (r) => money(r.dues.collectedPaise),
    },
    {
      key: "out",
      header: "Outstanding",
      align: "right",
      render: (r) =>
        r.dues.outstandingPaise > 0 ? (
          <span className="font-medium text-danger">
            {money(r.dues.outstandingPaise)}
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
          {r.scholarNo && (
            <span className="text-xs text-ink-muted">
              Scholar no. {r.scholarNo}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "act",
      header: "",
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {canEnter &&
            r.status !== "cancelled" &&
            r.dues.outstandingPaise > 0 && (
              <Button onClick={() => setDialog({ type: "pay", row: r })}>
                Collect fee
              </Button>
            )}
          <Button
            variant="secondary"
            onClick={() => setDialog({ type: "view", row: r })}
          >
            Details
          </Button>
          {isAdmin && r.status !== "admitted" && (
            <>
              <Button
                variant="secondary"
                onClick={() => setDialog({ type: "form", row: r })}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDialog({ type: "status", row: r })}
              >
                Status
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">New Admissions</h1>
          <p className="text-sm text-ink-muted">
            Session {settings.data?.session ?? "..."}. Forms stay here until the
            Admin admits the child; then the child moves to Students.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button
              variant="secondary"
              onClick={() => setDialog({ type: "session" })}
            >
              Change session
            </Button>
          )}
          {canEnter && (
            <Button onClick={() => setDialog({ type: "form" })}>
              Add admission form
            </Button>
          )}
        </div>
      </div>

      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, father, form no., mobile"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label="Session"
          options={[
            {
              value: "current",
              label: settings.data?.session ?? "Current session",
            },
            { value: "all", label: "All sessions" },
          ]}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>

      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={settings.isPending || list.isPending}
        error={
          settings.isError
            ? errorText(settings.error)
            : list.isError
              ? errorText(list.error)
              : null
        }
        onRetry={() =>
          void (settings.isError ? settings.refetch() : list.refetch())
        }
        emptyTitle="No admission forms yet"
      />
      {list.data && list.data.total > 25 && (
        <Pagination
          page={page}
          pageSize={25}
          total={list.data.total}
          onPageChange={setPage}
        />
      )}

      {dialog?.type === "form" && (
        <FormDialog row={dialog.row} onClose={close} settings={settings.data} />
      )}
      {dialog?.type === "pay" && <PayDialog row={dialog.row} onClose={close} />}
      {dialog?.type === "status" && (
        <StatusDialog row={dialog.row} onClose={close} />
      )}
      {dialog?.type === "view" && (
        <ViewDialog id={dialog.row.id} onClose={close} />
      )}
      {dialog?.type === "session" && (
        <SessionDialog current={settings.data?.session} onClose={close} />
      )}
    </div>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["admissions"] });
}

function FormDialog({ row, onClose, settings }) {
  const { notify } = useToast();
  const refresh = useRefresh();
  const editing = !!row;
  const [f, setF] = useState(() =>
    row
      ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k] ?? ""]))
      : { ...EMPTY, formSubmittedOn: todayInput() },
  );
  const [fields, setFields] = useState({});
  const [similar, setSimilar] = useState(null);
  const key = useRef(newIdempotencyKey());
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.name.trim().length >= 2 && f.classKey;
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/api/admissions/${row.id}`, { method: "PATCH", body: clean(f) })
        : api("/api/admissions", {
            method: "POST",
            body: clean(f),
            idempotencyKey: key.current,
          }),
    onSuccess: async (saved) => {
      await refresh();
      notify(editing ? "Saved." : `Form saved: ${saved.formNo}`, "success");
      onClose();
    },
    onError: (e) => {
      setFields(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), "error");
    },
  });
  // New forms: look for a child who already exists first. It is only a warning, never a block.
  const check = useMutation({
    mutationFn: () => {
      const p = new URLSearchParams({ name: f.name.trim() });
      if (f.fatherName.trim()) p.set("fatherName", f.fatherName.trim());
      if (f.dateOfBirth) p.set("dateOfBirth", f.dateOfBirth);
      return api(`/api/admissions/similar?${p}`);
    },
    onSuccess: (found) => {
      if (found.students.length || found.admissions.length) setSimilar(found);
      else save.mutate();
    },
    onError: () => save.mutate(), // the warning is only help; never stop a form because of it
  });
  const submit = () => (editing || similar ? save.mutate() : check.mutate());
  const busy = save.isPending || check.isPending;
  return (
    <Dialog
      open
      title={editing ? `Edit ${row.formNo}` : "Add admission form"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={busy} onClick={submit}>
            {similar ? "Save anyway" : "Save form"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        {!editing && settings && (
          <p className="text-sm text-ink-muted">
            Session {settings.session}. Form fee {money(settings.formFeePaise)};
            the admission fee comes from the Fee Structure for the class.
          </p>
        )}
        {similar && (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p className="font-medium">
              A child like this is already in the system:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {similar.students.map((s) => (
                <li key={s.id}>
                  Student: {s.name} (Adm. no. {s.admissionNo},{" "}
                  {classLabel(s.classKey)})
                </li>
              ))}
              {similar.admissions.map((a) => (
                <li key={a.id}>
                  Form: {a.name} ({a.formNo}, {classLabel(a.classKey)})
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Check, then press Save anyway if this is a different child.
            </p>
          </div>
        )}
        <Input
          label="Child's name"
          required
          value={f.name}
          error={fields.name}
          onChange={set("name")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Father's name"
            value={f.fatherName}
            onChange={set("fatherName")}
          />
          <Input
            label="Mother's name"
            value={f.motherName}
            onChange={set("motherName")}
          />
          <Select
            label="Class"
            required
            options={[{ value: "", label: "Choose" }, ...CLASS_OPTIONS]}
            value={f.classKey}
            error={fields.classKey}
            onChange={set("classKey")}
          />
          {(f.classKey === "11" || f.classKey === "12") && (
            <Select
              label="Stream"
              options={[
                { value: "", label: "Choose" },
                ...STREAMS.map((s) => ({ value: s, label: s })),
              ]}
              value={f.stream}
              onChange={set("stream")}
            />
          )}
          <Select
            label="Gender"
            options={[
              { value: "", label: "Choose" },
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "OTHER", label: "Other" },
            ]}
            value={f.gender}
            onChange={set("gender")}
          />
          <Input
            label="Date of birth"
            type="date"
            value={f.dateOfBirth}
            onChange={set("dateOfBirth")}
          />
          <Input
            label="Mobile"
            inputMode="tel"
            value={f.contactNo}
            onChange={set("contactNo")}
          />
          <Input
            label="Category"
            placeholder="GEN / OBC / SC / ST"
            value={f.category}
            onChange={set("category")}
          />
          <Input
            label="Form submitted on"
            type="date"
            value={f.formSubmittedOn}
            onChange={set("formSubmittedOn")}
          />
          <Input
            label="Collected by"
            placeholder="Defaults to you"
            value={f.collectedBy}
            onChange={set("collectedBy")}
          />
        </div>
        <Input label="Address" value={f.address} onChange={set("address")} />
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink">
            More details
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {MORE_FIELDS.map(([k, label]) => (
              <Input
                key={k}
                label={label}
                value={f[k]}
                error={fields[k]}
                onChange={set(k)}
              />
            ))}
          </div>
        </details>
      </div>
    </Dialog>
  );
}

function PayDialog({ row, onClose }) {
  const { notify } = useToast();
  const refresh = useRefresh();
  const key = useRef(newIdempotencyKey());
  const [form, setForm] = useState(String(row.dues.form.leftPaise / 100 || ""));
  const [adm, setAdm] = useState(
    String(row.dues.admission.leftPaise / 100 || ""),
  );
  const [mode, setMode] = useState("cash");
  const [reference, setReference] = useState("");
  const [bankId, setBankId] = useState("");
  const [fields, setFields] = useState({});
  const banks = useQuery({
    queryKey: ["banks", "options"],
    queryFn: () => api("/api/banks/options"),
  });
  const bankList = banks.data?.banks ?? [];
  const bank =
    bankId || bankList.find((b) => b.defaultForModes.includes(mode))?.id || "";
  const f = parseRupees(form);
  const a = parseRupees(adm);
  const total = (f.paise ?? 0) + (a.paise ?? 0);
  const ready =
    !f.error &&
    !a.error &&
    total > 0 &&
    (mode === "cash" || (reference.trim().length >= 4 && bank));
  const pay = useMutation({
    mutationFn: () =>
      api(`/api/admissions/${row.id}/receipts`, {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          input: {
            formPaise: f.paise || undefined,
            admissionPaise: a.paise || undefined,
          },
          mode,
          ...(mode === "upi"
            ? { reference: reference.trim(), bankId: bank }
            : {}),
        },
      }),
    onSuccess: async (out) => {
      await refresh();
      notify(`Receipt ${out.receipt.number} made.`, "success");
      onClose();
    },
    onError: (e) => {
      setFields(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), "error");
    },
  });
  return (
    <Dialog
      open
      title={`Collect fee: ${row.formNo}`}
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
            disabled={!ready}
            loading={pay.isPending}
            onClick={() => pay.mutate()}
          >
            Collect {money(total)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          {row.name}. Pending: form fee {money(row.dues.form.leftPaise)},
          admission fee {money(row.dues.admission.leftPaise)}. Today's date and
          your name go on the receipt.
        </p>
        <Input
          label="Form fee (₹)"
          inputMode="decimal"
          value={form}
          error={f.error ?? fields.formPaise}
          onChange={(e) => setForm(e.target.value)}
        />
        <Input
          label="Admission fee (₹)"
          inputMode="decimal"
          value={adm}
          error={a.error ?? fields.admissionPaise}
          onChange={(e) => setAdm(e.target.value)}
        />
        <Select
          label="Paid by"
          options={[
            { value: "cash", label: "Cash" },
            { value: "upi", label: "UPI / QR" },
          ]}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setBankId("");
          }}
        />
        {mode === "upi" && (
          <>
            <Select
              label="Bank account"
              options={[
                { value: "", label: "Choose" },
                ...bankList.map((b) => ({ value: b.id, label: b.name })),
              ]}
              value={bank}
              error={fields.bankId}
              onChange={(e) => setBankId(e.target.value)}
            />
            <Input
              label="UPI / QR reference"
              value={reference}
              error={fields.reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function StatusDialog({ row, onClose }) {
  const { notify } = useToast();
  const refresh = useRefresh();
  const [to, setTo] = useState(row.status);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(null); // the scholar number the Admin is confirming
  const next = useQuery({
    queryKey: ["admissions", "next-scholar-no"],
    queryFn: () => api("/api/admissions/next-scholar-no"),
    enabled: to === "admitted",
    gcTime: 0,
    staleTime: 0,
  });
  const scholarNo = confirmed ?? next.data?.scholarNo;
  const change = useMutation({
    mutationFn: () =>
      to === "admitted"
        ? api(`/api/admissions/${row.id}/admit`, {
            method: "POST",
            body: { scholarNo },
          })
        : api(`/api/admissions/${row.id}/status`, {
            method: "POST",
            body: {
              status: to,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            },
          }),
    onSuccess: async () => {
      await refresh();
      notify(
        to === "admitted"
          ? `Admitted with scholar no. ${scholarNo}. The child is now in Students.`
          : "Status saved.",
        "success",
      );
      onClose();
    },
    onError: (e) => {
      // Another admission took the number: show the new one and ask again, nothing was saved.
      if (e.code === "SCHOLAR_NO_CHANGED" && e.fields?.scholarNo)
        setConfirmed(e.fields.scholarNo);
      notify(errorText(e), "error");
    },
  });
  const changedNo = confirmed && confirmed !== next.data?.scholarNo;
  return (
    <Dialog
      open
      title={`Status: ${row.formNo}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={change.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={to === row.status || (to === "admitted" && !scholarNo)}
            loading={change.isPending}
            onClick={() => change.mutate()}
          >
            {to === "admitted" ? "Confirm and admit" : "Save status"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{row.name}</p>
        <Select
          label="Admission status"
          options={STATUS_OPTIONS}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setConfirmed(null);
          }}
        />
        {to === "admitted" && (
          <div className="rounded-lg border border-line bg-app p-3 text-sm">
            {next.isPending && (
              <Spinner label="Finding the next scholar number" />
            )}
            {next.isError && (
              <p className="text-danger">{errorText(next.error)}</p>
            )}
            {scholarNo && (
              <>
                <p className="text-ink-muted">Scholar number to be given</p>
                <p
                  className="text-2xl font-semibold text-ink"
                  data-testid="scholar-no"
                >
                  {scholarNo}
                </p>
                {changedNo && (
                  <p className="mt-1 text-warning">
                    Another admission took the earlier number. Please check this
                    new number.
                  </p>
                )}
                <p className="mt-2 text-ink-muted">
                  After you confirm, the child moves to Students with this
                  number.
                </p>
              </>
            )}
          </div>
        )}
        {to === "cancelled" && (
          <Input
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </div>
    </Dialog>
  );
}

function ViewDialog({ id, onClose }) {
  const q = useQuery({
    queryKey: ["admissions", "one", id],
    queryFn: () => api(`/api/admissions/${id}`),
  });
  const a = q.data;
  return (
    <Dialog
      open
      title={a ? `${a.formNo}: ${a.name}` : "Admission form"}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isPending && <Spinner label="Loading" />}
      {q.isError && <p className="text-danger">{errorText(q.error)}</p>}
      {a && (
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              ["Class", classLabel(a.classKey)],
              ["Father", a.fatherName],
              ["Mother", a.motherName],
              ["Mobile", a.contactNo],
              ["Form date", fmtDate(a.formSubmittedOn)],
              ["Collected by", a.collectedBy],
              ["Entered by", a.createdByName],
              ["Status", a.statusLabel],
              ...(a.scholarNo ? [["Scholar no.", a.scholarNo]] : []),
              ...(a.cancelReason ? [["Cancel reason", a.cancelReason]] : []),
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd>{v || "-"}</dd>
              </div>
            ))}
          </dl>
          <Card title="Fees">
            <p>
              Form fee {money(a.dues.form.duePaise)}:{" "}
              <PayBadge part={a.dues.form} /> · Admission fee{" "}
              {money(a.dues.admission.duePaise)}:{" "}
              <PayBadge part={a.dues.admission} />
            </p>
            <p className="mt-1">
              Collected {money(a.dues.collectedPaise)} · Outstanding{" "}
              <b>{money(a.dues.outstandingPaise)}</b>
            </p>
          </Card>
          <div>
            <p className="mb-1 font-medium">Receipts</p>
            {a.receipts.length === 0 ? (
              <p className="text-ink-muted">No fee collected yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {a.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <Link
                      to={`/receipts/${r.id}`}
                      className="font-medium text-brand underline"
                    >
                      {r.number}
                    </Link>
                    <span>
                      {fmtDate(r.issuedAt.slice(0, 10))} ·{" "}
                      {r.mode === "upi" ? "UPI / QR" : "Cash"} ·{" "}
                      {money(r.totalPaise)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SessionDialog({ current, onClose }) {
  const { notify } = useToast();
  const refresh = useRefresh();
  const [session, setSession] = useState(current ?? "");
  const ok =
    /^\d{4}-\d{2}$/.test(session) &&
    (Number(session.slice(0, 4)) + 1) % 100 === Number(session.slice(5));
  const save = useMutation({
    mutationFn: () =>
      api("/api/admissions/settings", { method: "PUT", body: { session } }),
    onSuccess: async () => {
      await refresh();
      notify("Session changed. New forms use it from now on.", "success");
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  return (
    <Dialog
      open
      title="Admission session"
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
            disabled={!ok || session === current}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save session
          </Button>
        </>
      }
    >
      <Input
        label="Session (like 2026-27)"
        value={session}
        error={session && !ok ? "Use a session like 2026-27" : undefined}
        hint="Form numbers count separately for each session. Forms already made keep their session."
        onChange={(e) => setSession(e.target.value)}
      />
    </Dialog>
  );
}
