-- Additive only: do not rewrite existing status values.
-- Existing APPROVED / REJECTED rows stay terminal. proposedByUserId stays NULL
-- on legacy rows (never proposed in the dual-control workflow).

ALTER TYPE "LoanApplicationStatus" ADD VALUE 'PENDING_CONFIRMATION';

ALTER TABLE "LoanApplication" ADD COLUMN "proposedByUserId" TEXT;

CREATE INDEX "LoanApplication_proposedByUserId_idx" ON "LoanApplication"("proposedByUserId");

ALTER TABLE "LoanApplication"
  ADD CONSTRAINT "LoanApplication_proposedByUserId_fkey"
  FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
