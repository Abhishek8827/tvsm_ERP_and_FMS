import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CLASSES,
  TC_CONDUCT,
  TC_REASONS,
  classLabel,
  dMonY,
  dmy,
  formatINR,
  getFinancialYear,
} from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  Table,
  useToast,
} from "../components/ui";
import { CERT_CSS, bonafideHtml, tcHtml } from "../lib/certificateHtml";
import { printHtml } from "../lib/printHtml";
import { WhatsappStatus } from "../components/WhatsappStatus";
import { approveAfter } from "../lib/approveAfter";
import { errorText, todayInput } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const slText = (n) => String(n).padStart(4, "0");

/** Find one student by name or Sch. no. `onlyActive` for the Bonafide. */
function StudentPicker({ onPick, onlyActive }) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const found = useQuery({
    queryKey: ["cert-student-search", q, onlyActive],
    queryFn: () =>
      api(
        `/api/students?${onlyActive ? "status=active&" : ""}pageSize=8&q=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2,
  });
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Find student (name or Sch. no.)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Type at least 2 letters"
      />
      {found.isLoading && (
        <p className="text-sm text-ink-muted">Searching...</p>
      )}
      {found.isError && (
        <p className="text-sm text-danger">{errorText(found.error)}</p>
      )}
      {found.data && found.data.rows.length === 0 && (
        <p className="text-sm text-ink-muted">No student found.</p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {found.data?.rows.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-app"
            >
              <span>
                <b>{s.name}</b>{" "}
                <span className="text-ink-muted">· Sch. {s.admissionNo}</span>
              </span>
              <span className="text-sm text-ink-muted">
                {classLabel(s.classKey)}
                {s.section ? ` - ${s.section}` : ""}
                {s.status === "inactive" ? " · inactive" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** On-screen preview in its own page (iframe) so the print CSS cannot leak into the app. */
function PreviewDialog({
  open,
  title,
  html,
  onClose,
  onPrint,
  printing,
  canPrint,
  extra,
  notice,
  footer,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-[90vh] w-full max-w-4xl flex-col gap-3 rounded-card bg-surface p-4 shadow-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <div className="flex flex-wrap gap-2">
            {extra}
            {canPrint && (
              <Button onClick={onPrint} loading={printing}>
                Print / Save as PDF
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        {notice}
        <iframe
          title="Certificate preview"
          className="min-h-0 flex-1 rounded border border-line bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${CERT_CSS} body{padding:8px}</style></head><body>${html}</body></html>`}
        />
        {footer !== null && !canPrint && (
          <p className="text-xs text-ink-muted">
            {footer ??
              "You can look at this certificate here. Only the Admin can print it."}
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Transfer Certificate

const TC_STATUS = {
  issued: ["success", "Issued"],
  cancelled: ["danger", "Cancelled"],
};

/**
 * The Admin asks and the request is approved at once (the Principal is read-only). If the approval
 * step fails the request stays waiting and the Admin can approve it from the requests list.
 */
async function askAndApprove(asking) {
  const created = await asking;
  if (created.status !== "pending") return { ...created, approveError: null };
  const { result, approveError } = await approveAfter(
    created,
    `/api/certificate-requests/${created.id}/approve`,
  );
  return { ...created, ...result, approveError };
}
function notifyIssued(notify, r) {
  if (r.approveError)
    notify(
      `Request saved, but approving it failed: ${errorText(r.approveError)} Approve it from the requests list.`,
      "error",
    );
  else
    notify(
      `Done. ${r.certificateNumber ? `Number ${r.certificateNumber} is ` : ""}ready to print.`,
      "success",
    );
}

function TcForm({ draft, student, onSent, onBack }) {
  const { notify } = useToast();
  const keyRef = useRef(newIdempotencyKey());
  const d = draft.defaults;
  const missingKeys = draft.missing.map((m) => m.key);
  const [f, setF] = useState({
    nationality: draft.snapshot.nationality || "Indian",
    firstAdmissionDate: draft.snapshot.firstAdmissionDate ?? "",
    firstAdmissionClass: "",
    pen: draft.pen,
    aparId: draft.aparId,
    fatherName: "",
    motherName: "",
    category: "",
    dateOfBirth: "",
    bookNo: draft.bookNo,
    lastExam: "",
    failedInSameClass: "No",
    subjects: "",
    qualifiedForPromotion: d.qualifiedForPromotion,
    workingDays: "",
    daysPresent: "",
    ncc: d.ncc,
    games: d.games,
    conduct: "Good",
    dateOfApplication: d.dateOfApplication,
    dateOfIssue: d.dateOfIssue,
    reason: "Parent Request",
    reasonNote: "",
    remarks: d.remarks,
    duesOverrideReason: "",
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const due = draft.pendingPaise;

  const issue = useMutation({
    mutationFn: () => {
      const body = {
        studentId: student.id,
        bookNo: f.bookNo.trim(),
        lastExam: f.lastExam.trim(),
        failedInSameClass: f.failedInSameClass.trim(),
        subjects: f.subjects.trim(),
        qualifiedForPromotion: f.qualifiedForPromotion.trim(),
        workingDays: Number(f.workingDays),
        daysPresent: Number(f.daysPresent),
        ncc: f.ncc.trim() || "Not applicable",
        games: f.games.trim() || "Not applicable",
        conduct: f.conduct,
        dateOfApplication: f.dateOfApplication,
        dateOfIssue: f.dateOfIssue,
        reason: f.reason,
        remarks: f.remarks.trim() || "None",
      };
      if (f.reasonNote.trim()) body.reasonNote = f.reasonNote.trim();
      if (due > 0) body.duesOverrideReason = f.duesOverrideReason.trim();
      for (const k of [
        "fatherName",
        "motherName",
        "category",
        "dateOfBirth",
        "nationality",
        "firstAdmissionDate",
        "firstAdmissionClass",
        "pen",
        "aparId",
      ])
        if (String(f[k] ?? "").trim()) body[k] = String(f[k]).trim();
      return askAndApprove(
        api("/api/certificate-requests/tc", {
          method: "POST",
          body,
          idempotencyKey: keyRef.current,
        }),
      );
    },
    onSuccess: (r) => {
      notifyIssued(notify, r);
      onSent(r);
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), "error");
      // A refusal (4xx) needs a fresh key after the Admin fixes it; a network failure keeps it.
      if (e.status >= 400 && e.status < 500)
        keyRef.current = newIdempotencyKey();
    },
  });

  const submit = (e) => {
    e.preventDefault();
    const local = {};
    const need = (k, label) =>
      !String(f[k] ?? "").trim() && (local[k] = `${label} is required`);
    need("lastExam", "Last exam and result");
    need("failedInSameClass", "This answer");
    need("subjects", "Subjects studied");
    need("qualifiedForPromotion", "Promotion");
    need("workingDays", "Working days");
    need("daysPresent", "Days present");
    need("bookNo", "Book No.");
    for (const m of draft.missing) need(m.key, m.label);
    if (due > 0 && f.duesOverrideReason.trim().length < 3)
      local.duesOverrideReason = "Write the reason (at least 3 letters)";
    if (Number(f.daysPresent) > Number(f.workingDays))
      local.daysPresent = "Days present cannot be more than working days";
    setErrors(local);
    if (Object.keys(local).length === 0) issue.mutate();
  };
  const err = (k) => errors[k];
  const s = draft.snapshot;
  const cls = `${classLabel(student.classKey)}${student.section ? ` - ${student.section}` : ""}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Card title="From the school records (fields 1-8, 13, 14)">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ["Name", s.name],
            ["Mother's name", s.motherName || "—"],
            ["Father's name", s.fatherName || "—"],
            ["Date of birth", s.dob ? `${dmy(s.dob)} · ${s.dobInWords}` : "—"],
            ["Category", s.category || "—"],
            [
              "Last class",
              `${s.lastClassInWords}${s.section ? ` - ${s.section}` : ""} (${cls})`,
            ],
            ["Dues paid up to", s.duesPaidUpto],
            ["Fee concession", s.feeConcession],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-36 shrink-0 text-ink-muted">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {due > 0 ? (
        <div
          role="alert"
          className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm"
        >
          <p className="font-medium text-danger">
            Fees are still due: {money(due)} (late fee included).
          </p>
          {draft.unpaid?.length > 0 && (
            <table className="mb-3 w-full text-left" aria-label="Unpaid months">
              <thead className="text-xs uppercase text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Month</th>
                  <th className="py-1 pr-3 font-medium">Unpaid</th>
                  <th className="py-1 text-right font-medium">Late fee</th>
                </tr>
              </thead>
              <tbody>
                {draft.unpaid.map((u) => (
                  <tr key={u.period}>
                    <td className="py-1 pr-3">{u.period}</td>
                    <td className="py-1 pr-3">
                      {u.items
                        .map((x) => `${x.head} ${money(x.duePaise)}`)
                        .join(", ") || "-"}
                    </td>
                    <td className="py-1 text-right">
                      {u.lateFeePaise > 0 ? money(u.lateFeePaise) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mb-3 text-ink-muted">
            A TC is normally given only after all dues are paid. To ask for it
            anyway, write the reason. The Principal sees it, and it is saved on
            the TC and in the audit log.
          </p>
          <Input
            label="Reason to ask for the TC with dues pending"
            value={f.duesOverrideReason}
            onChange={set("duesOverrideReason")}
            error={err("duesOverrideReason")}
          />
        </div>
      ) : (
        <div className="rounded-card border border-success/40 bg-success/5 p-3 text-sm text-success">
          No fee dues pending. This request can be sent.
        </div>
      )}

      <Card
        title="Student details"
        subtitle="Anything missing is filled here and saved back to the student record."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {missingKeys.includes("fatherName") && (
            <Input
              label="Father's name"
              required
              value={f.fatherName}
              onChange={set("fatherName")}
              error={err("fatherName")}
            />
          )}
          {missingKeys.includes("motherName") && (
            <Input
              label="Mother's name"
              required
              value={f.motherName}
              onChange={set("motherName")}
              error={err("motherName")}
            />
          )}
          {missingKeys.includes("dateOfBirth") && (
            <Input
              label="Date of birth"
              type="date"
              required
              value={f.dateOfBirth}
              onChange={set("dateOfBirth")}
              error={err("dateOfBirth")}
            />
          )}
          {missingKeys.includes("category") && (
            <Input
              label="Category (SC / ST / OBC / General)"
              required
              value={f.category}
              onChange={set("category")}
              error={err("category")}
            />
          )}
          <Input
            label="Nationality"
            value={f.nationality}
            onChange={set("nationality")}
            error={err("nationality")}
          />
          <Input
            label="Date of first admission"
            type="date"
            required={missingKeys.includes("firstAdmissionDate")}
            value={f.firstAdmissionDate}
            onChange={set("firstAdmissionDate")}
            error={err("firstAdmissionDate")}
          />
          <Select
            label="Class at first admission"
            required={missingKeys.includes("firstAdmissionClass")}
            value={f.firstAdmissionClass}
            onChange={set("firstAdmissionClass")}
            error={err("firstAdmissionClass")}
            options={[
              {
                value: "",
                label: s.firstAdmissionClass
                  ? `${s.firstAdmissionClass} (saved)`
                  : "Select",
              },
              ...CLASSES.map((c) => ({ value: c.key, label: c.label })),
            ]}
          />
          <Input label="PEN (optional)" value={f.pen} onChange={set("pen")} />
          <Input
            label="APAAR ID (optional)"
            value={f.aparId}
            onChange={set("aparId")}
          />
        </div>
      </Card>

      <Card title="To be entered (fields 9-12, 15-23)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Book No."
            required
            value={f.bookNo}
            onChange={set("bookNo")}
            error={err("bookNo")}
          />
          <Input
            label="9. Annual exam last taken, with result"
            required
            value={f.lastExam}
            onChange={set("lastExam")}
            error={err("lastExam")}
            placeholder="Annual Examination 2025-26, Passed"
          />
          <Input
            label="10. Failed? once or twice in same class"
            required
            value={f.failedInSameClass}
            onChange={set("failedInSameClass")}
            error={err("failedInSameClass")}
          />
          <Input
            label="11. Subjects studied"
            required
            value={f.subjects}
            onChange={set("subjects")}
            error={err("subjects")}
          />
          <Input
            label="12. Qualified for promotion to higher class"
            required
            value={f.qualifiedForPromotion}
            onChange={set("qualifiedForPromotion")}
            error={err("qualifiedForPromotion")}
          />
          <Input
            label="15. Working days in the session"
            type="number"
            min="0"
            required
            value={f.workingDays}
            onChange={set("workingDays")}
            error={err("workingDays")}
          />
          <Input
            label="16. Days present"
            type="number"
            min="0"
            required
            value={f.daysPresent}
            onChange={set("daysPresent")}
            error={err("daysPresent")}
          />
          <Input
            label="17. NCC / Scout / Guide"
            value={f.ncc}
            onChange={set("ncc")}
          />
          <Input
            label="18. Games / activities"
            value={f.games}
            onChange={set("games")}
          />
          <Select
            label="19. General conduct"
            value={f.conduct}
            onChange={set("conduct")}
            options={TC_CONDUCT.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="20. Date of application"
            type="date"
            value={f.dateOfApplication}
            onChange={set("dateOfApplication")}
            error={err("dateOfApplication")}
          />
          <Input
            label="21. Date of issue"
            type="date"
            value={f.dateOfIssue}
            onChange={set("dateOfIssue")}
            error={err("dateOfIssue")}
          />
          <Select
            label="22. Reason for leaving"
            value={f.reason}
            onChange={set("reason")}
            options={TC_REASONS.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="22. More detail (optional)"
            value={f.reasonNote}
            onChange={set("reasonNote")}
          />
          <Input
            label="23. Any other remarks"
            value={f.remarks}
            onChange={set("remarks")}
          />
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        The Sl. No. is given when you press the button (next free number:{" "}
        <b>{slText(draft.nextSl)}</b> or later). After that the student becomes
        inactive, no more fees are posted, and you can print the certificate.
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={issue.isPending}>
          Issue certificate
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={issue.isPending}>
          Back
        </Button>
      </div>
    </form>
  );
}

function TcRequestForm({ student, onSent, onBack }) {
  const draft = useQuery({
    queryKey: ["tc-draft", student.id],
    queryFn: () => api(`/api/tc/draft/${student.id}`),
    gcTime: 0,
  });
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          Transfer Certificate request
        </h2>
        <Button variant="secondary" onClick={onBack}>
          Choose another student
        </Button>
      </div>
      <Card title="Student">
        <p>
          <b>{student.name}</b>{" "}
          <span className="text-ink-muted">· Sch. {student.admissionNo}</span>
          <span className="text-ink-muted">
            {" "}
            · {classLabel(student.classKey)}
            {student.section ? ` - ${student.section}` : ""}
          </span>
        </p>
      </Card>
      {draft.isLoading && (
        <p className="text-sm text-ink-muted">Loading details...</p>
      )}
      {draft.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorText(draft.error)}
        </p>
      )}
      {draft.data?.existingTc && (
        <div
          role="alert"
          className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm"
        >
          A Transfer Certificate (Sl. No. {slText(draft.data.existingTc.slNo)})
          is already issued for this student. Cancel it from the Issued list
          first if it was a mistake.
        </div>
      )}
      {draft.data && !draft.data.existingTc && (
        <TcForm
          key={student.id}
          draft={draft.data}
          student={student}
          onSent={onSent}
          onBack={onBack}
        />
      )}
    </div>
  );
}

/** Issued Transfer Certificates: look, print (original first, then duplicates), cancel. */
function TcIssued({ isAdmin, initialQ = "" }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null); // the TC being looked at
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [printing, setPrinting] = useState(false);

  const list = useQuery({
    queryKey: ["tc-list", page, pageSize, q, status],
    queryFn: () =>
      api(
        `/api/tc?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`,
      ),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tc-list"] });
  const doPrint = async (tc, copyNo) => {
    setPrinting(true);
    try {
      await printHtml({
        html: tcHtml(tc, { copyNo }),
        css: CERT_CSS,
        title: `TC ${slText(tc.slNo)}`,
      });
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setPrinting(false);
    }
  };
  // The first print is the original; the server counts every later one as a duplicate copy.
  const print = useMutation({
    mutationFn: (id) => api(`/api/tc/${id}/print`, { method: "POST" }),
    onSuccess: async (tc) => {
      await refresh();
      await doPrint(tc, tc.copyNo);
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/api/tc/${cancelFor.id}/cancel`, {
        method: "POST",
        body: { reason: cancelReason.trim() },
      }),
    onSuccess: async () => {
      notify(
        "Transfer Certificate cancelled. The student is active again.",
        "success",
      );
      setCancelFor(null);
      setView(null);
      await refresh();
      await qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e) => notify(errorText(e), "error"),
  });

  const columns = [
    { key: "sl", header: "Sl. No.", render: (r) => <b>{slText(r.slNo)}</b> },
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <span>
          {r.snapshot.name}{" "}
          <span className="text-ink-muted">
            · Sch. {r.snapshot.admissionNo}
          </span>
        </span>
      ),
    },
    {
      key: "class",
      header: "Last class",
      render: (r) => classLabel(r.snapshot.lastClass),
    },
    {
      key: "date",
      header: "Issued",
      render: (r) => dmy(r.entered.dateOfIssue),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={TC_STATUS[r.status][0]}>{TC_STATUS[r.status][1]}</Badge>
          {r.status === "issued" && !r.originalPrinted && (
            <Badge tone="info">Not printed yet</Badge>
          )}
          {r.duesOverride && <Badge tone="warning">Dues pending</Badge>}
          {r.duplicateCount > 0 && (
            <Badge>{r.duplicateCount} duplicate(s)</Badge>
          )}
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setView(r)}>
            View
          </Button>
          {isAdmin && r.status === "issued" && (
            <>
              <Button
                loading={print.isPending && print.variables === r.id}
                variant={r.originalPrinted ? "secondary" : "primary"}
                onClick={() => print.mutate(r.id)}
              >
                {r.originalPrinted ? "Print duplicate" : "Print original"}
              </Button>
              <Button variant="danger" onClick={() => setCancelFor(r)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <Input
          label="Search issued TCs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Name or Sch. no."
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "", label: "All" },
            { value: "issued", label: "Issued" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => list.refetch()}
        emptyTitle="No Transfer Certificates issued yet"
        emptyDescription="A certificate appears here after it is issued."
      />
      {list.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <PreviewDialog
        open={Boolean(view)}
        title={view ? `Transfer Certificate ${slText(view.slNo)}` : ""}
        html={view ? tcHtml(view) : ""}
        canPrint={isAdmin && view?.status === "issued"}
        printing={printing || print.isPending}
        onPrint={() => print.mutate(view.id)}
        onClose={() => setView(null)}
        extra={
          view?.status === "cancelled" ? (
            <Badge tone="danger">Cancelled: {view.cancelReason}</Badge>
          ) : view?.status === "issued" ? (
            <WhatsappStatus
              kind="tc"
              refId={view.id}
              canRetry={isAdmin}
              waitingText="WhatsApp: the parent is told when the original is printed."
            />
          ) : null
        }
      />
      <ConfirmDialog
        open={Boolean(cancelFor)}
        title={
          cancelFor
            ? `Cancel Transfer Certificate ${slText(cancelFor.slNo)}?`
            : ""
        }
        description="The number stays used (it is never given again). The student becomes active again."
        confirmLabel="Cancel this TC"
        tone="danger"
        requireReason
        onReasonChange={setCancelReason}
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setCancelFor(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Bonafide

function BonafideForm({ student, onSent, onBack }) {
  const { notify } = useToast();
  const keyRef = useRef(newIdempotencyKey());
  const [purpose, setPurpose] = useState("");
  const [academicYear, setAcademicYear] = useState(
    getFinancialYear(new Date()),
  );
  const [dateOfIssue, setDateOfIssue] = useState(todayInput());
  const [errors, setErrors] = useState({});
  const ask = useMutation({
    mutationFn: () =>
      askAndApprove(
        api("/api/certificate-requests/bonafide", {
          method: "POST",
          body: {
            studentId: student.id,
            purpose: purpose.trim(),
            academicYear,
            dateOfIssue,
          },
          idempotencyKey: keyRef.current,
        }),
      ),
    onSuccess: (r) => {
      notifyIssued(notify, r);
      onSent(r);
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), "error");
      if (e.status >= 400 && e.status < 500)
        keyRef.current = newIdempotencyKey();
    },
  });
  const submit = (e) => {
    e.preventDefault();
    const local = {};
    if (purpose.trim().length < 2) local.purpose = "Write the purpose";
    if (!/^\d{4}-\d{2}$/.test(academicYear))
      local.academicYear = "Use a year like 2026-27";
    setErrors(local);
    if (Object.keys(local).length === 0) ask.mutate();
  };
  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-w-3xl flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          Bonafide Certificate request
        </h2>
        <Button variant="secondary" onClick={onBack}>
          Choose another student
        </Button>
      </div>
      <Card title="Student">
        <p>
          <b>{student.name}</b>{" "}
          <span className="text-ink-muted">· Sch. {student.admissionNo}</span>
          <span className="text-ink-muted">
            {" "}
            · {classLabel(student.classKey)}
            {student.section ? ` - ${student.section}` : ""}
          </span>
        </p>
      </Card>
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Purpose"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            error={errors.purpose}
            placeholder="Passport application"
          />
          <Input
            label="Academic year"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            error={errors.academicYear}
          />
          <Input
            label="Date of issue"
            type="date"
            value={dateOfIssue}
            onChange={(e) => setDateOfIssue(e.target.value)}
            error={errors.dateOfIssue}
          />
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Dues are not checked for a Bonafide. The number is given when you
          press the button.
        </p>
      </Card>
      <div>
        <Button type="submit" loading={ask.isPending}>
          Issue certificate
        </Button>
      </div>
    </form>
  );
}

/** Issued Bonafide certificates: look, print (original first, then duplicates). */
function BonafideIssued({ isAdmin, initialQ = "" }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState(initialQ);
  const [view, setView] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const list = useQuery({
    queryKey: ["bonafide-list", page, pageSize, q],
    queryFn: () =>
      api(
        `/api/bonafide?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`,
      ),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["bonafide-list"] });
  const doPrint = async (b, copyNo) => {
    setPrinting(true);
    try {
      await printHtml({
        html: bonafideHtml(b, { copyNo }),
        css: CERT_CSS,
        title: `Bonafide ${b.number}`,
      });
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setPrinting(false);
    }
  };
  const print = useMutation({
    mutationFn: (id) => api(`/api/bonafide/${id}/print`, { method: "POST" }),
    onSuccess: async (b) => {
      await refresh();
      await doPrint(b, b.copyNo);
    },
    onError: (e) => notify(errorText(e), "error"),
  });

  const cancel = useMutation({
    mutationFn: () =>
      api(`/api/bonafide/${cancelFor.id}/cancel`, {
        method: "POST",
        body: { reason: cancelReason.trim() },
      }),
    onSuccess: async () => {
      notify(
        "Bonafide certificate cancelled. Its number stays used.",
        "success",
      );
      setCancelFor(null);
      setCancelReason("");
      setView(null);
      await refresh();
    },
    onError: (e) => notify(errorText(e), "error"),
  });

  const columns = [
    { key: "no", header: "Number", render: (r) => <b>{r.number}</b> },
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <span>
          {r.snapshot.name}{" "}
          <span className="text-ink-muted">
            · Sch. {r.snapshot.admissionNo}
          </span>
        </span>
      ),
    },
    { key: "purpose", header: "Purpose", render: (r) => r.purpose },
    { key: "date", header: "Issued", render: (r) => dMonY(r.dateOfIssue) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.status === "cancelled" && <Badge tone="danger">Cancelled</Badge>}
          {r.status === "issued" && !r.originalPrinted && (
            <Badge tone="info">Not printed yet</Badge>
          )}
          {r.duplicateCount > 0 && (
            <Badge>{r.duplicateCount} duplicate(s)</Badge>
          )}
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setView(r)}>
            View
          </Button>
          {isAdmin && r.status === "issued" && (
            <>
              <Button
                variant={r.originalPrinted ? "secondary" : "primary"}
                loading={print.isPending && print.variables === r.id}
                onClick={() => print.mutate(r.id)}
              >
                {r.originalPrinted ? "Print duplicate" : "Print original"}
              </Button>
              <Button variant="danger" onClick={() => setCancelFor(r)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <Input
          label="Search issued Bonafide"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Name or Sch. no."
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => list.refetch()}
        emptyTitle="No Bonafide certificates issued yet"
        emptyDescription="A certificate appears here after it is issued."
      />
      {list.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <PreviewDialog
        open={Boolean(view)}
        title={view ? `Bonafide ${view.number}` : ""}
        html={view ? bonafideHtml(view) : ""}
        canPrint={isAdmin && view?.status === "issued"}
        printing={printing || print.isPending}
        onPrint={() => print.mutate(view.id)}
        onClose={() => setView(null)}
        extra={
          view?.status === "cancelled" ? (
            <Badge tone="danger">Cancelled: {view.cancelReason}</Badge>
          ) : null
        }
      />
      <ConfirmDialog
        open={Boolean(cancelFor)}
        title={cancelFor ? `Cancel Bonafide ${cancelFor.number}?` : ""}
        description="The number stays used (it is never given again). A cancelled Bonafide cannot be printed."
        confirmLabel="Cancel this Bonafide"
        tone="danger"
        requireReason
        onReasonChange={setCancelReason}
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setCancelFor(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Requests (Admin asks, Principal decides)

const REQUEST_STATUS = {
  pending: ["warning", "Waiting"],
  approved: ["success", "Approved"],
  rejected: ["danger", "Rejected"],
};

function RequestsPanel({ kind, isAdmin, onPick, onGoIssued }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const label = kind === "tc" ? "Transfer Certificate" : "Bonafide";

  const list = useQuery({
    queryKey: ["cert-requests", kind, page, pageSize, q, status],
    queryFn: () =>
      api(
        `/api/certificate-requests?kind=${kind}&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`,
      ),
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 30_000,
  });
  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ["cert-requests"] });
    await qc.invalidateQueries({ queryKey: ["tc-list"] });
    await qc.invalidateQueries({ queryKey: ["bonafide-list"] });
    await qc.invalidateQueries({ queryKey: ["students"] });
  };
  const approve = useMutation({
    mutationFn: (id) =>
      api(`/api/certificate-requests/${id}/approve`, { method: "POST" }),
    onSuccess: async (r) => {
      notify(
        `Approved. ${kind === "tc" ? `Sl. No. ${r.certificateNumber}` : r.certificateNumber} is ready for the Admin to print.`,
        "success",
      );
      setView(null);
      await refreshAll();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const reject = useMutation({
    mutationFn: () =>
      api(`/api/certificate-requests/${rejectFor.id}/reject`, {
        method: "POST",
        body: { reason: rejectReason.trim() },
      }),
    onSuccess: async () => {
      notify("Request rejected. No number was used.", "success");
      setRejectFor(null);
      setView(null);
      await refreshAll();
    },
    onError: (e) => notify(errorText(e), "error"),
  });

  const columns = [
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <span>
          {r.studentName}{" "}
          <span className="text-ink-muted">· Sch. {r.admissionNo}</span>
        </span>
      ),
    },
    {
      key: "what",
      header: kind === "tc" ? "Reason" : "Purpose",
      render: (r) =>
        kind === "tc" ? r.preview.entered.reason : r.preview.purpose,
    },
    {
      key: "asked",
      header: "Asked by",
      render: (r) => (
        <span>
          {r.requestedByName ?? "-"}{" "}
          <span className="text-ink-muted">
            · {dmy(String(r.createdAt).slice(0, 10))}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap gap-1">
            <Badge tone={REQUEST_STATUS[r.status][0]}>
              {REQUEST_STATUS[r.status][1]}
              {r.status === "approved" && r.certificateNumber
                ? ` · ${r.certificateNumber}`
                : ""}
            </Badge>
            {r.duesOverride && <Badge tone="warning">Dues pending</Badge>}
          </span>
          {r.status === "rejected" && (
            <span className="text-xs text-ink-muted">
              Reason: {r.rejectReason}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "act",
      header: "",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant={
              isAdmin && r.status === "pending" ? "primary" : "secondary"
            }
            onClick={() => setView(r)}
          >
            {isAdmin && r.status === "pending" ? "Review" : "View"}
          </Button>
          {isAdmin && r.status === "approved" && (
            <Button onClick={() => onGoIssued(r.admissionNo)}>Print</Button>
          )}
        </div>
      ),
    },
  ];

  const html = view
    ? kind === "tc"
      ? tcHtml({ ...view.preview, slNo: null, status: "issued" })
      : bonafideHtml({ ...view.preview, number: null })
    : "";
  const canDecide = isAdmin && view?.status === "pending";

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <Card
          title={`Ask for a new ${label}`}
          subtitle={`Find the student, choose them, then fill the form. It is issued at once; then you can print and sign it.${kind === "bonafide" ? " Only students who are studying now (active) can get one." : ""}`}
        >
          <StudentPicker onPick={onPick} onlyActive={kind === "bonafide"} />
        </Card>
      )}
      <FilterBar>
        <Input
          label="Search requests"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Name or Sch. no."
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "", label: "All" },
            { value: "pending", label: "Waiting" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => list.refetch()}
        emptyTitle={`No ${label} requests yet`}
        emptyDescription={
          isAdmin
            ? "Search for a student above to make the first request."
            : undefined
        }
      />
      {list.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <PreviewDialog
        open={Boolean(view)}
        title={view ? `${label} request: ${view.studentName}` : ""}
        html={html}
        canPrint={false}
        footer={null}
        onClose={() => setView(null)}
        notice={
          view?.duesOverride ? (
            <div
              role="alert"
              className="rounded-card border border-danger/40 bg-danger/5 p-3 text-sm"
            >
              <b className="text-danger">
                Fees are pending: {money(view.duesOverride.duePaise)}.
              </b>{" "}
              Admin's reason: {view.duesOverride.reason}
            </div>
          ) : view?.status === "rejected" ? (
            <div
              role="alert"
              className="rounded-card bg-danger/5 p-3 text-sm text-danger"
            >
              Rejected by {view.decidedByName}: {view.rejectReason}
            </div>
          ) : null
        }
        extra={
          canDecide ? (
            <>
              <Button
                loading={approve.isPending}
                disabled={reject.isPending}
                onClick={() => approve.mutate(view.id)}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                disabled={approve.isPending}
                onClick={() => {
                  setRejectReason("");
                  setRejectFor(view);
                }}
              >
                Reject
              </Button>
            </>
          ) : view ? (
            <Badge tone={REQUEST_STATUS[view.status][0]}>
              {REQUEST_STATUS[view.status][1]}
            </Badge>
          ) : null
        }
      />
      <ConfirmDialog
        open={Boolean(rejectFor)}
        title={
          rejectFor
            ? `Reject the ${label} request for ${rejectFor.studentName}?`
            : ""
        }
        description="No number is used. The Admin sees your reason and can send a new request."
        confirmLabel="Reject request"
        tone="danger"
        requireReason
        onReasonChange={setRejectReason}
        loading={reject.isPending}
        onConfirm={() => reject.mutate()}
        onCancel={() => setRejectFor(null)}
      />
    </div>
  );
}

/** One certificate kind: the Requests (Admin asks, Principal decides) and the Issued list. */
function CertTab({ kind, isAdmin }) {
  const [sub, setSub] = useState("requests");
  const [student, setStudent] = useState(null);
  const [issuedQ, setIssuedQ] = useState("");
  const waiting = useQuery({
    queryKey: ["cert-requests", "waiting", kind],
    queryFn: () =>
      api(`/api/certificate-requests?kind=${kind}&status=pending&pageSize=1`),
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 30_000,
  });
  if (student) {
    const back = () => setStudent(null);
    return kind === "tc" ? (
      <TcRequestForm student={student} onBack={back} onSent={back} />
    ) : (
      <BonafideForm student={student} onBack={back} onSent={back} />
    );
  }
  const n = waiting.data?.total ?? 0;
  const subs = [
    ["requests", `Requests${n > 0 ? ` (${n} waiting)` : ""}`],
    ["issued", "Issued"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Requests or issued"
        className="flex gap-2"
      >
        {subs.map(([key, text]) => (
          <button
            key={key}
            role="tab"
            aria-selected={sub === key}
            onClick={() => setSub(key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${sub === key ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted hover:text-ink"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {sub === "requests" && (
        <RequestsPanel
          kind={kind}
          isAdmin={isAdmin}
          onPick={setStudent}
          onGoIssued={(admissionNo) => {
            setIssuedQ(admissionNo);
            setSub("issued");
          }}
        />
      )}
      {sub === "issued" &&
        (kind === "tc" ? (
          <TcIssued isAdmin={isAdmin} initialQ={issuedQ} />
        ) : (
          <BonafideIssued isAdmin={isAdmin} initialQ={issuedQ} />
        ))}
    </div>
  );
}

// ------------------------------------------------------------------ Settings (Admin)

function SettingsForm({ data, onSaved }) {
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

function SettingsTab() {
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
    <SettingsForm
      key={`${s.data.tcBookNo}|${s.data.tcStartSl}|${s.data.startLocked}`}
      data={s.data}
      onSaved={() => qc.invalidateQueries({ queryKey: ["cert-settings"] })}
    />
  );
}

/**
 * TC & Bonafide. The Admin issues (asks and approves in one go), then prints and signs.
 * The Cashier can only look.
 */
export function TcBonafide() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  // /tc-bonafide?tab=bonafide opens the Bonafide tab (the Approvals inbox links here).
  const [params] = useSearchParams();
  const [tab, setTab] = useState(
    params.get("tab") === "bonafide" ? "bonafide" : "tc",
  );
  const tabs = [
    ["tc", "Transfer Certificates"],
    ["bonafide", "Bonafide"],
    ...(isAdmin ? [["settings", "Settings"]] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">TC & Bonafide</h1>
        <p className="text-sm text-ink-muted">
          {isAdmin
            ? "Issue a certificate, then print and sign it."
            : "You can look at requests and issued certificates. Only the Admin can issue or print them."}
        </p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "tc" && <CertTab kind="tc" isAdmin={isAdmin} />}
      {tab === "bonafide" && <CertTab kind="bonafide" isAdmin={isAdmin} />}
      {tab === "settings" && isAdmin && <SettingsTab />}
    </div>
  );
}
