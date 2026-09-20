#include "../src/evidence_validator.h"
#include "../src/rag_types.h"
#include <iostream>
#include <stdexcept>

using namespace oral_training::rag;
namespace {
int checks = 0;
void require(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}
json context() {
  json c = {{"contextId", "ctx1"}, {"serviceId", "svc1"}, {"serviceRevisionId", "sr1"},
            {"trainingScope", "demo"}, {"manifest", {"kr1", "kr2"}}};
  c["manifestHash"] = manifestHash("sr1", c["manifest"], "demo");
  return c;
}
json bundle() {
  auto b = context();
  b["facts"] = json::array({{{"evidenceId", "E1"}, {"revisionId", "sr1"}, {"field", "price"},
      {"displayText", "3980 元总价"}, {"value", {{"status", "known"}, {"type", "starting_from"},
      {"currency", "CNY"}, {"amountMinor", 398000}, {"unit", "per_tooth"},
      {"conditions", "需检查后确认"}, {"validUntil", "2026-12-31"}}}}});
  b["passages"] = json::array({{{"evidenceId", "E2"}, {"revisionId", "kr1"}, {"chunkId", "kr1-c0"},
      {"body", "疗程依检查结果确定，不能保证固定时间完成。"}, {"scope", "service"},
      {"serviceId", "svc1"}, {"trainingScope", "demo"}}});
  b["conflicts"] = json::array();
  b["missingFields"] = json::array();
  return b;
}
json ref(const char* id = "E1") { return {{"traceId", "t1"}, {"evidenceId", id}}; }
}
int main() {
  try {
    require(oral_training::sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "SHA empty vector");
    require(oral_training::sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA abc vector");
    require(oral_training::sha256Hex(std::string(1000000, 'a')) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "SHA multi-block vector");
    auto c = context(), b = bundle();
    require(manifestHash("sr1", {"kr2", "kr1", "kr1"}, "demo") == c["manifestHash"], "manifest order and duplicates");
    require(manifestHash("sr2", c["manifest"], "demo") != c["manifestHash"], "service revision participates in hash");
    require(manifestHash("sr1", c["manifest"], "production") != c["manifestHash"], "scope participates in hash");
    require(manifestHash("sr1", json::array(), "demo").size() == 71, "empty knowledge manifest supported");
    bool rejected = false;
    try { manifestHash("sr1", {1}, "demo"); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "non-string revision rejected");
    EvidenceValidator v(c, b, "t1");
    require(v.valid(), "valid bundle");
    auto resolved = v.resolve(ref());
    require(!resolved.is_null(), "valid evidence resolves");
    require(resolved["text"].get<std::string>().find("3980 元起/颗") != std::string::npos, "price rendered from value");
    require(resolved["text"].get<std::string>().find("2026-12-31") != std::string::npos, "price validity retained");
    require(resolved["citation"]["manifestHash"] == c["manifestHash"], "citation hash matches context");
    require(v.resolve({{"traceId", "other"}, {"evidenceId", "E1"}}).is_null(), "foreign trace E1 rejected");
    require(v.resolve(ref(), true, false).is_null(), "private evidence rejected");
    require(v.resolve(ref(), true, true).is_object(), "public evidence allowed");
    require(v.resolve(ref("missing")).is_null(), "unknown ID rejected");
    for (const auto* key : {"manifestHash", "revisionId"}) {
      auto r = ref(); r[key] = "foreign";
      require(v.resolve(r).is_null(), "forged citation metadata rejected");
    }
    for (const auto* key : {"contextId", "serviceId", "serviceRevisionId", "manifestHash", "trainingScope"}) {
      auto bad = b; bad[key] = "other";
      require(!EvidenceValidator(c, bad, "t1").valid(), "bundle binding checked");
    }
    auto bad = b; bad["facts"][0]["revisionId"] = "sr2";
    require(EvidenceValidator(c, bad, "t1").resolve(ref()).is_null(), "foreign service fact rejected");
    for (const auto* key : {"revisionId", "serviceId", "trainingScope", "scope"}) {
      bad = b; bad["passages"][0][key] = "other";
      require(EvidenceValidator(c, bad, "t1").resolve(ref("E2")).is_null(), "passage scope checked");
    }
    bad = b; bad["passages"][0]["scope"] = "general"; bad["passages"][0]["serviceId"] = "";
    require(!EvidenceValidator(c, bad, "t1").resolve(ref("E2")).is_null(), "general knowledge allowed");
    bad = b; bad["passages"][0]["evidenceId"] = "E1";
    require(!EvidenceValidator(c, bad, "t1").valid(), "duplicate evidence IDs rejected");
    for (const auto* key : {"unit", "amountMinor", "currency", "conditions"}) {
      auto price = b["facts"][0]["value"]; price.erase(key);
      require(renderFact("price", price).empty(), "incomplete typed price rejected");
    }
    auto price = b["facts"][0]["value"]; price["status"] = "unknown";
    require(renderFact("price", price).empty(), "unknown price not rendered");
    price = b["facts"][0]["value"]; price["type"] = "range"; price["minimumMinor"] = 399001; price["maximumMinor"] = 499099;
    require(renderFact("price", price).find("3990.01—4990.99 元/颗") != std::string::npos, "range and fractional yuan exact");
    price["maximumMinor"] = 1;
    require(renderFact("price", price).empty(), "inverted range rejected");
    json duration = {{"status", "known"}, {"minimum", 3}, {"maximum", 6}, {"unit", "month"}, {"estimated", true}, {"conditions", "因人而异"}};
    require(renderFact("treatmentDuration", duration) == "完整疗程：约 3—6个月；因人而异", "duration conditions retained");
    duration["unit"] = "nonsense";
    require(renderFact("treatmentDuration", duration).empty(), "unknown unit rejected");
    auto reply = groundedReply({{"evidenceIds", json::array()}}, c, b, "t1");
    require(reply["answerStatus"] == "unknown" && reply["citations"].empty(), "no fallback evidence selection");
    require(groundedReply({{"evidenceIds", {"invalid"}}}, c, b, "t1")["answerStatus"] == "unknown", "illegal selection unknown");
    for (const std::string attack : {"3980元总价", "明天有号", "三个月完成", "九折优惠", "保证治愈", "１００％有效", "服务包含全部检查"}) {
      reply = groundedReply({{"evidenceIds", {"E1"}}, {"intro", attack}, {"learningPoints", {attack}}, {"complianceBoundary", attack}}, c, b, "t1");
      require(reply.dump().find(attack) == std::string::npos, "model free-text fact injection blocked");
    }
    bad = b; bad["missingFields"] = {"appointment"};
    require(groundedReply({{"evidenceIds", {"E1"}}}, c, bad, "t1")["answerStatus"] == "partial", "partial answer");
    bad["conflicts"] = {{{"reason", "conflict"}}};
    reply = groundedReply({{"evidenceIds", {"E1"}}}, c, bad, "t1");
    require(reply["answerStatus"] == "conflicted" && reply["citations"].empty(), "conflict must not choose side");
    bad = b; bad["passages"][0]["body"] = std::string(3000, 'x') + "不能保证";
    require(groundedReply({{"evidenceIds", {"E2"}}}, c, bad, "t1")["citations"].empty(), "overlong evidence omitted, never truncated");
    json trace = {{"traceId", "t1"}, {"isPublic", true}, {"evidence", b}, {"citations", {ref()}}};
    auto summary = groundedSummary(c, json::array({trace}));
    require(summary["groundedFacts"].size() == 1, "summary reuses published selected evidence only");
    require(summary["knowledgeManifestHash"] == summary["citations"][0]["manifestHash"], "summary and citation same hash");
    require(summary["groundedFacts"][0]["text"] == resolved["text"], "summary preserves complete fact");
    trace["isPublic"] = false;
    require(groundedSummary(c, json::array({trace}))["groundedFacts"].empty(), "private trace not in summary");
    trace["isPublic"] = true; trace["citations"][0]["traceId"] = "foreign";
    require(groundedSummary(c, json::array({trace}))["groundedFacts"].empty(), "summary rejects foreign E1");
    require(groundedSummary(c, json::array())["groundedFacts"].empty(), "no evidence summary safe");
    std::cout << checks << " evidence checks passed\n";
  } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
