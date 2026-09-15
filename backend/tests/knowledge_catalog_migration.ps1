param(
  [Parameter(Mandatory = $true)] [string]$DatabaseUrl,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [switch]$KeepSchemas
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PsqlPath)) { throw "psql not found: $PsqlPath" }

$databaseName = ([Uri]$DatabaseUrl).AbsolutePath.Trim('/')
if ($databaseName -notmatch '(?i)(test|ci)') {
  throw "Refusing to alter database '$databaseName'. Use a disposable database whose name contains test or ci."
}

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$emptySchema = "knowledge_empty_$suffix"
$historySchema = "knowledge_history_$suffix"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migrations = Join-Path $repositoryRoot 'backend\migrations'
$previousOptions = $env:PGOPTIONS

function Invoke-Psql {
  param([string]$Schema, [string]$File, [string]$Command)
  $env:PGOPTIONS = "-c search_path=$Schema"
  $arguments = @($DatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q')
  if ($File) { $arguments += @('-f', $File) }
  if ($Command) { $arguments += @('-c', $Command) }
  & $PsqlPath @arguments
  if ($LASTEXITCODE -ne 0) { throw "psql failed for schema $Schema" }
}

function Invoke-CoreMigrations {
  param([string]$Schema)
  foreach ($migration in @(
    '001_initial.sql', '002_roleplay.sql', '003_reliability.sql', '004_identity.sql',
    '005_pair_and_state_repair.sql', '006_learner_insights.sql',
    '007_training_experience.sql', '008_supervisor_growth.sql', '009_legacy_report_totals.sql'
  )) {
    Invoke-Psql $Schema (Join-Path $migrations $migration) ''
  }
}

try {
  & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "CREATE SCHEMA $emptySchema; CREATE SCHEMA $historySchema;"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create disposable schemas.' }

  Invoke-CoreMigrations $emptySchema
  Invoke-Psql $emptySchema (Join-Path $migrations '010_knowledge_catalog.sql') ''
  Invoke-Psql $emptySchema '' @'
DO $$ BEGIN
  IF to_regclass('clinic_services') IS NULL OR to_regclass('service_drafts') IS NULL OR
     to_regclass('service_revisions') IS NULL OR to_regclass('service_scenarios') IS NULL OR
     to_regclass('knowledge_entries') IS NULL OR to_regclass('knowledge_drafts') IS NULL OR
     to_regclass('knowledge_revisions') IS NULL OR to_regclass('knowledge_chunks') IS NULL OR
     to_regclass('knowledge_admin_jobs') IS NULL OR
     to_regclass('knowledge_publish_requests') IS NULL OR
     to_regclass('knowledge_audit_events') IS NULL THEN
    RAISE EXCEPTION 'knowledge catalog migration did not create all tables';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'knowledge_admin_jobs'
        AND column_name IN ('base_draft_version', 'attempt_token', 'request',
                            'prompt_version', 'model_version', 'result_applied')) <> 6 THEN
    RAISE EXCEPTION 'knowledge admin job reliability columns are incomplete';
  END IF;
END $$;
'@

  Invoke-CoreMigrations $historySchema
  Invoke-Psql $historySchema '' @'
INSERT INTO sessions(id,user_id,scenario_id,scenario_name,status,current_round,max_rounds,patient_state)
VALUES ('knowledge-history-session','demo-user-001','implant-basic','History training','in_progress',1,10,'{}');
INSERT INTO messages(id,session_id,role,content,round)
VALUES ('knowledge-history-message','knowledge-history-session','user','History message must remain',1);
'@
  Invoke-Psql $historySchema (Join-Path $migrations '010_knowledge_catalog.sql') ''
  Invoke-Psql $historySchema '' @'
INSERT INTO users(id,display_name,role,status,is_demo)
VALUES ('knowledge-test-admin','Knowledge Admin','admin','active',TRUE);
INSERT INTO clinic_services(id,name,category,status,created_by)
VALUES ('svc-migration','Migration service','implant','active','knowledge-test-admin');
INSERT INTO service_drafts(id,service_id,payload,draft_version,updated_by)
VALUES ('svc-draft-migration','svc-migration','{"name":"Migration service"}',1,'knowledge-test-admin');
INSERT INTO service_revisions(id,service_id,version,payload,content_hash,origin,published_by)
VALUES ('srv-rev-migration','svc-migration',1,'{"name":"Migration service"}',repeat('a',64),'synthetic','knowledge-test-admin');
UPDATE clinic_services SET current_revision_id='srv-rev-migration' WHERE id='svc-migration';
INSERT INTO knowledge_entries(id,topic,scope,status,created_by)
VALUES ('knowledge-migration','migration-topic','general','active','knowledge-test-admin');
INSERT INTO knowledge_drafts(id,entry_id,title,body,metadata,draft_version,updated_by)
VALUES ('knowledge-draft-migration','knowledge-migration','Migration title','Migration body',
  '{"origin":"synthetic","verification":"unverified","trainingScope":"demo"}',1,'knowledge-test-admin');
INSERT INTO knowledge_revisions(id,entry_id,version,title,body,metadata,content_hash,published_by)
VALUES ('kn-rev-migration','knowledge-migration',1,'Migration title','Migration body',
  '{"origin":"synthetic","verification":"unverified","trainingScope":"demo"}',repeat('b',64),'knowledge-test-admin');
UPDATE knowledge_entries SET current_revision_id='kn-rev-migration' WHERE id='knowledge-migration';
DO $$ BEGIN
  BEGIN
    UPDATE service_revisions SET payload='{}' WHERE id='srv-rev-migration';
    RAISE EXCEPTION 'immutable service revision accepted an update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'published revisions are immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM knowledge_revisions WHERE id='kn-rev-migration';
    RAISE EXCEPTION 'immutable knowledge revision accepted a delete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'published revisions are immutable' THEN RAISE; END IF;
  END;
END $$;
'@

  foreach ($rerun in 1..2) {
    Invoke-Psql $historySchema (Join-Path $migrations '010_knowledge_catalog.sql') ''
  }
  Invoke-Psql $historySchema '' @'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM messages WHERE id='knowledge-history-message'
    AND content='History message must remain') THEN
    RAISE EXCEPTION '010 changed existing training history';
  END IF;
  IF (SELECT COUNT(*) FROM service_revisions WHERE service_id='svc-migration') <> 1 OR
     (SELECT current_revision_id FROM clinic_services WHERE id='svc-migration') <> 'srv-rev-migration' OR
     (SELECT COUNT(*) FROM knowledge_revisions WHERE entry_id='knowledge-migration') <> 1 OR
     (SELECT current_revision_id FROM knowledge_entries WHERE id='knowledge-migration') <> 'kn-rev-migration' THEN
    RAISE EXCEPTION '010 rerun changed knowledge catalog history';
  END IF;
END $$;
'@
  [pscustomobject]@{ Result = 'passed'; EmptySchema = $emptySchema; HistorySchema = $historySchema } |
    ConvertTo-Json -Compress
} finally {
  $env:PGOPTIONS = $previousOptions
  if (-not $KeepSchemas) {
    & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "DROP SCHEMA IF EXISTS $emptySchema CASCADE; DROP SCHEMA IF EXISTS $historySchema CASCADE;"
  }
}
