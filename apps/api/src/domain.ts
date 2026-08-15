import type { LoanNotification, LoanNotificationType, LoanNotifier } from "./notifier.js";

export type UserRole = "UNDERWRITER" | "SUPPORT";
export type LoanApplicationStatus =
  "PENDING_REVIEW" | "PENDING_CONFIRMATION" | "APPROVED" | "REJECTED";
export type LoanDecision = "APPROVED" | "REJECTED";

/** Inclusive ceiling for a single underwriter's delegated authority, in minor units. */
export const DELEGATED_AUTHORITY_THRESHOLD_MINOR = 1_000_000;

/** Prisma `Int` / PostgreSQL `INTEGER` ceiling. Workflow amounts fit; BigInt is out of scope. */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface LoanApplicationRecord {
  id: string;
  status: LoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customer: {
    fullName: string;
    lastName: string;
    gender: string;
    taxId: string;
    email: string;
    phone: string;
    nationalId: string;
    monthlyIncomeMinor: number;
  };
}

export interface LoanApplicationView {
  id: string;
  status: LoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customer: {
    fullName: string;
    lastName: string;
    gender: string;
    taxId: string;
    email: string;
  };
}

export interface DecideLoanApplicationInput {
  applicationId: string;
  decision: LoanDecision;
  approvedAmountMinor?: number | undefined;
  reason: string;
}

export interface ConfirmLoanApplicationInput {
  applicationId: string;
  reason: string;
}

export interface AuditRecordInput {
  applicationId: string;
  actorId: string;
  previousStatus: LoanApplicationStatus;
  newStatus: LoanApplicationStatus;
  approvedAmountMinor: number | null;
  reason: string;
}

export type LoanDecisionErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN";

export class LoanDecisionError extends Error {
  readonly code: LoanDecisionErrorCode;

  constructor(code: LoanDecisionErrorCode, message: string) {
    super(message);
    this.name = "LoanDecisionError";
    this.code = code;
  }
}

export interface PlannedTransition {
  reason: string;
  nextStatus: LoanApplicationStatus;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  notificationType: LoanNotificationType;
}

export interface DecisionResult {
  application: LoanApplicationRecord;
  notification: LoanNotification;
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new LoanDecisionError("BAD_REQUEST", "A reason is required");
  }
  return trimmed;
}

export function planDecide(
  application: LoanApplicationRecord,
  actorId: string,
  input: DecideLoanApplicationInput,
): PlannedTransition {
  const reason = requireReason(input.reason);

  if (input.decision === "REJECTED") {
    if (input.approvedAmountMinor !== undefined) {
      throw new LoanDecisionError("BAD_REQUEST", "Rejection cannot have an amount");
    }
    if (application.status !== "PENDING_REVIEW" && application.status !== "PENDING_CONFIRMATION") {
      throw new LoanDecisionError("CONFLICT", "Application cannot be rejected");
    }
    return {
      reason,
      nextStatus: "REJECTED",
      approvedAmountMinor: null,
      proposedByUserId: null,
      notificationType: "REJECTED",
    };
  }

  if (application.status !== "PENDING_REVIEW") {
    throw new LoanDecisionError("CONFLICT", "Application already decided");
  }

  const amount = input.approvedAmountMinor;
  if (
    amount === undefined ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > POSTGRES_INTEGER_MAX ||
    amount > application.requestedAmountMinor
  ) {
    throw new LoanDecisionError("BAD_REQUEST", "Invalid approved amount");
  }

  if (amount <= DELEGATED_AUTHORITY_THRESHOLD_MINOR) {
    return {
      reason,
      nextStatus: "APPROVED",
      approvedAmountMinor: amount,
      proposedByUserId: null,
      notificationType: "APPROVED",
    };
  }

  return {
    reason,
    nextStatus: "PENDING_CONFIRMATION",
    approvedAmountMinor: amount,
    proposedByUserId: actorId,
    notificationType: "APPROVAL_PROPOSED",
  };
}

export function planConfirm(
  application: LoanApplicationRecord,
  actorId: string,
  input: ConfirmLoanApplicationInput,
): PlannedTransition {
  const reason = requireReason(input.reason);

  if (
    application.status !== "PENDING_CONFIRMATION" ||
    application.approvedAmountMinor === null ||
    application.proposedByUserId === null
  ) {
    throw new LoanDecisionError("CONFLICT", "Application is not awaiting confirmation");
  }

  if (application.proposedByUserId === actorId) {
    throw new LoanDecisionError(
      "FORBIDDEN",
      "The proposing underwriter cannot confirm this approval",
    );
  }

  return {
    reason,
    nextStatus: "APPROVED",
    approvedAmountMinor: application.approvedAmountMinor,
    proposedByUserId: application.proposedByUserId,
    notificationType: "APPROVED",
  };
}

export interface LoanRepository {
  findApplication(id: string): Promise<LoanApplicationRecord | null>;
  listApplications(): Promise<LoanApplicationRecord[]>;
  decide(actorId: string, input: DecideLoanApplicationInput): Promise<DecisionResult>;
  confirm(actorId: string, input: ConfirmLoanApplicationInput): Promise<DecisionResult>;
}

export interface AppLogger {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface RequestContext {
  repository: LoanRepository;
  session: { user: SessionUser } | null;
  logger: AppLogger;
  notifier: LoanNotifier;
}
