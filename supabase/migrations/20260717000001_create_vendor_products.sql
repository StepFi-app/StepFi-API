-- Vendor product catalog. Each product belongs to exactly one vendor and is
-- managed only by that vendor (ownership enforced in the API service layer,
-- scoped by the authenticated wallet's vendor record).
CREATE TABLE IF NOT EXISTS public.vendor_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL
      REFERENCES public.vendors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products are almost always queried by their owning vendor.
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor_id
  ON public.vendor_products (vendor_id);

ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.vendor_products IS
  'Vendor-owned product catalog. Access is scoped to the owning vendor in the API service layer.';
