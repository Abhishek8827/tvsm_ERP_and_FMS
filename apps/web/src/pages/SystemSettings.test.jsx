import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackupReminder } from "../components/BackupReminder";
import { ToastProvider } from "../components/ui";
import { SystemSettings } from "./SystemSettings";

vi.mock("../api/client", () => ({ api: vi.fn() }));
vi.mock("../lib/saveFile", () => ({
  saveBlob: vi.fn(),
  istStamp: () => "2026-11-01-1000",
}));
import { api } from "../api/client";
import { saveBlob } from "../lib/saveFile";

let status;
const wrap = (ui) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  status = {
    lastBackupAt: null,
    daysSince: null,
    reminderDays: 7,
    reminder: true,
  };
  api.mockImplementation(async (url) => {
    if (url === "/api/backup/status") return status;
    if (url === "/api/backup/download") return new Blob(["{}"]);
    if (url === "/api/money/overview")
      return { openingCashPaise: 0, openingPettyPaise: 0, banks: [] };
    if (url === "/api/reports/settings")
      return { fixedAssetsPaise: 0, capitalPaise: 0, history: [] };
    if (url.startsWith("/api/backup/restore"))
      return {
        collections: { Receipt: { inFile: 3, added: 1, skipped: 2 } },
        totals: { inFile: 3, added: 1, skipped: 2 },
        unknown: [],
      };
    return {};
  });
});

describe("System Settings: Backup & Restore", () => {
  it('shows "no backup yet" and downloads a backup file', async () => {
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Backup & safety" }));
    expect(
      await screen.findByText(/No backup has been taken yet/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Download backup" }),
    );
    await waitFor(() =>
      expect(saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "tvsm-erp-backup-2026-11-01-1000.json",
      ),
    );
  });

  it("restore needs a file AND the exact phrase; it saves a safety copy first, then restores", async () => {
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Backup & safety" }));
    const restoreBtn = await screen.findByRole("button", {
      name: "Restore from file",
    });
    expect(restoreBtn).toBeDisabled();
    const file = new File(['{"format":"x"}'], "b.json", {
      type: "application/json",
    });
    await userEvent.upload(screen.getByLabelText("Backup file"), file);
    expect(restoreBtn).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Type RESTORE BACKUP/),
      "RESTORE BACKUP",
    );
    expect(restoreBtn).toBeEnabled();
    await userEvent.click(restoreBtn);
    expect(await screen.findByText(/1 record added/)).toBeInTheDocument();
    expect(saveBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "safety-backup-before-restore-2026-11-01-1000.json",
    );
    const order = api.mock.calls.map((c) => c[0]);
    expect(order.indexOf("/api/backup/download")).toBeLessThan(
      order.findIndex((u) => u.startsWith("/api/backup/restore")),
    );
    const post = api.mock.calls.find((c) =>
      c[0].startsWith("/api/backup/restore"),
    );
    expect(post[0]).toBe("/api/backup/restore?confirm=RESTORE%20BACKUP");
    expect(post[1]).toMatchObject({ method: "POST", file });
  });
});

describe("Backup reminder (Dashboard, Admin)", () => {
  it("shows when no backup exists or it is 7+ days old, and is silent otherwise", async () => {
    const { unmount } = wrap(<BackupReminder />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No backup has been taken yet/,
    );
    unmount();
    status = {
      lastBackupAt: "x",
      daysSince: 9,
      reminderDays: 7,
      reminder: true,
    };
    const second = wrap(<BackupReminder />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/9 days ago/);
    second.unmount();
    status = {
      lastBackupAt: "x",
      daysSince: 2,
      reminderDays: 7,
      reminder: false,
    };
    wrap(<BackupReminder />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Hard reset card", () => {
  it("says it is switched off when the server has it off, with no form", async () => {
    api.mockImplementation(async (url) =>
      url === "/api/system/hard-reset/status"
        ? { enabled: false }
        : url === "/api/money/overview"
          ? { openingCashPaise: 0, openingPettyPaise: 0, banks: [] }
          : status,
    );
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Backup & safety" }));
    expect(
      await screen.findByText(/Hard reset is switched off/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erase all data" })).toBeNull();
  });

  it("needs a fresh backup and every field before Erase works, then sends them all", async () => {
    let fresh = false;
    api.mockImplementation(async (url, opts) => {
      if (url === "/api/system/hard-reset/status")
        return {
          enabled: true,
          question: "First school?",
          phrase: "ERASE ALL DATA",
          backupFresh: fresh,
        };
      if (url === "/api/backup/download") {
        fresh = true;
        return new Blob(["{}"]);
      }
      if (url === "/api/system/hard-reset" && opts?.method === "POST")
        return { removed: { Student: 3 }, reset: [] };
      if (url === "/api/money/overview")
        return { openingCashPaise: 0, openingPettyPaise: 0, banks: [] };
      return status;
    });
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Backup & safety" }));
    const erase = await screen.findByRole("button", { name: "Erase all data" });
    await userEvent.type(screen.getByLabelText("Your password"), "pw");
    await userEvent.type(screen.getByLabelText("Reset key"), "K");
    await userEvent.type(screen.getByLabelText("First school?"), "Nepanagar");
    await userEvent.type(
      screen.getByLabelText("Why are you erasing everything?"),
      "Go live",
    );
    await userEvent.type(
      screen.getByLabelText(/Type ERASE ALL DATA/),
      "ERASE ALL DATA",
    );
    expect(erase).toBeDisabled(); // no backup yet
    await userEvent.click(
      screen.getByRole("button", { name: "Download backup now" }),
    );
    await waitFor(() => expect(erase).toBeEnabled());
    await userEvent.click(erase);
    expect(await screen.findByText(/Erased: Student 3/)).toBeInTheDocument();
    const post = api.mock.calls.find(
      (c) => c[0] === "/api/system/hard-reset" && c[1]?.method === "POST",
    );
    expect(post[1].body).toEqual({
      password: "pw",
      key: "K",
      answer: "Nepanagar",
      reason: "Go live",
      phrase: "ERASE ALL DATA",
    });
  });
});

const settingsApi = (extra = {}) =>
  api.mockImplementation(async (url, opts) => {
    const hit = Object.entries(extra).find(([k]) => String(url).startsWith(k));
    if (hit) return typeof hit[1] === 'function' ? hit[1](url, opts) : hit[1];
    if (url === '/api/money/overview')
      return {
        openingCashPaise: 100000,
        openingPettyPaise: 5000,
        banks: [
          { id: 'b1', name: 'IDFC', last4: '1234', active: true, defaultForModes: ['upi'], balancePaise: 0, openingPaise: 250000 },
        ],
      };
    if (url === '/api/reports/settings')
      return { fixedAssetsPaise: 100000, capitalPaise: 200000, history: [] };
    return {};
  }); // prettier-ignore

describe("System Settings: all settings on one page", () => {
  it("has a tab for every settings group", async () => {
    settingsApi();
    wrap(<SystemSettings />);
    for (const n of [
      "Accounts & opening balances",
      "Expense heads",
      "Transport account",
      "TC numbering",
      "Backup & safety",
    ])
      expect(screen.getByRole("tab", { name: n })).toBeInTheDocument();
  });

  it("accounts: shows the opening balances and banks; fixed assets / capital need a reason", async () => {
    settingsApi();
    wrap(<SystemSettings />);
    expect(
      await screen.findByRole("button", { name: "Edit opening balances" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add bank account" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("IDFC").length).toBeGreaterThan(0);
    await userEvent.click(
      screen.getByRole("button", { name: "Edit fixed assets and capital" }),
    );
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Fixed assets (₹)")).toHaveValue(
        "1000.00",
      ),
    );
    expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Reason for this entry"),
      "Opening figures",
    );
    await userEvent.click(save);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/reports/settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("expense heads: adds a head", async () => {
    settingsApi({
      "/api/expense-heads": (u, o) =>
        o?.method === "POST"
          ? { id: "h2" }
          : { heads: [{ id: "h1", name: "Stationery", active: true }] },
    });
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Expense heads" }));
    expect(await screen.findByText("Stationery")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Head name"), "Electricity");
    await userEvent.click(screen.getByRole("button", { name: "Add head" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/expense-heads",
        expect.objectContaining({
          method: "POST",
          body: { name: "Electricity" },
        }),
      ),
    );
  });

  it("transport account: saves with a reason", async () => {
    settingsApi({
      "/api/cashbook/settings": (u, o) =>
        o?.method === "PUT"
          ? { ok: true }
          : {
              transportOpeningPaise: 0,
              transportStartDate: null,
              transportHeads: [],
              history: [],
              expenseHeads: ["Bus Diesel"],
            },
    });
    wrap(<SystemSettings />);
    await userEvent.click(
      screen.getByRole("tab", { name: "Transport account" }),
    );
    const save = await screen.findByRole("button", { name: "Save" });
    await screen.findByLabelText("Bus Diesel");
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Opening amount/));
    await userEvent.type(screen.getByLabelText(/Opening amount/), "3000");
    await userEvent.click(screen.getByLabelText("Bus Diesel"));
    await userEvent.type(screen.getByLabelText(/Reason/), "start");
    await userEvent.click(save);
    await waitFor(() => {
      const put = api.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(put[1].body).toMatchObject({
        openingRupees: "3000",
        heads: ["Bus Diesel"],
        reason: "start",
      });
    });
  });

  it("TC numbering: the start Sl. No. is locked once a TC exists", async () => {
    settingsApi({
      "/api/certificates/settings": {
        tcBookNo: "7",
        tcStartSl: 143,
        fy: "2026-27",
        startLocked: true,
        history: [],
      },
    });
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "TC numbering" }));
    expect(await screen.findByLabelText(/First Sl. No./)).toBeDisabled();
    expect(screen.getByLabelText("Book No.")).toBeEnabled();
  });
});

describe("System Settings: Fee due date", () => {
  it("shows the warning and needs reason + typed phrase before it saves", async () => {
    const base = api.getMockImplementation();
    api.mockImplementation(async (url, opts) => {
      if (url.startsWith("/api/fee-structure/") && url.endsWith("/due-day"))
        return { dueDay: opts.body.dueDay, chargesMoved: 3 };
      if (url.startsWith("/api/fee-structure/")) return { dueDay: 10 };
      return base(url, opts);
    });
    wrap(<SystemSettings />);
    await userEvent.click(screen.getByRole("tab", { name: "Fee due date" }));
    expect(
      await screen.findByText(/changes money figures/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/10th of every month/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Change due date" });
    expect(button).toBeDisabled();
    const day = screen.getByLabelText(/Due day of the month/);
    await userEvent.clear(day);
    await userEvent.type(day, "5");
    await userEvent.type(
      screen.getByLabelText("Why are you changing it?"),
      "Board decision",
    );
    expect(button).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Type CHANGE DUE DATE/),
      "CHANGE DUE DATE",
    );
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.stringMatching(/\/due-day$/),
        expect.objectContaining({
          method: "PUT",
          body: {
            dueDay: 5,
            reason: "Board decision",
            confirm: "CHANGE DUE DATE",
          },
        }),
      ),
    );
  });
});
