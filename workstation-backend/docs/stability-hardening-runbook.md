# 上线稳定性改造运行手册

面向：`桌面端 + OpenClaw 网关 + api.bx-aigc.com 后端`

## 1. 修改文件清单

### 后端
- `src/config/env.ts` — HOST / RATE_LIMIT / LLM 超时 / 生产强制校验
- `src/server.ts` — 绑定 HOST、uncaught/unhandled、优雅退出
- `src/middleware/rateLimit.middleware.ts` — chat/反馈/上传/并发限流
- `src/routes/v1/chat.routes.ts` / `ai.routes.ts` / `feedback.routes.ts` / `auth.routes.ts`
- `src/routes/files.routes.ts`
- `src/providers/llm/openaiCompatible.provider.ts` — Abort + 90s 超时 + 最多重试 1 次
- `ecosystem.config.cjs` — 统一进程名 `workstation-api`
- `scripts/pg-backup.sh` — 每日 pg_dump
- `.env.example` / `.env.production.example`

### 桌面端
- `src/shared/openclawEngine/constants.ts`
- `src/main/libs/openclawEngineManager.ts` — OOM/134 停自启；10 分钟最多 3 次
- `src/main/main.ts` / `preload.ts` — 恢复/打开日志 IPC
- `src/renderer/services/cowork.ts` / `i18n.ts` / `components/Settings.tsx`

## 2. 开发环境启动

```bash
cd workstation-backend
cp .env.example .env   # 按需填写 DATABASE_URL / JWT 等
# .env 建议：
# NODE_ENV=development
# HOST=0.0.0.0
# PORT=3001
# RATE_LIMIT_ENABLED=false

npm run dev
# 或编译后：
npm run build && node dist/server.js
```

桌面：

```bash
cd LobsterAI
npm run electron:dev
```

## 3. 生产环境启动

服务器 `.env` 必须包含（示例见 `.env.production.example`）：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
RATE_LIMIT_ENABLED=true
COOKIE_SECURE=true
JWT_ACCESS_SECRET=<openssl rand -hex 32>
LLM_API_KEY=<真实密钥>
LLM_BASE_URL=https://1701.store/v1
DATABASE_URL=postgresql://...
```

```bash
cd /opt/workstation-backend   # 实际路径以服务器为准
npm ci && npm run build
pm2 delete workstation-backend 2>/dev/null || true   # 清理旧进程名
pm2 start ecosystem.config.cjs --env production
pm2 save
```

## 4. Nginx 反代地址

上游只应指向本机：

```nginx
proxy_pass http://127.0.0.1:3001;
```

不要把 `3001` 暴露到公网安全组。

## 5. PM2 命令

```bash
pm2 start ecosystem.config.cjs --env production
pm2 reload workstation-api
pm2 logs workstation-api
pm2 status
# 日志轮转（装一次）：
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

内存上限可用环境变量覆盖：`PM2_MAX_MEMORY_RESTART=800M`

## 6. 如何验证限流

1. 生产或 `RATE_LIMIT_ENABLED=true` 下登录后，对 `POST /api/v1/chat/messages` 快速连打 >30 次/分钟。
2. 期望 HTTP `429`：

```json
{ "success": false, "code": "RATE_LIMITED", "message": "请求过于频繁，请稍后重试" }
```

3. 开发设 `RATE_LIMIT_ENABLED=false` 时不应被拦。
4. 反馈：`POST /api/v1/feedback`（或实际挂载路径）同 IP 每小时 >5 次应 429。
5. 并发：同一用户同时打 3 个 AI 请求，第 3 个应 429。

## 7. 如何模拟 LLM 超时

临时把超时调极短：

```env
LLM_REQUEST_TIMEOUT_MS=1
```

再调用会走上游的分析/聊天接口，期望业务错误码 `LLM_TIMEOUT`（HTTP 504）。测完改回 `90000`。

也可在上游代理故意 `sleep` > 超时时间。

## 8. 如何模拟 OpenClaw 连续崩溃

1. 开发环境启动桌面端，确保网关在跑。
2. 用任务管理器结束 OpenClaw/gateway node 进程，或向其注入 OOM（例如极低 `--max-old-space-size` 后跑大任务）。
3. 普通崩溃：10 分钟内第 4 次应停止自动重启，设置页出现「连续崩溃」提示。
4. OOM/退出码 134：立即停止自动重启，出现「清理会话并重新启动 / 打开日志目录」。
5. 点「清理会话并重新启动」应清空重启计数并再次拉起网关；聊天记录仍在。

## 9. 自动化测试

本地可跑：

```bash
cd LobsterAI
npx vitest run src/main/libs/openclawEngineManager.test.ts -t "HeapOutOfMemory|max-old-space"
cd workstation-backend
npm test   # 若仓库已有后端测试脚本
```

本次以配置与中间件加固为主；限流/超时建议在联调环境用手工脚本验证 429 / LLM_TIMEOUT。

## 10. 尚未完成 / 残留风险

- HTTPS 证书与 Nginx 443：需在服务器上用 certbot 完成（不在本次代码改动内）。
- Postgres 异地备份：脚本预留 `BACKUP_UPLOAD_CMD`，需自行配置 rclone/OSS。
- 桌面端 OpenClaw→1701 的超时不在 `workstation-backend` LLM 层；桌面聊天慢仍可能来自模型与本地网关。
- 限流为进程内内存计数，PM2 保持单实例；勿开 cluster。
- 正式包禁 localhost API 已有运行时检查；构建期断言脚本可按需再补。
