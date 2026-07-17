-- Adds an optional free-text description to vendor profiles.
-- Used by the vendor registration flow (POST /vendors) so vendors can
-- describe their business. Nullable so existing rows remain valid.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.vendors.description IS
  'Optional vendor-provided business description (max 500 chars, enforced in the API DTO).';
