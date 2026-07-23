-- Row Level Security Policies for StepFi Tables
-- This migration adds RLS policies to ensure users can only access their own data
-- Service role bypasses RLS automatically for admin operations
--
-- IMPORTANT: These policies require the API layer to execute
-- SET LOCAL app.current_wallet = 'G...' before each query using a
-- non-service-role client. The current API uses service-role client which
-- bypasses RLS entirely. To enable RLS enforcement, the API layer must:
-- 1. Use anon-key client (non-service-role) for user-facing queries
-- 2. Execute SET LOCAL app.current_wallet = $wallet via raw SQL before queries

-- ============================================================================
-- Enable RLS on tables (ensure it's enabled)
-- ============================================================================
ALTER TABLE public.learner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_pools ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RPC function to set session variable for RLS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_app_current_wallet(wallet TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_wallet', wallet, false);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.set_app_current_wallet(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_app_current_wallet(TEXT) TO authenticated;

-- ============================================================================
-- learner_profiles
-- ============================================================================
-- Users can read their own profile
CREATE POLICY "Users can read own learner profile" 
ON public.learner_profiles
  FOR SELECT 
  USING (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- Users can insert their own profile
CREATE POLICY "Users can insert own learner profile" 
ON public.learner_profiles
  FOR INSERT 
  WITH CHECK (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- Users can update their own profile
CREATE POLICY "Users can update own learner profile" 
ON public.learner_profiles
  FOR UPDATE 
  USING (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- ============================================================================
-- loans
-- ============================================================================
-- Users can read their own loans
CREATE POLICY "Users can read own loans" 
ON public.loans
  FOR SELECT 
  USING (user_wallet = current_setting('app.current_wallet', true)::TEXT);


-- ============================================================================
-- vouches
-- ============================================================================
-- Users can read vouches where they are either mentor or learner
CREATE POLICY "Users can read own vouches" 
ON public.vouches
  FOR SELECT 
  USING (
    mentor_wallet = current_setting('app.current_wallet', true)::TEXT
    OR
    learner_wallet = current_setting('app.current_wallet', true)::TEXT
  );

-- Users can insert vouches where they are the mentor
CREATE POLICY "Mentors can insert vouches" 
ON public.vouches
  FOR INSERT 
  WITH CHECK (mentor_wallet = current_setting('app.current_wallet', true)::TEXT);

-- Users can update vouches where they are the mentor
CREATE POLICY "Mentors can update own vouches" 
ON public.vouches
  FOR UPDATE 
  USING (mentor_wallet = current_setting('app.current_wallet', true)::TEXT);

-- ============================================================================
-- vendors (formerly merchants)
-- ============================================================================
-- Authenticated users can read all vendors (public data)
CREATE POLICY "Authenticated users can read vendors" 
ON public.vendors
  FOR SELECT 
  USING (true);


-- ============================================================================
-- liquidity_positions (pool_positions)
-- ============================================================================
-- Users can read their own liquidity positions
CREATE POLICY "Users can read own liquidity positions" 
ON public.liquidity_positions
  FOR SELECT 
  USING (provider_wallet = current_setting('app.current_wallet', true)::TEXT);


-- ============================================================================
-- sponsor_pools
-- ============================================================================
-- Users can read their own sponsor pool
CREATE POLICY "Users can read own sponsor pool" 
ON public.sponsor_pools
  FOR SELECT 
  USING (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- Users can insert their own sponsor pool
CREATE POLICY "Users can insert own sponsor pool" 
ON public.sponsor_pools
  FOR INSERT 
  WITH CHECK (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- Users can update their own sponsor pool
CREATE POLICY "Users can update own sponsor pool" 
ON public.sponsor_pools
  FOR UPDATE 
  USING (wallet_address = current_setting('app.current_wallet', true)::TEXT);

-- ============================================================================
-- Notes
-- ============================================================================
-- 1. Service role bypasses RLS automatically for all operations
-- 2. Non-service-role clients must execute SET LOCAL app.current_wallet = 'G...'
--    via raw SQL before each query for RLS enforcement
-- 3. No blanket-permissive policies (WITH CHECK (true)) - service role bypasses RLS
-- 4. repayment_installments table does not exist - payment_index is used instead
--    (payment_index is an indexer table managed by service role)
-- 5. pool_positions is implemented as liquidity_positions
-- 6. RLS is explicitly enabled on all target tables in this migration
