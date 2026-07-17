-- Adds a permanent, wallet-bound role to users.
-- role starts NULL ("not yet chosen"). Once set, application code never
-- allows changing it (enforced in UsersService.setRole via a conflict check).
ALTER TABLE public.users
  ADD COLUMN role TEXT
  CHECK (role IN ('sponsor', 'vendor', 'mentor'));

COMMENT ON COLUMN public.users.role IS
  'Permanent user role chosen once after registration: sponsor | vendor | mentor. NULL = not yet chosen.';
