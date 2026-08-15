import "dotenv/config";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { LoanApplicationStatus, PrismaClient, UserRole } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const OPEN_FOR_REVIEW = [
  LoanApplicationStatus.PENDING_REVIEW,
  LoanApplicationStatus.PENDING_CONFIRMATION,
] as const;

interface SeedApplication {
  id: string;
  requestedAmountMinor: number;
  customerFullName: string;
  customerLastName: string;
  customerGender: string;
  customerTaxId: string;
  customerEmail: string;
  customerPhone: string;
  customerNationalId: string;
  monthlyIncomeMinor: number;
}

const seedApplications: SeedApplication[] = [
  {
    id: "app-pending",
    requestedAmountMinor: 500_000,
    customerFullName: "Olena Kovalenko",
    customerLastName: "Kovalenko",
    customerGender: "FEMALE",
    customerTaxId: "TAX-72419831",
    customerEmail: "olena@example.test",
    customerPhone: "+380501234567",
    customerNationalId: "ID-72419831",
    monthlyIncomeMinor: 180_000,
  },
  {
    id: "app-at-threshold",
    requestedAmountMinor: 1_000_000,
    customerFullName: "Threshold Fixture",
    customerLastName: "Fixture",
    customerGender: "NON_BINARY",
    customerTaxId: "TAX-THRESHOLD",
    customerEmail: "threshold@example.test",
    customerPhone: "+380500000002",
    customerNationalId: "ID-THRESHOLD",
    monthlyIncomeMinor: 300_000,
  },
  {
    id: "app-high-value",
    requestedAmountMinor: 2_000_000,
    customerFullName: "High Value Fixture",
    customerLastName: "Fixture",
    customerGender: "MALE",
    customerTaxId: "TAX-HIGH-VALUE",
    customerEmail: "high-value@example.test",
    customerPhone: "+380500000003",
    customerNationalId: "ID-HIGH-VALUE",
    monthlyIncomeMinor: 600_000,
  },
];

async function upsertSeedApplication(application: SeedApplication): Promise<void> {
  await prisma.loanApplication.upsert({
    where: { id: application.id },
    update: {
      customerLastName: application.customerLastName,
      customerGender: application.customerGender,
      customerTaxId: application.customerTaxId,
    },
    create: {
      ...application,
      status: LoanApplicationStatus.PENDING_REVIEW,
    },
  });
}

/** Keep terminal seed rows as-is; top up a pending/confirmable row per amount band for UI review. */
async function ensureOpenReview(application: SeedApplication): Promise<void> {
  const open = await prisma.loanApplication.findFirst({
    where: {
      requestedAmountMinor: application.requestedAmountMinor,
      status: { in: [...OPEN_FOR_REVIEW] },
    },
  });
  if (open) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  await prisma.loanApplication.create({
    data: {
      ...application,
      id: `${application.id}-${suffix}`,
      status: LoanApplicationStatus.PENDING_REVIEW,
      customerTaxId: `${application.customerTaxId}-${suffix}`,
      customerEmail: application.customerEmail.replace("@", `-${suffix}@`),
      customerNationalId: `${application.customerNationalId}-${suffix}`,
    },
  });
}

async function main() {
  await prisma.user.upsert({
    where: { id: "user-underwriter-1" },
    update: {},
    create: { id: "user-underwriter-1", name: "Ada Underwriter", role: UserRole.UNDERWRITER },
  });

  await prisma.user.upsert({
    where: { id: "user-underwriter-2" },
    update: {},
    create: { id: "user-underwriter-2", name: "Grace Underwriter", role: UserRole.UNDERWRITER },
  });

  await prisma.user.upsert({
    where: { id: "user-support-1" },
    update: {},
    create: { id: "user-support-1", name: "Sam Support", role: UserRole.SUPPORT },
  });

  for (const application of seedApplications) {
    await upsertSeedApplication(application);
    await ensureOpenReview(application);
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
