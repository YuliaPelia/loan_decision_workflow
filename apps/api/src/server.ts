import { prisma } from "@loan-review/db";

import { buildApp } from "./app.js";
import { NoopLoanNotifier } from "./notifier.js";
import { PrismaLoanRepository } from "./repository.js";

const server = await buildApp({
  repository: new PrismaLoanRepository(prisma),
  notifier: new NoopLoanNotifier(),
});

try {
  await server.listen({ port: 4000, host: "0.0.0.0" });
} catch (error: unknown) {
  server.log.error(error);
  process.exit(1);
}
