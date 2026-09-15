#include "../src/knowledge_store.h"
#include "../src/knowledge_admin_queue.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <thread>

namespace {

using json = nlohmann::json;
using oral_training::knowledge::KnowledgeStore;
using oral_training::knowledge::KnowledgeStoreError;
using oral_training::knowledge::KnowledgeAdminQueue;

constexpr char kAdminId[] = "knowledge-store-admin";
constexpr char kLearnerId[] = "knowledge-store-learner";

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

json servicePayload(const std::string& name) {
  return {
      {"name", name}, {"category", "implant"}, {"dataOrigin", "synthetic"},
      {"price", {{"status", "known"}, {"type", "starting_from"},
                 {"currency", "CNY"}, {"amountMinor", 398000},
                 {"unit", "per_tooth"}, {"conditions", "Test-only package"},
                 {"validFrom", "2026-09-01"}, {"validUntil", "2026-12-31"}}},
      {"includedItems", json::array({"Test consultation"})},
      {"excludedItems", json::array()},
      {"visitDuration", {{"status", "unknown"}, {"reason", "Not recorded"}}},
      {"treatmentDuration", {{"status", "unknown"}, {"reason", "Not recorded"}}},
      {"followupInterval", {{"status", "unknown"}, {"reason", "Not recorded"}}},
      {"appointment", {{"status", "known"}, {"type", "consultation_hours"},
                       {"timezone", "Asia/Shanghai"}, {"text", "Weekdays 09:00-17:00"},
                       {"isLiveAvailability", false}}},
      {"professionalTopics", json::array({"implant-components"})},
      {"scenarioIds", json::array({"implant-basic"})},
  };
}

json knowledgeMetadata() {
  return {{"origin", "synthetic"}, {"verification", "unverified"},
          {"sourceTitle", ""}, {"sourceUrl", nullptr}, {"sourceLocator", ""},
          {"applicability", "Test-only training material"}, {"trainingScope", "demo"},
          {"aliases", json::array({"implant"})}};
}

template <typename Callable>
void requireStoreError(Callable&& callable, int status, const std::string& code,
                       const std::string& message) {
  try {
    callable();
  } catch (const KnowledgeStoreError& error) {
    require(error.status == status && error.code == code, message + ": wrong error");
    return;
  }
  throw std::runtime_error(message + ": no error");
}

std::string digest(const json& value) {
  return oral_training::knowledge::contentSha256(value);
}

}  // namespace

int main() {
  const char* raw_url = std::getenv("ORAL_TRAINING_TEST_DATABASE_URL");
  if (raw_url == nullptr || std::string(raw_url).empty()) {
    std::cerr << "ORAL_TRAINING_TEST_DATABASE_URL is required\n";
    return 1;
  }
  std::string database_url(raw_url);
  auto lower_url = database_url;
  std::transform(lower_url.begin(), lower_url.end(), lower_url.begin(), [](unsigned char value) {
    return static_cast<char>(std::tolower(value));
  });
  if (lower_url.find("test") == std::string::npos && lower_url.find("ci") == std::string::npos) {
    std::cerr << "knowledge store database test refuses non-test database\n";
    return 1;
  }

  try {
    {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params(R"(
        INSERT INTO users(id, display_name, role, status, is_demo)
        VALUES ($1, 'Knowledge Store Admin', 'admin', 'active', TRUE),
               ($2, 'Knowledge Store Learner', 'learner', 'active', TRUE)
      )", kAdminId, kLearnerId);
      tx.commit();
    }

    const auto pool = std::make_shared<DatabasePool>(
        database_url, 4, std::chrono::milliseconds(3000));
    KnowledgeStore store(pool);
    KnowledgeAdminQueue admin_queue(pool);
    requireStoreError([&] { store.listServices(kLearnerId); }, 403, "ROLE_FORBIDDEN",
                      "learner accessed service management");

    const auto created = store.createService(kAdminId, servicePayload("Service A"), "request-1");
    const auto service_id = created["id"].get<std::string>();
    require(created["draftVersion"] == 1, "service did not start at draft version 1");

    std::atomic<int> successful_saves{0};
    std::atomic<int> conflicts{0};
    auto concurrent_save = [&](const std::string& suffix) {
      try {
        store.saveServiceDraft(kAdminId, service_id, 1,
                               servicePayload("Concurrent " + suffix), "request-save-" + suffix);
        ++successful_saves;
      } catch (const KnowledgeStoreError& error) {
        if (error.status == 409 && error.code == "DRAFT_VERSION_CONFLICT") {
          ++conflicts;
          return;
        }
        throw;
      }
    };
    std::thread first(concurrent_save, "A");
    std::thread second(concurrent_save, "B");
    first.join();
    second.join();
    require(successful_saves == 1 && conflicts == 1,
            "optimistic service save did not produce one winner and one conflict");

    const auto draft = store.getServiceDraft(kAdminId, service_id);
    require(draft["draftVersion"] == 2, "concurrent service save advanced version incorrectly");
    requireStoreError(
        [&] { store.saveServiceDraft(kAdminId, service_id, 1,
                                     servicePayload("Stale"), "request-stale"); },
        409, "DRAFT_VERSION_CONFLICT", "stale service save was accepted");

    const auto publish_digest = digest({{"serviceId", service_id}, {"draftVersion", 2}});
    const auto published = store.publishService(
        kAdminId, service_id, 2, "publish-service-1", publish_digest, "request-publish-1");
    const auto first_revision = published["revision"]["revisionId"].get<std::string>();
    require(!published["replayed"].get<bool>() && published["revision"]["version"] == 1,
            "first service publish returned an invalid revision");
    const auto replay = store.publishService(
        kAdminId, service_id, 2, "publish-service-1", publish_digest, "request-publish-replay");
    require(replay["replayed"].get<bool>() &&
                replay["revision"]["revisionId"].get<std::string>() == first_revision,
            "service publish idempotency did not replay the original revision");
    requireStoreError(
        [&] { store.publishService(kAdminId, service_id, 2, "publish-service-1",
                                   digest({{"different", true}}), "request-publish-conflict"); },
        409, "IDEMPOTENCY_CONFLICT", "service publish accepted a reused idempotency key");

    auto broken = draft["payload"];
    broken["scenarioIds"] = json::array({"missing-scenario"});
    const auto broken_save = store.saveServiceDraft(
        kAdminId, service_id, 2, broken, "request-broken-save");
    bool publish_failed = false;
    try {
      store.publishService(kAdminId, service_id, broken_save["draftVersion"].get<int>(),
                           "publish-service-broken", digest(broken), "request-broken-publish");
    } catch (const pqxx::sql_error&) {
      publish_failed = true;
    }
    require(publish_failed, "service publish with an unknown scenario unexpectedly succeeded");
    auto revisions = store.serviceRevisions(kAdminId, service_id);
    require(revisions["items"].size() == 1 &&
                store.getServiceDraft(kAdminId, service_id)["currentRevisionId"] == first_revision,
            "failed service publish changed published history or the current pointer");

    const auto repaired = store.saveServiceDraft(
        kAdminId, service_id, broken_save["draftVersion"].get<int>(),
        servicePayload("Service B"), "request-repair");
    const auto second_publish = store.publishService(
        kAdminId, service_id, repaired["draftVersion"].get<int>(), "publish-service-2",
        digest(repaired["payload"]), "request-publish-2");
    require(second_publish["revision"]["version"] == 2,
            "second service publish did not append version 2");
    bool duplicate_version_rejected = false;
    try {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params(R"(
        INSERT INTO service_revisions
          (id, service_id, version, payload, content_hash, origin, published_by)
        VALUES ('duplicate-service-version', $1, 2, $2::jsonb, $3, 'synthetic', $4)
      )", service_id, servicePayload("Duplicate").dump(),
          digest(servicePayload("Duplicate")), kAdminId);
      tx.commit();
    } catch (const pqxx::unique_violation&) {
      duplicate_version_rejected = true;
    }
    require(duplicate_version_rejected, "duplicate service revision version was accepted");

    const auto draft_id = created["draftId"].get<std::string>();
    const json generation_request = {{"brief", "Create another test-only variation"},
                                     {"count", 1}};
    const auto generation_digest = digest({{"kind", "service_draft"},
                                           {"draftId", draft_id},
                                           {"request", generation_request}});
    const auto generation = admin_queue.create(
        kAdminId, "service_draft", draft_id, generation_request,
        "generation-service-1", generation_digest, "request-generation-1");
    requireStoreError(
        [&] { admin_queue.create(kLearnerId, "service_draft", draft_id,
                                 generation_request, "learner-generation",
                                 generation_digest, "request-learner-generation"); },
        403, "ROLE_FORBIDDEN", "learner created an admin generation job");
    const auto generation_replay = admin_queue.create(
        kAdminId, "service_draft", draft_id, generation_request,
        "generation-service-1", generation_digest, "request-generation-replay");
    require(generation_replay["jobId"] == generation["jobId"],
            "generation idempotency did not return the original job");
    const auto claimed_generation = admin_queue.claim("database-test-worker");
    require(claimed_generation.has_value() && claimed_generation->id == generation["jobId"],
            "admin generation job was not claimable");
    require(admin_queue.succeed(*claimed_generation, servicePayload("Generated Service"),
                                "fake:knowledge-v1"),
            "valid active generation result was rejected");
    const auto generated_job = admin_queue.get(
        kAdminId, generation["jobId"].get<std::string>());
    require(generated_job["status"] == "succeeded" &&
                generated_job["resultApplied"] == true &&
                generated_job["promptVersion"] == "service-draft-v1" &&
                generated_job["modelVersion"] == "fake:knowledge-v1" &&
                store.getServiceDraft(kAdminId, service_id)["payload"]["name"] ==
                    "Generated Service",
            "active generation result was not applied atomically");

    const auto stale_generation = admin_queue.create(
        kAdminId, "service_draft", draft_id, generation_request,
        "generation-service-stale", digest({{"stale", true}}),
        "request-generation-stale");
    const auto before_manual = store.getServiceDraft(kAdminId, service_id);
    store.saveServiceDraft(kAdminId, service_id, before_manual["draftVersion"].get<int>(),
                           servicePayload("Manual Edit Wins"), "request-manual-wins");
    const auto claimed_stale = admin_queue.claim("database-test-worker");
    require(claimed_stale.has_value() && claimed_stale->id == stale_generation["jobId"],
            "stale generation job was not claimable");
    require(admin_queue.succeed(*claimed_stale, servicePayload("Stale Model Output"),
                                "fake:knowledge-v1"),
            "stale generation could not persist its candidate result");
    const auto stale_result = admin_queue.get(
        kAdminId, stale_generation["jobId"].get<std::string>());
    require(stale_result["status"] == "succeeded" && stale_result["resultApplied"] == false &&
                store.getServiceDraft(kAdminId, service_id)["payload"]["name"] ==
                    "Manual Edit Wins",
            "stale generation overwrote a newer manual draft");

    const auto failed_generation = admin_queue.create(
        kAdminId, "service_draft", draft_id, generation_request,
        "generation-service-failed", digest({{"failed", true}}),
        "request-generation-failed");
    const auto claimed_failed = admin_queue.claim("database-test-worker");
    require(claimed_failed.has_value() && claimed_failed->id == failed_generation["jobId"],
            "failure test job was not claimable");
    admin_queue.fail(*claimed_failed, "MODEL_INVALID_RESPONSE", "invalid fixture", false);
    require(admin_queue.get(kAdminId, failed_generation["jobId"].get<std::string>())["status"] ==
                "dead",
            "non-retryable generation failure did not become visible");
    const auto before_retry_edit = store.getServiceDraft(kAdminId, service_id);
    store.saveServiceDraft(kAdminId, service_id,
                           before_retry_edit["draftVersion"].get<int>(),
                           servicePayload("Manual Before Retry"),
                           "request-manual-before-retry");
    const auto retried = admin_queue.retry(
        kAdminId, failed_generation["jobId"].get<std::string>(), "request-retry");
    require(retried["status"] == "pending" && retried["generation"] == 2 &&
                retried["attempts"] == 0,
            "explicit generation retry did not start a new generation");
    const auto retry_attempt = admin_queue.claim("database-test-worker");
    require(retry_attempt.has_value() &&
                retry_attempt->id == failed_generation["jobId"] &&
                retry_attempt->request["currentDraft"]["name"] == "Manual Before Retry",
            "explicit retry did not refresh its input from the latest draft");
    {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params("UPDATE knowledge_admin_jobs SET lease_until = NOW() - INTERVAL '1 second' WHERE id = $1",
                     retry_attempt->id);
      tx.commit();
    }
    const auto reclaimed = admin_queue.claim("database-test-reclaimer");
    require(reclaimed.has_value() && reclaimed->id == retry_attempt->id &&
                reclaimed->attempt == retry_attempt->attempt + 1,
            "expired generation lease was not reclaimed with a new attempt");
    require(!admin_queue.succeed(*retry_attempt, servicePayload("Expired Output"),
                                 "fake:knowledge-v1"),
            "expired generation attempt remained eligible to write");
    require(admin_queue.succeed(*reclaimed, servicePayload("Reclaimed Output"),
                                "fake:knowledge-v1"),
            "reclaimed generation attempt could not persist its result");

    bool immutable = false;
    try {
      pqxx::connection connection(database_url);
      pqxx::work tx(connection);
      tx.exec_params("UPDATE service_revisions SET payload = '{}'::jsonb WHERE id = $1",
                     first_revision);
      tx.commit();
    } catch (const pqxx::sql_error&) {
      immutable = true;
    }
    require(immutable, "published service revision was mutable");
    store.archiveService(kAdminId, service_id, "request-archive-service");
    revisions = store.serviceRevisions(kAdminId, service_id);
    require(revisions["items"].size() == 2,
            "archiving a service removed immutable revision history");

    auto rejected_metadata = knowledgeMetadata();
    rejected_metadata["verification"] = "reviewed";
    requireStoreError(
        [&] { store.createKnowledge(kAdminId, "topic", "general", "", "Bad", "Body",
                                    rejected_metadata, "request-bad-knowledge"); },
        400, "INVALID_ARGUMENT", "synthetic knowledge was marked reviewed");
    const auto knowledge = store.createKnowledge(
        kAdminId, "implant-components", "service", service_id, "Implant concept",
        "Fixed test content for training only.", knowledgeMetadata(), "request-knowledge-create");
    const auto entry_id = knowledge["id"].get<std::string>();
    const auto knowledge_digest = digest({{"entryId", entry_id}, {"draftVersion", 1}});
    const auto knowledge_publish = store.publishKnowledge(
        kAdminId, entry_id, 1, "publish-knowledge-1", knowledge_digest,
        "request-knowledge-publish");
    const auto knowledge_revision =
        knowledge_publish["revision"]["revisionId"].get<std::string>();
    const auto knowledge_replay = store.publishKnowledge(
        kAdminId, entry_id, 1, "publish-knowledge-1", knowledge_digest,
        "request-knowledge-replay");
    require(knowledge_replay["replayed"].get<bool>() &&
                knowledge_replay["revision"]["revisionId"] == knowledge_revision,
            "knowledge publish idempotency did not replay the original revision");
    store.archiveKnowledge(kAdminId, entry_id, "request-knowledge-archive");
    require(store.knowledgeRevisions(kAdminId, entry_id)["items"].size() == 1,
            "archiving knowledge removed revision history");

    {
      pqxx::connection connection(database_url);
      pqxx::read_transaction tx(connection);
      const auto audit_count = tx.exec("SELECT COUNT(*) FROM knowledge_audit_events")[0][0].as<int>();
      require(audit_count >= 9, "knowledge operations were not fully audited");
    }
    std::cout << "knowledge store database test passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "knowledge store database test failed: " << error.what() << '\n';
    return 1;
  }
}
