import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";

import type { LoanRepository, RequestContext } from "./domain.js";
import type { LoanNotifier } from "./notifier.js";
import { appRouter } from "./router.js";
import { sessionFromHeaders } from "./session.js";

export interface BuildAppOptions {
  repository: LoanRepository;
  notifier: LoanNotifier;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions) {
  const server = Fastify({
    logger: options.logger ?? true,
    routerOptions: { maxParamLength: 5_000 },
  });

  await server.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  server.get("/health", async () => ({ status: "ok" }));

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext({ req }: CreateFastifyContextOptions): RequestContext {
        return {
          repository: options.repository,
          session: sessionFromHeaders({
            "x-user-id": req.headers["x-user-id"],
            "x-user-role": req.headers["x-user-role"],
          }),
          logger: {
            info(context, message) {
              server.log.info(context, message);
            },
            error(context, message) {
              server.log.error(context, message);
            },
          },
          notifier: options.notifier,
        };
      },
    },
  });

  return server;
}
