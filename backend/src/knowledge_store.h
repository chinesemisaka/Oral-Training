#pragma once

#include "database_pool.h"

#include <nlohmann/json.hpp>

#include <memory>
#include <stdexcept>
#include <string>

namespace oral_training::knowledge {

using json = nlohmann::json;

class KnowledgeStoreError : public std::runtime_error {
 public:
  KnowledgeStoreError(int status, std::string code, std::string message)
      : std::runtime_error(std::move(message)), status(status), code(std::move(code)) {}

  int status;
  std::string code;
};

void validateServiceDraft(const json& payload);
void validateKnowledgeDraft(const std::string& title, const std::string& body,
                            const json& metadata);
void validateGeneratedDraft(const std::string& kind, const json& candidate);
json servicePublicProjection(const json& payload);
std::string contentSha256(const json& value);

class KnowledgeStore {
 public:
  explicit KnowledgeStore(std::shared_ptr<DatabasePool> database_pool)
      : database_pool_(std::move(database_pool)) {}

  json listAvailableServices() const;
  json listServices(const std::string& actor_id) const;
  json createService(const std::string& actor_id, const json& payload,
                     const std::string& request_id) const;
  json getServiceDraft(const std::string& actor_id, const std::string& service_id) const;
  json saveServiceDraft(const std::string& actor_id, const std::string& service_id,
                        int draft_version, const json& payload,
                        const std::string& request_id) const;
  json publishService(const std::string& actor_id, const std::string& service_id,
                      int draft_version, const std::string& idempotency_key,
                      const std::string& request_digest, const std::string& request_id) const;
  json archiveService(const std::string& actor_id, const std::string& service_id,
                      const std::string& request_id) const;
  json serviceRevisions(const std::string& actor_id, const std::string& service_id) const;

  json listKnowledge(const std::string& actor_id) const;
  json createKnowledge(const std::string& actor_id, const std::string& topic,
                       const std::string& scope, const std::string& service_id,
                       const std::string& title, const std::string& body,
                       const json& metadata, const std::string& request_id) const;
  json getKnowledgeDraft(const std::string& actor_id, const std::string& entry_id) const;
  json saveKnowledgeDraft(const std::string& actor_id, const std::string& entry_id,
                          int draft_version, const std::string& title,
                          const std::string& body, const json& metadata,
                          const std::string& request_id) const;
  json publishKnowledge(const std::string& actor_id, const std::string& entry_id,
                        int draft_version, const std::string& idempotency_key,
                        const std::string& request_digest, const std::string& request_id) const;
  json archiveKnowledge(const std::string& actor_id, const std::string& entry_id,
                        const std::string& request_id) const;
  json knowledgeRevisions(const std::string& actor_id, const std::string& entry_id) const;

 private:
  std::shared_ptr<DatabasePool> database_pool_;
};

}  // namespace oral_training::knowledge
