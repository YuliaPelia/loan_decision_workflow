import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/router.js";
import type { LoanNotification } from "../../src/notifier.js";
import { POSTGRES_INTEGER_MAX } from "../../src/domain.js";
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

  it("approves an eligible application and notifies APPROVED", async () => {
    const repository = new InMemoryLoanRepository();
    const notifier = new RecordingLoanNotifier();
    const caller = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), notifier),
    );

    const result = await caller.loanApplications.decide(approvalInput());

    expect(result).toMatchObject({
      applicationId: "app-pending",
      status: "APPROVED",
      approvedAmountMinor: 400_000,
    });
    expect(repository.audits).toHaveLength(1);
    expect(notifier.sent).toEqual<LoanNotification[]>([
      { applicationId: "app-pending", type: "APPROVED" },
    ]);
  });

  it("rejects from PENDING_REVIEW and notifies REJECTED", async () => {
    const repository = new InMemoryLoanRepository();
    const notifier = new RecordingLoanNotifier();
    const caller = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), notifier),
    );

    const result = await caller.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "The submitted income cannot be verified",
    });

    expect(result).toMatchObject({
      status: "REJECTED",
      approvedAmountMinor: null,
    });
    expect(notifier.sent).toEqual<LoanNotification[]>([
      { applicationId: "app-pending", type: "REJECTED" },
    ]);
  });

  it("rejects an obviously empty reason at the input boundary", async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.loanApplications.decide(approvalInput({ reason: "   " })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an amount above the requested amount", async () => {
    const caller = appRouter.createCaller(createTestContext(new InMemoryLoanRepository()));

    await expect(
      caller.loanApplications.decide(approvalInput({ approvedAmountMinor: 500_001 })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects amounts above the PostgreSQL INTEGER ceiling", async () => {
    const repository = new InMemoryLoanRepository();
    repository.application.requestedAmountMinor = Number.MAX_SAFE_INTEGER;
    const caller = appRouter.createCaller(createTestContext(repository));

    await expect(
      caller.loanApplications.decide(
        approvalInput({ approvedAmountMinor: POSTGRES_INTEGER_MAX + 1 }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.loanApplications.decide(
        approvalInput({ approvedAmountMinor: Number.MAX_SAFE_INTEGER }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("authorization and dual-control", () => {
  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createTestContext(new InMemoryLoanRepository(), null));

    await expect(caller.loanApplications.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.loanApplications.getForReview({ applicationId: "app-pending" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.loanApplications.decide(approvalInput())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.loanApplications.confirm({ applicationId: "app-pending", reason: "No session" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

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

  it("rejects from PENDING_CONFIRMATION and notifies REJECTED", async () => {
    const repository = new InMemoryLoanRepository();
    repository.application.requestedAmountMinor = 2_000_000;
    const notifier = new RecordingLoanNotifier();
    const proposer = appRouter.createCaller(
      createTestContext(repository, underwriter, new CapturingLogger(), notifier),
    );

    await proposer.loanApplications.decide(approvalInput({ approvedAmountMinor: 1_500_000 }));

    const rejected = await proposer.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "Risk too high after proposal",
    });

    expect(rejected).toMatchObject({
      status: "REJECTED",
      approvedAmountMinor: null,
    });
    expect(repository.application.proposedByUserId).toBeNull();
    expect(notifier.sent.map((item) => item.type)).toEqual(["APPROVAL_PROPOSED", "REJECTED"]);
  });

  it("refuses decide and confirm on terminal statuses", async () => {
    const approvedRepo = new InMemoryLoanRepository();
    const approvedCaller = appRouter.createCaller(createTestContext(approvedRepo));
    await approvedCaller.loanApplications.decide(approvalInput());

    await expect(approvedCaller.loanApplications.decide(approvalInput())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      approvedCaller.loanApplications.confirm({
        applicationId: "app-pending",
        reason: "Already approved",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const rejectedRepo = new InMemoryLoanRepository();
    const rejectedCaller = appRouter.createCaller(createTestContext(rejectedRepo));
    await rejectedCaller.loanApplications.decide({
      applicationId: "app-pending",
      decision: "REJECTED",
      reason: "Income cannot be verified",
    });

    await expect(
      rejectedCaller.loanApplications.decide({
        applicationId: "app-pending",
        decision: "REJECTED",
        reason: "Already rejected",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
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
