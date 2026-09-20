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
  $ExecutablePath = Join-Path $repositoryRoot 'backend\build-msvc\Release\patient_initialization_test.exe'
}
if (-not (Test-Path -LiteralPath $ExecutablePath)) {
  throw "knowledge store database test executable not found: $ExecutablePath"
}

$schema = 'patient_init_' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$migrations = Join-Path $repositoryRoot 'backend\migrations'
$previousOptions = $env:PGOPTIONS
$previousTestUrl = $env:ORAL_TRAINING_TEST_DATABASE_URL

try {
  & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "CREATE SCHEMA $schema;"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create disposable schema.' }
  $env:PGOPTIONS = "-c search_path=$schema"
  $migrationFiles = Get-ChildItem -LiteralPath $migrations -File -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d{3}_.+\.sql$' } | Sort-Object Name
  foreach ($migration in $migrationFiles) {
    & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -f $migration.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($migration.Name)" }
  }
  # Verify the additive migration can be rerun without rewriting existing contexts.
  & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -f (Join-Path $migrations '020_patient_initialization_jobs.sql')
  if ($LASTEXITCODE -ne 0) { throw 'N02 migration rerun failed.' }


  $env:ORAL_TRAINING_TEST_DATABASE_URL = $DatabaseUrl
  & $ExecutablePath
  if ($LASTEXITCODE -ne 0) { throw 'Patient initialization test failed.' }
} finally {
  $env:PGOPTIONS = $previousOptions
  $env:ORAL_TRAINING_TEST_DATABASE_URL = $previousTestUrl
  if (-not $KeepSchema) {
    & $PsqlPath --dbname=$DatabaseUrl -v ON_ERROR_STOP=1 -X -q -c "DROP SCHEMA IF EXISTS $schema CASCADE;"
  }
}
