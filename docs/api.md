# AI口腔客服陪练小程序 — 后端接口文档（草稿 v1.0）

> 本文档根据前端小程序现有代码整理，用于明确前后端数据接口约定。
> 前端请求封装：`static/api/request.js`，统一前缀 `app.globalData.apiBaseUrl`。

## 0. 通用约定

**请求头**
```
Content-Type: application/json
Authorization: Bearer <token>   // token 取自 wx.storage 'token'，未登录可空
```

**统一响应结构**（前端 `request.js` 已按此解析，成功时 `resolve(res.data.data)`）
```json
{
  "code": 0,          // 0 成功，非 0 业务失败
  "message": "ok",    // 失败时的提示信息
  "data": { }         // 业务数据
}
```

**状态码约定**
- `200` + `code:0` → 成功
- `401` → 未授权/登录过期（前端会清空 storage 并提示重新登录）
- 其他 `statusCode` → 网络错误

**数据格式约定**
- 日期时间字符串：`MM-DD HH:mm`（如 `06-11 14:30`），由后端格式化后返回
- 分数：整数 0–100

---

## 1. 用户与登录

### 1.1 登录
- **接口**：`POST /login`
- **说明**：微信小程序登录，换取 token 与用户信息（前端目前用本地假数据，需对接）
- **请求参数**：
```json
{ "code": "微信 wx.login 返回的 code" }
```
- **返回 data**：
```json
{
  "token": "eyJhbGci...",
  "userInfo": {
    "nickname": "口腔客服",
    "avatar": "/static/images/default-avatar.png",
    "level": 3,
    "totalScore": 2850,
    "title": "金牌客服"
  }
}
```
- **前端消费位置**：`mine.js loadUserInfo()`、`index.js loadUserInfo()`（目前取本地 `userInfo`，需改为调此接口）

### 1.2 获取用户统计
- **接口**：`GET /user/stats`
- **说明**：我的页顶部统计 + 连续打卡天数
- **返回 data**：
```json
{
  "totalTrainings": 28,
  "totalScore": 2850,
  "rank": 5,
  "continuousDays": 7
}
```
- **前端消费位置**：`mine.js loadStats()`
- ⚠️ 注意：`continuousDays` 前端已改为从打卡记录动态计算（`calcContinuousDays`），建议后端也按打卡记录返回真实值。

---

## 2. 首页

### 2.1 热门话术列表
- **接口**：`GET /scripts/hot`
- **说明**：首页"热门话术"卡片（前端当前为 `home.js` 写死假数据，需对接）
- **返回 data**：
```json
{
  "list": [
    {
      "id": 1,
      "title": "种植牙咨询专业解答",
      "summary": "患者来电咨询种植牙流程和注意事项...",
      "tags": ["种植牙", "咨询", "专业解答"],
      "score": 96,
      "usageCount": 1280,
      "dialogues": [
        { "role": "patient", "text": "你好，我想了解一下种植牙大概是什么流程？" },
        { "role": "service", "text": "您好！种植牙一般分为三个阶段..." }
      ]
    }
  ]
}
```
- **前端消费位置**：`home.js loadMockData()` → `hotScripts`

---

## 3. 训练中心

### 3.1 训练场景分类列表
- **接口**：`GET /scenarios`
- **说明**：训练页四大分类及下属场景（前端当前为 `index.js` 写死假数据）
- **返回 data**：
```json
{
  "list": [
    {
      "id": "consult",
      "name": "咨询解答",
      "icon": "💬",
      "color": "#007aff",
      "description": "应对患者各类咨询，专业解答口腔问题",
      "completedCount": 1,
      "totalCount": 4,
      "scenarios": [
        {
          "id": 101,
          "name": "种植牙咨询",
          "difficulty": "easy",
          "scenarioDescription": "患者来电咨询种植牙流程和注意事项...",
          "passingScore": 70,
          "isCompleted": true,
          "bestScore": 82
        }
      ]
    }
  ]
}
```
- **前端消费位置**：`index.js loadMockData()` → `categories`

### 3.2 开始训练（创建会话）
- **接口**：`POST /training/start`
- **说明**：进入对话训练页，获取患者画像与开场白（前端当前为 `training.js getLevelConfig` 写死）
- **请求参数**：
```json
{ "scenarioId": 101 }
```
- **返回 data**：
```json
{
  "conversationId": "1718000000000",
  "levelName": "种植牙咨询",
  "patientProfile": "25岁女性，预算有限...",
  "initMessage": "我就想洗个牙，别的什么都不想做...",
  "remainingTurns": 20
}
```
- **前端消费位置**：`training.js startTraining()`

### 3.3 发送消息（AI 回复）
- **接口**：`POST /training/message`
- **说明**：客服发送一条回复，AI 返回患者下一句 + 黄金话术建议（前端当前为 `training.js getAIResponse` 写死）
- **请求参数**：
```json
{
  "conversationId": "1718000000000",
  "content": "我们洗牙套餐包含全面口腔检查哦",
  "turn": 2
}
```
- **返回 data**：
```json
{
  "reply": "还是太贵了，我就只想洗个牙。",
  "suggestedReply": "我理解您对价格的关心。我们的洗牙套餐虽然是9.9元...",
  "isEnd": false,
  "remainingTurns": 18
}
```
- **结束条件**：前端在 `content` 含"预约/到店/检查"或轮次≥10 时调用结束接口（见 3.4）
- **前端消费位置**：`training.js sendMessage()`

### 3.4 结束训练（提交评分）
- **接口**：`POST /training/end`
- **说明**：训练结束，提交对话记录由后端评分（前端当前为 `training.js endTraining` 用随机分，需对接）
- **请求参数**：
```json
{
  "conversationId": "1718000000000",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "ai", "content": "..." }
  ]
}
```
- **返回 data**：
```json
{
  "conversationId": "1718000000000",
  "totalScore": 82,
  "empathyScore": 88,
  "demandScore": 75,
  "valueScore": 82,
  "appointmentScore": 70,
  "complianceScore": 92
}
```
- **前端跳转**：`training.js endTraining()` 目前把分数拼到 URL 跳 `result` 页，建议改为拿 `conversationId` 跳 `result?conversationId=xxx`，由结果页拉取（见 4.1）

---

## 4. 训练结果

### 4.1 获取训练结果
- **接口**：`GET /result/{conversationId}`
- **说明**：结果页五维评分与雷达图
- **路径参数**：`conversationId`
- **返回 data**：
```json
{
  "totalScore": 82,
  "empathyScore": 88,
  "demandScore": 75,
  "valueScore": 82,
  "appointmentScore": 70,
  "complianceScore": 92,
  "levelInfo": {}
}
```
- **前端消费位置**：`result.js loadResult()`（已调用，当前未接真实后端）
- 前端根据 `totalScore >= 60` 判定通过，并自行生成文字评价（按 85/70/60 分档）

---

## 5. 报告页

### 5.1 个人汇总报告
- **接口**：`GET /report/summary`
- **说明**：报告页综合概览 / 历史 / 错题 / 成长轨迹四个标签页的数据源
- **返回 data**：
```json
{
  "stats": {
    "totalTrainings": 28,
    "avgScore": 82.5,
    "bestScore": 96,
    "totalHours": 14.5
  },
  "scores": [
    { "name": "共情能力", "value": 88, "color": "#007aff" },
    { "name": "需求挖掘", "value": 75, "color": "#52c41a" },
    { "name": "价值传递", "value": 82, "color": "#fa8c16" },
    { "name": "预约促成", "value": 70, "color": "#f5222d" },
    { "name": "合规表达", "value": 92, "color": "#722ed1" }
  ],
  "recentTrainings": [
    { "id": 1, "levelName": "种植牙咨询解答", "time": "06-11 14:30", "score": 92 }
  ],
  "mistakeList": [
    {
      "id": 1,
      "sceneType": "价格异议",
      "time": "06-10 16:20",
      "userMessage": "我们这个价格已经是最便宜的了...",
      "suggestedReply": "理解您的顾虑，价格确实是考虑因素之一...",
      "levelId": 2
    }
  ],
  "redFlagStats": [
    { "word": "最便宜", "count": 2 },
    { "word": "保证", "count": 3 }
  ],
  "levelProgress": [
    {
      "id": 1,
      "name": "种植牙咨询解答",
      "progress": 100,
      "status": "已通关",
      "scenarioDescription": "专业解答种植牙流程与注意事项"
    }
  ]
}
```
- **前端消费位置**：`report.js loadReportData()`（已调用，catch 中为写死假数据）
- **字段与前端 `setData` 的对应关系**：
  - `stats` → 顶部四个统计卡（总训练次数 / 平均分 / 最高分 / 训练时长）
  - `scores` → 能力雷达图五维条形
  - `recentTrainings` → 训练历史列表 + 得分趋势图（取最后 7 条）
  - `mistakeList` → 错题本
  - `redFlagStats` → 薄弱项分析（违规词统计）
  - `levelProgress` → 推荐练习 + 关卡通关进度

### 5.2 单次训练详情
- **接口**：`GET /report/detail/{conversationId}`
- **说明**：从报告历史或结果页点击进入的单次对话详情
- **路径参数**：`conversationId`
- **返回 data**：建议复用 5.1 中单条 `recentTrainings` 的结构，并补充完整对话：
```json
{
  "id": 1,
  "levelName": "种植牙咨询解答",
  "time": "06-11 14:30",
  "score": 92,
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "ai", "content": "..." }
  ]
}
```
- **前端消费位置**：`report.js loadReportData()`（当 `conversationId` 存在时调用，已写）

---

## 6. 排行榜

### 6.1 排行榜列表
- **接口**：`GET /rank/list`
- **说明**：报告页"排行榜"标签页
- **返回 data**：
```json
{
  "rankList": [
    {
      "rank": 1,
      "nickname": "张主任",
      "avatar": "",
      "title": "金牌客服",
      "totalScore": 9680,
      "avgScore": 96.8,
      "trainings": 42,
      "isMe": false
    }
  ],
  "myRank": {
    "rank": 5,
    "totalScore": 8520,
    "avgScore": 85.2
  }
}
```
- **前端消费位置**：`report.js loadRankData()`（已调用，catch 中为写死假数据）
- ⚠️ 注意：前端排行榜展示的是 `avgScore`（均分），`totalScore` 字段保留备用；`isMe` 用于高亮当前用户。

---

## 7. 打卡（新增，需后端持久化）

> 当前打卡仅存本地 `wx.setStorageSync('checkedDates')`，重新编译/清缓存即丢失。需后端接口实现持久化，前端 `mine.js` 的 `initCalendar` / `doCheckIn` 改为调接口。

### 7.1 获取打卡记录
- **接口**：`GET /checkin`
- **说明**：返回当前用户已打卡日期列表
- **返回 data**：
```json
{
  "checkedDates": ["2026-06-10", "2026-06-11", "2026-06-12"]
}
```
- **前端消费位置**：`mine.js initCalendar()` 中读取 `wx.getStorageSync('checkedDates')` → 改为调此接口

### 7.2 提交打卡
- **接口**：`POST /checkin`
- **说明**：今日打卡
- **请求参数**：
```json
{ "date": "2026-06-12" }
```
- **返回 data**：
```json
{
  "checkedDates": ["2026-06-10", "2026-06-11", "2026-06-12"],
  "continuousDays": 3
}
```
- **前端消费位置**：`mine.js doCheckIn()` 中 `wx.setStorageSync` → 改为调此接口，并用返回的 `continuousDays` 更新 `stats.continuousDays`

---

## 8. 接口清单速览

| 编号 | 方法 | 路径 | 状态 | 前端位置 |
|------|------|------|------|---------|
| 1.1 | POST | `/login` | 待对接（当前本地假数据） | mine/index loadUserInfo |
| 1.2 | GET | `/user/stats` | ✅ 已调用，catch 兜底 | mine loadStats |
| 2.1 | GET | `/scripts/hot` | 待对接（写死） | home loadMockData |
| 3.1 | GET | `/scenarios` | 待对接（写死） | index loadMockData |
| 3.2 | POST | `/training/start` | 待对接（写死） | training startTraining |
| 3.3 | POST | `/training/message` | 待对接（写死） | training sendMessage |
| 3.4 | POST | `/training/end` | 待对接（随机分） | training endTraining |
| 4.1 | GET | `/result/{conversationId}` | ✅ 已调用 | result loadResult |
| 5.1 | GET | `/report/summary` | ✅ 已调用，catch 兜底 | report loadReportData |
| 5.2 | GET | `/report/detail/{id}` | ✅ 已调用 | report loadReportData |
| 6.1 | GET | `/rank/list` | ✅ 已调用，catch 兜底 | report loadRankData |
| 7.1 | GET | `/checkin` | 🆕 新增（当前本地） | mine initCalendar |
| 7.2 | POST | `/checkin` | 🆕 新增（当前本地） | mine doCheckIn |
| 8.1 | GET | `/admin/dashboard` | ⚠️ 前端已调用但文档未记录 | admin onLoad |

**图例**：✅ 前端已写好调用（后端按文档返回即可）；待对接 前端写死假数据待替换；🆕 当前仅本地存储，需新增后端接口。

---

## 9. 给后端的备注（可删）

1. **统一返回结构**：前端 `request.js` 只在 `code===0` 时 `resolve(data)`，其余 `reject(message)`，请保证所有接口遵循第 0 节结构。
2. **日期格式**：前端直接展示后端返回的字符串，请按 `MM-DD HH:mm` 返回，避免前端再转换。
3. **分数范围**：所有 score 字段为 0–100 整数，前端雷达图/进度条按百分比渲染。
4. **登录态**：`Authorization: Bearer <token>` 由前端自动携带，未登录时为空，后端对需登录接口返回 401。
5. **打卡持久化**是当务之急：当前本地存储方案在清缓存/重编译时会丢失连续天数数据（即用户最初反馈的"昨天打卡今天看不到"问题），建议优先实现第 7 节接口。
