-- Row Level Security Policies for StepFi Tables
-- This migration adds RLS policies to ensure users can only access their own data
-- Service role bypasses RLS automatically for admin operations
--
-- This app uses wallet-based authentication. The API layer sets a Postgres session
-- variable 'app.current_wallet' before making queries. RLS policies check this variable.
--
-- To use: SET LOCAL app.current_wallet = 'G...'; before queries
-- Service role client bypasses RLS entirely for admin/indexer operations

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

-- Service role (indexer) can insert loans
CREATE POLICY "Service role can insert loans" 
ON public.loans
  FOR INSERT 
  WITH CHECK (true);

-- Service role (indexer) can update loans
CREATE POLICY "Service role can update loans" 
ON public.loans
  FOR UPDATE 
  USING (true);

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

-- Service role can insert vendors
CREATE POLICY "Service role can insert vendors" 
ON public.vendors
  FOR INSERT 
  WITH CHECK (true);

-- Service role can update vendors
CREATE POLICY "Service role can update vendors" 
ON public.vendors
  FOR UPDATE 
  USING (true);

-- Service role can delete vendors
CREATE POLICY "Service role can delete vendors" 
ON public.vendors
  FOR DELETE 
  USING (true);

-- ============================================================================
-- liquidity_positions (pool_positions)
-- ============================================================================
-- Users can read their own liquidity positions
CREATE POLICY "Users can read own liquidity positions" 
ON public.liquidity_positions
  FOR SELECT 
  USING (provider_wallet = current_setting('app.current_wallet', true)::TEXT);

-- Service role can insert liquidity positions
CREATE POLICY "Service role can insert liquidity positions" 
ON public.liquidity_positions
  FOR INSERT 
  WITH CHECK (true);

-- Service role can update liquidity positions
CREATE POLICY "Service role can update liquidity positions" 
ON public.liquidity_positions
  FOR UPDATE 
  USING (true);

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
-- 2. The API layer must SET LOCAL app.current_wallet = 'G...' before queries
--    This is done via SupabaseService.getClient() with a custom RPC or session var
-- 3. repayment_installments table does not exist - payment_index is used instead
--    (payment_index is an indexer table managed by service role)
-- 4. pool_positions is implemented as liquidity_positions
-- 5. All tables already have RLS enabled from previous migration 20260213006000
