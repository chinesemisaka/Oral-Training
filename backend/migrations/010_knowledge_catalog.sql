BEGIN;

CREATE TABLE IF NOT EXISTS clinic_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  category TEXT NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_revision_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_drafts (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL UNIQUE REFERENCES clinic_services(id) ON DELETE CASCADE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  generation_id TEXT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_revisions (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES clinic_services(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
  origin TEXT NOT NULL CHECK (origin IN ('synthetic', 'manual', 'reference')),
  published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_id, version)
);

CREATE TABLE IF NOT EXISTS service_scenarios (
  service_id TEXT NOT NULL REFERENCES clinic_services(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  PRIMARY KEY(service_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 120),
  scope TEXT NOT NULL CHECK (scope IN ('general', 'service')),
  service_id TEXT REFERENCES clinic_services(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_revision_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((scope = 'general' AND service_id IS NULL) OR
         (scope = 'service' AND service_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS knowledge_drafts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  generation_id TEXT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
  published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entry_id, version)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 800),
  section TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  search_vector TSVECTOR NOT NULL DEFAULT ''::tsvector,
  tokenizer_version TEXT NOT NULL,
  source_start INTEGER CHECK (source_start IS NULL OR source_start >= 0),
  source_end INTEGER CHECK (source_end IS NULL OR source_end >= source_start),
  UNIQUE(revision_id, ordinal)
);

CREATE TABLE IF NOT EXISTS knowledge_admin_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('service_draft', 'knowledge_draft')),
  draft_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 100),
  base_draft_version INTEGER NOT NULL CHECK (base_draft_version > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'retry_wait', 'succeeded', 'dead')),
  lease_until TIMESTAMPTZ,
  worker_id TEXT,
  attempt_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (char_length(request_digest) = 64),
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  prompt_version TEXT NOT NULL,
  model_version TEXT,
  result JSONB,
  result_applied BOOLEAN,
  error_type TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE(created_by, idempotency_key)
);

CREATE TABLE IF NOT EXISTS knowledge_publish_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('service', 'knowledge')),
  entity_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (char_length(request_digest) = 64),
  result_revision_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS knowledge_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'service_created', 'service_draft_saved', 'service_published', 'service_archived',
    'knowledge_created', 'knowledge_draft_saved', 'knowledge_published', 'knowledge_archived',
    'generation_requested', 'generation_retried'
  )),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('service', 'knowledge', 'generation_job')),
  entity_id TEXT NOT NULL,
  old_revision_id TEXT,
  new_revision_id TEXT,
  request_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_services_current_revision_fkey') THEN
    ALTER TABLE clinic_services ADD CONSTRAINT clinic_services_current_revision_fkey
      FOREIGN KEY (current_revision_id) REFERENCES service_revisions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_current_revision_fkey') THEN
    ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_current_revision_fkey
      FOREIGN KEY (current_revision_id) REFERENCES knowledge_revisions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clinic_services_status_idx
  ON clinic_services(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS service_revisions_service_idx
  ON service_revisions(service_id, version DESC);
CREATE INDEX IF NOT EXISTS knowledge_entries_scope_idx
  ON knowledge_entries(status, scope, service_id, topic);
CREATE INDEX IF NOT EXISTS knowledge_revisions_entry_idx
  ON knowledge_revisions(entry_id, version DESC);
CREATE INDEX IF NOT EXISTS knowledge_chunks_revision_idx
  ON knowledge_chunks(revision_id, ordinal);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx
  ON knowledge_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS knowledge_admin_jobs_claim_idx
  ON knowledge_admin_jobs(status, available_at, created_at)
  WHERE status IN ('pending', 'retry_wait');
CREATE INDEX IF NOT EXISTS knowledge_audit_entity_idx
  ON knowledge_audit_events(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_published_content_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published revisions are immutable';
END $$;

DROP TRIGGER IF EXISTS service_revisions_immutable ON service_revisions;
CREATE TRIGGER service_revisions_immutable
BEFORE UPDATE OR DELETE ON service_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_published_content_mutation();

DROP TRIGGER IF EXISTS knowledge_revisions_immutable ON knowledge_revisions;
CREATE TRIGGER knowledge_revisions_immutable
BEFORE UPDATE OR DELETE ON knowledge_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_published_content_mutation();

COMMIT;
