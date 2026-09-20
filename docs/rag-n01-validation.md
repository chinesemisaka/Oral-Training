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

## 远端 Windows CI 第一次运行

[Run 35498088974](https://github.com/chinesemisaka/Oral-Training/actions/runs/35498088974)，提交 `ee18c85`：MSVC Release 全量构建通过；CTest 9 Passed、0 Failed、database_feature 1 Skipped（CTest 阶段未设置测试库变量）。证据校验、retriever、报告/安全配置、客户端恢复和静态检查全部通过；knowledge_store_database_test 通过。

后续 knowledge_admin_api.ps1 失败：测试库仅执行 001—011，而当前后端已经依赖 019 的 free_description 字段，创建角色互换会话返回 500。无模型 API/状态机/并发测试因此跳过。该失败是同步上游后的测试初始化与当前 schema 不一致。

修复测试基础设施：当前后端 API smoke 和 workflow 的当前库初始化按名称顺序应用所有三位数字编号 SQL（当前 001—019），明确排除 `_seed_supervisor_test.sql`；专门的历史迁移 fixtures 保持原范围，已发布迁移没有修改。此修复为完成 N01 集成验证所需，未扩展到 N02。

## 远端 Windows CI 第二次运行

[Run 35498367274](https://github.com/chinesemisaka/Oral-Training/actions/runs/35498367274)，提交 `0cf18e7`：MSVC、CTest、迁移/知识存储及 knowledge_admin_api 全部通过，修复了测试库缺少 019 字段的问题。

数据库功能测试随后在原有“话术分类筛选”断言失败：fixture 同时为当前报告与 400 天前的历史报告写入相同分类话术，但断言只期待一条。该查询没有时间窗口，应该返回两份；修正为精确核对两份会话 ID、phraseKey 和分类，保留其他分类必须为空的断言，不修改业务代码。此处之前的失败阻止了无模型 HTTP smoke/状态机/并发测试继续执行。
