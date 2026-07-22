ALTER TABLE public.vendors
  ADD COLUMN status TEXT DEFAULT 'pending';

UPDATE public.vendors
SET status = 'pending'
WHERE status IS NULL;

ALTER TABLE public.vendors
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT vendors_status_check
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));

COMMENT ON COLUMN public.vendors.status IS
  'Vendor approval lifecycle mirrored from the vendor registry contract.';
