import type {
  LoanApplicationStatus as PrismaLoanApplicationStatus,
  Prisma,
  PrismaClient,
} from "@loan-review/db";

import type {
  ConfirmLoanApplicationInput,
  DecideLoanApplicationInput,
  DecisionResult,
  LoanApplicationRecord,
  LoanApplicationStatus,
  LoanRepository,
  PlannedTransition,
} from "./domain.js";
import { LoanDecisionError, planConfirm, planDecide } from "./domain.js";

function toRecord(application: {
  id: string;
  status: PrismaLoanApplicationStatus;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  proposedByUserId: string | null;
  customerFullName: string;
  customerLastName: string;
  customerGender: string;
  customerTaxId: string;
  customerEmail: string;
  customerPhone: string;
  customerNationalId: string;
  monthlyIncomeMinor: number;
}): LoanApplicationRecord {
  return {
    id: application.id,
    status: application.status as LoanApplicationStatus,
    requestedAmountMinor: application.requestedAmountMinor,
    approvedAmountMinor: application.approvedAmountMinor,
    proposedByUserId: application.proposedByUserId,
    customer: {
      fullName: application.customerFullName,
      lastName: application.customerLastName,
      gender: application.customerGender,
      taxId: application.customerTaxId,
      email: application.customerEmail,
      phone: application.customerPhone,
      nationalId: application.customerNationalId,
      monthlyIncomeMinor: application.monthlyIncomeMinor,
    },
  };
}

async function persistTransition(
  tx: Prisma.TransactionClient,
  application: LoanApplicationRecord,
  actorId: string,
  planned: PlannedTransition,
): Promise<DecisionResult> {
  const updated = await tx.loanApplication.update({
    where: { id: application.id },
    data: {
      status: planned.nextStatus as PrismaLoanApplicationStatus,
      approvedAmountMinor: planned.approvedAmountMinor,
      proposedByUserId: planned.proposedByUserId,
    },
  });

  await tx.loanDecisionAudit.create({
    data: {
      applicationId: application.id,
      actorId,
      previousStatus: application.status as PrismaLoanApplicationStatus,
      newStatus: planned.nextStatus as PrismaLoanApplicationStatus,
      approvedAmountMinor: planned.approvedAmountMinor,
      reason: planned.reason,
    },
  });

  return {
    application: toRecord(updated),
    notification: { applicationId: application.id, type: planned.notificationType },
  };
}

export class PrismaLoanRepository implements LoanRepository {
  constructor(private readonly client: PrismaClient) {}

  async findApplication(id: string): Promise<LoanApplicationRecord | null> {
    const application = await this.client.loanApplication.findUnique({ where: { id } });
    return application ? toRecord(application) : null;
  }

  async listApplications(): Promise<LoanApplicationRecord[]> {
    const applications = await this.client.loanApplication.findMany({
      orderBy: { createdAt: "desc" },
    });
    return applications.map(toRecord);
  }

  async decide(actorId: string, input: DecideLoanApplicationInput): Promise<DecisionResult> {
    return this.withLockedApplication(input.applicationId, async (application, tx) =>
      persistTransition(tx, application, actorId, planDecide(application, actorId, input)),
    );
  }

  async confirm(actorId: string, input: ConfirmLoanApplicationInput): Promise<DecisionResult> {
    return this.withLockedApplication(input.applicationId, async (application, tx) =>
      persistTransition(tx, application, actorId, planConfirm(application, actorId, input)),
    );
  }

  private async withLockedApplication<T>(
    applicationId: string,
    fn: (application: LoanApplicationRecord, tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "LoanApplication" WHERE "id" = ${applicationId} FOR UPDATE`;
      const row = await tx.loanApplication.findUnique({ where: { id: applicationId } });
      if (!row) {
        throw new LoanDecisionError("NOT_FOUND", "Application not found");
      }
      return fn(toRecord(row), tx);
    });
  }
}
