export type LoanNotificationType = "APPROVAL_PROPOSED" | "APPROVED" | "REJECTED";

export interface LoanNotification {
  applicationId: string;
  type: LoanNotificationType;
}

/**
 * Implementing the external transport itself is outside this exercise. Candidates
 * may evolve this boundary if their delivery design needs additional metadata.
 */
export interface LoanNotifier {
  send(notification: LoanNotification): Promise<void>;
}

/** Development default: delivery is out of scope; production would swap the transport. */
export class NoopLoanNotifier implements LoanNotifier {
  async send(): Promise<void> {}
}
