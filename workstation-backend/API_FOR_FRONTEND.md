# 前端联调 API 文档

> 基于当前后端真实代码生成，Base URL 默认：`http://localhost:3000`（以 `.env` 中 `PORT` 为准）

## 通用约定

### 鉴权

需要登录的接口，请求头：

```
Authorization: Bearer demo-token
```

第一版为假登录，登录接口固定返回 `demo-token`。

### 成功响应格式

```json
{
  "success": true,
  "data": { ... }
}
```

### 失败响应格式

```json
{
  "success": false,
  "message": "错误信息",
  "code": "ERROR_CODE"
}
```

### 常见错误码

| HTTP | code | 说明 |
|------|------|------|
| 401 | `UNAUTHORIZED` | 未登录或 token 无效 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 |
| 403 | `FORBIDDEN` | 无权访问资源 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 400 | `BAD_REQUEST` / `INVALID_FILE_TYPE` 等 | 参数或文件类型错误 |
| 502 | `MODEL_PROVIDER_ERROR` | 大模型调用失败 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

---

## 1. 登录

### POST /api/auth/login

| 项目 | 说明 |
|------|------|
| Authorization | 不需要 |
| Content-Type | `application/json` |

**请求参数（Body）**

第一版不校验密码，Body 可为空对象 `{}`。

```json
{}
```

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "token": "demo-token",
    "user": {
      "id": "demo_user",
      "username": "demo",
      "email": "demo@example.com",
      "phone": null,
      "role": "user",
      "vipLevel": "free",
      "credits": 1000
    }
  }
}
```

**失败返回示例**

```json
{
  "success": false,
  "message": "数据库中未找到 demo 用户，请先执行 npx prisma db seed",
  "code": "DEMO_USER_NOT_FOUND"
}
```

**前端用途**

登录页提交后保存 `token` 到 localStorage/sessionStorage，后续请求带上 `Authorization`。

---

## 2. 获取当前用户

### GET /api/auth/me

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**请求参数**

无。

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "id": "demo_user",
    "username": "demo",
    "email": "demo@example.com",
    "phone": null,
    "role": "user",
    "vipLevel": "free",
    "credits": 1000
  }
}
```

**失败返回示例（401）**

```json
{
  "success": false,
  "message": "请先登录",
  "code": "UNAUTHORIZED"
}
```

**前端用途**

应用启动时校验登录态、展示用户信息、刷新余额（也可配合 `/api/user/credits`）。

---

## 3. 智能体列表

### GET /api/agents

| 项目 | 说明 |
|------|------|
| Authorization | 不需要 |

**请求参数**

无。

**成功返回（200）**

```json
{
  "success": true,
  "data": [
    {
      "id": "hr",
      "name": "HR 智能体",
      "description": "分析人事 Excel 数据，支持招聘、考勤、绩效、薪酬等 HR 场景报告生成",
      "creditCost": 10,
      "supportedFiles": ["xlsx", "xls"],
      "tools": ["readExcel", "summarizeTable", "generateReport"],
      "status": "active"
    },
    {
      "id": "production",
      "name": "生产智能体",
      "description": "分析生产计划、产能、良率、设备稼动等生产数据",
      "creditCost": 10,
      "supportedFiles": ["xlsx", "xls"],
      "tools": ["readExcel", "summarizeTable", "generateReport"],
      "status": "inactive"
    },
    {
      "id": "sales",
      "name": "销售智能体",
      "description": "分析销售漏斗、客户转化、区域业绩等销售数据",
      "creditCost": 10,
      "supportedFiles": ["xlsx", "xls"],
      "tools": ["readExcel", "summarizeTable", "generateReport"],
      "status": "inactive"
    },
    {
      "id": "finance",
      "name": "财务智能体",
      "description": "分析费用、预算、现金流等财务数据",
      "creditCost": 10,
      "supportedFiles": ["xlsx", "xls"],
      "tools": ["readExcel", "summarizeTable", "generateReport"],
      "status": "inactive"
    }
  ]
}
```

**失败返回示例**

一般无业务失败；路由不存在时：

```json
{
  "success": false,
  "message": "接口不存在",
  "code": "NOT_FOUND"
}
```

**前端用途**

首页/智能体选择页展示可选智能体；仅 `status: "active"` 的可点击运行（当前仅 `hr`）。

> 注意：列表中 `creditCost` 为配置值；**HR 实际运行扣费为 20 点**（见 run 接口）。

---

## 4. 智能体详情

### GET /api/agents/:agentId

| 项目 | 说明 |
|------|------|
| Authorization | 不需要 |

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| agentId | string | 如 `hr`、`production` |

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "id": "hr",
    "name": "HR 智能体",
    "description": "分析人事 Excel 数据，支持招聘、考勤、绩效、薪酬等 HR 场景报告生成",
    "creditCost": 10,
    "supportedFiles": ["xlsx", "xls"],
    "tools": ["readExcel", "summarizeTable", "generateReport"],
    "status": "active"
  }
}
```

**失败返回示例（404）**

```json
{
  "success": false,
  "message": "智能体 xxx 不存在",
  "code": "NOT_FOUND"
}
```

**前端用途**

智能体详情页展示说明、支持文件类型、是否可用。

---

## 5. 上传文件

### POST /api/files/upload

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |
| Content-Type | `multipart/form-data` |

**请求参数（Form Data）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 仅支持 `.xlsx`、`.xls`、`.csv` |

**成功返回（201）**

```json
{
  "success": true,
  "data": {
    "fileId": "cmr4fm1f00001587xu8hsd50u",
    "originalName": "hr-test.xlsx",
    "size": 16466,
    "extension": "xlsx",
    "createdAt": "2026-07-03T04:27:00.397Z"
  }
}
```

**失败返回示例（400，不支持类型）**

```json
{
  "success": false,
  "message": "仅支持 xlsx、xls、csv 文件",
  "code": "INVALID_FILE_TYPE"
}
```

**失败返回示例（401）**

```json
{
  "success": false,
  "message": "请先登录",
  "code": "UNAUTHORIZED"
}
```

**前端用途**

任务页上传 Excel，保存返回的 `fileId` 供 run 接口使用。

---

## 6. 文件详情（含 Excel 解析预览）

### GET /api/files/:fileId

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| fileId | string | 上传接口返回的 fileId |

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "fileId": "cmr4fm1f00001587xu8hsd50u",
    "originalName": "hr-test.xlsx",
    "size": 16466,
    "extension": "xlsx",
    "createdAt": "2026-07-03T04:27:00.397Z",
    "parsedPreview": {
      "sheets": [
        {
          "name": "员工考勤",
          "headers": ["姓名", "部门", "出勤天数", "迟到次数", "请假天数"],
          "rowCount": 3,
          "sampleRows": [
            {
              "姓名": "张三",
              "部门": "研发",
              "出勤天数": 22,
              "迟到次数": 1,
              "请假天数": 0
            }
          ]
        }
      ]
    }
  }
}
```

**失败返回示例（404）**

```json
{
  "success": false,
  "message": "文件不存在",
  "code": "NOT_FOUND"
}
```

**失败返回示例（403）**

```json
{
  "success": false,
  "message": "无权访问该文件",
  "code": "FORBIDDEN"
}
```

**前端用途**

上传后预览 Excel 表头与样例数据，确认文件解析正确再提交任务。

---

## 7. 运行智能体

### POST /api/agents/:agentId/run

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |
| Content-Type | `application/json` |

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| agentId | string | 第一版仅支持 `hr` |

**请求参数（Body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fileId | string | 是 | 已上传文件 ID |
| task | string | 是 | 用户分析需求描述 |

```json
{
  "fileId": "cmr4fm1f00001587xu8hsd50u",
  "task": "请帮我分析这个月员工考勤异常，并输出 HR 管理建议。"
}
```

**成功返回（201）**

```json
{
  "success": true,
  "data": {
    "reportId": "cmr4frt30000358yhukxdcdc6",
    "content": "# HR数据分析报告\n\n...",
    "chargedCredits": 20,
    "creditsLeft": 980
  }
}
```

**失败返回示例（402，余额不足）**

```json
{
  "success": false,
  "message": "额度不足，当前余额 10，需要 20",
  "code": "INSUFFICIENT_CREDITS"
}
```

**失败返回示例（400，task 为空）**

```json
{
  "success": false,
  "message": "请填写分析任务",
  "code": "BAD_REQUEST"
}
```

**失败返回示例（400，非 HR 智能体）**

```json
{
  "success": false,
  "message": "第一版仅支持 HR 智能体",
  "code": "AGENT_NOT_SUPPORTED"
}
```

**失败返回示例（400，智能体未开放）**

```json
{
  "success": false,
  "message": "智能体「生产智能体」暂未开放",
  "code": "AGENT_INACTIVE"
}
```

**失败返回示例（502，模型调用失败）**

```json
{
  "success": false,
  "message": "大模型调用失败，请稍后重试",
  "code": "MODEL_PROVIDER_ERROR"
}
```

**前端用途**

核心任务提交：上传 Excel → 输入 task → 运行 HR 智能体 → 展示报告内容并跳转报告详情。

> HR 运行固定扣 **20** 点；模型失败时不扣费、不创建 report。

---

## 8. 查询用户额度

### GET /api/user/credits

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**请求参数**

无。

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "credits": 1000
  }
}
```

**失败返回示例（401）**

```json
{
  "success": false,
  "message": "请先登录",
  "code": "UNAUTHORIZED"
}
```

**前端用途**

顶部导航/个人中心展示剩余额度；run 前校验是否 ≥ 20。

---

## 9. 报告列表

### GET /api/reports

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**请求参数**

无。

**成功返回（200）**

```json
{
  "success": true,
  "data": [
    {
      "reportId": "cmr4fq4dg0003587xbs7lvqtu",
      "agentId": "hr",
      "title": "HR 分析报告（Mock）",
      "summary": "Mock 报告：研发出勤良好，销售绩效均衡",
      "status": "completed",
      "creditCost": 10,
      "createdAt": "2026-07-03T04:30:10.853Z"
    }
  ]
}
```

**失败返回示例（401）**

```json
{
  "success": false,
  "message": "请先登录",
  "code": "UNAUTHORIZED"
}
```

**前端用途**

报告历史列表页，按时间倒序展示。

---

## 10. 报告详情

### GET /api/reports/:reportId

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| reportId | string | 报告 ID |

**成功返回（200）**

```json
{
  "success": true,
  "data": {
    "reportId": "cmr4fq4dg0003587xbs7lvqtu",
    "userId": "demo_user",
    "agentId": "hr",
    "fileId": null,
    "title": "HR 分析报告（Mock）",
    "task": "分析员工考勤与绩效数据，识别异常趋势",
    "content": "# HR 分析报告（Mock）\n\n...",
    "summary": "Mock 报告：研发出勤良好，销售绩效均衡",
    "status": "completed",
    "creditCost": 10,
    "createdAt": "2026-07-03T04:30:10.853Z",
    "updatedAt": "2026-07-03T04:30:10.853Z"
  }
}
```

**失败返回示例（404）**

```json
{
  "success": false,
  "message": "报告不存在",
  "code": "NOT_FOUND"
}
```

**失败返回示例（403）**

```json
{
  "success": false,
  "message": "无权访问该报告",
  "code": "FORBIDDEN"
}
```

**前端用途**

报告详情页渲染 Markdown 内容（`content` 字段）。

---

## 11. 使用记录

### GET /api/usage/logs

| 项目 | 说明 |
|------|------|
| Authorization | **需要** |

**请求参数**

无（默认返回最近 50 条）。

**成功返回（200）**

```json
{
  "success": true,
  "data": [
    {
      "agentId": "hr",
      "modelProvider": "mock",
      "modelName": "gpt-4o-mini",
      "inputTokens": 289,
      "outputTokens": 329,
      "chargedCredits": 20,
      "status": "completed",
      "createdAt": "2026-07-03T03:12:27.337Z"
    }
  ]
}
```

无记录时：

```json
{
  "success": true,
  "data": []
}
```

**失败返回示例（401）**

```json
{
  "success": false,
  "message": "请先登录",
  "code": "UNAUTHORIZED"
}
```

**前端用途**

用量/账单页展示每次智能体调用的 token 与扣费记录。

---

## 前端开发顺序建议

### 第一阶段：基础框架

1. `POST /api/auth/login` — 登录，保存 token
2. `GET /api/auth/me` — 启动时恢复登录态
3. `GET /api/user/credits` — 展示余额

### 第二阶段：智能体选择

4. `GET /api/agents` — 首页智能体卡片
5. `GET /api/agents/:agentId` — 详情页（可选）

### 第三阶段：核心任务流（HR）

6. `POST /api/files/upload` — 上传 Excel
7. `GET /api/files/:fileId` — 预览 parsedPreview
8. `POST /api/agents/hr/run` — 提交任务，展示报告
9. `GET /api/user/credits` — run 后刷新余额

### 第四阶段：历史记录

10. `GET /api/reports` — 报告列表
11. `GET /api/reports/:reportId` — 报告详情
12. `GET /api/usage/logs` — 用量记录

### 第五阶段：异常处理

- 401 → 跳转登录
- 402 → 提示额度不足
- 400/404/403 → 展示 `message`
- run 提交过程加 loading，防止重复点击

---

## 附录：环境变量（前端无需配置，仅供联调参考）

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，默认 3001（`.env.example`），本地可能为 3000 |
| `MODEL_PROVIDER` | `mock` 或 `openai`，影响 run 报告内容来源 |
