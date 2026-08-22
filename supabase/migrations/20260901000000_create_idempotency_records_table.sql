CREATE TABLE public.idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    request_body JSONB NOT NULL,
    response_body JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX idempotency_records_key_idx ON public.idempotency_records (idempotency_key);
CREATE UNIQUE INDEX idempotency_records_hash_idx ON public.idempotency_records (transaction_hash);
CREATE INDEX idempotency_records_expires_at_idx ON public.idempotency_records (expires_at);

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
