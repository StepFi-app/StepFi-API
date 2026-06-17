-- Add under_review and rejected as valid status values for the credit scoring pipeline.
-- The loans.status column is TEXT, so no schema change is required.
-- Valid statuses: pending, active, completed, defaulted, under_review, rejected

COMMENT ON COLUMN public.loans.status IS 'Loan status: pending (awaiting on-chain), active (repaying), completed (paid off), defaulted (missed payments), under_review (flagged for manual review), rejected (declined by credit scoring)';
