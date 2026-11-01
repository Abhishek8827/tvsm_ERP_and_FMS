import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
      url === "/api/system/hard-reset/status" ? { enabled: false } : status,
    );
    wrap(<SystemSettings />);
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
      return status;
    });
    wrap(<SystemSettings />);
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
