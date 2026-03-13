-- Dewey: PostgreSQL schema for users and user_settings.
-- Run once (e.g. psql $DATABASE_URL -f scripts/schema.sql).

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_provider TEXT NOT NULL DEFAULT 'dewey',
  username TEXT,
  password_hash TEXT,
  provider_id TEXT,
  email TEXT,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_dewey_username ON users (LOWER(username)) WHERE auth_provider = 'dewey' AND username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users (auth_provider, provider_id) WHERE provider_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  ollama_url TEXT,
  rag_server_url TEXT,
  rag_threshold DOUBLE PRECISION,
  rag_collections JSONB,
  model TEXT,
  theme TEXT,
  panel_state TEXT,
  chat_font_size INTEGER,
  user_preferred_name TEXT,
  user_school_or_office TEXT,
  user_role TEXT,
  user_context TEXT,
  is_system_admin BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
