# 上线产品就绪清单（全真实链路）

可勾选总清单。默认域名：**官网/下载 `https://bx-aigc.com`**，**API `https://api.bx-aigc.com`**。  
支付一期：`DEFAULT_PAYMENT_PROVIDER=manual`（扫码 + 管理员确认）。模型：1701 `custom` / `gpt-5.6-sol`。

相关文档：

- [pre-launch-local-checklist.md](./pre-launch-local-checklist.md)
- [tencent-cloud-inventory.md](./tencent-cloud-inventory.md)（真实资源：Lighthouse `106.54.15.76`）
- [tencent-cvm-deploy-beginner.md](./tencent-cvm-deploy-beginner.md)
- [tencent-email-otp-setup.md](./tencent-email-otp-setup.md)
- 环境模板：[`.env.production.example`](../.env.production.example)

---

## 0. 密钥与资产（阻塞项）

对照 [tencent-cloud-inventory.md](./tencent-cloud-inventory.md)：

- [x] DNS：`api` / `@` / `www` → `106.54.15.76`
- [ ] Postgres：**无云库** → Lighthouse 本机安装，连接串写入 `.env`
- [x] SES 发信域名 `bx-aigc.com` 已验证（SPF/DKIM）
- [ ] SES **发信地址**（如 `noreply@bx-aigc.com`）+ SMTP 密码
- [ ] **SSL**：机上 certbot（尚无腾讯云证书/CLB）
- [ ] 126 授权码 → `FEEDBACK_SMTP_PASS`
- [ ] 1701 API Key（仅服务器 `.env`）
- [ ] `JWT_ACCESS_SECRET` / `LICENSE_TOKEN_SECRET` / `LICENSE_HASH_PEPPER`（各 `openssl rand -hex 32`）
- [ ] 正式 `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`（禁止 `AdminPass123!`）
- [x] `public/payment/` 六张微信/支付宝 50/100/500（需挂到 HTTPS）
- [ ] （建议）Windows 签名 `YD_SIGN_*`

---

## 1. 仓库工程债（已落地检查）

- [x] `.env.production.example`：`manual` + 1701 custom + HTTPS QR + SMTP/反馈/安全开关
- [x] 客户端生产默认 `https://api.bx-aigc.com`；`localStore` 生产会清掉已持久化的 localhost；打包门禁要求 **恰好** 该 URL（`assert-workstation-prod-api.cjs` + `predist:win`）
- [x] 生产禁用 `POST /api/v1/payments/mock/complete`
- [x] 生产 seed **强制**显式 `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`；`ALLOW_DEMO_USER=false` 不创建 demo
- [x] `npm run db:cleanup-demo`（`scripts/cleanup-demo-data.ts`）
- [x] 本清单文档

---

## 2. 环境变量对照（服务器 `.env`）

从 `.env.production.example` 复制后必填/核对：

| 变量 | 生产期望 | 说明 |
|------|----------|------|
| `NODE_ENV` | `production` | boot 禁 mock |
| `APP_BASE_URL` | `https://api.bx-aigc.com` | |
| `WEB_BASE_URL` | `https://bx-aigc.com` | |
| `DATABASE_URL` | `127.0.0.1` 本机库 | + `DIRECT_DATABASE_URL`；`DB_SSL=false` |
| `CORS_ORIGINS` | `https://bx-aigc.com,https://www.bx-aigc.com` | 禁止 `*` |
| `COOKIE_SECURE` | `true` | |
| `COOKIE_DOMAIN` | `.bx-aigc.com` | 按实测可收紧 |
| `MODEL_PROVIDER` | `custom` | 禁止 `mock` |
| `LLM_BASE_URL` | `https://1701.store/v1` | |
| `LLM_MODEL` | `gpt-5.6-sol` | |
| `LLM_API_KEY` | 真密钥 | |
| `MAIL_PROVIDER` | `smtp` | 禁止 `mock`；OTP 无 `mockCode` |
| `SMTP_*` / `MAIL_FROM` | 腾讯云 SES | |
| `FEEDBACK_SMTP_PASS` | 126 授权码 | 应用内反馈 |
| `DEFAULT_PAYMENT_PROVIDER` | `manual` | 禁止 `mock` |
| `PAYMENT_*_QR_URL*` | `https://api.../static/payment/...` | 六档 |
| `ALLOW_DEMO_USER` | `false` | |
| `LICENSE_ENFORCEMENT_ENABLED` | `true` | |
| `DEFAULT_USER_CREDITS` | `0` | |
| `SIGNUP_BONUS_CREDITS` | 审视后的值 | 示例为 `0` |
| `ADMIN_SEED_*` | 正式管理员 | seed 前设置 |

客户端打包（仓库根 `.env` / CI）：

| 变量 | 生产期望 |
|------|----------|
| `WORKSTATION_API_BASE_URL` | `https://api.bx-aigc.com` |
| `VITE_WORKSTATION_API_BASE_URL` | `https://api.bx-aigc.com`（须与上一行一致） |

校验：`npm run assert:prod-api`

---

## 3. 服务器 Cutover（真库 · 真域名 · pm2）

机器：Lighthouse **`Ubuntu-O2mi` / `106.54.15.76`**（详见 [tencent-cloud-inventory.md](./tencent-cloud-inventory.md)）。  
无 RDS / CLB / CDN —— Postgres + Nginx + Node 都在这一台。

按 [tencent-cvm-deploy-beginner.md](./tencent-cvm-deploy-beginner.md) 执行：

- [ ] SSH `ubuntu@106.54.15.76`（用户名以控制台为准）
- [ ] 本机安装 PostgreSQL（方案 B），勿对公网开 5432
- [ ] Nginx + certbot（`api.bx-aigc.com`，建议同时签 `bx-aigc.com` / `www`）
- [ ] 复制 `.env.production.example` → 服务器 `.env`，填真实值（本机库 `DB_SSL=false`）
- [ ] 上传代码后执行 `bash scripts/server-cutover.sh`  
  （或逐步：`migrate deploy` → `db seed` → `db:cleanup-demo` → `build` → pm2）
- [ ] 确认 `https://api.bx-aigc.com/static/payment/alipay-qr-50.png` 等可公网访问
- [ ] pm2 守护 `workstation-backend`
- [ ] 生产 boot：`MAIL/MODEL/PAYMENT` 非 mock（否则进程拒绝启动）
- [ ] SES 发信地址已建 + 真 OTP；126 反馈 SMTP 通
- [ ] 真模型 1701 一轮对话扣费成功
- [ ] 生产库无 `demo@example.com` / DEMO-*（截图里的「demo 企业版」只属于本地开发 seed）

### Demo 清理（有旧库时）

先备份，再：

```bash
cd workstation-backend
npm run db:cleanup-demo -- --dry-run
npm run db:cleanup-demo
```

示意 SQL（脚本优先；外键顺序因环境而异）：

```sql
-- 备份后执行；优先用 scripts/cleanup-demo-data.ts
-- DELETE demo user / DEMO-* licenses via cleanup script above
```

保留：充值套餐 ¥50/100/500、正式管理员、商业 Plan。  
删除：`demo@example.com`、DEMO-* 许可证、演示组织万级积分。

---

## 4. 真扫码充值验收

- [ ] QR 全部 HTTPS 公网可扫（微信/支付宝 × 50/100/500）
- [ ] 用户下单 →「我已付款」→ `PENDING_REVIEW`
- [ ] 管理员确认积分到账：

```bash
# 登录拿 accessToken
curl -s -X POST https://api.bx-aigc.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ADMIN_EMAIL","password":"ADMIN_PASSWORD"}'

# 确认订单
curl -s -X POST "https://api.bx-aigc.com/api/v1/admin/recharge/orders/ORDER_ID/confirm" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

运营：谁持有 admin、如何确认订单（本期无管理后台 UI）。

---

## 5. 客户端打包与下载页（Windows + macOS）

官网静态页在仓库 `website/`，部署到 **`https://bx-aigc.com`**（兼容 `#/download-list`）。  
下载按钮：**Windows** + **macOS Apple 芯片**（Intel 在「其他版本」）。

### 5.1 打包（API 门禁 → 正式包）

```bash
# Windows 机器
npm run ship:win:prod
npm run publish:downloads -- --platform win

# Mac 机器（Apple Silicon；.dmg 必须在 macOS 上打）
npm run ship:mac:prod
npm run publish:downloads -- --platform mac-arm64

# 可选：Intel Mac
npm run ship:mac:prod:x64
npm run publish:downloads -- --platform mac-x64
```

稳定文件名（上传后用户点的就是这些）：

| 平台 | URL |
|------|-----|
| Windows | `https://bx-aigc.com/downloads/WorkhorseAI-Windows-Setup.exe` |
| macOS arm64 | `https://bx-aigc.com/downloads/WorkhorseAI-macOS-arm64.dmg` |
| macOS x64 | `https://bx-aigc.com/downloads/WorkhorseAI-macOS-x64.dmg` |

### 5.2 挂到服务器

```bash
sudo mkdir -p /var/www/bx-aigc.com
sudo rsync -a website/ /var/www/bx-aigc.com/
sudo cp deploy/nginx/bx-aigc.com.conf /etc/nginx/sites-available/bx-aigc.com
sudo ln -sf /etc/nginx/sites-available/bx-aigc.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

- [ ] 安装包内登录/充值请求打到 `api.bx-aigc.com`（禁止 127.0.0.1）
- [ ] `https://bx-aigc.com` 可打开，Windows / macOS 两个主按钮可下
- [ ] `releases.json` 中对应平台 `available: true`
- [ ] `YOUDAO_CLOUD_ENABLED=false`（靠官网下载，无应用内自动更新）

---

## 6. 上线冒烟矩阵（全绿再放量）

| # | 场景 | 通过标准 | ☑ |
|---|------|----------|---|
| 1 | `GET https://api.bx-aigc.com/api/v1/health` | 200 | |
| 2 | 邮箱注册 + OTP | 真邮件到达，响应无 `mockCode` | |
| 3 | 密码登录 / 刷新 token | 成功 | |
| 4 | 充值页加载 QR | 六档 HTTPS 可扫 | |
| 5 | 下单 → 已付款 → admin 确认 | 积分增加 | |
| 6 | 部门智能体一轮对话 | 真模型回复 + 扣费流水 | |
| 7 | 帮助反馈提交 | 126 收到，无跳转 mailto | |
| 8 | 正式安装包登录充值 | Win + Mac 均可从官网下到；不走 localhost | |
| 9 | demo 用户 | 无法登录或已删除 | |
| 10 | 生产 boot | `MAIL/MODEL/PAYMENT` 非 mock | |

快速探活（健康检查 + 六档收款码资源）：

```bash
cd workstation-backend
npm run smoke:go-live
# 或: node scripts/smoke-go-live.cjs https://api.bx-aigc.com
```

---

## 7. 回滚要点

- pm2：保留上一版 `dist/` / 镜像；`pm2 reload` 失败则切回上一进程
- Nginx：证书与 upstream 不动；只回滚 Node 应用目录
- DB：migrate 前备份；禁止对生产 `migrate reset`
- 客户端：官网保留上一安装包链接；新包有问题则换回旧包
- 配置：勿把 `MAIL_PROVIDER=mock` / `DEFAULT_PAYMENT_PROVIDER=mock` 带回生产（boot 会拒绝）

---

## 明确本期不做

- 微信/支付宝 SDK 自动回调（继续人工确认）
- 有道云登录 / 应用内自动更新
- 管理后台可视化 UI
