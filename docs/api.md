# 口腔客服智能陪练 API 契约

版本：v3.0（可靠任务与单机构多用户）

Base URL 为 `https://<host>/api`。本机开发可使用 `http://127.0.0.1:8080/api`；体验版和正式版必须使用 HTTPS。

## 1. 通用约定

除健康检查和登录外，所有接口必须携带服务端会话令牌：

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

服务端不读取或信任 `X-Demo-User-Id`。成功与失败结构保持统一：

```json
{"code":0,"message":"ok","data":{}}
```

```json
{"code":"SESSION_ABANDONED","message":"已放弃的训练不能结束或恢复","data":null}
```

每个响应包含 `X-Request-Id`。时间为带时区的 ISO 8601 字符串；业务 ID 均为字符串。所有用户输入先去除首尾空白，再按 UTF-8 字符数校验，消息长度为 1—1000 个字符。

## 2. 登录、角色与数据范围

### `POST /auth/wechat`

请求：

```json
{"code":"wx.login 返回的临时 code"}
```

服务端在 `AUTH_MODE=wechat` 时通过微信 `jscode2session` 换取 `openid`，创建或读取本地用户，并返回不透明会话令牌。`AUTH_MODE=demo` 仅供本机和受控局域网使用，同一路径会登录保留的演示用户。

```json
{
  "accessToken":"仅此处返回的令牌",
  "expiresIn":604800,
  "user":{"id":"wx_...","role":"learner","displayName":"微信用户"}
}
```

角色只有：

- `learner`：只能访问自己的场景进度、会话、消息、历史和个人看板。
- `admin`：只能读取当前单一机构的聚合看板，不返回个人会话明细，不能使用训练接口。

本轮不提供多机构租户、排行榜或团队运营接口。

## 3. 健康检查

### `GET /health`

无需登录。响应不包含任务内容、Prompt 或密钥：

```json
{
  "database":true,
  "modelConfigured":true,
  "workerRunning":true,
  "pendingJobs":0,
  "deadJobs":0,
  "runtimeApiKeyAllowed":false,
  "authMode":"wechat",
  "production":true
}
```

## 4. 客服训练

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/scenarios` | 场景、本人最佳分和本人进行中会话 |
| `POST` | `/sessions` | 创建会话，body 为 `{"scenarioId":"implant-basic"}` |
| `GET` | `/sessions` | 本人历史；支持 `status`、`scenarioId`、`limit` |
| `GET` | `/sessions/{id}` | 会话、完整消息和待恢复输入 |
| `POST` | `/sessions/{id}/restart` | 放弃进行中会话并创建新会话 |
| `POST` | `/sessions/{id}/messages` | 提交客服输入并获取模拟患者回复 |
| `POST` | `/sessions/{id}/finish` | 结束会话并可靠入队评分任务 |
| `GET` | `/sessions/{id}/evaluation` | 获取 `not_started/generating/ready/failed` |
| `POST` | `/sessions/{id}/evaluation/retry` | 仅对失败评分人工重试 |

### 消息幂等与回复租约

请求：

```json
{"clientMessageId":"client-msg-123","content":"我理解您的担忧……"}
```

- 相同 `clientMessageId` 和相同清理后内容返回原消息对。
- 相同 ID 与不同内容返回 `409 IDEMPOTENCY_CONFLICT`。
- 首个请求领取 180 秒回复生成租约。租约有效时，并发请求返回 `409 SESSION_RESPONSE_PENDING`，不会发起第二次模型调用。
- 模型失败或租约过期后，只有相同 ID 和内容可以重新领取。
- `GET /sessions/{id}` 的 `pendingMessage` 包含 `clientMessageId`、`content`、`round`、`replyStatus`；前端应轮询会话，并在超时后保留原 ID 和输入。

最后一轮的患者回复、输入状态 `ready`、会话 `completed`、评分 `generating` 和任务入队在同一数据库事务内提交。

### 结束与重试

- 零轮会话返回 `422 MIN_ROUNDS_NOT_REACHED`。
- `abandoned` 永远不能恢复为 `completed`，返回 `409 SESSION_ABANDONED`。
- 重复结束已完成会话只返回当前状态，不新建任务，也不隐式重试失败任务。
- 失败评分只能调用 `/evaluation/retry` 重新入队。

## 5. 患者模拟（角色互换）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/roleplay/scenarios` | 场景、建议问题和本人进行中会话 |
| `POST` / `GET` | `/roleplay/sessions` | 创建或查询本人会话 |
| `GET` | `/roleplay/sessions/{id}` | 会话、消息及待恢复问题 |
| `POST` | `/roleplay/sessions/{id}/restart` | 放弃并重新创建 |
| `POST` | `/roleplay/sessions/{id}/messages` | 提交患者问题，获取标准客服答复 |
| `POST` | `/roleplay/sessions/{id}/finish` | 结束并可靠入队复盘任务 |
| `GET` | `/roleplay/sessions/{id}/summary` | 获取复盘状态或内容 |
| `POST` | `/roleplay/sessions/{id}/summary/retry` | 仅对失败复盘人工重试 |

角色互换使用相同的幂等规则，生成中错误码为 `ROLEPLAY_RESPONSE_PENDING`，放弃错误码为 `ROLEPLAY_SESSION_ABANDONED`。标准客服消息额外包含：

```json
{
  "learningPoints":["学习要点"],
  "complianceBoundary":"具体诊疗判断需由医生结合检查评估。"
}
```

复盘不含数值评分，结构为 `summary`、`coveredTopics`、`keyPrinciples` 和 `nextPracticeSuggestions`。

## 6. 评分规则

总分只使用一次固定五维加权，不再按违规二次扣减：

| 字段 | 权重 |
|---|---:|
| `knowledgeAccuracy` | 25% |
| `medicalCompliance` | 25% |
| `empathy` | 20% |
| `needsDiscovery` | 20% |
| `serviceEtiquette` | 10% |

单项违规 `deduction` 归一到 0—50，仅用于解释。如果存在 `deduction >= 30` 的严重违规且 `medicalCompliance > 60`，该次结果判定为 `MODEL_SCORE_INCONSISTENT`，由可靠任务机制按策略重试。

## 7. 可靠 AI Worker

API 和 Worker 运行在同一个便携程序中。Worker 默认并发 1，可配置到 4；使用 `FOR UPDATE SKIP LOCKED` 领取任务，租约 180 秒。去重键为：

- `evaluation:{sessionId}`
- `roleplay-summary:{sessionId}`

瞬时错误最多尝试 3 次，第一次失败后等待 5 秒，第二次失败后等待 30 秒。未配置模型、鉴权失败、内容过滤或不安全输出等非瞬时错误直接进入 `dead` 并把业务状态置为 `failed`。Worker 会回收过期租约；数据库中断时在进程内退避，异常不会逃出线程。

## 8. 看板

### `GET /dashboard/summary`

`scope` 为 `personal` 或 `institution`。学员收到个人统计和最近 5 条本人会话；管理员收到单机构聚合，`recentSessions` 为空，避免泄露个人会话。

## 9. 错误码

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `INVALID_ARGUMENT` | 参数、JSON、UTF-8 或字符长度无效 |
| 400 | `HTTPS_REQUIRED` | 生产入口未通过 HTTPS 代理 |
| 401 | `AUTH_REQUIRED` / `AUTH_INVALID` / `AUTH_EXPIRED` | 缺少、无效或过期令牌 |
| 401 | `WECHAT_LOGIN_FAILED` | 微信 code 无效或过期 |
| 403 | `ROLE_FORBIDDEN` | 角色无权访问该类接口 |
| 403 | `ORIGIN_FORBIDDEN` | Origin 不在精确允许列表 |
| 404 | `SCENARIO_NOT_FOUND` | 场景不存在 |
| 404 | `SESSION_NOT_FOUND` / `ROLEPLAY_SESSION_NOT_FOUND` | 会话不存在或不属于本人 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一幂等 ID 对应不同内容 |
| 409 | `SESSION_RESPONSE_PENDING` | 模拟患者回复租约有效 |
| 409 | `ROLEPLAY_RESPONSE_PENDING` | 标准客服回复租约有效 |
| 409 | `SESSION_ABANDONED` | 客服训练会话已放弃 |
| 409 | `ROLEPLAY_SESSION_ABANDONED` | 患者模拟会话已放弃 |
| 409 | `SESSION_IN_PROGRESS` / `ROLEPLAY_SESSION_IN_PROGRESS` | 同场景已有进行中会话 |
| 409 | `EVALUATION_NOT_RETRYABLE` / `ROLEPLAY_SUMMARY_NOT_RETRYABLE` | 当前任务不可人工重试 |
| 422 | `MIN_ROUNDS_NOT_REACHED` | 尚未完成一轮 |
| 429 | `RATE_LIMITED` | 用户/IP 速率超限 |
| 503 | `MODEL_NOT_CONFIGURED` / `MODEL_AUTH_FAILED` | 模型配置不可用 |
| 503 | `MODEL_TIMEOUT` / `MODEL_RATE_LIMITED` / `MODEL_ERROR` | 模型瞬时错误 |
| 503 | `MODEL_INVALID_RESPONSE` / `MODEL_SCORE_INCONSISTENT` | 模型结果无效或评分矛盾 |

## 10. 兼容与安全边界

现有成功响应数据结构和全部业务路径保持兼容。DeepSeek 请求地址、请求参数、Prompt、响应解析与模型调用内部重试逻辑未改变。生产环境必须设置 `PRODUCTION=true`、`AUTH_MODE=wechat`、精确 `ALLOWED_ORIGIN`、`REQUIRE_HTTPS=true`，并在 HTTPS 反向代理后运行；运行时密钥上传会自动关闭。
