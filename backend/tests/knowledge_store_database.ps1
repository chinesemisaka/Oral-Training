param(
  [Parameter(Mandatory = $true)] [string]$DatabaseUrl,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$ExecutablePath = '',
  [switch]$KeepSchema
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PsqlPath)) { throw "psql not found: $PsqlPath" }

$databaseName = ([Uri]$DatabaseUrl).AbsolutePath.Trim('/')
if ($databaseName -notmatch '(?i)(test|ci)') {
  throw "Refusing to alter database '$databaseName'. Use a disposable database whose name contains test or ci."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $ExecutablePath) {
  $ExecutablePath = Join-Path $repositoryRoot 'backend\build-msvc\Release\knowledge_store_database_test.exe'
}
if (-not (Test-Path -LiteralPath $ExecutablePath)) {
  throw "knowledge store database test executable not found: $ExecutablePath"
}

$schema = 'knowledge_store_' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$migrations = Join-Path $repositoryRoot 'backend\migrations'
$previousOptions = $env:PGOPTIONS
$previousTestUrl = $env:ORAL_TRAINING_TEST_DATABASE_URL

try {
  & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "CREATE SCHEMA $schema;"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create disposable schema.' }
  $env:PGOPTIONS = "-c search_path=$schema"
  foreach ($migration in @(
    '001_initial.sql', '002_roleplay.sql', '003_reliability.sql', '004_identity.sql',
    '005_pair_and_state_repair.sql', '006_learner_insights.sql',
    '007_training_experience.sql', '008_supervisor_growth.sql',
    '009_legacy_report_totals.sql', '010_knowledge_catalog.sql', '011_roleplay_rag_mvp.sql'
  )) {
    & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -f (Join-Path $migrations $migration)
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migration" }
  }

  $env:ORAL_TRAINING_TEST_DATABASE_URL = $DatabaseUrl
  & $ExecutablePath
  if ($LASTEXITCODE -ne 0) { throw 'Knowledge store database test failed.' }
} finally {
  $env:PGOPTIONS = $previousOptions
  $env:ORAL_TRAINING_TEST_DATABASE_URL = $previousTestUrl
  if (-not $KeepSchema) {
    & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
  }
}
