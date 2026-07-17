CREATE TABLE public.indexer_state (
    contract_id TEXT PRIMARY KEY,
    last_ledger BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.indexer_state ENABLE ROW LEVEL SECURITY;
