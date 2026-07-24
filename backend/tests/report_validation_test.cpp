#define ORAL_TRAINING_NO_MAIN
#include "../src/main.cpp"

#include <iostream>

int main() {
  const auto expected_reply = std::string("我还想了解一下具体需要检查什么。");
  const auto plain = parseModelJsonContent("{\"reply\":\"" + expected_reply + "\"}");
  const auto fenced = parseModelJsonContent("```json\n{\"reply\":\"" + expected_reply + "\"}\n```");
  const auto explained = parseModelJsonContent("下面是结果：\n{\"reply\":\"" + expected_reply + "\"}\n以上。");
  const auto thought = parseModelJsonContent("<think>内部思考不应参与解析</think>\n{\"reply\":\"" + expected_reply + "\"}");
  const auto encoded = parseModelJsonContent("\"{\\\"reply\\\":\\\"" + expected_reply + "\\\"}\"");
  if (plain["reply"] != expected_reply || fenced["reply"] != expected_reply ||
      explained["reply"] != expected_reply || thought["reply"] != expected_reply || encoded["reply"] != expected_reply) {
    std::cerr << "model JSON recovery did not preserve the reply\n";
    return 1;
  }
  try {
    (void)parseModelJsonContent("这不是 JSON");
    std::cerr << "invalid model content was accepted\n";
    return 1;
  } catch (const ApiError& error) {
    if (error.code != "MODEL_INVALID_RESPONSE") throw;
  }
  const auto plain_patient = plainPatientReply("患者：我还是有点担心疼痛。");
  if (plain_patient["reply"] != "患者：我还是有点担心疼痛。") {
    std::cerr << "plain patient fallback did not preserve the reply\n";
    return 1;
  }

  const json patient_state = {{"emotion", "犹豫"}, {"emotionLevel", -1}, {"trustLevel", 45}, {"riskTriggered", false}};
  const auto normalized_patient = normalizePatientReply(
      {{"reply", "我还是有些担心费用。"}, {"emotion", 123}, {"emotionLevel", "invalid"},
       {"trustLevel", 200}, {"newlyRevealedInformation", json::array({"预算有限", 42})},
       {"riskTriggered", "false"}, {"shouldEnd", "false"}},
      patient_state);
  if (normalized_patient["emotion"] != "犹豫" || normalized_patient["emotionLevel"] != -1 ||
      normalized_patient["trustLevel"] != 100 || normalized_patient["riskTriggered"] != false ||
      normalized_patient["shouldEnd"] != false || normalized_patient["newlyRevealedInformation"].size() != 1) {
    std::cerr << "patient reply fields were not normalized safely\n";
    return 1;
  }

  const auto json_request = buildCompletionRequest("deepseek-v4-flash", json::array(), 500, 0.4, true);
  const auto fallback_request = buildCompletionRequest("deepseek-v4-flash", json::array(), 1000, 0.0, false);
  if (json_request["response_format"]["type"] != "json_object" || fallback_request.contains("response_format") ||
      fallback_request["max_tokens"] != 1000 || fallback_request["thinking"]["type"] != "disabled") {
    std::cerr << "completion fallback request was not configured correctly\n";
    return 1;
  }

  const std::vector<std::string> dimension_keys = {
      "knowledgeAccuracy", "medicalCompliance", "empathy", "needsDiscovery", "serviceEtiquette",
  };
  json dimension_totals = json::object();
  for (const auto& key : dimension_keys) dimension_totals[key] = 0.0;
  accumulateDimensionScores(dimension_totals,
                            {{"dimensionScores", {{"knowledgeAccuracy", 80}, {"medicalCompliance", 90},
                                                   {"empathy", 75}, {"needsDiscovery", 70},
                                                   {"serviceEtiquette", 85}}}},
                            dimension_keys);
  if (dimension_totals["knowledgeAccuracy"].get<double>() != 80.0 ||
      dimension_totals["medicalCompliance"].get<double>() != 90.0) {
    std::cerr << "dimension scores were not accumulated numerically\n";
    return 1;
  }

  const json messages = json::array({
      {{"role", "patient"}, {"content", "需要拔牙吗？"}, {"round", 0}},
      {{"role", "user"}, {"content", "是否需要拔牙，要由医生结合检查结果评估。"}, {"round", 1}},
  });
  const json safe_report = {
      {"dimensionScores", {{"knowledgeAccuracy", 80}, {"medicalCompliance", 90}, {"empathy", 75},
                            {"needsDiscovery", 70}, {"serviceEtiquette", 85}}},
      {"summary", "能够说明医疗判断边界。"},
      {"strengths", json::array({{{"round", 1}, {"evidence", "说明需要医生评估"}, {"content", "合规边界清楚"}}})},
      {"improvements", json::array({{{"round", 1}, {"content", "可以先回应患者的担忧，再说明由医生评估。"}}})},
      {"violations", json::array()},
      {"roundComments", json::array({{{"round", 1}, {"userMessage", "错误的患者原话"},
                                        {"comment", "边界表达清楚。"},
                                        {"recommendedRewrite", "是否需要拔牙，要由医生结合检查结果评估。"}}})},
  };

  const auto normalized = normalizeReport(safe_report, messages);
  if (normalized["roundComments"][0]["userMessage"] != messages[1]["content"]) {
    std::cerr << "round comment was not grounded in the user message\n";
    return 1;
  }

  auto unsafe_report = safe_report;
  unsafe_report["roundComments"][0]["recommendedRewrite"] = "一般需要1-2年，费用2-5万元。";
  const auto normalized_unsafe = normalizeReport(unsafe_report, messages);
  if (normalized_unsafe["roundComments"][0]["recommendedRewrite"] ==
      unsafe_report["roundComments"][0]["recommendedRewrite"] ||
      normalized_unsafe["roundComments"][0]["recommendedRewrite"].get<std::string>().find("医生") == std::string::npos) {
    std::cerr << "unsafe advice was not replaced with a compliant fallback\n";
    return 1;
  }

  auto fabricated_quote_report = safe_report;
  fabricated_quote_report["violations"] = json::array({
      {{"round", 1}, {"originalQuote", "保证一定成功"}, {"type", "疗效保证"},
       {"reason", "不能作出绝对承诺。"}, {"deduction", 30},
       {"recommendedRewrite", "具体情况需要医生结合检查结果评估。"}},
  });
  try {
    (void)normalizeReport(fabricated_quote_report, messages);
    std::cerr << "fabricated quote was accepted\n";
    return 1;
  } catch (const ApiError& error) {
    if (error.code != "MODEL_INVALID_RESPONSE") throw;
  }

  std::cout << "report validation tests passed\n";
  return 0;
}
