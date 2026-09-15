BEGIN;

ALTER TABLE roleplay_sessions
  ADD COLUMN IF NOT EXISTS service_id TEXT REFERENCES clinic_services(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_revision_id TEXT REFERENCES service_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS client_session_id TEXT,
  ADD COLUMN IF NOT EXISTS context_version INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS one_active_roleplay_session_per_scenario;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_roleplay_session_per_service
  ON roleplay_sessions(user_id, scenario_id, COALESCE(service_id, ''))
  WHERE status = 'in_progress';
CREATE UNIQUE INDEX IF NOT EXISTS roleplay_client_session_id_idx
  ON roleplay_sessions(user_id, client_session_id)
  WHERE client_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS training_contexts (
  id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('training', 'roleplay')),
  session_id TEXT NOT NULL,
  context_version INTEGER NOT NULL DEFAULT 2,
  service_id TEXT NOT NULL REFERENCES clinic_services(id) ON DELETE RESTRICT,
  service_revision_id TEXT NOT NULL REFERENCES service_revisions(id) ON DELETE RESTRICT,
  knowledge_as_of TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manifest JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(manifest) = 'array'),
  manifest_hash TEXT NOT NULL,
  training_scope TEXT NOT NULL DEFAULT 'demo' CHECK (training_scope IN ('demo', 'verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_type, session_id)
);

CREATE TABLE IF NOT EXISTS rag_traces (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES training_contexts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  round SMALLINT,
  attempt_token TEXT,
  query TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  model_version TEXT,
  latency_ms INTEGER,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rag_traces_context_idx
  ON rag_traces(context_id, created_at DESC);

ALTER TABLE roleplay_messages
  ADD COLUMN IF NOT EXISTS answer_status TEXT
    CHECK (answer_status IS NULL OR answer_status IN ('answered', 'partial', 'unknown', 'conflicted')),
  ADD COLUMN IF NOT EXISTS citations JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(citations) = 'array'),
  ADD COLUMN IF NOT EXISTS trace_id TEXT REFERENCES rag_traces(id) ON DELETE RESTRICT;

COMMIT;
