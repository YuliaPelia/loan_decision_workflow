import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLoanRepository } from "../../src/repository.js";
import { loadDatabaseUrl } from "../support/database-url.js";

const databaseUrl = loadDatabaseUrl();

describe.skipIf(!databaseUrl)("postgres row lock", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
  });

  afterAll(async () => {
    if (!databaseUrl) {
      return;
    }
    const { prisma } = await import("@loan-review/db");
    await prisma.$disconnect();
  });

  it("lets only one concurrent decide succeed against PostgreSQL", async () => {
    const { prisma } = await import("@loan-review/db");
    const id = `app-race-${randomUUID()}`;
    const repository = new PrismaLoanRepository(prisma);

    await prisma.loanApplication.create({
      data: {
        id,
        requestedAmountMinor: 500_000,
        customerFullName: "Race Fixture",
        customerLastName: "Fixture",
        customerGender: "FEMALE",
        customerTaxId: `TAX-${id}`,
        customerEmail: `${id}@example.test`,
        customerPhone: "+380500000099",
        customerNationalId: `ID-${id}`,
        monthlyIncomeMinor: 180_000,
      },
    });

    try {
      const [first, second] = await Promise.allSettled([
        repository.decide("user-underwriter-1", {
          applicationId: id,
          decision: "APPROVED",
          approvedAmountMinor: 400_000,
          reason: "First concurrent writer",
        }),
        repository.decide("user-underwriter-2", {
          applicationId: id,
          decision: "APPROVED",
          approvedAmountMinor: 400_000,
          reason: "Second concurrent writer",
        }),
      ]);

      const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
      const rejected = [first, second].filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ code: "CONFLICT" }),
      });

      const stored = await prisma.loanApplication.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe("APPROVED");
      expect(await prisma.loanDecisionAudit.count({ where: { applicationId: id } })).toBe(1);
    } finally {
      await prisma.loanDecisionAudit.deleteMany({ where: { applicationId: id } });
      await prisma.loanApplication.delete({ where: { id } });
    }
  });
});
