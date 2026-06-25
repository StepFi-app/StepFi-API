-- Create table to store default detection job results
CREATE TABLE public.default_detection_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id TEXT NOT NULL REFERENCES public.loans(loan_id),
    loan_db_id UUID NOT NULL REFERENCES public.loans(id),
    user_wallet TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('detected', 'skipped', 'failed')),
    reason TEXT,
    on_chain_tx_hash TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up detection history by loan
CREATE INDEX idx_default_detection_loan_id ON public.default_detection_results(loan_id);
CREATE INDEX idx_default_detection_user_wallet ON public.default_detection_results(user_wallet);

-- Index for quick lookups of defaulted loans
CREATE INDEX idx_loans_defaulted_at ON public.loans(defaulted_at) WHERE status = 'defaulted';

ALTER TABLE public.default_detection_results ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.default_detection_results IS 'Records from the automated default detection job — tracks which loans were checked and the outcome';
COMMENT ON COLUMN public.default_detection_results.status IS 'detected = loan was marked defaulted on-chain, skipped = loan was not overdue enough, failed = on-chain call errored';
