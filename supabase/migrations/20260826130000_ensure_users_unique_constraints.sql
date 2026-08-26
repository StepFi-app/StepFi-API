-- Ensure DB-level UNIQUE indexes exist on users.wallet_address and users.username

-- Keep the oldest row in each duplicate group before adding the constraints.
WITH duplicate_wallets AS (
	SELECT id,
		   ROW_NUMBER() OVER (
			   PARTITION BY wallet_address
			   ORDER BY created_at ASC, id ASC
		   ) AS row_number
	FROM public.users
	WHERE wallet_address IS NOT NULL
), rows_to_delete AS (
	SELECT id
	FROM duplicate_wallets
	WHERE row_number > 1
)
DELETE FROM public.users
WHERE id IN (SELECT id FROM rows_to_delete);

WITH duplicate_usernames AS (
	SELECT id,
		   ROW_NUMBER() OVER (
			   PARTITION BY username
			   ORDER BY created_at ASC, id ASC
		   ) AS row_number
	FROM public.users
	WHERE username IS NOT NULL
), rows_to_delete AS (
	SELECT id
	FROM duplicate_usernames
	WHERE row_number > 1
)
DELETE FROM public.users
WHERE id IN (SELECT id FROM rows_to_delete);

CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_address_idx ON public.users (wallet_address);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
