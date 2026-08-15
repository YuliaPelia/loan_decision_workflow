"use client";

import type { LoanApplicationView } from "@loan-review/api/types";
import Link from "next/link";
import { useParams } from "next/navigation";

import { DecisionForm, type DecisionFormValue } from "@/components/DecisionForm";
import { formatMinorUnits } from "@/lib/money";
import { actorName } from "@/lib/session";
import { useSessionActor } from "@/app/providers";
import { trpc } from "@/lib/trpc";

function statusClass(status: LoanApplicationView["status"]): string {
  return `status status-${status.toLowerCase()}`;
}

function decisionErrorMessage(code: string | undefined, fallback: string): string {
  if (code === "CONFLICT") {
    return "This application is no longer in a state that accepts that action.";
  }
  if (code === "FORBIDDEN") {
    return "You are not allowed to perform this action.";
  }
  return fallback;
}

function ApplicationReview() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;
  const { actor } = useSessionActor();

  const application = trpc.loanApplications.getForReview.useQuery({ applicationId });
  const decide = trpc.loanApplications.decide.useMutation();
  const confirm = trpc.loanApplications.confirm.useMutation();
  const busy = decide.isPending || confirm.isPending;
  const mutationError = decide.error ?? confirm.error;

  if (application.isPending) {
    return <main className="shell">Loading application…</main>;
  }

  if (application.isError) {
    return (
      <main className="shell" role="alert">
        Could not load this application: {application.error.message}
      </main>
    );
  }

  const item = application.data;
  const isProposer = item.proposedByUserId === actor.id;

  async function submit(value: DecisionFormValue) {
    decide.reset();
    confirm.reset();

    if (value.decision === "CONFIRMED") {
      await confirm.mutateAsync({ applicationId, reason: value.reason });
    } else if (value.decision === "APPROVED") {
      await decide.mutateAsync({
        applicationId,
        decision: "APPROVED",
        approvedAmountMinor: value.approvedAmountMinor,
        reason: value.reason,
      });
    } else {
      await decide.mutateAsync({
        applicationId,
        decision: "REJECTED",
        reason: value.reason,
      });
    }

    await application.refetch();
  }

  return (
    <main className="shell">
      <Link className="back-link" href="/">
        All applications
      </Link>
      <div className="eyebrow">Application {item.id}</div>
      <div className="title-row">
        <h1>{item.customer.fullName}</h1>
        <span className={statusClass(item.status)}>{item.status}</span>
      </div>

      <section className="summary-card" aria-labelledby="application-summary">
        <h2 id="application-summary">Application summary</h2>
        <dl>
          <div>
            <dt>Requested</dt>
            <dd>{formatMinorUnits(item.requestedAmountMinor)}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{item.customer.email}</dd>
          </div>
          {item.approvedAmountMinor === null ? null : (
            <div>
              <dt>{item.status === "APPROVED" ? "Approved" : "Proposed"}</dt>
              <dd>{formatMinorUnits(item.approvedAmountMinor)}</dd>
            </div>
          )}
          {item.proposedByUserId ? (
            <div>
              <dt>Proposed by</dt>
              <dd>{actorName(item.proposedByUserId)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {actor.role !== "UNDERWRITER" ? (
        <p className="notice" role="status">
          Only an underwriter can record or confirm a decision.
        </p>
      ) : item.status === "PENDING_REVIEW" ? (
        <section aria-labelledby="record-decision">
          <h2 id="record-decision">Record a decision</h2>
          <DecisionForm
            disabled={busy}
            mode="initial"
            onSubmit={submit}
            requestedAmountMinor={item.requestedAmountMinor}
          />
        </section>
      ) : item.status === "PENDING_CONFIRMATION" ? (
        <section aria-labelledby="record-decision">
          <h2 id="record-decision">Confirm or reject</h2>
          <DecisionForm
            canConfirm={!isProposer}
            disabled={busy}
            mode="confirm"
            onSubmit={submit}
            requestedAmountMinor={item.requestedAmountMinor}
          />
        </section>
      ) : (
        <p className="notice">This application has already been processed.</p>
      )}

      {mutationError ? (
        <p className="error" role="alert">
          {decisionErrorMessage(mutationError.data?.code, mutationError.message)}
        </p>
      ) : null}
    </main>
  );
}

export default function ApplicationReviewPage() {
  return <ApplicationReview />;
}
