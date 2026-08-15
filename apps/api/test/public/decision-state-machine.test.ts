import { describe, expect, it } from "vitest";

import {
  DELEGATED_AUTHORITY_THRESHOLD_MINOR,
  LoanDecisionError,
  planConfirm,
  planDecide,
  type LoanApplicationRecord,
} from "../../src/domain.js";
import {
  InMemoryLoanRepository,
  approvalInput,
  confirmingUnderwriter,
  underwriter,
} from "../support/in-memory-repository.js";

function pending(overrides: Partial<LoanApplicationRecord> = {}): LoanApplicationRecord {
  return {
    id: "app-pending",
    status: "PENDING_REVIEW",
    requestedAmountMinor: 2_000_000,
    approvedAmountMinor: null,
    proposedByUserId: null,
    customer: {
      fullName: "High Value Fixture",
      lastName: "Fixture",
      gender: "MALE",
      taxId: "TAX-HIGH-VALUE",
      email: "high-value@example.test",
      phone: "+380500000003",
      nationalId: "ID-HIGH-VALUE",
      monthlyIncomeMinor: 600_000,
    },
    ...overrides,
  };
}

describe("planDecide", () => {
  it("finalizes approvals at the delegated-authority threshold", () => {
    const planned = planDecide(pending({ requestedAmountMinor: 1_000_000 }), underwriter.id, {
      applicationId: "app-pending",
      decision: "APPROVED",
      approvedAmountMinor: DELEGATED_AUTHORITY_THRESHOLD_MINOR,
      reason: "Within authority",
    });

    expect(planned).toMatchObject({
      nextStatus: "APPROVED",
      approvedAmountMinor: 1_000_000,
      proposedByUserId: null,
      notificationType: "APPROVED",
    });
  });

  it("sends high-value approvals to confirmation and records the proposer", () => {
    const planned = planDecide(pending(), underwriter.id, {
      applicationId: "app-pending",
      decision: "APPROVED",
      approvedAmountMinor: 1_000_001,
      reason: "Needs second pair of eyes",
    });

    expect(planned).toMatchObject({
      nextStatus: "PENDING_CONFIRMATION",
      approvedAmountMinor: 1_000_001,
      proposedByUserId: underwriter.id,
      notificationType: "APPROVAL_PROPOSED",
    });
  });

  it("rejects non-positive and non-integer amounts", () => {
    expect(() =>
      planDecide(pending(), underwriter.id, approvalInput({ approvedAmountMinor: 0 })),
    ).toThrow(LoanDecisionError);
    expect(() =>
      planDecide(pending(), underwriter.id, approvalInput({ approvedAmountMinor: 100.5 })),
    ).toThrow(LoanDecisionError);
  });

  it("clears amount and proposer when rejecting a proposed approval", () => {
    const planned = planDecide(
      pending({
        status: "PENDING_CONFIRMATION",
        approvedAmountMinor: 1_500_000,
        proposedByUserId: underwriter.id,
      }),
      confirmingUnderwriter.id,
      { applicationId: "app-pending", decision: "REJECTED", reason: "Risk too high" },
    );

    expect(planned).toMatchObject({
      nextStatus: "REJECTED",
      approvedAmountMinor: null,
      proposedByUserId: null,
      notificationType: "REJECTED",
    });
  });
});

describe("planConfirm", () => {
  it("preserves the proposed amount and forbids the proposer", () => {
    const proposed = pending({
      status: "PENDING_CONFIRMATION",
      approvedAmountMinor: 1_500_000,
      proposedByUserId: underwriter.id,
    });

    expect(() =>
      planConfirm(proposed, underwriter.id, {
        applicationId: proposed.id,
        reason: "Confirming own proposal",
      }),
    ).toThrow(LoanDecisionError);

    expect(
      planConfirm(proposed, confirmingUnderwriter.id, {
        applicationId: proposed.id,
        reason: "Independent review passed",
      }),
    ).toMatchObject({
      nextStatus: "APPROVED",
      approvedAmountMinor: 1_500_000,
      proposedByUserId: underwriter.id,
      notificationType: "APPROVED",
    });
  });
});

describe("in-memory decide lock", () => {
  it("lets only one concurrent decide succeed", async () => {
    const repository = new InMemoryLoanRepository();

    const [first, second] = await Promise.allSettled([
      repository.decide(underwriter.id, approvalInput()),
      repository.decide(confirmingUnderwriter.id, approvalInput()),
    ]);

    const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
    const rejected = [first, second].filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "CONFLICT" }),
    });
    expect(repository.application.status).toBe("APPROVED");
    expect(repository.audits).toHaveLength(1);
  });
});
