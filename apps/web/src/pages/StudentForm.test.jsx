import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { StudentForm } from "./StudentForm";

vi.mock("../api/client", () => ({ api: vi.fn() }));
import { api } from "../api/client";

function show(path) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/students/new" element={<StudentForm />} />
            <Route path="/students/:id/edit" element={<StudentForm />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("StudentForm", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockRejectedValue(new Error("no fee chart")); // fee-structure lookup is optional here
  });

  it("will not send the form without name and admission number", async () => {
    show("/students/new");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add student" }),
    );
    expect(
      await screen.findByText("Admission number is required"),
    ).toBeInTheDocument();
    expect(screen.getByText("Student name is required")).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith("/api/students", expect.anything());
  });

  it("Admin editing sees the saved Aadhaar and bank details", async () => {
    api.mockImplementation(async (path) => {
      if (path === "/api/students/s1")
        return {
          id: "s1",
          admissionNo: "7",
          name: "Asha",
          classKey: "1",
          status: "active",
          aadhaar: "123412349876",
          bankAccount: "55556666",
          ifsc: "SBIN0001",
        };
      throw new Error("no fee chart");
    });
    show("/students/s1/edit");
    expect(await screen.findByDisplayValue("123412349876")).toBeInTheDocument();
    expect(screen.getByDisplayValue("55556666")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SBIN0001")).toBeInTheDocument();
  });
});
