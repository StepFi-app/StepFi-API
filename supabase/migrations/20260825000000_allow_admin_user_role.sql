-- Expand the users.role constraint so server-side admin records can exist.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('sponsor', 'vendor', 'mentor', 'admin'));

COMMENT ON COLUMN public.users.role IS
  'Permanent user role chosen once after registration: sponsor | vendor | mentor | admin. NULL = not yet chosen.';
