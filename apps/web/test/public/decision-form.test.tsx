import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionForm } from "../../src/components/DecisionForm";
import { formatMinorUnits, parseEuroToMinorUnits } from "../../src/lib/money";

afterEach(() => {
  cleanup();
});

describe("parseEuroToMinorUnits", () => {
  it("converts decimal strings without float rounding", () => {
    expect(parseEuroToMinorUnits("1250.50")).toBe(125_050);
    expect(parseEuroToMinorUnits("0.01")).toBe(1);
    expect(parseEuroToMinorUnits("10")).toBe(1_000);
    expect(parseEuroToMinorUnits("12.345")).toBeNull();
    expect(parseEuroToMinorUnits("0")).toBeNull();
    expect(parseEuroToMinorUnits("21474836.48")).toBeNull();
  });
});

describe("formatMinorUnits", () => {
  it("formats with integer division rather than float", () => {
    expect(formatMinorUnits(125_050)).toBe("€1,250.50");
    expect(formatMinorUnits(1)).toBe("€0.01");
    expect(formatMinorUnits(100)).toBe("€1.00");
  });
});

describe("DecisionForm", () => {
  it("submits an approval in integer minor units", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm mode="initial" onSubmit={onSubmit} requestedAmountMinor={500_000} />);

    await user.type(screen.getByLabelText(/Approved amount/), "1250.50");
    await user.type(screen.getByLabelText("Reason"), "Affordability checks passed");
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        decision: "APPROVED",
        approvedAmountMinor: 125_050,
        reason: "Affordability checks passed",
      }),
    );
  });

  it("blocks amounts with more than two decimal places", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm mode="initial" onSubmit={onSubmit} requestedAmountMinor={500_000} />);

    await user.type(screen.getByLabelText(/Approved amount/), "12.345");
    await user.type(screen.getByLabelText("Reason"), "Too precise");
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("two decimal places");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks a whitespace-only reason before submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DecisionForm mode="initial" onSubmit={onSubmit} requestedAmountMinor={500_000} />);

    await user.type(screen.getByLabelText(/Approved amount/), "100");
    await user.type(screen.getByLabelText("Reason"), "   ");
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A reason is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits confirmation without an amount", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DecisionForm
        canConfirm
        mode="confirm"
        onSubmit={onSubmit}
        requestedAmountMinor={2_000_000}
      />,
    );

    await user.type(screen.getByLabelText("Reason"), "Independent review passed");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        decision: "CONFIRMED",
        reason: "Independent review passed",
      }),
    );
  });
});
