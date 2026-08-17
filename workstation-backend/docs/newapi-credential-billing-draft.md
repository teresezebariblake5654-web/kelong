# 一期草案：App 登录 + 1701(New API) 令牌代管 + 额度展示

> 目标：用户只登录使用；Key 由运营在后台人工绑定；扣费与充值主要在 [1701.store](https://1701.store/)；App 同步展示额度/流水。  
> 对齐现有：`User` / `Organization` / `/api/v1/auth` / `/api/v1/credits`。  
> 状态：**设计草稿，未实现**。

---

## 0. 原则

| 原则 | 说明 |
|------|------|
| 真相源 | **额度真相在 1701**；本地账本可选缓存，冲突时以 1701 为准 |
| Key 不下发 | `sk-xxx` 只存服务端，前端/Electron 永不展示明文 |
| 一期人工 | 不做自动开户/自助充值；运营在 1701 开 Token 后写入绑定表 |
| 有道旁路 | 不走 `lobsterai-server` 计费；AI 出站统一打 `LLM_BASE_URL`（如 `https://1701.store/v1`） |

```text
用户登录 App
  → JWT（现有 /api/v1/auth）
  → 后端查 LlmCredential（用户或组织绑定的 sk）
  → 调 1701 /v1/chat/completions
  → 额度页调 1701 GET /api/usage/token 回写缓存并返回前端
```

---

## 1. 表字段草案

### 1.1 `LlmCredential`（核心：App 用户 ↔ 中转站令牌）

一人一活跃令牌（一期）；预留多令牌。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | String (cuid) | PK | |
| `userId` | String | FK → User, index | 归属用户 |
| `organizationId` | String? | FK → Organization, index | 可选：企业共用一把 Key |
| `provider` | String | default `newapi` | 预留多中转 |
| `baseUrl` | String | default `https://1701.store` | 不含 `/v1` 亦可，服务端规范化 |
| `tokenName` | String? | | 运营备注（如「张三-正式」） |
| `tokenHint` | String | | 脱敏展示，如 `sk-***ABCD` |
| `tokenCipher` | String | | 加密后的完整 Token（AES-GCM / KMS） |
| `tokenHash` | String | unique | sha256(token)，防重复绑定 |
| `externalUserId` | String? | | 1701 侧用户 id（可选，人工填） |
| `status` | String | `active` \| `disabled` \| `revoked` | |
| `isPrimary` | Boolean | default true | 同用户多 Key 时选主 |
| `lastVerifiedAt` | DateTime? | | 最近一次成功调 usage |
| `lastSyncAt` | DateTime? | | 最近一次额度同步 |
| `createdByAdminId` | String? | | 录入的管理员 User.id |
| `createdAt` | DateTime | | |
| `updatedAt` | DateTime | | |

**建议索引**

- `@@unique([userId, tokenHash])`
- `@@index([userId, status])`
- `@@index([organizationId, status])`

**Prisma 草稿**

```prisma
model LlmCredential {
  id               String    @id @default(cuid())
  userId           String
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId   String?
  organization     Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  provider         String    @default("newapi")
  baseUrl          String    @default("https://1701.store")
  tokenName        String?
  tokenHint        String
  tokenCipher      String
  tokenHash        String    @unique
  externalUserId   String?
  status           String    @default("active")
  isPrimary        Boolean   @default(true)
  lastVerifiedAt   DateTime?
  lastSyncAt       DateTime?
  createdByAdminId String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  quotaSnapshots   LlmQuotaSnapshot[]
  usageSyncLogs    LlmUsageSyncLog[]

  @@index([userId, status])
  @@index([organizationId, status])
}
```

---

### 1.2 `LlmQuotaSnapshot`（额度缓存，给 App 快开）

每次拉 1701 [`GET /api/usage/token`](https://doc.newapi.pro/api/token-usage/) 写一条或 upsert 最新。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | PK |
| `credentialId` | String | FK → LlmCredential |
| `userId` | String | 冗余，方便按用户查 |
| `totalGranted` | BigInt / Decimal | 对应 New API `total_granted` |
| `totalUsed` | BigInt / Decimal | `total_used` |
| `totalAvailable` | BigInt / Decimal | `total_available` |
| `unlimitedQuota` | Boolean | |
| `expiresAt` | DateTime? | New API `expires_at`（0=永不过期→null） |
| `rawJson` | Json? | 原始响应，排障用 |
| `fetchedAt` | DateTime | 拉取时间 |

**一期可只保留「每 credential 最新一行」**（`credentialId` unique），二期再做历史曲线。

---

### 1.3 `LlmUsageSyncLog`（可选：流水镜像）

New API 若有日志/明细 API，则定时同步；没有则一期用「会话侧本地 UsageLog」凑合。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | PK |
| `credentialId` | String | |
| `userId` | String | |
| `externalId` | String? | 中转站日志 id，幂等 |
| `model` | String? | |
| `promptTokens` | Int? | |
| `completionTokens` | Int? | |
| `quotaCost` | Decimal? | 中转站扣的额度单位 |
| `requestId` | String? | |
| `occurredAt` | DateTime | 中转站侧时间 |
| `syncedAt` | DateTime | |
| `rawJson` | Json? | |

`@@unique([credentialId, externalId])`

---

### 1.4 与现有表的关系（不要混用真相源）

| 现有表 | 一期怎么用 |
|--------|------------|
| `User` / `RefreshToken` / `/api/v1/auth` | **继续用**：App 登录态 |
| `CreditAccount` / `CreditLedger` | **暂停作为 AI 扣费真相**；可标 `billingMode=external_newapi`，或仅做「赠送活动积分」 |
| `User.credits` | 废弃或只读展示「本地赠送」；主展示走 Snapshot |
| `UsageLog` | 可继续记「本系统发起了哪些任务」；金额以 1701 为准 |

新增配置建议（env）：

```env
NEWAPI_BASE_URL=https://1701.store
NEWAPI_USAGE_PATH=/api/usage/token
LLM_BASE_URL=https://1701.store/v1
# 加密 LlmCredential.tokenCipher 用
CREDENTIAL_ENCRYPTION_KEY=...
# 出站模式：per_user_token | shared_env_token
LLM_CREDENTIAL_MODE=per_user_token
```

---

## 2. 接口草稿

统一前缀：`/api/v1`  
鉴权：`Authorization: Bearer <access_jwt>`（与现有 auth 一致）  
响应：沿用 `{ success, data, message?, code? }`

### 2.1 用户侧（App / 用户中心）

#### `GET /api/v1/billing/quota`

当前登录用户主令牌的额度（优先读缓存，可 `?refresh=1` 强制打 1701）。

**Query**

| 参数 | 说明 |
|------|------|
| `refresh` | `0` \| `1`，默认 `0`；为 1 时调 New API 并更新 Snapshot |

**200 data**

```json
{
  "provider": "newapi",
  "tokenHint": "sk-***YBgR",
  "status": "active",
  "totalGranted": 1000000,
  "totalUsed": 12345,
  "totalAvailable": 987655,
  "unlimitedQuota": false,
  "expiresAt": null,
  "fetchedAt": "2026-07-30T06:00:00.000Z",
  "stale": false,
  "billingMode": "external_newapi"
}
```

**错误**

| code | 含义 |
|------|------|
| `CREDENTIAL_NOT_BOUND` | 未绑定令牌（引导联系管理员） |
| `CREDENTIAL_DISABLED` | 已停用 |
| `NEWAPI_UNAVAILABLE` | 中转站不可达 |

---

#### `GET /api/v1/billing/usage`

流水列表（一期：本地 `LlmUsageSyncLog` ∪ 近期任务 `UsageLog`；二期纯 1701）。

**Query**：`page`, `pageSize`, `from`, `to`

**200 data**

```json
{
  "items": [
    {
      "id": "usg_xxx",
      "model": "gpt-5.6-sol",
      "promptTokens": 1200,
      "completionTokens": 800,
      "quotaCost": 42,
      "occurredAt": "2026-07-30T05:10:00.000Z",
      "source": "local_task"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

---

#### `GET /api/v1/billing/credential-status`

仅状态，不含额度数字（启动页轻量检查）。

```json
{
  "bound": true,
  "tokenHint": "sk-***YBgR",
  "status": "active",
  "needsAdmin": false
}
```

未绑定：`bound: false, needsAdmin: true`。

---

#### 现有登录（不变）

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me` — **建议扩展**返回：

```json
{
  "id": "...",
  "email": "...",
  "billing": {
    "mode": "external_newapi",
    "bound": true,
    "tokenHint": "sk-***YBgR"
  }
}
```

---

### 2.2 管理侧（运营人工绑 Key）

鉴权：`requireAuth` + `role === admin`（或独立 `ADMIN_API_KEY`）。

#### `POST /api/v1/admin/llm-credentials`

人工录入。

**Body**

```json
{
  "userId": "clx_user_xxx",
  "organizationId": null,
  "token": "sk-v5bh....",
  "tokenName": "张三-正式",
  "baseUrl": "https://1701.store",
  "externalUserId": null,
  "verify": true
}
```

- `verify: true` 时立刻请求 `GET {baseUrl}/api/usage/token`，失败则不落库。  
- 服务端：加密 → `tokenCipher`，写 `tokenHint` / `tokenHash`，同用户旧 primary 置 `isPrimary=false`。

**200 data**

```json
{
  "id": "cred_xxx",
  "userId": "clx_user_xxx",
  "tokenHint": "sk-***YBgR",
  "status": "active",
  "quota": {
    "totalAvailable": 987655,
    "totalUsed": 12345,
    "totalGranted": 1000000
  }
}
```

---

#### `GET /api/v1/admin/llm-credentials?userId=`

列表（永不返回明文 token）。

---

#### `PATCH /api/v1/admin/llm-credentials/:id`

```json
{ "status": "disabled", "tokenName": "停用-欠费" }
```

或轮换 Token：`{ "token": "sk-new...", "verify": true }`。

---

#### `POST /api/v1/admin/llm-credentials/:id/sync-quota`

强制同步额度，写 Snapshot。

---

### 2.3 AI 出站（对内，不给前端 Key）

现有聊天/代理路由改造约定：

| 步骤 | 行为 |
|------|------|
| 1 | 从 JWT 取 `userId` |
| 2 | 查 primary + active 的 `LlmCredential` |
| 3 | 解密 Token，请求 `{baseUrl}/v1/...` |
| 4 | 成功后可异步 `sync-quota`（节流，如 60s 一次） |
| 5 | 无绑定 → `402 CREDENTIAL_NOT_BOUND` |

**不要**把 `LLM_API_KEY` 环境变量当作多租户用户 Key（可仅作 admin 兜底 / 本地 demo）。

Electron Cowork：优先「会话走 workstation 代理」或主进程注入「系统代管 custom provider」（Key 来自后端下发的**短期会话票据**，而非永久 sk）。一期最简单：**工作站内 AI 全走 backend**；Cowork 二期再接。

---

## 3. 1701 侧对照

| App 能力 | 1701 能力 | 谁做 |
|----------|-----------|------|
| 充值 | 管理后台给用户/令牌加额度 | **中转站** |
| 模型开关/限流 | 令牌模型限制 | **中转站** |
| 查剩余 | [`GET /api/usage/token`](https://doc.newapi.pro/api/token-usage/) | App 后端代查 |
| 账单 USD 面板 | [`/v1/dashboard/billing/*`](https://doc.newapi.pro/api/fei-account-billing-panel/) | 可选二期 |
| 登录 | 你们 JWT | **App** |
| 展示额度 UI | 用户中心 | **App** |

---

## 4. 前端对接映射（用户中心）

| UI | 接口 |
|----|------|
| 额度概览剩余 | `GET /api/v1/billing/quota` |
| 使用流水 | `GET /api/v1/billing/usage` |
| 「未开通」空态 | `credential-status.bound === false` →「请联系管理员开通」 |
| 充值按钮 | 一期改为文案/外链（运营企业微信），**不**跳有道 Portal |

现有 mock：`user-center/userCenterApi.ts` → 改为打上述真实接口。

---

## 5. 安全清单（实现时必做）

1. `tokenCipher` 使用独立 `CREDENTIAL_ENCRYPTION_KEY`，禁止只 Base64  
2. Admin 写接口审计日志（谁绑了哪个 userId / tokenHint）  
3. 日志与错误信息禁止打印完整 sk  
4. 前端 Network 面板不应出现 sk  
5. 用户注销/禁用时 `status=revoked`，出站立即失败  

---

## 6. 一期实施顺序（建议）

1. Prisma：`LlmCredential` + `LlmQuotaSnapshot`  
2. Admin 绑定 + verify + sync  
3. `GET /billing/quota` 接用户中心  
4. AI 路由改 per-user Token  
5. 隐藏有道充值 / 自助 Key 设置（产品开关）  

---

## 7. 非目标（一期明确不做）

- App 内支付收银台  
- 自动在 1701 注册用户并开 Token（可用管理 API 做二期）  
- 与有道积分双轨结算  
- 把明文 Key 同步进 Electron 本地配置长期保存  
