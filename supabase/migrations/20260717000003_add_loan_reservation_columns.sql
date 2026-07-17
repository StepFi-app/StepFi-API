-- 2026-07-17 — Issue #81 (liquidity reservation layer)
--
-- Records the reservation handle that backs each pending loan so the
-- transaction-status pipeline can locate and release it when the
-- on-chain funding transaction settles (success or failure).
--
-- Both columns are nullable: legacy rows pre-dating the reservation
-- layer are unaffected, and loans in `under_review` (manual review)
-- have no reservation because the XDR is never built yet.

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS reservation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN loans.reservation_id IS
  'Stable handle returned by the liquidity reservation ledger (issue #81). Null when the loan predates the reservation layer or is in manual review.';

COMMENT ON COLUMN loans.reservation_expires_at IS
  'Auto-release deadline for the liquidity reservation backing this loan row. Null when no reservation was issued.';

CREATE INDEX IF NOT EXISTS idx_loans_reservation_id
  ON loans (reservation_id)
  WHERE reservation_id IS NOT NULL;
