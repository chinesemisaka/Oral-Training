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
$emptySchema = "reliability_empty_$suffix"
$historySchema = "reliability_history_$suffix"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migrations = Join-Path $repositoryRoot 'backend\migrations'
$fixture = Join-Path $PSScriptRoot 'fixtures\reliability_history.sql'
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

try {
  & $PsqlPath $DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "CREATE SCHEMA $emptySchema; CREATE SCHEMA $historySchema;"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create disposable schemas.' }

  foreach ($schema in @($emptySchema, $historySchema)) {
    Invoke-Psql $schema (Join-Path $migrations '001_initial.sql') ''
    Invoke-Psql $schema (Join-Path $migrations '002_roleplay.sql') ''
  }

  Invoke-Psql $emptySchema (Join-Path $migrations '003_reliability.sql') ''
  Invoke-Psql $emptySchema (Join-Path $migrations '004_identity.sql') ''
  Invoke-Psql $emptySchema '' @'
DO $$ BEGIN
  IF to_regclass('message_repair_archive') IS NULL OR to_regclass('ai_jobs') IS NULL OR
     to_regclass('users') IS NULL OR to_regclass('auth_sessions') IS NULL THEN
    RAISE EXCEPTION 'empty database migration did not create required tables';
  END IF;
END $$;
'@

  Invoke-Psql $historySchema $fixture ''
  Invoke-Psql $historySchema (Join-Path $migrations '003_reliability.sql') ''
  Invoke-Psql $historySchema (Join-Path $migrations '004_identity.sql') ''
  Invoke-Psql $historySchema '' @'
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM message_repair_archive) <> 4 THEN
    RAISE EXCEPTION 'expected four archived duplicate rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM messages WHERE id = 'input-earliest') OR
     NOT EXISTS (SELECT 1 FROM messages WHERE id = 'reply-latest') OR
     EXISTS (SELECT 1 FROM messages WHERE id IN ('input-later', 'reply-earlier')) THEN
    RAISE EXCEPTION 'training duplicate repair kept the wrong rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roleplay_messages WHERE id = 'rp-input-earliest') OR
     NOT EXISTS (SELECT 1 FROM roleplay_messages WHERE id = 'rp-reply-latest') OR
     EXISTS (SELECT 1 FROM roleplay_messages WHERE id IN ('rp-input-later', 'rp-reply-earlier')) THEN
    RAISE EXCEPTION 'roleplay duplicate repair kept the wrong rows';
  END IF;
  IF (SELECT reply_status FROM messages WHERE id = 'input-earliest') <> 'ready' OR
     (SELECT reply_status FROM roleplay_messages WHERE id = 'rp-input-earliest') <> 'ready' THEN
    RAISE EXCEPTION 'complete rounds were not backfilled ready';
  END IF;
  IF (SELECT COUNT(*) FROM ai_jobs WHERE status = 'pending') <> 2 THEN
    RAISE EXCEPTION 'generating records were not backfilled as jobs';
  END IF;
  IF (SELECT status FROM sessions WHERE id = 'test-max-rounds') <> 'in_progress' THEN
    RAISE EXCEPTION 'max-round historical session was changed destructively';
  END IF;
END $$;
'@

  Invoke-Psql $historySchema (Join-Path $migrations '003_reliability.sql') ''
  Invoke-Psql $historySchema (Join-Path $migrations '004_identity.sql') ''
  [pscustomobject]@{ Result = 'passed'; EmptySchema = $emptySchema; HistorySchema = $historySchema } |
    ConvertTo-Json -Compress
} finally {
  $env:PGOPTIONS = $previousOptions
  if (-not $KeepSchemas) {
    & $PsqlPath $DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "DROP SCHEMA IF EXISTS $emptySchema CASCADE; DROP SCHEMA IF EXISTS $historySchema CASCADE;"
  }
}
