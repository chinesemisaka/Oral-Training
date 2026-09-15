#include "knowledge_admin_queue.h"

#include "knowledge_store.h"

#include <windows.h>
#include <bcrypt.h>

#include <array>
#include <chrono>
#include <iomanip>
#include <optional>
#include <sstream>

namespace oral_training::knowledge {
namespace {

constexpr int kLeaseSeconds = 180;

std::string randomId(const std::string& prefix) {
  std::array<unsigned char, 12> bytes{};
  if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                      BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
    throw std::runtime_error("secure random generation failed");
  }
  std::ostringstream output;
  output << prefix << '-';
  for (const auto value : bytes) {
    output << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(value);
  }
  return output.str();
}

void requireAdmin(pqxx::transaction_base& tx, const std::string& actor_id) {
  const auto rows = tx.exec_params(
      "SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND status = 'active'", actor_id);
  if (rows.empty()) throw KnowledgeStoreError(403, "ROLE_FORBIDDEN", "仅管理员可管理生成任务");
}

json parseJsonField(const pqxx::field& field) {
  return field.is_null() ? json(nullptr) : json::parse(field.c_str());
}

json jobJson(const pqxx::row& row) {
  json result = {
      {"jobId", row["id"].c_str()}, {"kind", row["kind"].c_str()},
      {"draftId", row["draft_id"].c_str()}, {"generation", row["generation"].as<int>()},
      {"baseDraftVersion", row["base_draft_version"].as<int>()},
      {"status", row["status"].c_str()}, {"attempts", row["attempts"].as<int>()},
      {"maxAttempts", row["max_attempts"].as<int>()},
      {"promptVersion", row["prompt_version"].c_str()},
      {"modelVersion", row["model_version"].is_null()
          ? json(nullptr) : json(row["model_version"].c_str())},
      {"result", parseJsonField(row["result"])},
      {"resultApplied", row["result_applied"].is_null()
          ? json(nullptr) : json(row["result_applied"].as<bool>())},
      {"errorType", row["error_type"].is_null()
          ? json(nullptr) : json(row["error_type"].c_str())},
      {"errorMessage", row["error_message"].is_null()
          ? json(nullptr) : json(row["error_message"].c_str())},
      {"createdAt", row["created_at"].c_str()}, {"updatedAt", row["updated_at"].c_str()},
      {"finishedAt", row["finished_at"].is_null()
          ? json(nullptr) : json(row["finished_at"].c_str())},
  };
  return result;
}

pqxx::result selectJob(pqxx::transaction_base& tx, const std::string& job_id) {
  return tx.exec_params(R"(
    SELECT id, kind, draft_id, generation, base_draft_version, status, attempts, max_attempts,
      prompt_version, model_version, result, result_applied, error_type, error_message,
      created_at, updated_at, finished_at
    FROM knowledge_admin_jobs WHERE id = $1
  )", job_id);
}

void writeAudit(pqxx::transaction_base& tx, const std::string& actor_id,
                const std::string& action, const std::string& job_id,
                const std::string& request_id) {
  tx.exec_params(R"(
    INSERT INTO knowledge_audit_events
      (id, actor_id, action, entity_type, entity_id, request_id)
    VALUES ($1, $2, $3, 'generation_job', $4, NULLIF($5, ''))
  )", randomId("audit"), actor_id, action, job_id, request_id);
}

}  // namespace

json KnowledgeAdminQueue::create(const std::string& actor_id, const std::string& kind,
                                 const std::string& draft_id, const json& request,
                                 const std::string& idempotency_key,
                                 const std::string& request_digest,
                                 const std::string& request_id) const {
  if (kind != "service_draft" && kind != "knowledge_draft") {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "生成任务 kind 无效");
  }
  if (draft_id.empty() || draft_id.size() > 200 || !request.is_object() ||
      idempotency_key.empty() || idempotency_key.size() > 200 || request_digest.size() != 64) {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "生成任务参数无效");
  }
  if (request.contains("count") && !request["count"].is_number_integer()) {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "生成数量必须是整数");
  }
  const auto count = request.value("count", 1);
  if (count != 1) {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "每个生成任务仅允许生成 1 份候选草稿");
  }
  if (request.contains("brief") && !request["brief"].is_string()) {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "生成说明必须是字符串");
  }
  const auto brief = request.value("brief", std::string());
  if (brief.size() > 2000) {
    throw KnowledgeStoreError(400, "INVALID_ARGUMENT", "生成说明最长 2000 个字符");
  }

  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  requireAdmin(tx, actor_id);
  const auto replay = tx.exec_params(R"(
    SELECT id, kind, draft_id, request_digest FROM knowledge_admin_jobs
    WHERE created_by = $1 AND idempotency_key = $2
  )", actor_id, idempotency_key);
  if (!replay.empty()) {
    if (std::string(replay[0]["kind"].c_str()) != kind ||
        std::string(replay[0]["draft_id"].c_str()) != draft_id ||
        std::string(replay[0]["request_digest"].c_str()) != request_digest) {
      throw KnowledgeStoreError(409, "IDEMPOTENCY_CONFLICT", "幂等键对应不同生成请求");
    }
    return jobJson(selectJob(tx, replay[0]["id"].c_str())[0]);
  }

  pqxx::result draft_rows;
  json model_input = request;
  if (kind == "service_draft") {
    draft_rows = tx.exec_params(
        "SELECT id, draft_version, payload FROM service_drafts WHERE id = $1 FOR UPDATE", draft_id);
    if (draft_rows.empty()) throw KnowledgeStoreError(404, "SERVICE_NOT_FOUND", "服务草稿不存在");
    model_input["currentDraft"] = parseJsonField(draft_rows[0]["payload"]);
  } else {
    draft_rows = tx.exec_params(R"(
      SELECT d.id, d.draft_version, d.title, d.body, d.metadata, e.topic, e.scope
      FROM knowledge_drafts d JOIN knowledge_entries e ON e.id = d.entry_id
      WHERE d.id = $1 FOR UPDATE OF d
    )", draft_id);
    if (draft_rows.empty()) throw KnowledgeStoreError(404, "KNOWLEDGE_NOT_FOUND", "知识草稿不存在");
    model_input["currentDraft"] = {
        {"title", draft_rows[0]["title"].c_str()}, {"body", draft_rows[0]["body"].c_str()},
        {"metadata", parseJsonField(draft_rows[0]["metadata"])},
        {"topic", draft_rows[0]["topic"].c_str()}, {"scope", draft_rows[0]["scope"].c_str()},
    };
  }
  model_input["contentPolicy"] = "synthetic_unverified_only";
  const auto base_version = draft_rows[0]["draft_version"].as<int>();
  const auto job_id = randomId("knowledge-job");
  tx.exec_params(R"(
    INSERT INTO knowledge_admin_jobs
      (id, kind, draft_id, base_draft_version, idempotency_key, request_digest, request,
       prompt_version, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
  )", job_id, kind, draft_id, base_version, idempotency_key, request_digest,
      model_input.dump(), kind == "service_draft" ? "service-draft-v1" : "knowledge-draft-v1",
      actor_id);
  if (kind == "service_draft") {
    tx.exec_params("UPDATE service_drafts SET generation_id = $2 WHERE id = $1", draft_id, job_id);
  } else {
    tx.exec_params("UPDATE knowledge_drafts SET generation_id = $2 WHERE id = $1", draft_id, job_id);
  }
  writeAudit(tx, actor_id, "generation_requested", job_id, request_id);
  const auto result = jobJson(selectJob(tx, job_id)[0]);
  tx.commit();
  return result;
}

json KnowledgeAdminQueue::get(const std::string& actor_id, const std::string& job_id) const {
  auto connection = database_pool_->acquire();
  pqxx::read_transaction tx(connection.get());
  requireAdmin(tx, actor_id);
  const auto rows = selectJob(tx, job_id);
  if (rows.empty()) throw KnowledgeStoreError(404, "GENERATION_JOB_NOT_FOUND", "生成任务不存在");
  return jobJson(rows[0]);
}

json KnowledgeAdminQueue::retry(const std::string& actor_id, const std::string& job_id,
                                const std::string& request_id) const {
  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  requireAdmin(tx, actor_id);
  const auto rows = tx.exec_params(R"(
    SELECT id, kind, draft_id, generation, status, request
    FROM knowledge_admin_jobs WHERE id = $1 FOR UPDATE
  )", job_id);
  if (rows.empty()) throw KnowledgeStoreError(404, "GENERATION_JOB_NOT_FOUND", "生成任务不存在");
  if (std::string(rows[0]["kind"].c_str()) != "service_draft" &&
      std::string(rows[0]["kind"].c_str()) != "knowledge_draft") {
    throw KnowledgeStoreError(409, "GENERATION_JOB_STATE_CONFLICT", "生成任务类型无效");
  }
  if (std::string(rows[0]["status"].c_str()) != "dead") {
    throw KnowledgeStoreError(409, "GENERATION_JOB_STATE_CONFLICT", "仅失败任务可以重试");
  }
  if (rows[0]["generation"].as<int>() >= 100) {
    throw KnowledgeStoreError(409, "GENERATION_EXHAUSTED", "生成任务已达到重试上限");
  }
  const auto kind = std::string(rows[0]["kind"].c_str());
  const auto draft_id = std::string(rows[0]["draft_id"].c_str());
  pqxx::result draft;
  auto updated_request = parseJsonField(rows[0]["request"]);
  if (kind == "service_draft") {
    draft = tx.exec_params(
        "SELECT draft_version, payload FROM service_drafts WHERE id = $1 FOR UPDATE", draft_id);
    if (!draft.empty()) updated_request["currentDraft"] = parseJsonField(draft[0]["payload"]);
  } else {
    draft = tx.exec_params(R"(
      SELECT d.draft_version, d.title, d.body, d.metadata, e.topic, e.scope
      FROM knowledge_drafts d JOIN knowledge_entries e ON e.id = d.entry_id
      WHERE d.id = $1 FOR UPDATE OF d
    )", draft_id);
    if (!draft.empty()) {
      updated_request["currentDraft"] = {
          {"title", draft[0]["title"].c_str()}, {"body", draft[0]["body"].c_str()},
          {"metadata", parseJsonField(draft[0]["metadata"])},
          {"topic", draft[0]["topic"].c_str()}, {"scope", draft[0]["scope"].c_str()},
      };
    }
  }
  if (draft.empty()) throw KnowledgeStoreError(404, "DRAFT_NOT_FOUND", "目标草稿不存在");
  tx.exec_params(R"(
    UPDATE knowledge_admin_jobs SET generation = generation + 1,
      base_draft_version = $2, status = 'pending', lease_until = NULL, worker_id = NULL,
      attempt_token = NULL, attempts = 0, available_at = NOW(), result = NULL,
      result_applied = NULL, model_version = NULL, error_type = NULL, error_message = NULL,
      request = $3::jsonb, updated_at = NOW(), finished_at = NULL WHERE id = $1
  )", job_id, draft[0]["draft_version"].as<int>(), updated_request.dump());
  if (kind == "service_draft") {
    tx.exec_params("UPDATE service_drafts SET generation_id = $2 WHERE id = $1", draft_id, job_id);
  } else {
    tx.exec_params("UPDATE knowledge_drafts SET generation_id = $2 WHERE id = $1", draft_id, job_id);
  }
  writeAudit(tx, actor_id, "generation_retried", job_id, request_id);
  const auto result = jobJson(selectJob(tx, job_id)[0]);
  tx.commit();
  return result;
}

json KnowledgeAdminQueue::stats() const {
  auto connection = database_pool_->acquire();
  pqxx::read_transaction tx(connection.get());
  const auto row = tx.exec(R"(
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'retry_wait')) AS pending_jobs,
      COUNT(*) FILTER (WHERE status = 'dead') AS dead_jobs
    FROM knowledge_admin_jobs
  )")[0];
  return {{"pendingJobs", row["pending_jobs"].as<int>()},
          {"deadJobs", row["dead_jobs"].as<int>()}};
}

std::optional<KnowledgeAdminJob> KnowledgeAdminQueue::claim(
    const std::string& worker_id) const {
  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  tx.exec(R"(
    UPDATE knowledge_admin_jobs SET status = 'dead', lease_until = NULL,
      worker_id = NULL, attempt_token = NULL, error_type = 'LEASE_EXHAUSTED',
      error_message = '生成任务租约失效且已达到最大尝试次数',
      updated_at = NOW(), finished_at = NOW()
    WHERE status = 'running' AND lease_until <= NOW() AND attempts >= max_attempts
  )");
  const auto attempt_token = randomId("attempt");
  const auto rows = tx.exec_params(R"(
    WITH candidate AS (
      SELECT id FROM knowledge_admin_jobs
      WHERE ((status IN ('pending', 'retry_wait') AND available_at <= NOW()) OR
             (status = 'running' AND lease_until <= NOW() AND attempts < max_attempts))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE knowledge_admin_jobs j SET status = 'running', worker_id = $1,
      attempt_token = $2, attempts = attempts + 1,
      lease_until = NOW() + make_interval(secs => $3), updated_at = NOW()
    FROM candidate WHERE j.id = candidate.id
    RETURNING j.id, j.kind, j.draft_id, j.generation, j.base_draft_version,
      j.attempts, j.max_attempts, j.attempt_token, j.request
  )", worker_id, attempt_token, kLeaseSeconds);
  tx.commit();
  if (rows.empty()) return std::nullopt;
  return KnowledgeAdminJob{
      rows[0]["id"].c_str(), rows[0]["kind"].c_str(), rows[0]["draft_id"].c_str(),
      rows[0]["generation"].as<int>(), rows[0]["base_draft_version"].as<int>(),
      rows[0]["attempts"].as<int>(), rows[0]["max_attempts"].as<int>(),
      rows[0]["attempt_token"].c_str(), parseJsonField(rows[0]["request"])};
}

bool KnowledgeAdminQueue::renewLease(const KnowledgeAdminJob& job) const {
  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  const auto rows = tx.exec_params(R"(
    UPDATE knowledge_admin_jobs SET lease_until = NOW() + make_interval(secs => $4),
      updated_at = NOW() WHERE id = $1 AND generation = $2 AND attempt_token = $3
      AND status = 'running' AND lease_until > NOW() RETURNING 1
  )", job.id, job.generation, job.attempt_token, kLeaseSeconds);
  tx.commit();
  return !rows.empty();
}

bool KnowledgeAdminQueue::succeed(const KnowledgeAdminJob& job, const json& candidate,
                                  const std::string& model_version) const {
  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  const auto active = tx.exec_params(R"(
    SELECT created_by FROM knowledge_admin_jobs WHERE id = $1 AND generation = $2
      AND attempt_token = $3 AND status = 'running' AND lease_until > NOW() FOR UPDATE
  )", job.id, job.generation, job.attempt_token);
  if (active.empty()) return false;

  pqxx::result applied;
  if (job.kind == "service_draft") {
    applied = tx.exec_params(R"(
      UPDATE service_drafts SET payload = $4::jsonb, draft_version = draft_version + 1,
        generation_id = NULL, updated_by = $5, updated_at = NOW()
      WHERE id = $1 AND generation_id = $2 AND draft_version = $3
      RETURNING service_id, draft_version
    )", job.draft_id, job.id, job.base_draft_version, candidate.dump(),
        active[0]["created_by"].c_str());
    if (!applied.empty()) {
      tx.exec_params(R"(
        UPDATE clinic_services SET name = $2, category = $3, updated_at = NOW()
        WHERE id = $1
      )", applied[0]["service_id"].c_str(), candidate["name"].get<std::string>(),
          candidate["category"].get<std::string>());
    }
  } else {
    applied = tx.exec_params(R"(
      UPDATE knowledge_drafts SET title = $4, body = $5, metadata = $6::jsonb,
        draft_version = draft_version + 1, generation_id = NULL,
        updated_by = $7, updated_at = NOW()
      WHERE id = $1 AND generation_id = $2 AND draft_version = $3
      RETURNING draft_version
    )", job.draft_id, job.id, job.base_draft_version,
        candidate["title"].get<std::string>(), candidate["body"].get<std::string>(),
        candidate["metadata"].dump(), active[0]["created_by"].c_str());
  }
  json stored_result = {{"candidate", candidate}, {"applied", !applied.empty()}};
  if (!applied.empty()) stored_result["draftVersion"] = applied[0]["draft_version"].as<int>();
  tx.exec_params(R"(
    UPDATE knowledge_admin_jobs SET status = 'succeeded', result = $4::jsonb,
      result_applied = $5, model_version = $6, lease_until = NULL, worker_id = NULL,
      attempt_token = NULL,
      error_type = NULL, error_message = NULL, updated_at = NOW(), finished_at = NOW()
    WHERE id = $1 AND generation = $2 AND attempt_token = $3
  )", job.id, job.generation, job.attempt_token, stored_result.dump(), !applied.empty(),
      model_version);
  tx.commit();
  return true;
}

void KnowledgeAdminQueue::fail(const KnowledgeAdminJob& job,
                               const std::string& error_type,
                               const std::string& message, bool retryable) const {
  auto connection = database_pool_->acquire();
  pqxx::work tx(connection.get());
  const bool retry_wait = retryable && job.attempt < job.max_attempts;
  tx.exec_params(R"(
    UPDATE knowledge_admin_jobs SET status = $4, lease_until = NULL, worker_id = NULL,
      attempt_token = NULL, available_at = CASE WHEN $5 THEN NOW() +
        make_interval(secs => LEAST(30, attempts * attempts)) ELSE available_at END,
      error_type = $6, error_message = $7, updated_at = NOW(),
      finished_at = CASE WHEN $5 THEN NULL ELSE NOW() END
    WHERE id = $1 AND generation = $2 AND attempt_token = $3 AND status = 'running'
  )", job.id, job.generation, job.attempt_token, retry_wait ? "retry_wait" : "dead",
      retry_wait, error_type, message.substr(0, 1000));
  tx.commit();
}

}  // namespace oral_training::knowledge
