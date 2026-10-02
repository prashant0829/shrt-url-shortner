CREATE TABLE links (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text        NOT NULL,
  original_url text        NOT NULL,
  user_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  expires_at   timestamptz,
  -- Denormalised human-click counter, maintained by the click worker.
  click_count  bigint      NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Soft delete: the code stays reserved so an old short URL can never be re-pointed elsewhere.
  deleted_at   timestamptz,
  CONSTRAINT links_code_format CHECK (code ~ '^[A-Za-z0-9_-]{3,32}$')
);

-- Redirect hot path: a single unique-index lookup by code.
CREATE UNIQUE INDEX links_code_key ON links (code);

-- "My links" listing with keyset pagination (newest first).
CREATE INDEX links_user_listing_idx ON links (user_id, id DESC) WHERE deleted_at IS NULL;
