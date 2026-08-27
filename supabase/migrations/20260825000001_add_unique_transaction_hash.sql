-- Idempotency backstop for POST /transactions/submit (issue #117).
--
-- A Stellar transaction hash may only be recorded once: duplicate submissions
-- return the original record instead of re-submitting to Horizon. The unique
-- indexes below make that guarantee hold even under concurrent requests.
-- Partial indexes are used because both columns are nullable (legacy rows may
-- only populate one).

-- Deduplicate pre-existing rows (keep the earliest record per hash) so the
-- unique indexes below can be created.
DELETE FROM public.transactions AS dup
USING public.transactions AS kept
WHERE dup.transaction_hash IS NOT NULL
  AND dup.transaction_hash = kept.transaction_hash
  AND dup.id <> kept.id
  AND dup.submitted_at > kept.submitted_at;

DELETE FROM public.transactions AS dup
USING public.transactions AS kept
WHERE dup.hash IS NOT NULL
  AND dup.hash = kept.hash
  AND dup.id <> kept.id
  AND dup.submitted_at > kept.submitted_at;

CREATE UNIQUE INDEX transactions_transaction_hash_unique
  ON public.transactions (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

CREATE UNIQUE INDEX transactions_hash_unique
  ON public.transactions (hash)
  WHERE hash IS NOT NULL;
