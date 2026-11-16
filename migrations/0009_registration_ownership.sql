-- Additive onboarding and ownership metadata. Existing user/auth rows are preserved.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Accounts already waiting for a platform owner remain pending after migration.
UPDATE profiles
SET approval_status = 'pending'
WHERE role = 'pending' AND approval_status = 'approved';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES profiles(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_approval_status_created_idx
  ON profiles (approval_status, created_at);

CREATE INDEX IF NOT EXISTS companies_owner_user_id_idx
  ON companies (owner_user_id);

CREATE TABLE IF NOT EXISTS company_ownership_transfers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_owner_user_id TEXT,
  to_email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS company_one_pending_ownership_transfer_idx
  ON company_ownership_transfers (company_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS company_ownership_transfer_email_idx
  ON company_ownership_transfers (lower(to_email), status);
