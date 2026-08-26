-- Ensure DB-level UNIQUE indexes exist on users.wallet_address and users.username

CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_address_idx ON public.users (wallet_address);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
