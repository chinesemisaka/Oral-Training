#include "rag_retriever.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>

namespace oral_training::rag {
namespace {

struct Rune {
  char32_t value = 0;
  std::string bytes;
};

std::vector<Rune> decodeUtf8(const std::string& input) {
  std::vector<Rune> output;
  for (std::size_t i = 0; i < input.size();) {
    const auto first = static_cast<unsigned char>(input[i]);
    std::size_t count = 1;
    char32_t value = first;
    if ((first & 0xe0) == 0xc0 && i + 1 < input.size()) {
      count = 2;
      value = first & 0x1f;
    } else if ((first & 0xf0) == 0xe0 && i + 2 < input.size()) {
      count = 3;
      value = first & 0x0f;
    } else if ((first & 0xf8) == 0xf0 && i + 3 < input.size()) {
      count = 4;
      value = first & 0x07;
    }
    bool valid = true;
    for (std::size_t j = 1; j < count; ++j) {
      const auto next = static_cast<unsigned char>(input[i + j]);
      if ((next & 0xc0) != 0x80) {
        valid = false;
        break;
      }
      value = (value << 6) | (next & 0x3f);
    }
    if (!valid) {
      count = 1;
      value = first;
    }
    output.push_back({value, input.substr(i, count)});
    i += count;
  }
  return output;
}

bool isCjk(char32_t value) {
  return (value >= 0x3400 && value <= 0x4dbf) ||
      (value >= 0x4e00 && value <= 0x9fff) ||
      (value >= 0xf900 && value <= 0xfaff);
}

bool isAsciiWord(char32_t value) {
  return value < 128 && std::isalnum(static_cast<unsigned char>(value));
}

std::string hexBytes(const std::string& value) {
  std::ostringstream output;
  for (const auto character : value) {
    output << std::hex << std::setw(2) << std::setfill('0')
           << static_cast<int>(static_cast<unsigned char>(character));
  }
  return output.str();
}

std::string join(const std::vector<std::string>& values, const char* separator = " ") {
  std::ostringstream output;
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i != 0) output << separator;
    output << values[i];
  }
  return output.str();
}

std::string normalizeForAlias(const std::string& input) {
  std::string output;
  for (const auto& rune : decodeUtf8(input)) {
    auto value = rune.value;
    if (value >= 0xff01 && value <= 0xff5e) value -= 0xfee0;
    if (value < 128) output.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(value))));
    else output += rune.bytes;
  }
  return output;
}

std::vector<std::string> uniqueTerms(std::vector<std::string> values) {
  std::sort(values.begin(), values.end());
  values.erase(std::unique(values.begin(), values.end()), values.end());
  return values;
}

std::string utf8Slice(const std::vector<Rune>& runes, std::size_t first, std::size_t last) {
  std::string output;
  for (std::size_t i = first; i < last; ++i) output += runes[i].bytes;
  return output;
}

std::string metadataString(const json& metadata, const char* key) {
  return metadata.contains(key) && metadata[key].is_string()
      ? metadata[key].get<std::string>() : "";
}

std::string yuan(long long minor) {
  std::ostringstream output;
  output << minor / 100;
  if (minor % 100 != 0) output << '.' << std::setw(2) << std::setfill('0') << minor % 100;
  return output.str();
}

std::string priceDisplay(const json& price) {
  if (price.value("status", "unknown") == "unknown") return "目前资料没有提供价格信息";
  const std::map<std::string, std::string> units = {
      {"per_tooth", "颗"}, {"per_case", "例"}, {"per_visit", "次"},
      {"per_arch", "牙弓"}, {"per_item", "项"}};
  const auto type = price.value("type", "quote_after_assessment");
  std::string amount = "需评估后报价";
  if (type == "fixed") amount = yuan(price.value("amountMinor", 0LL)) + " 元";
  if (type == "starting_from") amount = yuan(price.value("amountMinor", 0LL)) + " 元起";
  if (type == "range") amount = yuan(price.value("minimumMinor", 0LL)) + "—" +
      yuan(price.value("maximumMinor", 0LL)) + " 元";
  const auto unit = units.find(price.value("unit", "per_item"));
  return amount + "/" + (unit == units.end() ? "项" : unit->second) + "；" +
      price.value("conditions", "以评估结果为准");
}

std::string durationDisplay(const json& duration, const std::string& label) {
  if (duration.value("status", "unknown") == "unknown") return "目前资料没有提供" + label + "信息";
  const std::map<std::string, std::string> units = {
      {"minute", "分钟"}, {"hour", "小时"}, {"day", "天"}, {"week", "周"},
      {"month", "个月"}, {"year", "年"}};
  const auto unit = units.find(duration.value("unit", "minute"));
  const auto minimum = duration.value("minimum", 0);
  const auto maximum = duration.value("maximum", minimum);
  std::string value = minimum == maximum ? std::to_string(minimum)
      : std::to_string(minimum) + "—" + std::to_string(maximum);
  value += unit == units.end() ? "" : unit->second;
  if (duration.value("estimated", false)) value = "约 " + value;
  const auto conditions = duration.value("conditions", "");
  return label + "：" + value + (conditions.empty() ? "" : "；" + conditions);
}

bool containsAny(const std::string& text, const std::vector<std::string>& needles) {
  for (const auto& needle : needles) if (text.find(needle) != std::string::npos) return true;
  return false;
}

std::set<std::string> requestedFields(const std::string& question,
                                      const std::optional<std::string>& explicit_field) {
  std::set<std::string> fields;
  if (explicit_field && !explicit_field->empty()) fields.insert(*explicit_field);
  const auto normalized = normalizeForAlias(question);
  if (containsAny(normalized, {"价格", "费用", "多少钱", "报价", "收费"})) fields.insert("price");
  if (containsAny(normalized, {"包括", "包含", "另收费", "项目", "拍片"})) fields.insert("includedItems");
  if (containsAny(normalized, {"多久", "多长时间", "时长", "疗程"})) {
    fields.insert("visitDuration");
    fields.insert("treatmentDuration");
  }
  if (containsAny(normalized, {"复诊", "复查", "间隔"})) fields.insert("followupInterval");
  if (containsAny(normalized, {"预约", "挂号", "号源", "营业时间"})) fields.insert("appointment");
  return fields;
}

std::string tsQuery(const std::vector<std::string>& terms) {
  return join(terms, " | ");
}

double overlapScore(const std::vector<std::string>& query, const std::string& terms) {
  if (query.empty()) return 0.0;
  std::set<std::string> document;
  std::istringstream input(terms);
  for (std::string value; input >> value;) document.insert(value);
  int matches = 0;
  for (const auto& value : query) if (document.count(value) != 0) ++matches;
  return static_cast<double>(matches) / static_cast<double>(query.size());
}

}  // namespace

std::vector<std::string> tokenizeChinese(const std::string& text) {
  const auto normalized = normalizeForAlias(text);
  const auto runes = decodeUtf8(normalized);
  std::vector<std::string> terms;
  std::vector<Rune> cjk;
  std::string ascii;
  const auto flushCjk = [&] {
    if (cjk.size() == 1) terms.push_back("c_" + hexBytes(cjk[0].bytes));
    for (std::size_t i = 1; i < cjk.size(); ++i) {
      terms.push_back("c_" + hexBytes(cjk[i - 1].bytes + cjk[i].bytes));
    }
    cjk.clear();
  };
  const auto flushAscii = [&] {
    if (!ascii.empty()) terms.push_back("w_" + ascii);
    ascii.clear();
  };
  for (const auto& rune : runes) {
    if (isCjk(rune.value)) {
      flushAscii();
      cjk.push_back(rune);
    } else if (isAsciiWord(rune.value)) {
      flushCjk();
      ascii.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(rune.value))));
    } else {
      flushCjk();
      flushAscii();
    }
  }
  flushCjk();
  flushAscii();

  const std::vector<std::pair<std::string, std::vector<std::string>>> aliases = {
      {"price", {"价格", "费用", "多少钱", "报价", "收费"}},
      {"duration", {"多久", "多长时间", "时长", "疗程"}},
      {"included", {"包括", "包含", "另收费", "拍片"}},
      {"orthodontic_appliance", {"牙套", "矫治器"}},
      {"dental_implant", {"种牙", "种植牙"}},
      {"followup", {"复诊", "复查"}},
      {"appointment", {"预约", "挂号", "号源"}},
  };
  for (const auto& [canonical, variants] : aliases) {
    if (containsAny(normalized, variants)) terms.push_back("a_" + canonical);
  }
  return uniqueTerms(std::move(terms));
}

std::vector<KnowledgeChunkDraft> chunkKnowledge(const std::string& title,
                                                const std::string& body,
                                                const json& metadata) {
  const auto runes = decodeUtf8(body);
  std::vector<KnowledgeChunkDraft> chunks;
  constexpr std::size_t kTarget = 450;
  constexpr std::size_t kOverlap = 60;
  for (std::size_t start = 0; start < runes.size();) {
    std::size_t end = std::min(start + kTarget, runes.size());
    if (end < runes.size()) {
      const auto floor = start + 200;
      for (std::size_t cursor = end; cursor > floor; --cursor) {
        const auto value = runes[cursor - 1].value;
        if (value == U'\n' || value == U'。' || value == U'！' || value == U'？') {
          end = cursor;
          break;
        }
      }
    }
    auto chunk_body = utf8Slice(runes, start, end);
    while (!chunk_body.empty() && (chunk_body.back() == '\n' || chunk_body.back() == '\r')) {
      chunk_body.pop_back();
    }
    if (!chunk_body.empty()) {
      std::string aliases;
      if (metadata.contains("aliases") && metadata["aliases"].is_array()) {
        for (const auto& alias : metadata["aliases"]) if (alias.is_string()) aliases += " " + alias.get<std::string>();
      }
      const auto title_terms = join(tokenizeChinese(title + " " + aliases));
      const auto body_terms = join(tokenizeChinese(chunk_body + " " + metadataString(metadata, "applicability")));
      chunks.push_back({static_cast<int>(chunks.size()), chunk_body, title,
                        title_terms + (title_terms.empty() || body_terms.empty() ? "" : " ") + body_terms,
                        title_terms, body_terms, static_cast<int>(start), static_cast<int>(end)});
    }
    if (end == runes.size()) break;
    start = end > kOverlap ? end - kOverlap : end;
  }
  return chunks;
}

void insertKnowledgeChunks(pqxx::transaction_base& tx, const std::string& revision_id,
                           const std::string& title, const std::string& body,
                           const json& metadata) {
  const auto chunks = chunkKnowledge(title, body, metadata);
  for (const auto& chunk : chunks) {
    tx.exec_params(R"(
      INSERT INTO knowledge_chunks
        (id, revision_id, ordinal, body, section, terms, search_vector,
         tokenizer_version, source_start, source_end)
      VALUES ($1, $2, $3, $4, $5, $6,
        setweight(to_tsvector('simple', $7), 'A') || setweight(to_tsvector('simple', $8), 'D'),
        $9, $10, $11)
    )", revision_id + "-c" + std::to_string(chunk.ordinal), revision_id, chunk.ordinal,
        chunk.body, chunk.section, chunk.terms, chunk.title_terms, chunk.body_terms,
        std::string(kTokenizerVersion), chunk.source_start, chunk.source_end);
  }
}

EvidenceBundle RagRetriever::retrieve(const std::string& service_revision_id,
                                      const std::vector<std::string>& knowledge_revision_ids,
                                      const std::string& knowledge_as_of,
                                      const RetrievalRequest& request,
                                      const std::string& training_scope) const {
  EvidenceBundle bundle;
  bundle.context_id = request.context_id;
  bundle.service_revision_id = service_revision_id;
  bundle.knowledge_as_of = knowledge_as_of;
  bundle.purpose = request.purpose;
  bundle.manifest_hash = join(knowledge_revision_ids, ",");
  auto connection = database_pool_->acquire();
  pqxx::read_transaction tx(connection.get());

  std::string service_id;
  json service_payload;
  if (!service_revision_id.empty()) {
    const auto service = tx.exec_params(
        "SELECT service_id, payload FROM service_revisions WHERE id = $1", service_revision_id);
    if (service.empty()) throw std::runtime_error("service revision not found");
    service_id = service[0]["service_id"].c_str();
    service_payload = json::parse(service[0]["payload"].c_str());
  }

  int evidence = 1;
  for (const auto& field : requestedFields(request.current_question, request.field)) {
    if (!service_payload.contains(field)) {
      bundle.missing_fields.push_back(field);
      continue;
    }
    const auto& value = service_payload[field];
    if (value.is_object() && value.value("status", "known") == "unknown") {
      bundle.missing_fields.push_back(field);
      continue;
    }
    std::string display;
    if (field == "price") display = priceDisplay(value);
    else if (field == "visitDuration") display = durationDisplay(value, "单次就诊时长");
    else if (field == "treatmentDuration") display = durationDisplay(value, "完整疗程");
    else if (field == "followupInterval") display = durationDisplay(value, "复诊间隔");
    else if (field == "includedItems") {
      display = "包含项目：";
      if (value.is_array()) for (std::size_t i = 0; i < value.size(); ++i) {
        if (i != 0) display += "、";
        display += value[i].get<std::string>();
      }
    } else if (field == "appointment") {
      display = value.value("text", "目前没有可确认的预约信息");
      if (!value.value("isLiveAvailability", false)) display += "（非实时号源，请以预约确认为准）";
    }
    bundle.facts.push_back({"E" + std::to_string(evidence++), field, value, display,
                            service_revision_id, service_payload.value("dataOrigin", "manual")});
  }

  const auto query_terms = tokenizeChinese(request.current_question);
  if (!knowledge_revision_ids.empty() && !query_terms.empty()) {
    const json manifest = knowledge_revision_ids;
    const auto rows = tx.exec_params(R"(
      SELECT c.id, c.revision_id, c.body, c.section, r.title, r.metadata,
        ts_rank_cd(c.search_vector, to_tsquery('simple', $2)) AS rank
      FROM knowledge_chunks c
      JOIN knowledge_revisions r ON r.id = c.revision_id
      JOIN knowledge_entries e ON e.id = r.entry_id
      WHERE c.revision_id IN (SELECT jsonb_array_elements_text($1::jsonb))
        AND c.tokenizer_version = $3
        AND r.metadata->>'trainingScope' = $4
        AND (e.scope = 'general' OR e.service_id = $5)
        AND ($6 = '' OR e.topic = $6)
        AND c.search_vector @@ to_tsquery('simple', $2)
      ORDER BY rank DESC, c.revision_id, c.ordinal
      LIMIT 6
    )", manifest.dump(), tsQuery(query_terms), std::string(kTokenizerVersion), training_scope,
        service_id, request.topic.value_or(""));
    for (const auto& row : rows) {
      const auto metadata = json::parse(row["metadata"].c_str());
      bundle.passages.push_back({"E" + std::to_string(evidence++), row["id"].c_str(),
          row["revision_id"].c_str(), row["title"].c_str(), row["body"].c_str(),
          metadataString(metadata, "applicability"), metadataString(metadata, "sourceTitle"),
          metadataString(metadata, "sourceUrl").empty() ? std::nullopt
              : std::optional<std::string>(metadataString(metadata, "sourceUrl")),
          metadataString(metadata, "sourceLocator").empty() ? std::nullopt
              : std::optional<std::string>(metadataString(metadata, "sourceLocator"))});
    }
  }
  bundle.retrieval_status = bundle.facts.empty() && bundle.passages.empty()
      ? RetrievalStatus::NoHit : RetrievalStatus::Ok;
  return bundle;
}

json RagRetriever::previewKnowledge(const std::string& actor_id, const std::string& entry_id,
                                    int draft_version, const std::string& question) const {
  auto connection = database_pool_->acquire();
  pqxx::read_transaction tx(connection.get());
  const auto rows = tx.exec_params(R"(
    SELECT e.topic, e.scope, e.service_id, d.title, d.body, d.metadata, d.draft_version
    FROM users u, knowledge_entries e JOIN knowledge_drafts d ON d.entry_id = e.id
    WHERE u.id = $1 AND u.role = 'admin' AND u.status = 'active' AND e.id = $2
  )", actor_id, entry_id);
  if (rows.empty()) throw std::runtime_error("knowledge draft not found");
  if (rows[0]["draft_version"].as<int>() != draft_version) {
    throw std::invalid_argument("draft version conflict");
  }
  const auto title = std::string(rows[0]["title"].c_str());
  const auto body = std::string(rows[0]["body"].c_str());
  const auto metadata = json::parse(rows[0]["metadata"].c_str());
  const auto chunks = chunkKnowledge(title, body, metadata);
  const auto effective_query = question.empty() ? title : question;
  const auto query_terms = tokenizeChinese(effective_query);
  struct Hit { double score; const KnowledgeChunkDraft* chunk; };
  std::vector<Hit> hits;
  for (const auto& chunk : chunks) {
    const auto score = overlapScore(query_terms, chunk.terms);
    if (score > 0.0 || question.empty()) hits.push_back({score, &chunk});
  }
  std::sort(hits.begin(), hits.end(), [](const Hit& left, const Hit& right) {
    if (std::abs(left.score - right.score) > 0.000001) return left.score > right.score;
    return left.chunk->ordinal < right.chunk->ordinal;
  });
  if (hits.size() > 6) hits.resize(6);
  json evidence = json::array();
  for (std::size_t i = 0; i < hits.size(); ++i) {
    evidence.push_back({{"evidenceId", "E" + std::to_string(i + 1)},
                        {"title", title}, {"body", hits[i].chunk->body},
                        {"section", hits[i].chunk->section},
                        {"score", std::round(hits[i].score * 1000.0) / 1000.0},
                        {"applicability", metadataString(metadata, "applicability")}});
  }
  const auto status = evidence.empty() ? "no_hit" : "ok";
  const auto answer = evidence.empty()
      ? "当前草稿没有命中该问题，请补充更明确的资料或关键词。"
      : "已命中当前草稿中的可引用内容，训练回答将只使用下方依据。";
  return {{"entityId", entry_id}, {"draftVersion", draft_version},
          {"query", effective_query}, {"tokenizerVersion", kTokenizerVersion},
          {"retrievalStatus", status}, {"answer", answer}, {"evidence", evidence}};
}

}  // namespace oral_training::rag
