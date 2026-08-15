import type {
  AppLogger,
  AuditRecordInput,
  ConfirmLoanApplicationInput,
  DecideLoanApplicationInput,
  DecisionResult,
  LoanApplicationRecord,
  LoanRepository,
  RequestContext,
  SessionUser,
} from "../../src/domain.js";
import { LoanDecisionError, planConfirm, planDecide } from "../../src/domain.js";
import type { LoanNotification, LoanNotifier } from "../../src/notifier.js";

const seededApplication: LoanApplicationRecord = {
  id: "app-pending",
  status: "PENDING_REVIEW",
  requestedAmountMinor: 500_000,
  approvedAmountMinor: null,
  proposedByUserId: null,
  customer: {
    fullName: "Olena Kovalenko",
    lastName: "Kovalenko",
    gender: "FEMALE",
    taxId: "TAX-72419831",
    email: "olena@example.test",
    phone: "+380501234567",
    nationalId: "ID-72419831",
    monthlyIncomeMinor: 180_000,
  },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryLoanRepository implements LoanRepository {
  application = clone(seededApplication);
  audits: AuditRecordInput[] = [];
  failNextAudit = false;
  private lock: Promise<void> = Promise.resolve();

  async findApplication(id: string): Promise<LoanApplicationRecord | null> {
    return id === this.application.id ? clone(this.application) : null;
  }

  async listApplications(): Promise<LoanApplicationRecord[]> {
    return [clone(this.application)];
  }

  async decide(actorId: string, input: DecideLoanApplicationInput): Promise<DecisionResult> {
    return this.withLock(async () => {
      const application = await this.requireApplication(input.applicationId);
      return this.persist(application, actorId, planDecide(application, actorId, input));
    });
  }

  async confirm(actorId: string, input: ConfirmLoanApplicationInput): Promise<DecisionResult> {
    return this.withLock(async () => {
      const application = await this.requireApplication(input.applicationId);
      return this.persist(application, actorId, planConfirm(application, actorId, input));
    });
  }

  private async requireApplication(id: string): Promise<LoanApplicationRecord> {
    if (id !== this.application.id) {
      throw new LoanDecisionError("NOT_FOUND", "Application not found");
    }
    return clone(this.application);
  }

  private persist(
    application: LoanApplicationRecord,
    actorId: string,
    planned: ReturnType<typeof planDecide>,
  ): DecisionResult {
    if (this.failNextAudit) {
      this.failNextAudit = false;
      throw new Error("Injected audit failure");
    }

    this.application.status = planned.nextStatus;
    this.application.approvedAmountMinor = planned.approvedAmountMinor;
    this.application.proposedByUserId = planned.proposedByUserId;
    this.audits.push({
      applicationId: application.id,
      actorId,
      previousStatus: application.status,
      newStatus: planned.nextStatus,
      approvedAmountMinor: planned.approvedAmountMinor,
      reason: planned.reason,
    });

    return {
      application: clone(this.application),
      notification: { applicationId: application.id, type: planned.notificationType },
    };
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.lock;
    this.lock = next;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class CapturingLogger implements AppLogger {
  events: Array<{ level: "info" | "error"; context: Record<string, unknown>; message: string }> =
    [];

  info(context: Record<string, unknown>, message: string): void {
    this.events.push({ level: "info", context: clone(context), message });
  }

  error(context: Record<string, unknown>, message: string): void {
    this.events.push({ level: "error", context: clone(context), message });
  }
}

export const underwriter: SessionUser = {
  id: "user-underwriter-1",
  name: "Ada Underwriter",
  role: "UNDERWRITER",
};

export const confirmingUnderwriter: SessionUser = {
  id: "user-underwriter-2",
  name: "Grace Underwriter",
  role: "UNDERWRITER",
};

export const supportAgent: SessionUser = {
  id: "user-support-1",
  name: "Sam Support",
  role: "SUPPORT",
};

export class RecordingLoanNotifier implements LoanNotifier {
  sent: LoanNotification[] = [];

  async send(notification: LoanNotification): Promise<void> {
    this.sent.push(clone(notification));
  }
}

export function createTestContext(
  repository = new InMemoryLoanRepository(),
  user: SessionUser | null = underwriter,
  logger = new CapturingLogger(),
  notifier = new RecordingLoanNotifier(),
): RequestContext {
  return { repository, session: user ? { user } : null, logger, notifier };
}

export function approvalInput(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: "app-pending",
    decision: "APPROVED" as const,
    approvedAmountMinor: 400_000,
    reason: "Affordability checks passed",
    ...overrides,
  };
}
