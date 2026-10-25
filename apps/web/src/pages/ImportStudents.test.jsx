import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { ImportStudents } from "./ImportStudents";

vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";

const file = new File(["x"], "students.xlsx");
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter>
          <ImportStudents />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("ImportStudents", () => {
  beforeEach(() => {
    api.mockReset();
  });

  it("Check file saves nothing, lists problem rows, then Import saves", async () => {
    const preview = {
      committed: false,
      rowsInFile: 3,
      ready: 2,
      created: 0,
      skipped: 1,
      errors: [{ row: 4, message: 'CLASS "Mars" is not recognised' }],
    };
    const done = {
      committed: true,
      rowsInFile: 3,
      ready: 2,
      created: 2,
      skipped: 1,
      errors: [],
    };
    api.mockImplementation(async (...args) => {
      const url = String(args[0]);
      return url.endsWith("commit=false") ? preview : done;
    });
    show();
    expect(screen.getByRole("button", { name: "Check file" })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText("Excel file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(
      await screen.findByText('CLASS "Mars" is not recognised'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1); // nothing saved yet
    await userEvent.click(
      screen.getByRole("button", { name: "Import 2 students" }),
    );
    expect(await screen.findByText("Import finished")).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith(
      "/api/students/import?commit=true",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the server message when the file is rejected", async () => {
    api.mockRejectedValue(
      new Error("Required column missing: SCH.. Use the template."),
    );
    show();
    await userEvent.upload(screen.getByLabelText("Excel file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(
      await screen.findByText(/Required column missing/),
    ).toBeInTheDocument();
  });
});
