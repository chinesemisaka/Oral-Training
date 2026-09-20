#pragma once

#include "rag_manifest.h"
#include <map>
#include <set>

namespace oral_training::rag {
using json = nlohmann::json;

inline std::string evidenceString(const json& value, const char* key) {
  return value.is_object() && value.contains(key) && value[key].is_string()
      ? value[key].get<std::string>() : "";
}

inline std::size_t textLength(const std::string& text) {
  return std::count_if(text.begin(), text.end(), [](unsigned char c) { return (c & 0xc0) != 0x80; });
}

// A malformed field is not renderable. Never default a missing amount/unit to zero.
inline std::string renderFact(const std::string& field, const json& value) {
  try {
    if (field == "includedItems") {
      if (!value.is_array() || value.empty()) return "";
      std::string result = "包含项目：";
      for (const auto& item : value) {
        if (!item.is_string() || item.get<std::string>().empty()) return "";
        if (result != "包含项目：") result += "、";
        result += item.get<std::string>();
      }
      return result;
    }
    if (!value.is_object() || evidenceString(value, "status") != "known") return "";
    const auto positive = [&](const char* key) -> long long {
      if (!value.contains(key) || !value[key].is_number_integer() ||
          value[key] <= 0 || value[key] > 9000000000000000LL) return 0;
      return value[key].get<long long>();
    };
    if (field == "price") {
      const std::map<std::string, std::string> units = {
          {"per_tooth", "颗"}, {"per_case", "例"}, {"per_visit", "次"},
          {"per_arch", "牙弓"}, {"per_item", "项"}};
      const auto unit = units.find(evidenceString(value, "unit"));
      if (unit == units.end() || evidenceString(value, "currency") != "CNY" ||
          evidenceString(value, "conditions").empty()) return "";
      const auto yuan = [](long long minor) {
        std::ostringstream out;
        out << minor / 100;
        if (minor % 100) out << '.' << std::setw(2) << std::setfill('0') << minor % 100;
        return out.str();
      };
      const auto type = evidenceString(value, "type");
      std::string result;
      if ((type == "fixed" || type == "starting_from") && positive("amountMinor"))
        result = yuan(positive("amountMinor")) + (type == "fixed" ? " 元" : " 元起");
      else if (type == "range" && positive("minimumMinor") &&
               positive("maximumMinor") >= positive("minimumMinor"))
        result = yuan(positive("minimumMinor")) + "—" + yuan(positive("maximumMinor")) + " 元";
      else if (type == "quote_after_assessment") result = "需评估后报价";
      else return "";
      result += "/" + unit->second + "；" + evidenceString(value, "conditions");
      for (const auto* key : {"validFrom", "validUntil"}) {
        if (value.contains(key) && !value[key].is_null() && !value[key].is_string()) return "";
        const auto date = evidenceString(value, key);
        if (!date.empty()) result += std::string(key == std::string("validFrom") ? "；有效期自 " : "；有效期至 ") + date;
      }
      return result;
    }
    const std::map<std::string, std::string> labels = {
        {"visitDuration", "单次就诊时长"}, {"treatmentDuration", "完整疗程"},
        {"followupInterval", "复诊间隔"}};
    if (labels.count(field)) {
      const std::map<std::string, std::string> units = {{"minute", "分钟"}, {"hour", "小时"},
          {"day", "天"}, {"week", "周"}, {"month", "个月"}, {"year", "年"}};
      const auto unit = units.find(evidenceString(value, "unit"));
      const auto minimum = positive("minimum"), maximum = positive("maximum");
      if (unit == units.end() || !minimum || maximum < minimum ||
          (value.contains("estimated") && !value["estimated"].is_boolean())) return "";
      std::string result = labels.at(field) + "：" + (value.value("estimated", false) ? "约 " : "") +
          std::to_string(minimum) + (minimum == maximum ? "" : "—" + std::to_string(maximum)) + unit->second;
      for (const auto* key : {"phase", "conditions"}) {
        if (value.contains(key) && !value[key].is_null() && !value[key].is_string()) return "";
        if (!evidenceString(value, key).empty()) result += "；" + evidenceString(value, key);
      }
      return result;
    }
    if (field == "appointment") {
      if (evidenceString(value, "text").empty() || evidenceString(value, "timezone").empty() ||
          !value.contains("isLiveAvailability") || !value["isLiveAvailability"].is_boolean()) return "";
      // Published revisions can never reserve a live slot.
      return evidenceString(value, "text") + "（时区：" + evidenceString(value, "timezone") +
          "；仅为已发布资料，非实时号源，请以预约确认为准）";
    }
  } catch (const json::exception&) { return ""; }
  return "";
}

class EvidenceValidator {
 public:
  // Both context and bundle come from the backend, never from model output.
  EvidenceValidator(const json& context, const json& bundle, std::string trace_id)
      : trace_id_(std::move(trace_id)), hash_(evidenceString(context, "manifestHash")) {
    const auto revision = evidenceString(context, "serviceRevisionId");
    const auto scope = evidenceString(context, "trainingScope");
    const auto service = evidenceString(context, "serviceId");
    if (trace_id_.empty() || service.empty() || !context.contains("manifest") ||
        hash_ != manifestHash(revision, context["manifest"], scope) ||
        evidenceString(bundle, "contextId") != evidenceString(context, "contextId") ||
        evidenceString(bundle, "serviceRevisionId") != revision ||
        evidenceString(bundle, "serviceId") != service ||
        evidenceString(bundle, "trainingScope") != scope ||
        evidenceString(bundle, "manifestHash") != hash_) return;
    valid_ = true;
    std::set<std::string> manifest;
    for (const auto& id : context["manifest"]) manifest.insert(id.get<std::string>());
    std::set<std::string> seen;
    for (const auto* kind : {"facts", "passages"}) {
      if (!bundle.contains(kind) || !bundle[kind].is_array()) { valid_ = false; break; }
      for (const auto& item : bundle[kind]) {
        const auto id = evidenceString(item, "evidenceId");
        if (id.empty() || !seen.insert(id).second) { valid_ = false; break; }
        std::string text;
        if (std::string(kind) == "facts") {
          if (evidenceString(item, "revisionId") != revision || !item.contains("value")) continue;
          text = renderFact(evidenceString(item, "field"), item["value"]);
          // Display text is never authority; regenerate from the typed value.
        } else {
          if (!manifest.count(evidenceString(item, "revisionId")) ||
              evidenceString(item, "chunkId").empty() ||
              evidenceString(item, "trainingScope") != scope) continue;
          const auto item_scope = evidenceString(item, "scope");
          if (!((item_scope == "general" && evidenceString(item, "serviceId").empty()) ||
                (item_scope == "service" && evidenceString(item, "serviceId") == service))) continue;
          text = evidenceString(item, "body");
          if (!text.empty()) {
            text = "资料原文：" + text;
            const auto applicability = evidenceString(item, "applicability");
            if (!applicability.empty()) text += "（适用范围：" + applicability + "）";
          }
        }
        if (!text.empty()) entries_[id] = {{"text", text}, {"revisionId", evidenceString(item, "revisionId")}};
      }
    }
    if (!valid_) entries_.clear();
  }

  bool valid() const { return valid_; }
  json resolve(const json& citation, bool require_public = false, bool is_public = false) const {
    if (!valid_ || (require_public && !is_public) ||
        evidenceString(citation, "traceId") != trace_id_) return nullptr;
    const auto id = evidenceString(citation, "evidenceId");
    const auto entry = entries_.find(id);
    if (entry == entries_.end()) return nullptr;
    if (citation.contains("manifestHash") && evidenceString(citation, "manifestHash") != hash_) return nullptr;
    if (citation.contains("revisionId") && citation["revisionId"] != entry->second["revisionId"]) return nullptr;
    return {{"text", entry->second["text"]}, {"citation", {
        {"traceId", trace_id_}, {"evidenceId", id}, {"manifestHash", hash_},
        {"revisionId", entry->second["revisionId"]}}}};
  }

 private:
  bool valid_ = false;
  std::string trace_id_, hash_;
  std::map<std::string, json> entries_;
};

// Model free text is not an evidence channel. Use fixed communication templates;
// this also blocks spelled-out numbers and promises that regex filters miss.
inline json groundedReply(const json& source, const json& context,
                           const json& bundle, const std::string& trace_id) {
  if (!source.is_object()) throw std::invalid_argument("grounded reply must be an object");
  EvidenceValidator validator(context, bundle, trace_id);
  if (!validator.valid()) throw std::runtime_error("RAG evidence context mismatch");
  const bool conflicted = bundle.contains("conflicts") && !bundle["conflicts"].empty();
  std::string reply = "我理解您对这项服务的关注。";
  json citations = json::array();
  std::set<std::string> selected;
  if (!conflicted && source.contains("evidenceIds") && source["evidenceIds"].is_array()) {
    for (const auto& id : source["evidenceIds"]) {
      if (!id.is_string() || !selected.insert(id.get<std::string>()).second) continue;
      const auto result = validator.resolve({{"traceId", trace_id}, {"evidenceId", id}});
      if (result.is_null()) continue;
      const auto text = result["text"].get<std::string>();
      // Never cut off a price qualifier or the negation at the end of a passage.
      if (textLength(reply) + textLength(text) > 850) continue;
      reply += " " + text;
      citations.push_back(result["citation"]);
      if (citations.size() == 4) break;
    }
  }
  const bool missing = bundle.contains("missingFields") && !bundle["missingFields"].empty();
  if (conflicted) reply += " 当前资料存在冲突，需要进一步核对，暂不能确认。";
  else if (citations.empty()) reply += " 当前没有可确认的依据，需要进一步核对。";
  else if (missing) reply += " 部分信息目前没有资料依据，需要进一步确认。";
  return {{"reply", reply}, {"answerStatus", conflicted ? "conflicted" : citations.empty() ? "unknown" : missing ? "partial" : "answered"},
      {"citations", citations}, {"learningPoints", {"先回应患者问题，再引用已发布的服务资料。", "资料未提供的信息要明确说明，不自行补充。"}},
      {"complianceBoundary", "客服仅说明已发布的服务资料，具体诊疗判断需由医生结合检查评估。"},
      {"shouldEnd", source.contains("shouldEnd") && source["shouldEnd"].is_boolean() && source["shouldEnd"].get<bool>()},
      {"traceId", trace_id}, {"evidenceBundle", bundle}};
}

inline json groundedSummary(const json& context, const json& public_traces) {
  json facts = json::array(), citations = json::array();
  std::set<std::string> seen;
  for (const auto& trace : public_traces) {
    if (!trace.value("isPublic", false) || !trace.contains("evidence") ||
        !trace.contains("citations") || !trace["citations"].is_array()) continue;
    if (trace["evidence"].contains("conflicts") && !trace["evidence"]["conflicts"].empty()) continue;
    EvidenceValidator validator(context, trace["evidence"], evidenceString(trace, "traceId"));
    for (const auto& ref : trace["citations"]) {
      const auto result = validator.resolve(ref, true, true);
      if (result.is_null() || !seen.insert(result["text"].get<std::string>()).second) continue;
      facts.push_back({{"text", result["text"]}, {"citation", result["citation"]}});
      citations.push_back(result["citation"]);
      if (facts.size() == 6) break;
    }
    if (facts.size() == 6) break;
  }
  return {{"schemaVersion", 2}, {"knowledgeManifestHash", context.at("manifestHash")},
      {"summary", facts.empty() ? "本次复盘没有可复用的已公开依据，仅整理沟通原则；未核实的信息需要进一步确认。" : "本次复盘复用会话中已公开的依据。请结合原文及适用条件回顾表达，未核实的信息需要进一步确认。"},
      {"coveredTopics", {"患者问题回应与资料核对"}},
      {"keyPrinciples", {"先理解患者关注，再使用可核对的资料说明。", "资料不足时明确说明，具体诊疗判断交由医生评估。"}},
      {"nextPracticeSuggestions", {"练习保留资料中的单位、范围和适用条件。"}},
      {"groundedFacts", facts}, {"citations", citations}};
}

}  // namespace oral_training::rag
