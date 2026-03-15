import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { NameGate } from "@/app/(tools)/karaslice/name-gate";


const refreshMock = vi.fn();


vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));


describe("NameGate", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the email and keeps submit disabled until both names are entered", async () => {
    const user = userEvent.setup();
    render(<NameGate email="driver@example.com" />);

    expect(screen.getByText("driver@example.com")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Continue to Karaslice" });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText("First name"), "Jane");
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText("Last name"), "Doe");
    expect(button).toBeEnabled();
  });

  it("submits the trimmed full name", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    render(<NameGate email="driver@example.com" />);

    await user.type(screen.getByLabelText("First name"), "  Jane ");
    await user.type(screen.getByLabelText("Last name"), "  Doe  ");
    await user.click(screen.getByRole("button", { name: "Continue to Karaslice" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Jane Doe" }),
      });
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows the API error and does not refresh on failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Name update failed" }),
    } as Response);

    render(<NameGate email="driver@example.com" />);

    await user.type(screen.getByLabelText("First name"), "Jane");
    await user.type(screen.getByLabelText("Last name"), "Doe");
    await user.click(screen.getByRole("button", { name: "Continue to Karaslice" }));

    expect(await screen.findByText("Name update failed")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
