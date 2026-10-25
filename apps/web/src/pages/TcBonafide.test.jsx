import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { bonafideHtml, tcHtml } from "../lib/certificateHtml";
import { TcBonafide } from "./TcBonafide";

vi.mock("../api/client", () => ({
  api: vi.fn(),
  newIdempotencyKey: () => "key-test-12345",
}));
vi.mock("../lib/printHtml", () => ({ printHtml: vi.fn(async () => {}) }));
let mockRole = "admin";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ role: mockRole }) }));
import { api } from "../api/client";
import { printHtml } from "../lib/printHtml";

const snapshot = {
  admissionNo: '412', name: 'Aarav Sharma', motherName: 'Sunita', fatherName: 'Rajesh',
  dob: '2014-03-14', dobInWords: 'Fourteenth March Two Thousand Fourteen', nationality: 'Indian',
  category: 'General', firstAdmissionDate: '2019-07-04', firstAdmissionClass: '1st', lastClass: '7',
  lastClassInWords: '7 (Seventh)', section: 'A', duesPaidUpto: 'September 2026', feeConcession: 'None',
}; // prettier-ignore
const entered = {
  lastExam: 'Annual 2025-26, Passed', failedInSameClass: 'No', subjects: 'English',
  qualifiedForPromotion: 'Yes, to next class', workingDays: 220, daysPresent: 198, ncc: 'Not applicable',
  games: 'Kabaddi', conduct: 'Very Good', dateOfApplication: '2026-10-12', dateOfIssue: '2026-10-13',
  reason: 'Parent Request', remarks: 'None',
}; // prettier-ignore
const tc = (o = {}) => ({ id: 't1', fy: '2026-27', slNo: 143, bookNo: '7', studentId: 's1', snapshot, entered, duesOverride: null, status: 'issued', duplicateCount: 0, ...o }); // prettier-ignore
const tcList = { rows: [tc()], total: 1, page: 1, pageSize: 25 };
const req = (o = {}) => ({ id: 'r1', kind: 'tc', studentId: 's1', studentName: 'Aarav Sharma', admissionNo: '412', fy: '2026-27', status: 'pending', preview: { bookNo: '7', snapshot, entered }, duesOverride: null, requestedByName: 'Admin', decidedByName: null, rejectReason: null, certificateNumber: null, createdAt: '2026-10-13T06:00:00Z', ...o }); // prettier-ignore
const reqList = (...rows) => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 25,
});
const student = { id: 's1', name: 'Aarav Sharma', admissionNo: '412', classKey: '7', section: 'A', status: 'active' }; // prettier-ignore
const draft = (o = {}) => ({
  fy: '2026-27', today: '2026-10-13', existingTc: null, student: { id: 's1', status: 'active' },
  snapshot, pen: '', aparId: '', missing: [], pendingPaise: 0, duesPaidUpto: 'September 2026',
  bookNo: '7', nextSl: 143,
  defaults: { qualifiedForPromotion: 'Yes, to next class', ncc: 'Not applicable', games: 'Not applicable', remarks: 'None', dateOfIssue: '2026-10-13', dateOfApplication: '2026-10-13' },
  ...o,
}); // prettier-ignore

function show(path = "/") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <TcBonafide />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
function route(map) {
  api.mockImplementation(async (url, opts) => {
    const hit = Object.entries(map).find(([k]) => String(url).startsWith(k));
    if (!hit) throw new Error(`unexpected ${opts?.method ?? "GET"} ${url}`);
    return typeof hit[1] === "function" ? hit[1](url, opts) : hit[1];
  });
}
const fill = async (user, label, value) => {
  const el = screen.getByLabelText(label);
  await user.clear(el);
  await user.type(el, value);
};

const openIssued = (user) =>
  user.click(screen.getByRole("tab", { name: "Issued" }));
// Search for the student on the Requests page and choose them (no second search box).
const pickStudent = async (user) => {
  await user.type(await screen.findByLabelText(/Find student/), "Aarav");
  await user.click(await screen.findByRole("button", { name: /Aarav Sharma/ }));
};

describe("TC & Bonafide screen: Admin", () => {
  beforeEach(() => {
    api.mockReset();
    mockRole = "admin";
  });

  it("Requests page: a working student search, the waiting count, and the requests table", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(req()),
      "/api/students?": { rows: [student], total: 1 },
    });
    show();
    expect(
      await screen.findByRole("tab", { name: "Requests (1 waiting)" }),
    ).toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /Aarav/ });
    expect(within(row).getByText("Waiting for Principal")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    // the search at the top finds students and lets the Admin choose one
    await user.type(screen.getByLabelText(/Find student/), "Aarav");
    expect(
      await screen.findByRole("button", { name: /Aarav Sharma/ }),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("/api/students?pageSize=8&q=Aarav"),
    );
  });

  it("an approved request has a Print button that opens the Issued list for that student", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(
        req({ status: "approved", certificateNumber: "0143" }),
      ),
      "/api/students?": { rows: [], total: 0 },
      "/api/tc?": tcList,
    });
    show();
    const row = await screen.findByRole("row", { name: /Aarav/ });
    expect(within(row).getByText(/Approved · 0143/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Print" }));
    expect(await screen.findByLabelText("Search issued TCs")).toHaveValue(
      "412",
    );
    expect(
      await screen.findByRole("button", { name: "Print original" }),
    ).toBeInTheDocument();
  });

  it("a rejected request shows the Principal's reason", async () => {
    route({
      "/api/certificate-requests?": reqList(
        req({
          status: "rejected",
          rejectReason: "Wrong class entered",
          decidedByName: "Principal",
        }),
      ),
      "/api/students?": { rows: [], total: 0 },
    });
    show();
    expect(await screen.findByText(/Wrong class entered/)).toBeInTheDocument();
  });

  it('Issued: first print is "Print original" (then a duplicate), with Cancel', async () => {
    const user = userEvent.setup();
    const calls = [];
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [], total: 0 },
      "/api/tc?": {
        rows: [
          tc({ originalPrinted: false }),
          tc({ id: "t2", slNo: 144, originalPrinted: true }),
        ],
        total: 2,
      },
      "/api/tc/t1/print": (url) => {
        calls.push(url);
        return tc({ originalPrinted: true, copyNo: null });
      },
      "/api/tc/t2/print": (url) => {
        calls.push(url);
        return tc({
          id: "t2",
          slNo: 144,
          originalPrinted: true,
          duplicateCount: 1,
          copyNo: 1,
        });
      },
    });
    show();
    await openIssued(user);
    const rows = await screen.findAllByRole("row", { name: /Aarav/ });
    expect(within(rows[0]).getByText("Not printed yet")).toBeInTheDocument();
    expect(
      within(rows[0]).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    await user.click(
      within(rows[0]).getByRole("button", { name: "Print original" }),
    );
    await vi.waitFor(() => expect(printHtml).toHaveBeenCalledTimes(1));
    expect(printHtml.mock.calls[0][0].html).not.toContain("DUPLICATE");
    await user.click(
      within(rows[1]).getByRole("button", { name: "Print duplicate" }),
    );
    await vi.waitFor(() => expect(printHtml).toHaveBeenCalledTimes(2));
    expect(printHtml.mock.calls[1][0].html).toContain("DUPLICATE COPY 1");
    expect(calls).toEqual(["/api/tc/t1/print", "/api/tc/t2/print"]);
  });

  it("with no dues: fills the form, validates, then sends ONE request with an Idempotency-Key", async () => {
    const user = userEvent.setup();
    const posts = [];
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [student], total: 1 },
      "/api/tc/draft/s1": draft(),
      "/api/certificate-requests/tc": (url, opts) => {
        posts.push({ url, ...opts });
        return req();
      },
    });
    show();
    await pickStudent(user);
    expect(await screen.findByText(/No fee dues pending/)).toBeInTheDocument();
    // empty compulsory fields stop the Admin before any request is sent
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(
      await screen.findByText("Last exam and result is required"),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await fill(user, /9\. Annual exam/, "Annual 2025-26, Passed");
    await fill(user, /11\. Subjects/, "English, Hindi");
    await fill(user, /15\. Working days/, "220");
    await fill(user, /16\. Days present/, "198");
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(
      await screen.findByText(/Request sent to the Principal/),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/certificate-requests/tc");
    expect(posts[0].idempotencyKey).toBe("key-test-12345");
    expect(posts[0].body).toMatchObject({
      studentId: 's1', bookNo: '7', workingDays: 220, daysPresent: 198, conduct: 'Good', reason: 'Parent Request',
    }); // prettier-ignore
    expect(posts[0].body.duesOverrideReason).toBeUndefined();
    // back on the Requests page; nothing was printed or numbered
    expect(await screen.findByLabelText(/Find student/)).toBeInTheDocument();
    expect(printHtml).not.toHaveBeenCalled();
  });

  it("with dues pending: shows the amount and needs a reason before it will send", async () => {
    const user = userEvent.setup();
    const posts = [];
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [student], total: 1 },
      '/api/tc/draft/s1': draft({
        pendingPaise: 150000,
        unpaid: [
          { period: '2026-04', dueDate: '2026-04-15', duePaise: 150000, lateFeePaise: 0, items: [{ head: 'tuition', duePaise: 150000 }] },
        ],
      }), // prettier-ignore
      "/api/certificate-requests/tc": (url, opts) => {
        posts.push(opts);
        return req();
      },
    });
    show();
    await pickStudent(user);
    expect(
      await screen.findByText(/Fees are still due: ₹1,500/),
    ).toBeInTheDocument();
    // the Admin can see WHICH month and head is unpaid
    const unpaid = screen.getByRole("table", { name: "Unpaid months" });
    expect(within(unpaid).getByText("2026-04")).toBeInTheDocument();
    expect(within(unpaid).getByText(/tuition ₹1,500/)).toBeInTheDocument();
    await fill(user, /9\. Annual exam/, "Passed");
    await fill(user, /11\. Subjects/, "English");
    await fill(user, /15\. Working days/, "220");
    await fill(user, /16\. Days present/, "198");
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(await screen.findByText(/Write the reason/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await fill(
      user,
      /Reason to ask for the TC with dues pending/,
      "Principal allowed",
    );
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    await screen.findByText(/Request sent to the Principal/);
    expect(posts[0].body.duesOverrideReason).toBe("Principal allowed");
  });

  it("asks for details the record lacks", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [student], total: 1 },
      "/api/tc/draft/s1": draft({
        snapshot: { ...snapshot, firstAdmissionDate: null },
        missing: [
          { key: "firstAdmissionDate", label: "Date of first admission" },
        ],
      }),
    });
    show();
    await pickStudent(user);
    await screen.findByText(/No fee dues pending/);
    await fill(user, /9\. Annual exam/, "Passed");
    await fill(user, /11\. Subjects/, "English");
    await fill(user, /15\. Working days/, "220");
    await fill(user, /16\. Days present/, "198");
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(
      await screen.findByText("Date of first admission is required"),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal when the request is turned down (no success message)", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [student], total: 1 },
      "/api/tc/draft/s1": draft(),
      "/api/certificate-requests/tc": () => {
        throw Object.assign(
          new Error(
            "A request for this student is already waiting for the Principal.",
          ),
          { status: 409 },
        );
      },
    });
    show();
    await pickStudent(user);
    await screen.findByText(/No fee dues pending/);
    await fill(user, /9\. Annual exam/, "Passed");
    await fill(user, /11\. Subjects/, "English");
    await fill(user, /15\. Working days/, "220");
    await fill(user, /16\. Days present/, "198");
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(
      await screen.findByText(/already waiting for the Principal/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Request sent to the Principal/)).toBeNull();
  });

  it("a student who already has a TC gets no form", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [student], total: 1 },
      "/api/tc/draft/s1": draft({ existingTc: { id: "t1", slNo: 143 } }),
    });
    show();
    await pickStudent(user);
    expect(await screen.findByText(/already issued/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send for Principal approval" }),
    ).toBeNull();
  });

  it("Bonafide: Admin asks only for active students, purpose required", async () => {
    const user = userEvent.setup();
    const posts = [];
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?status=active": { rows: [student], total: 1 },
      "/api/certificate-requests/bonafide": (url, opts) => {
        posts.push(opts);
        return req({ kind: "bonafide" });
      },
    });
    show();
    await user.click(screen.getByRole("tab", { name: "Bonafide" }));
    await pickStudent(user);
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(await screen.findByText("Write the purpose")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await user.type(screen.getByLabelText(/Purpose/), "Passport");
    await user.click(
      screen.getByRole("button", { name: "Send for Principal approval" }),
    );
    expect(
      await screen.findByText(/Request sent to the Principal/),
    ).toBeInTheDocument();
    expect(posts[0].body).toMatchObject({
      studentId: "s1",
      purpose: "Passport",
    });
    expect(posts[0].idempotencyKey).toBe("key-test-12345");
  });

  it("Bonafide Issued: original then duplicate", async () => {
    const user = userEvent.setup();
    const bon = {
      id: 'b1', number: 'BON/FY2026-27/001', studentId: 's1', originalPrinted: false,
      snapshot: { admissionNo: '412', name: 'Aarav Sharma', fatherName: 'Rajesh', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
      academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13', status: 'issued', duplicateCount: 0,
    }; // prettier-ignore
    route({
      "/api/certificate-requests?": reqList(),
      "/api/bonafide?": { rows: [bon], total: 1 },
      "/api/bonafide/b1/print": { ...bon, originalPrinted: true, copyNo: null },
    });
    show();
    await user.click(screen.getByRole("tab", { name: "Bonafide" }));
    await openIssued(user);
    await user.click(
      await screen.findByRole("button", { name: "Print original" }),
    );
    await vi.waitFor(() => expect(printHtml).toHaveBeenCalledTimes(1));
    expect(printHtml.mock.calls[0][0].html).toContain("BON/FY2026-27/001");
  });

  it("Settings: the start Sl. No. is locked once a TC exists", async () => {
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(),
      "/api/certificates/settings": {
        tcBookNo: "7",
        tcStartSl: 143,
        fy: "2026-27",
        startLocked: true,
        history: [],
      },
    });
    show();
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(await screen.findByLabelText(/First Sl. No./)).toBeDisabled();
    expect(screen.getByLabelText("Book No.")).toBeEnabled();
  });

  it("shows empty and error states (with retry)", async () => {
    route({
      "/api/certificate-requests?": reqList(),
      "/api/students?": { rows: [], total: 0 },
    });
    const a = show();
    expect(
      await screen.findByText("No Transfer Certificate requests yet"),
    ).toBeInTheDocument();
    a.unmount();
    api.mockReset();
    api.mockRejectedValue(new Error("Server down"));
    show();
    expect(await screen.findByText(/Server down/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("TC & Bonafide screen: opened from a link", () => {
  it("?tab=bonafide opens the Bonafide tab (the Approvals inbox links there)", async () => {
    mockRole = "principal";
    api.mockReset();
    route({
      "/api/certificate-requests?": reqList(
        req({ kind: "bonafide", preview: { snapshot, purpose: "Passport" } }),
      ),
    });
    show("/?tab=bonafide");
    expect(
      await screen.findByRole("tab", { name: "Bonafide", selected: true }),
    ).toBeInTheDocument();
    await screen.findByRole("row", { name: /Aarav/ });
    expect(api).toHaveBeenCalledWith(expect.stringContaining("kind=bonafide"));
  });
});

describe("TC & Bonafide screen: Principal decides, Cashier only looks", () => {
  beforeEach(() => {
    api.mockReset();
    printHtml.mockClear();
  });

  it("Principal reviews the certificate, sees the dues reason, and approves once", async () => {
    mockRole = "principal";
    const user = userEvent.setup();
    const posts = [];
    route({
      "/api/certificate-requests?": reqList(
        req({
          duesOverride: {
            reason: "Parent will pay on Monday",
            duePaise: 150000,
          },
        }),
      ),
      "/api/certificate-requests/r1/approve": (url, opts) => {
        posts.push({ url, ...opts });
        return req({ status: "approved", certificateNumber: "0143" });
      },
    });
    show();
    // the Principal lands on the requests that are waiting for a decision
    await screen.findByRole("row", { name: /Aarav/ });
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("status=pending&"),
    );
    // no ask-card, no Settings, no print for the Principal
    expect(screen.queryByLabelText(/Find student/)).toBeNull();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    const row = await screen.findByRole("row", { name: /Aarav/ });
    await user.click(within(row).getByRole("button", { name: "Review" }));
    const frame = await screen.findByTitle("Certificate preview");
    expect(frame.getAttribute("srcdoc")).toContain("On approval");
    expect(frame.getAttribute("srcdoc")).toContain("PENDING APPROVAL");
    expect(screen.getByText(/Fees are pending: ₹1,500/)).toBeInTheDocument();
    expect(screen.getByText(/Parent will pay on Monday/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Print / Save as PDF" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText(/Approved\. Sl\. No\. 0143/),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it("Principal rejects only with a reason, and it is sent to the server", async () => {
    mockRole = "principal";
    const user = userEvent.setup();
    const posts = [];
    route({
      "/api/certificate-requests?": reqList(req()),
      "/api/certificate-requests/r1/reject": (url, opts) => {
        posts.push(opts);
        return req({ status: "rejected" });
      },
    });
    show();
    await user.click(await screen.findByRole("button", { name: "Review" }));
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const confirm = await screen.findByRole("button", {
      name: "Reject request",
    });
    expect(confirm).toBeDisabled(); // a reason is compulsory
    await user.type(
      screen.getByLabelText("Reason (required)"),
      "Wrong class entered",
    );
    await user.click(confirm);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ reason: "Wrong class entered" });
  });

  it("Cashier can only look: no ask-card, no Approve, Reject, Print or Settings", async () => {
    mockRole = "cashier";
    const user = userEvent.setup();
    route({
      "/api/certificate-requests?": reqList(req()),
      "/api/tc?": tcList,
    });
    show();
    const row = await screen.findByRole("row", { name: /Aarav/ });
    expect(screen.queryByLabelText(/Find student/)).toBeNull();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "View" }));
    expect(await screen.findByTitle("Certificate preview")).toBeInTheDocument();
    for (const n of ["Approve", "Reject", "Print / Save as PDF"])
      expect(screen.queryByRole("button", { name: n })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await openIssued(user);
    const issued = await screen.findByRole("row", { name: /Aarav/ });
    for (const n of ["Print original", "Print duplicate", "Cancel"])
      expect(within(issued).queryByRole("button", { name: n })).toBeNull();
  });
});

describe("certificate print HTML", () => {
  it("TC has 23 fields, no image except the logo, blank sign lines and the right footer", () => {
    const html = tcHtml(tc());
    expect(html.match(/<tr>/g)).toHaveLength(23);
    expect(html).toContain("Sl. No.: <b>0143</b>");
    expect(html).toContain(
      "14/03/2014 · Fourteenth March Two Thousand Fourteen",
    );
    expect(html).toContain("Fee dues were checked and cleared before issue.");
    expect(html).toContain("Original copy");
    expect(html.match(/<img/g)).toHaveLength(1); // only the school logo, never a signature or seal
    expect(html).not.toContain("DUPLICATE");
  });
  it("a request that has no number yet says so and is marked not valid", () => {
    const t = tcHtml({ ...tc(), slNo: null });
    expect(t).toContain("Sl. No.: <b>On approval</b>");
    expect(t).toContain("PENDING APPROVAL - NOT VALID");
    const b = bonafideHtml({
      number: null, academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13',
      snapshot: { admissionNo: '412', name: 'Aarav Sharma', fatherName: 'Rajesh', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
    }); // prettier-ignore
    expect(b).toContain("No. <b>On approval</b>");
    expect(b).toContain("PENDING APPROVAL - NOT VALID");
  });
  it("a duplicate is marked; a TC issued with dues does not claim they were cleared", () => {
    const html = tcHtml(tc({ duesOverride: { reason: "x", duePaise: 1 } }), {
      copyNo: 2,
    });
    expect(html).toContain("DUPLICATE COPY 2");
    expect(html).not.toContain("cleared");
  });
  it("escapes names so typed text cannot inject markup", () => {
    const html = tcHtml(tc({ snapshot: { ...snapshot, name: "<b>X</b>" } }));
    expect(html).not.toContain("<b>X</b></td>");
    expect(html).toContain("&lt;B&gt;X&lt;/B&gt;");
  });
  it("Bonafide wording follows the school format", () => {
    const html = bonafideHtml({
      number: 'BON/FY2026-27/001', academicYear: '2026-27', purpose: 'Passport', dateOfIssue: '2026-10-13',
      snapshot: { admissionNo: '412', name: 'Aarav Sharma', fatherName: 'Rajesh', gender: 'MALE', classKey: '7', section: 'A', dob: '2014-03-14' },
    }); // prettier-ignore
    expect(html).toContain("son of");
    expect(html).toContain("14 Mar 2014");
    expect(html).toContain("13 Oct 2026");
    expect(html).toContain("Class <b>7th-A</b>");
  });
});
