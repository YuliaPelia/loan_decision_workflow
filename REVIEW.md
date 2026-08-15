# Initial review

Complete this file before making implementation changes.

Agreed design (before implementation):

1. Concurrency: PostgreSQL transaction + `SELECT FOR UPDATE` on the application row.
2. API: separate `decide` and `confirm` mutations.
3. Segregation of duties: nullable `proposedByUserId` on `LoanApplication`, plus an immutable audit row.
4. Notifications: best-effort `LoanNotifier.send` after a successful commit. Lost notifications are acceptable; a transactional outbox is out of scope.

## Critical issues

1. **Lost updates under concurrent decide.** `decide` loads the row, checks `PENDING_REVIEW`, then writes status and audit in two separate statements with no transaction and no row lock. Two underwriters can both pass the status check and both persist a decision. The last writer wins; audit can disagree with the live status. This is the highest production risk.

2. **State machine is a single-underwriter slice.** Domain and Prisma enum only know `PENDING_REVIEW | APPROVED | REJECTED`. There is no `PENDING_CONFIRMATION`, no confirm path, and no stored proposer. High-value approvals (`> 1_000_000` minor units) become final immediately, which violates delegated authority.

3. **Authorization is not role-exact.** `underwriterProcedure` only checks that `role` is truthy. `SUPPORT` can record a decision. Session is always present: missing `x-user-role` defaults to `UNDERWRITER`, missing `x-user-id` defaults to `user-underwriter-1`. `loanApplications.delete` is an unauthenticated mutation.

4. **Decision errors are swallowed.** The `decide` `catch` converts `NOT_FOUND`, `BAD_REQUEST`, and `CONFLICT` into `INTERNAL_SERVER_ERROR` with `"Decision failed"`. Clients cannot distinguish validation from conflicts; stack details stay in logs only if they were logged before the catch.

5. **Audit is not atomic with the decision.** `createAudit` runs after `updateApplication`. If audit insert fails, the application is already `APPROVED`/`REJECTED` with no trail. `newStatus` is typed as `LoanDecision`, so `PENDING_CONFIRMATION` cannot be recorded without a type change.

6. **Money rules are incomplete.** Approval rejects non-integers and amounts above requested, but not `<= 0`. The browser uses `Math.round(Number(approvedAmount) * 100)`, so float rounding can disagree with the API. Prisma `Int` maps to PostgreSQL `INTEGER` (32-bit); that is enough for this workflow and will be treated as a documented ceiling, not migrated to `BigInt` in the timebox.

7. **`LoanNotifier` is unused.** No `APPROVAL_PROPOSED` / `APPROVED` / `REJECTED` delivery. Notifications must not run inside the DB transaction (notify-then-rollback) and will be invoked only after commit.

8. **Review UI cannot express the workflow.** The form only submits approve/reject. There is no confirm action, no proposer identity, no actor switch between the two seeded underwriters, and list loading uses `isFetching` so the table disappears on every 5s refetch.

## Non-critical improvements

1. Stop logging the full application record and decision input (PII: tax id, national id, phone, email). Log application id, actor id, previous/new status, amount only.

2. Protect or remove `delete`. It is unused by the UI and is an unauthenticated data-loss path. Prefer removing it from the public router unless a later requirement needs it.

3. Show list loading only on initial `isPending`, not on background refetch.

4. Keep seed upserts rerunnable without resetting decided rows to `PENDING_REVIEW` (current behaviour is correct for a populated DB).

## Implementation plan

1. Additive Prisma migration only: add enum value `PENDING_CONFIRMATION`; add nullable `proposedByUserId` (FK to `User`). Do not edit `20260809000000_init`. Existing `APPROVED`/`REJECTED` rows stay terminal and are not reinterpreted.

2. Domain: extend statuses; add `confirm` input (reason only, no amount); store proposer on the record; put `LoanNotifier` on `RequestContext`.

3. Repository: `decide`/`confirm`/`reject` in one transaction; `SELECT FOR UPDATE` the application row; write application + audit together; clear `approvedAmountMinor` and `proposedByUserId` on reject.

4. Router: `role === "UNDERWRITER"`; rethrow `TRPCError`; map unexpected errors to `INTERNAL_SERVER_ERROR` without internals. `decide` only from `PENDING_REVIEW`. `confirm` only from `PENDING_CONFIRMATION`, actor `!== proposedByUserId`, amount preserved. Threshold: `<= 1_000_000` final `APPROVED`, else `PENDING_CONFIRMATION`.

5. After commit, best-effort `notifier.send`. Failure to notify does not roll back the decision.

6. Review screen: inferred tRPC types; confirm/reject when `PENDING_CONFIRMATION`; exact minor-unit parsing; actor header switcher for the two seeded underwriters so SoD is exercisable.

7. Tests for: SUPPORT forbidden; amount `> 0` and `<= requested`; threshold inclusive `1_000_000`; propose vs confirm; SoD; reject from both non-terminal states; notification types; concurrent second writer gets `CONFLICT`; `TRPCError` not masked as 500.

## What I will not complete within the timebox

1. Real authentication/session issuance. Header identity stays a test harness; we only make authorization checks exact.

2. Transactional outbox / retry worker for notifications.

3. Migrating amounts to `BigInt` / `BIGINT`.

4. Redis usage, list pagination as a product feature, visual polish beyond accessible workflow feedback.

## Production readiness

### Observability

Counters: decide/confirm/reject by result (`ok`, `forbidden`, `conflict`, `validation`). Log actor id, application id, previous status, new status, amount — not full customer records. Alert on notification send failures and on `CONFLICT` spikes (signal of double-submit or a stuck lock). Tracing: one span per decision transaction.

### Rollout and rollback

Expand-only migration: add enum value and nullable column, deploy API that understands both. Rollback the app first; leave the additive migration in place (Postgres cannot easily drop enum values). Feature does not require backfill: null `proposedByUserId` means “never proposed in the new workflow”. Existing final rows remain final.

### Known limitations

- Header identity is a local harness (`x-user-id` / `x-user-role`), not session issuance. Missing or unrecognised headers are unauthenticated (401). Anyone who can set headers can spoof a role; production must replace `createContext` with a verified session. Out of scope for this take-home.
- Notifications are at-most-once best-effort after commit; a crash between commit and `send` loses the event.
- `SELECT FOR UPDATE` only serializes writers that use this path; ad-hoc SQL still races. Concurrent `decide` is covered by a PostgreSQL integration test when `DATABASE_URL` is available.
- PostgreSQL `INTEGER` / Prisma `Int` (32-bit, max `2_147_483_647`) is the amount ceiling. Workflow values fit; `BigInt` is out of scope. Domain and UI reject amounts above that bound; `Number.MAX_SAFE_INTEGER` is not stored.
- Seed never reopens `APPROVED`/`REJECTED` rows. If the original demo ids are already terminal, a rerun inserts a new `PENDING_REVIEW` row per amount band so the UI still has something to exercise.
