# N01 验证记录

日期：2026-09-20。上游基线：`a1ba5fb1ea028d74b64f4a1ca5917d8e05e8d740`。
分支：`fix/rag-n01`。先将个人 fork master 从 `3174405` 快进同步上游（24 个提交）。最新迁移为 `019_roleplay_free_template.sql`，本次未改迁移。

## 实施范围

共享 SHA-256、规范化 manifest、EvidenceValidator、结构化事实完整渲染、无合法选择时 unknown、固定沟通文本、确定性有据复盘、胜出事务校验、复盘引用展示。N02—N07 未开始。

实现选择：校验器采用 header-only，使纯离线测试无需依赖 Crow/WinHTTP/数据库；Windows 使用现有 BCrypt SHA-256，离线 Linux 测试使用 OpenSSL EVP。v2 复盘直接复用已公开且已经引用的证据，不新增模型契约或调用。原始旧 hash/trace 不改写，读取时验证并规范化；缺少服务范围元数据的旧 passage 不在新复盘复用。

## 已运行

环境：Linux、GCC 13、Node.js；nlohmann JSON v3.11.3，OpenSSL。下面的 `$JSON_INCLUDE` 指向包含 `nlohmann/json.hpp` 的依赖目录。

| 命令 | 结果 |
|---|---|
| `g++ -std=c++17 -Wall -Wextra -Werror -I "$JSON_INCLUDE" backend/tests/evidence_validator_test.cpp -lcrypto -o /tmp/evidence_validator_test && /tmp/evidence_validator_test` | Passed，退出码 0，58 项断言 |
| `g++ -std=c++17 -I "$JSON_INCLUDE" backend/tests/rag_contract_test.cpp -o /tmp/rag_contract_test && /tmp/rag_contract_test` | Passed，退出码 0 |
| `node backend/tests/roleplay_evidence_test.js` | Passed，退出码 0；正确引用、版本/ID/revision 不匹配、空会话 |
| `node backend/tests/client_recovery_test.js` | Passed，退出码 0 |
| 对仓库所有 JS 运行 `node --check`，对 JSON 执行解析 | Passed，50 个 JS、37 个 JSON，退出码 0 |
| `git diff --check` | Passed，退出码 0 |

SHA 标准向量包括空串、abc、一百万个 a。证据测试覆盖跨 trace 的同名 E1、跨服务 revision、未知 ID、重复 ID、未公开证据、manifest 顺序/去重、空知识快照、金额小数/范围/单位/起价/有效期、时长条件、无证据 unknown、部分缺失、冲突、不截断长证据、模型自由文本事实注入，以及复盘引用的哈希一致性。

初次以 `-Werror` 编译现有 rag_contract 时，原有 model_gateway.h 的未使用参数触发警告；按原项目非 Werror 设置编译后通过，未为此改动无关模型接口。

## 未运行与发布限制

- Windows/MSVC 完整构建、CTest：本地 Not run，当前环境无 Windows 编译工具。新证据测试和 UI 引用测试已经注册 CTest；待仓库 CI 验证。
- PostgreSQL 集成、历史 MD5 投影、任务并发/权限的数据库回归及无模型 HTTP smoke：本地 Not run，当前环境无 PostgreSQL。
- 新增 retriever 摘要不匹配测试已写入，但依赖 libpqxx 的 retriever 测试本地 Not run。
- 微信开发者工具模拟器/真机视觉与交互：Not run；仅完成脚本、JSON 和引用行为测试。
- 真实 DeepSeek：Not run，遵循 N07 前不调用真实模型的边界。

N01 状态为“实现完成，离线核心验证通过，Windows/数据库集成验收待确认”，不将核心单元测试等同于完整上线验收。需要 Windows CI/数据库回归通过后再开放发布。
