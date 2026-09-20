#include "../src/rag_retriever.h"
#include "../src/rag_manifest.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

bool has(const std::vector<std::string>& values, const std::string& value) {
  return std::find(values.begin(), values.end(), value) != values.end();
}

}  // namespace

int main() {
  try {
    oral_training::rag::RagRetriever retriever(nullptr);
    oral_training::rag::RetrievalRequest request;
    bool mismatched_hash_rejected = false;
    try {
      retriever.retrieve("sr1", {"kr1"}, "2026-09-20", "kr1", request);
    } catch (const std::runtime_error&) { mismatched_hash_rejected = true; }
    require(mismatched_hash_rejected, "manifest mismatch must fail before database access");
    const auto price = oral_training::rag::tokenizeChinese("这个项目多少钱？");
    const auto quote = oral_training::rag::tokenizeChinese("请问报价和收费标准");
    require(has(price, "a_price") && has(quote, "a_price"), "price aliases must converge");

    const auto full_width = oral_training::rag::tokenizeChinese("ＡＢＣ １２３");
    require(has(full_width, "w_abc") && has(full_width, "w_123"),
            "full-width ASCII must normalize");

    const std::string sentence = "种植牙不保证一次完成，也不代表无需复诊。";
    const nlohmann::json metadata = {
        {"aliases", {"种牙"}}, {"applicability", "成年人模拟咨询"}};
    const auto short_chunks = oral_training::rag::chunkKnowledge("种植说明", sentence, metadata);
    require(short_chunks.size() == 1 && short_chunks[0].body == sentence,
            "chunking must preserve negation and original text");
    require(has(oral_training::rag::tokenizeChinese(short_chunks[0].body), "a_dental_implant"),
            "controlled implant alias must be indexed");

    std::string long_body;
    for (int i = 0; i < 1100; ++i) long_body += "牙";
    const auto chunks = oral_training::rag::chunkKnowledge("长文", long_body, metadata);
    require(chunks.size() >= 3, "long text must be split");
    for (std::size_t i = 0; i < chunks.size(); ++i) {
      require(chunks[i].ordinal == static_cast<int>(i), "chunk ordinals must be stable");
      require(chunks[i].source_end > chunks[i].source_start, "chunk source offsets required");
      require(chunks[i].source_end - chunks[i].source_start <= 450,
              "chunk must stay below database limit");
    }

    require(oral_training::rag::tokenizeChinese("牙套费用") ==
            oral_training::rag::tokenizeChinese("牙套费用"), "tokenization must be deterministic");
    std::cout << "rag retriever tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
