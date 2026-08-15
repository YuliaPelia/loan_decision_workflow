import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { InMemoryLoanRepository, RecordingLoanNotifier } from "../support/in-memory-repository.js";

const underwriterHeaders = {
  "x-user-id": "user-underwriter-1",
  "x-user-role": "UNDERWRITER",
};

function jsonInput(value: unknown): string {
  return encodeURIComponent(JSON.stringify({ json: value }));
}

function hasClientStack(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasClientStack);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, nested]) => {
      if (key === "stack" && typeof nested === "string") {
        return true;
      }
      return hasClientStack(nested);
    });
  }
  return false;
}

async function withApp(
  run: (inject: Awaited<ReturnType<typeof buildApp>>["inject"]) => Promise<void>,
) {
  const app = await buildApp({
    repository: new InMemoryLoanRepository(),
    notifier: new RecordingLoanNotifier(),
    logger: false,
  });
  try {
    await run(app.inject.bind(app));
  } finally {
    await app.close();
  }
}

describe("HTTP adapter", () => {
  it("does not treat a non-SUPPORT header as UNDERWRITER", async () => {
    await withApp(async (inject) => {
      const admin = await inject({
        method: "GET",
        url: "/trpc/loanApplications.list",
        headers: { "x-user-id": "user-underwriter-1", "x-user-role": "ADMIN" },
      });
      const lowercase = await inject({
        method: "POST",
        url: "/trpc/loanApplications.decide",
        headers: {
          "content-type": "application/json",
          "x-user-id": "user-underwriter-1",
          "x-user-role": "underwriter",
        },
        payload: {
          json: {
            applicationId: "app-pending",
            decision: "APPROVED",
            approvedAmountMinor: 400_000,
            reason: "Should not authenticate",
          },
        },
      });

      expect(admin.statusCode).toBe(401);
      expect(lowercase.statusCode).toBe(401);
    });
  });

  it("returns 403/404/409 without stack traces in the error JSON", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      await withApp(async (inject) => {
        const forbidden = await inject({
          method: "POST",
          url: "/trpc/loanApplications.decide",
          headers: {
            "content-type": "application/json",
            "x-user-id": "user-support-1",
            "x-user-role": "SUPPORT",
          },
          payload: {
            json: {
              applicationId: "app-pending",
              decision: "APPROVED",
              approvedAmountMinor: 400_000,
              reason: "Support must not decide",
            },
          },
        });

        const missing = await inject({
          method: "GET",
          url: `/trpc/loanApplications.getForReview?input=${jsonInput({ applicationId: "missing" })}`,
          headers: underwriterHeaders,
        });

        const conflict = await inject({
          method: "POST",
          url: "/trpc/loanApplications.confirm",
          headers: {
            "content-type": "application/json",
            ...underwriterHeaders,
          },
          payload: {
            json: { applicationId: "app-pending", reason: "Nothing to confirm" },
          },
        });

        expect(forbidden.statusCode).toBe(403);
        expect(missing.statusCode).toBe(404);
        expect(conflict.statusCode).toBe(409);

        for (const response of [forbidden, missing, conflict]) {
          const body: unknown = response.json();
          expect(hasClientStack(body)).toBe(false);
        }
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv ?? "test";
    }
  });
});
