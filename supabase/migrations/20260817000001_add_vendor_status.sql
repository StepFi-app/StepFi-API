-- Add status column to vendors table with default 'pending' and constraint
ALTER TABLE public.vendors
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));

-- Backfill existing rows to 'pending' if null
UPDATE public.vendors
SET status = 'pending'
WHERE status IS NULL;
