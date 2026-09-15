#include "../src/model_gateway.h"
#include "../src/rag_types.h"

#include <iostream>
#include <memory>

namespace {

using json = nlohmann::json;
using namespace oral_training::rag;

class FakeModelGateway final : public oral_training::IModelGateway {
 public:
  explicit FakeModelGateway(json response) : response_(std::move(response)) {}

  bool configured() const override { return true; }
  std::string modelVersion() const override { return "fake:rag-contract-v1"; }
  void setRuntimeKey(const std::string&) override {}
  json patientReply(const json&, const json&, const json&) const override { return response_; }
  json evaluate(const json&, const json&) const override { return response_; }
  json standardServiceReply(const json&, const json&) const override { return response_; }
  json roleplaySummary(const json&, const json&) const override { return response_; }

 private:
  json response_;
};

bool require(bool condition, const char* message) {
  if (condition) return true;
  std::cerr << message << '\n';
  return false;
}

}  // namespace

int main() {
  TrainingContext context;
  context.context_id = "ctx-001";
  context.service_revision_id = "srv-rev-001";
  context.knowledge_as_of = "2026-09-14T08:00:00+08:00";
  context.manifest_hash = "sha256:manifest";

  const json context_json = context;
  if (!require(context_json["contextVersion"] == 2, "contextVersion must remain 2") ||
      !require(context_json["initialization"]["status"] == "pending",
               "initialization default changed")) {
    return 1;
  }

  EvidenceBundle bundle;
  bundle.context_id = context.context_id;
  bundle.service_revision_id = context.service_revision_id;
  bundle.knowledge_as_of = context.knowledge_as_of;
  bundle.manifest_hash = context.manifest_hash;
  bundle.retrieval_status = RetrievalStatus::Ok;
  bundle.facts.push_back({"E1", "price",
                          {{"type", "starting_from"}, {"amountMinor", 398000},
                           {"currency", "CNY"}, {"unit", "per_tooth"}},
                          "演示服务 A：3980 元起/颗", "srv-rev-001", "synthetic"});
  const json bundle_json = bundle;
  if (!require(bundle_json["tokenizerVersion"] == "zh-bigram-v1", "tokenizer version changed") ||
      !require(bundle_json["retrievalStatus"] == "ok", "retrieval status serialization failed") ||
      !require(bundle_json["facts"][0]["evidenceId"] == "E1", "evidence alias was lost")) {
    return 1;
  }

  ReportV2 report;
  report.knowledge_manifest_hash = context.manifest_hash;
  const json report_json = report;
  if (!require(report_json["schemaVersion"] == 2, "schemaVersion must remain 2") ||
      !require(report_json["totalScore"].is_null(), "unscored v2 report must serialize null") ||
      !require(report_json["passed"].is_null(), "unassessed pass state must serialize null") ||
      !require(report_json["knowledgeAssessment"]["status"] == "insufficient_evidence",
               "insufficient evidence status changed")) {
    return 1;
  }

  std::unique_ptr<oral_training::IModelGateway> fake =
      std::make_unique<FakeModelGateway>(json{{"reply", "fixture"}});
  if (!require(fake->standardServiceReply({}, {})["reply"] == "fixture",
               "fake model gateway injection contract failed")) {
    return 1;
  }

  return 0;
}
