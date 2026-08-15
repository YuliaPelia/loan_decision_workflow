"use client";

import { useState, type FormEvent } from "react";

import { parseEuroToMinorUnits } from "@/lib/money";

export type DecisionFormValue =
  | { decision: "APPROVED"; approvedAmountMinor: number; reason: string }
  | { decision: "REJECTED"; reason: string }
  | { decision: "CONFIRMED"; reason: string };

interface DecisionFormProps {
  mode: "initial" | "confirm";
  requestedAmountMinor: number;
  canConfirm?: boolean;
  disabled?: boolean;
  onSubmit(value: DecisionFormValue): Promise<void> | void;
}

export function DecisionForm({
  mode,
  requestedAmountMinor,
  canConfirm = true,
  disabled = false,
  onSubmit,
}: DecisionFormProps) {
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | "CONFIRMED">(
    mode === "confirm" ? (canConfirm ? "CONFIRMED" : "REJECTED") : "APPROVED",
  );
  const [approvedAmount, setApprovedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAmountError(null);
    setReasonError(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError("A reason is required.");
      return;
    }

    if (decision === "APPROVED") {
      const minor = parseEuroToMinorUnits(approvedAmount);
      if (minor === null) {
        setAmountError("Enter a positive amount with at most two decimal places.");
        return;
      }
      if (minor > requestedAmountMinor) {
        setAmountError("Approved amount cannot exceed the requested amount.");
        return;
      }
      setSubmitting(true);
      try {
        await onSubmit({ decision, approvedAmountMinor: minor, reason: trimmedReason });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ decision, reason: trimmedReason });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="decision-form" onSubmit={(event) => void handleSubmit(event)}>
      <fieldset disabled={disabled || submitting}>
        <legend>Decision</legend>
        {mode === "initial" ? (
          <>
            <label className="radio-row">
              <input
                checked={decision === "APPROVED"}
                name="decision"
                onChange={() => setDecision("APPROVED")}
                type="radio"
                value="APPROVED"
              />
              Approve
            </label>
            <label className="radio-row">
              <input
                checked={decision === "REJECTED"}
                name="decision"
                onChange={() => setDecision("REJECTED")}
                type="radio"
                value="REJECTED"
              />
              Reject
            </label>
          </>
        ) : (
          <>
            <label className="radio-row">
              <input
                checked={decision === "CONFIRMED"}
                disabled={!canConfirm}
                name="decision"
                onChange={() => setDecision("CONFIRMED")}
                type="radio"
                value="CONFIRMED"
              />
              Confirm
            </label>
            <label className="radio-row">
              <input
                checked={decision === "REJECTED"}
                name="decision"
                onChange={() => setDecision("REJECTED")}
                type="radio"
                value="REJECTED"
              />
              Reject
            </label>
            {canConfirm ? null : (
              <p className="notice" role="status">
                You proposed this approval, so another underwriter must confirm it. You can still
                reject.
              </p>
            )}
          </>
        )}

        {mode === "initial" && decision === "APPROVED" ? (
          <label>
            Approved amount
            <span className="input-affix">
              <span aria-hidden="true">€</span>
              <input
                aria-describedby={amountError ? "approved-amount-error" : undefined}
                aria-invalid={amountError ? true : undefined}
                autoComplete="off"
                inputMode="decimal"
                onChange={(event) => {
                  setApprovedAmount(event.target.value);
                  setAmountError(null);
                }}
                required
                value={approvedAmount}
              />
            </span>
          </label>
        ) : null}

        {amountError ? (
          <p className="error" id="approved-amount-error" role="alert">
            {amountError}
          </p>
        ) : null}

        <label>
          Reason
          <textarea
            aria-describedby={reasonError ? "decision-reason-error" : undefined}
            aria-invalid={reasonError ? true : undefined}
            minLength={1}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(null);
            }}
            required
            rows={4}
            value={reason}
          />
        </label>

        {reasonError ? (
          <p className="error" id="decision-reason-error" role="alert">
            {reasonError}
          </p>
        ) : null}

        <button className="primary-button" type="submit">
          {submitting ? "Saving…" : mode === "confirm" ? "Submit" : "Record decision"}
        </button>
      </fieldset>
    </form>
  );
}
