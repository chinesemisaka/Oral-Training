param(
  [string]$BaseUrl = 'http://127.0.0.1:8080/api',
  [switch]$WithModel
)

$ErrorActionPreference = 'Stop'

function Invoke-Api {
  param(
    [ValidateSet('GET', 'POST')] [string]$Method,
    [string]$Path,
    [object]$Body
  )

  $args = @{ Method = $Method; Uri = "$BaseUrl$Path"; TimeoutSec = 45 }
  if ($null -ne $Body) {
    $args.ContentType = 'application/json'
    $args.Body = $Body | ConvertTo-Json -Compress -Depth 8
  }
  $response = Invoke-RestMethod @args
  if ($response.code -ne 0) { throw "API failed: $($response.code) $($response.message)" }
  return $response.data
}

$health = Invoke-Api GET '/health' $null
if (-not $health.database) { throw 'Database health check failed.' }

$scenarioData = Invoke-Api GET '/scenarios' $null
if ($scenarioData.items.Count -ne 4) { throw "Expected 4 scenarios, got $($scenarioData.items.Count)." }
if ($scenarioData.items[0].PSObject.Properties.Name -contains 'hidden') { throw 'Scenario API leaked hidden configuration.' }
$dashboard = Invoke-Api GET '/dashboard/summary' $null
if ($null -eq $dashboard.scenarioStats -or $dashboard.scenarioStats.Count -ne 4) { throw 'Dashboard scenario statistics are invalid.' }
if ($null -eq $dashboard.dimensionAverages) { throw 'Dashboard dimension averages are missing.' }

if (-not $WithModel) {
  [pscustomobject]@{
    Result = 'passed'
    Database = $health.database
    ModelConfigured = $health.modelConfigured
    ScenarioCount = $scenarioData.items.Count
    ModelTest = 'skipped'
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not $health.modelConfigured) { throw 'DEEPSEEK_API_KEY is not configured in the backend process.' }
$scenario = $scenarioData.items | Where-Object { $null -eq $_.activeSession } | Select-Object -First 1
if ($null -eq $scenario) { throw 'No idle scenario is available. Finish or restart an active session before model smoke testing.' }

$created = Invoke-Api POST '/sessions' @{ scenarioId = $scenario.id }
$sessionId = $created.session.id
$message = Invoke-Api POST "/sessions/$sessionId/messages" @{
  clientMessageId = "smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  content = 'I understand your concern. Which matters most to you: pain, time, or cost?'
}
if ([string]::IsNullOrWhiteSpace($message.patientMessage.content)) { throw 'Patient model returned an empty reply.' }

$null = Invoke-Api POST "/sessions/$sessionId/finish" @{ reason = 'manual' }
$evaluation = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 2
  $evaluation = Invoke-Api GET "/sessions/$sessionId/evaluation" $null
  if ($evaluation.status -eq 'ready') { break }
  if ($evaluation.status -eq 'failed') { throw 'Evaluation generation failed.' }
}
if ($null -eq $evaluation -or $evaluation.status -ne 'ready') { throw 'Evaluation did not become ready within 40 seconds.' }
if (@($evaluation.evaluation.dimensionScores.PSObject.Properties).Count -ne 5) { throw 'Evaluation does not contain five dimensions.' }

[pscustomobject]@{
  Result = 'passed'
  Database = $health.database
  ScenarioCount = $scenarioData.items.Count
  SessionId = $sessionId
  PatientReplyLength = $message.patientMessage.content.Length
  TotalScore = $evaluation.evaluation.totalScore
  ModelTest = 'passed'
} | ConvertTo-Json -Compress
