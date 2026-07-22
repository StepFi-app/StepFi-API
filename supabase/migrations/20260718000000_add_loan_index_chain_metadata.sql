ALTER TABLE public.loan_index
  ADD COLUMN IF NOT EXISTS transaction_hash TEXT,
  ADD COLUMN IF NOT EXISTS ledger_sequence BIGINT;

CREATE INDEX IF NOT EXISTS loan_index_transaction_hash_idx
  ON public.loan_index (transaction_hash)
  WHERE transaction_hash IS NOT NULL;
