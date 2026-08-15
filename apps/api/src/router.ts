import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

import type {
  DecisionResult,
  LoanApplicationRecord,
  LoanApplicationView,
  RequestContext,
} from "./domain.js";
import { LoanDecisionError } from "./domain.js";

const t = initTRPC.context<RequestContext>().create({ transformer: superjson });

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const underwriterProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.user.role !== "UNDERWRITER") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

export const decideLoanApplicationSchema = z.object({
  applicationId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  approvedAmountMinor: z.number().int().positive().optional(),
  reason: z.string().min(1),
});

export const confirmLoanApplicationSchema = z.object({
  applicationId: z.string().min(1),
  reason: z.string().min(1),
});

function toView(application: LoanApplicationRecord): LoanApplicationView {
  return {
    id: application.id,
    status: application.status,
    requestedAmountMinor: application.requestedAmountMinor,
    approvedAmountMinor: application.approvedAmountMinor,
    proposedByUserId: application.proposedByUserId,
    customer: {
      fullName: application.customer.fullName,
      lastName: application.customer.lastName,
      gender: application.customer.gender,
      taxId: application.customer.taxId,
      email: application.customer.email,
    },
  };
}

function toDecisionResponse(result: DecisionResult) {
  return {
    applicationId: result.application.id,
    status: result.application.status,
    approvedAmountMinor: result.application.approvedAmountMinor,
  };
}

function mapDecisionError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }
  if (error instanceof LoanDecisionError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Decision failed",
  });
}

async function deliverAfterCommit(ctx: RequestContext, result: DecisionResult): Promise<void> {
  try {
    await ctx.notifier.send(result.notification);
  } catch {
    ctx.logger.error(
      {
        applicationId: result.notification.applicationId,
        type: result.notification.type,
      },
      "Notification delivery failed",
    );
  }
}

export const appRouter = t.router({
  loanApplications: t.router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const applications = await ctx.repository.listApplications();
      return applications.map(toView);
    }),

    getForReview: protectedProcedure
      .input(z.object({ applicationId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const application = await ctx.repository.findApplication(input.applicationId);
        if (!application) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
        }
        return toView(application);
      }),

    decide: underwriterProcedure
      .input(decideLoanApplicationSchema)
      .mutation(async ({ ctx, input }) => {
        ctx.logger.info(
          {
            applicationId: input.applicationId,
            decision: input.decision,
            actorId: ctx.session.user.id,
          },
          "Processing loan decision",
        );

        try {
          const result = await ctx.repository.decide(ctx.session.user.id, input);
          await deliverAfterCommit(ctx, result);
          return toDecisionResponse(result);
        } catch (error: unknown) {
          mapDecisionError(error);
        }
      }),

    confirm: underwriterProcedure
      .input(confirmLoanApplicationSchema)
      .mutation(async ({ ctx, input }) => {
        ctx.logger.info(
          {
            applicationId: input.applicationId,
            actorId: ctx.session.user.id,
          },
          "Processing loan confirmation",
        );

        try {
          const result = await ctx.repository.confirm(ctx.session.user.id, input);
          await deliverAfterCommit(ctx, result);
          return toDecisionResponse(result);
        } catch (error: unknown) {
          mapDecisionError(error);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
