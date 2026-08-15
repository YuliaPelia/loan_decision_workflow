import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/router.js";
import type { LoanNotification } from "../../src/notifier.js";
import {
  approvalInput,
  CapturingLogger,
  confirmingUnderwriter,
  createTestContext,
  InMemoryLoanRepository,
  RecordingLoanNotifier,
  supportAgent,
  underwriter,
} from "../support/in-memory-repository.js";

describe("loan application public examples", () => {
  it("returns the seeded pending application for review", async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.loanApplications.getForReview({ applicationId: "app-pending" });

    expect(result).toMatchObject({
      id: "app-pending",
      status: "PENDING_REVIEW",
      requestedAmountMinor: 500_000,
      customer: { fullName: "Olena Kovalenko" },
    });
    expect(result.customer).not.toHaveProperty("nationalId");
  });

  it("approves an eligible application", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(createTestContext(repository));

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result).toMatchObject({
      applicationId: "app-pending",
      status: "APPROVED",
      approvedAmountMinor: 400_000,
    });
    expect(repository.audits).toHaveLength(1);
  });

  it("rejects an application without an approved amount", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(createTestContext(repository));

    const result = await caller.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "The submitted income cannot be verified",
    });

    expect(result.status).toBe("REJECTED");
    expect(result.approvedAmountMinor).toBeNull();
  });

  it("rejects an obviously empty reason at the input boundary", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("authorization and dual-control", () => {
  it("forbids a SUPPORT user from recording a decision", async () => {
    const caller = appRouter.createCaller(
      createTestContext(new InMemoryLoanRepository(), supportAgent),
    );

    await expect(caller.loanApplications.decide(approvalInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("proposes high-value approval, blocks the proposer, and lets a second underwriter confirm", async () => {
    const repository = new InMemoryLoanRepository();
    repository.application.requestedAmountMinor = 2_000_000;
    const notifier = new RecordingLoanNotifier();
    const proposer = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), notifier),
    );

    const proposed = await proposer.loanApplications.decide(
      approvalInput({ approvedAmountMinor: 1_500_000 }),
    );

    expect(proposed).toMatchObject({
      status: "PENDING_CONFIRMATION",
      approvedAmountMinor: 1_500_000,
    });
    expect(notifier.sent).toEqual<LoanNotification[]>([
      { applicationId: "app-pending", type: "APPROVAL_PROPOSED" },
    ]);

    await expect(
      proposer.loanApplications.confirm({
        applicationId: "app-pending",
        reason: "Confirming my own proposal",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const confirmer = appRouter.createCaller(
      createTestContext(repository, confirmingUnderwriter, new CapturingLogger(), notifier),
    );
    const confirmed = await confirmer.loanApplications.confirm({
      applicationId: "app-pending",
      reason: "Independent review passed",
    });

    expect(confirmed).toMatchObject({
      status: "APPROVED",
      approvedAmountMinor: 1_500_000,
    });
    expect(notifier.sent.map((item) => item.type)).toEqual(["APPROVAL_PROPOSED", "APPROVED"]);
  });

  it("keeps a committed decision if notification delivery fails", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), {
        async send() {
          throw new Error("smtp down");
        },
      }),
    );

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result.status).toBe("APPROVED");
    expect(repository.application.status).toBe("APPROVED");
  });
});

describe("loan application public examples", () => {
  it("returns the seeded pending application for review", async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.loanApplications.getForReview({ applicationId: "app-pending" });

    expect(result).toMatchObject({
      id: "app-pending",
      status: "PENDING_REVIEW",
      requestedAmountMinor: 500_000,
      customer: { fullName: "Olena Kovalenko" },
    });
    expect(result.customer).not.toHaveProperty("nationalId");
  });

  it("approves an eligible application", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(createTestContext(repository));

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result).toMatchObject({
      applicationId: "app-pending",
      status: "APPROVED",
      approvedAmountMinor: 400_000,
    });
    expect(repository.audits).toHaveLength(1);
  });

  it("rejects an application without an approved amount", async () => {
    const repository = new InMemoryLoanRepository();
    const caller = appRouter.createCaller(createTestContext(repository));

    const result = await caller.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "The submitted income cannot be verified",
    });

    expect(result.status).toBe("REJECTED");
    expect(result.approvedAmountMinor).toBeNull();
  });

  it("rejects an obviously empty reason at the input boundary", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
