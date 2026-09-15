#pragma once

#include "database_pool.h"

#include <nlohmann/json.hpp>

#include <memory>
#include <optional>
#include <string>

namespace oral_training::knowledge {

using json = nlohmann::json;

struct KnowledgeAdminJob {
  std::string id;
  std::string kind;
  std::string draft_id;
  int generation = 0;
  int base_draft_version = 0;
  int attempt = 0;
  int max_attempts = 0;
  std::string attempt_token;
  json request;
};

class KnowledgeAdminQueue {
 public:
  explicit KnowledgeAdminQueue(std::shared_ptr<DatabasePool> database_pool)
      : database_pool_(std::move(database_pool)) {}

  json create(const std::string& actor_id, const std::string& kind,
              const std::string& draft_id, const json& request,
              const std::string& idempotency_key,
              const std::string& request_digest,
              const std::string& request_id) const;
  json get(const std::string& actor_id, const std::string& job_id) const;
  json retry(const std::string& actor_id, const std::string& job_id,
             const std::string& request_id) const;
  json stats() const;

  std::optional<KnowledgeAdminJob> claim(const std::string& worker_id) const;
  bool renewLease(const KnowledgeAdminJob& job) const;
  bool succeed(const KnowledgeAdminJob& job, const json& candidate,
               const std::string& model_version) const;
  void fail(const KnowledgeAdminJob& job, const std::string& error_type,
            const std::string& message, bool retryable) const;

 private:
  std::shared_ptr<DatabasePool> database_pool_;
};

}  // namespace oral_training::knowledge
