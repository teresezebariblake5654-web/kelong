# 腾讯云上线手册（bx-aigc.com · 小白版）

面向：域名已买、轻量服务器已开、[1701.store](https://1701.store/) 中转已有，但还不懂「部署」的同学。

**当前账号真实资源（请先读）：** [`tencent-cloud-inventory.md`](./tencent-cloud-inventory.md)

| 项 | 值 |
|----|-----|
| 机器 | Lighthouse `Ubuntu-O2mi`（上海） |
| 公网 IP | `106.54.15.76` |
| DNS | `@` / `www` / `api` → 已指向该 IP |
| 数据库 | **无云数据库** → 必须装本机 PostgreSQL |
| SSL | **尚无证书** → 用 certbot |
| SES | 域名已验证；**仍需新建发信地址** |

目标：用户打开产品 → **邮箱注册/登录** → **AI 积分充值（扫码）** → **Chat / Agent** 能用，且不依赖有道 Portal。

---

## 0. 先搞懂你在部署什么

```
用户电脑（Electron / 浏览器）
        │  HTTPS
        ▼
  bx-aigc.com / api.bx-aigc.com（Nginx 反代 + SSL）
        │
        ▼
  Lighthouse 106.54.15.76 上的 Node 后端（workstation-backend，端口 3001）
        │
        ├── PostgreSQL @ 127.0.0.1（同机）
        ├── 腾讯云邮件推送 SES（发验证码）
        └── https://1701.store/v1（大模型中转，用你的 API Key）
```

**一句话：**这一台轻量服务器上跑后端 + 数据库 + Nginx；域名已指到服务器；客户端打包时 API 指向 `https://api.bx-aigc.com`。

> `bx-robot.cn` 指向外部 IP，**本期不要部署到那台机**。

---

## 1. 域名与防火墙

DNS（DNSPod）**已就绪**：

| 主机记录 | 类型 | 记录值 | 用途 |
|---------|------|--------|------|
| `api` | A | `106.54.15.76` | API：`https://api.bx-aigc.com` |
| `@` / `www` | A | `106.54.15.76` | 官网 / 下载页 |

轻量应用服务器防火墙先只开：

- `22` SSH（建议限制你自己的 IP）
- `80` HTTP（申请证书用）
- `443` HTTPS（对外）
- **不要**把 `3001` / `5432` 直接对公网开放

---

## 2. 登录服务器，装基础环境

```bash
ssh ubuntu@106.54.15.76
# 用户名以腾讯云控制台「重置密码 / 密钥」实际为准
```

以 Ubuntu 为例：

```bash
sudo apt update
sudo apt install -y git nginx curl

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应显示 v20.x
```

### 数据库（本账号无云数据库 → 用方案 B）

**A. 腾讯云 PostgreSQL（可选，以后再买）** — 本期跳过。

**B. 装在同一台 Lighthouse（本期必做）**

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER aw WITH PASSWORD '换成强密码';"
sudo -u postgres psql -c "CREATE DATABASE agent_workstation OWNER aw;"
```

`.env` 连接串：

```text
postgresql://aw:强密码@127.0.0.1:5432/agent_workstation?schema=public
```

并设 `DB_SSL=false`（本机不走云库 SSL）。

---

## 3. 把代码放到服务器

任选一种：

- `git clone` 你们的私有仓库到 `/opt/lobsterai`
- 或本机打包 `workstation-backend` + `workstation-packages` 用 scp/rsync 上传

目录建议：

```text
/opt/lobsterai/
  workstation-backend/
  workstation-packages/
```

后端依赖本地包 `@aw/shared`，**两个目录要一起在**，相对路径保持和本机仓库一致。

```bash
cd /opt/lobsterai/workstation-backend
npm ci
```

---

## 4. 写生产 `.env`（最关键）

```bash
cd /opt/lobsterai/workstation-backend
cp .env.production.example .env
nano .env   # 或 vim —— 填真实密钥；勿提交 .env
```

按下面改（**密钥请自己生成，不要用示例字面量**）。完整字段见 `.env.production.example`：

```env
NODE_ENV=production
PORT=3001
APP_BASE_URL=https://api.bx-aigc.com
WEB_BASE_URL=https://bx-aigc.com

DATABASE_URL="postgresql://aw:强密码@127.0.0.1:5432/agent_workstation?schema=public"
DIRECT_DATABASE_URL="postgresql://aw:强密码@127.0.0.1:5432/agent_workstation?schema=public"
DB_SSL=false

# 用 openssl rand -hex 32 生成下面三个
JWT_ACCESS_SECRET=至少32位随机串
LICENSE_TOKEN_SECRET=至少32位另一串
LICENSE_HASH_PEPPER=至少32位再一串

JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=14
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=.bx-aigc.com
CORS_ORIGINS=https://bx-aigc.com,https://www.bx-aigc.com
ALLOW_DEMO_USER=false
LICENSE_ENFORCEMENT_ENABLED=true
ADMIN_SEED_EMAIL=你的管理员邮箱
ADMIN_SEED_PASSWORD=强密码勿用默认

# —— 1701 中转 ——
MODEL_PROVIDER=custom
AI_PROVIDER=custom
LLM_BASE_URL=https://1701.store/v1
LLM_API_KEY=sk-你在1701控制台复制的Key
LLM_MODEL=gpt-5.6-sol

# —— 一期用扫码人工充值 ——
DEFAULT_PAYMENT_PROVIDER=manual
WECHAT_PAY_ENABLED=false
ALIPAY_ENABLED=false
PAYMENT_ALIPAY_QR_URL_50=https://api.bx-aigc.com/static/payment/alipay-qr-50.png
PAYMENT_ALIPAY_QR_URL_100=https://api.bx-aigc.com/static/payment/alipay-qr-100.png
PAYMENT_ALIPAY_QR_URL_500=https://api.bx-aigc.com/static/payment/alipay-qr-500.png
PAYMENT_WECHAT_QR_URL_50=https://api.bx-aigc.com/static/payment/wechat-qr-50.png
PAYMENT_WECHAT_QR_URL_100=https://api.bx-aigc.com/static/payment/wechat-qr-100.png
PAYMENT_WECHAT_QR_URL_500=https://api.bx-aigc.com/static/payment/wechat-qr-500.png
PAYMENT_PAYEE_NAME=公司全称或个人名
PAYMENT_SUPPORT_TEXT=付款后点击「我已付款」，客服确认后到账
PAYMENT_NOTICE=请备注注册邮箱，便于核对

# —— 腾讯云邮件推送 SMTP（先在控制台新建发信地址）——
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.qcloudmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@bx-aigc.com
SMTP_PASS=SMTP授权密码
MAIL_FROM=noreply@bx-aigc.com
MAIL_FROM_NAME=Workhorse AI
```

生成随机密钥：

```bash
openssl rand -hex 32
```

---

## 5. 建表、种子数据、编译、启动

```bash
cd /opt/lobsterai/workstation-backend
npx prisma migrate deploy
npx prisma db seed
npm run build
```

用 pm2 常驻（推荐）：

```bash
sudo npm i -g pm2
pm2 start dist/server.js --name workstation-api
pm2 save
pm2 startup   # 按提示执行它打印的那一行，开机自启
```

本机自测：

```bash
curl -s http://127.0.0.1:3001/api/v1/ready
# 应返回健康/就绪类 JSON
```

---

## 6. Nginx + HTTPS（域名真正可用）

```bash
sudo apt install -y certbot python3-certbot-nginx
```

仓库里已有现成配置（在已上传代码的机器上）：

```bash
# API 反代
sudo cp /opt/lobsterai/deploy/nginx/api.bx-aigc.com.conf /etc/nginx/sites-available/api.bx-aigc.com
sudo ln -sf /etc/nginx/sites-available/api.bx-aigc.com /etc/nginx/sites-enabled/

# 官网下载页（Windows + macOS 安装包）
sudo mkdir -p /var/www/bx-aigc.com
sudo rsync -a /opt/lobsterai/website/ /var/www/bx-aigc.com/
sudo cp /opt/lobsterai/deploy/nginx/bx-aigc.com.conf /etc/nginx/sites-available/bx-aigc.com
sudo ln -sf /etc/nginx/sites-available/bx-aigc.com /etc/nginx/sites-enabled/

sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.bx-aigc.com -d bx-aigc.com -d www.bx-aigc.com
```

浏览器访问：

- `https://api.bx-aigc.com/api/v1/ready` 应能通
- `https://bx-aigc.com` 应看到 **下载 Windows / 下载 macOS** 两个按钮

---

## 7. 腾讯云邮件（验证码能发出去）

1. 开通 [邮件推送 SES](https://console.cloud.tencent.com/ses)
2. 发信域名填 `bx-aigc.com`，按提示加 **SPF / DKIM** DNS 记录
3. 创建发信地址 `noreply@bx-aigc.com`
4. 生成 SMTP 密码，填进上面 `.env`
5. `pm2 restart workstation-api`
6. 用接口或客户端「获取验证码」测一封真邮件

详细：`docs/tencent-email-otp-setup.md`

---

## 8. 客户端指到生产 API

本机 / 打包 Electron 时环境变量：

```env
WORKSTATION_API_BASE_URL=https://api.bx-aigc.com
VITE_WORKSTATION_API_BASE_URL=https://api.bx-aigc.com
```

`CORS_ORIGINS` 必须包含真实前端来源；Electron 若用 `file://` 或自定义协议，需按你们现有 CORS 实现再调（开发期先用网页版工作站联调最省事）。

---

## 9. 管理员确认充值（一期运营）

用户流程：选套餐 → 扫码付款 → 点「我已付款」→ 订单 `PENDING_REVIEW`。

你（管理员）确认到账后调：

```bash
# 先登录拿到管理员 JWT，再：
curl -X POST "https://api.bx-aigc.com/api/v1/admin/recharge/orders/订单ID/confirm" \
  -H "Authorization: Bearer 管理员Token"
```

上线前在库里确保有 **system admin** 用户（种子或手工），并把确认步骤写进你们内部群。

---

## 10. 上线当天检查清单（打勾再用）

- [ ] `api.bx-aigc.com` DNS 已生效，HTTPS 绿锁
- [ ] `/api/v1/ready` 正常
- [ ] `https://bx-aigc.com` 可下载 **Windows** 与 **macOS** 安装包
- [ ] 邮箱能收到验证码
- [ ] 注册 → 登录成功
- [ ] Chat / Agent 能回复（1701 Key、模型名正确）
- [ ] 积分会扣减；余额不足有提示
- [ ] 充值页能看到收款码；下单 → 标记已付 → 管理员确认 → 积分增加
- [ ] `ALLOW_DEMO_USER=false`，`MAIL_PROVIDER=smtp`，`DEFAULT_PAYMENT_PROVIDER=manual`
- [ ] 安全组未裸奔 3001 / 5432

---

## 你「下一步」建议只做这四件（按顺序）

1. **SES 控制台**：新建发信地址 `noreply@bx-aigc.com`，记下 SMTP 密码  
2. **SSH `106.54.15.76`**：装 Node + Nginx + **本机 PostgreSQL**；防火墙只开 22/80/443  
3. **上传代码 + 写 `.env`（从 `.env.production.example`）+ `bash scripts/server-cutover.sh` + certbot**，先让 `https://api.bx-aigc.com/api/v1/ready` 通  
4. **本机** 分别打包并发布下载（两边都要有）：
   - Windows：`npm run ship:win:prod` → `npm run publish:downloads -- --platform win`
   - Mac：`npm run ship:mac:prod` → `npm run publish:downloads -- --platform mac-arm64`
   - 同步 `website/` 到 `/var/www/bx-aigc.com/`；按 [`go-live-product-readiness.md`](./go-live-product-readiness.md) 冒烟矩阵勾选

通了 health / 邮件 / 1701 之后再公网放量。

---

## 常见坑

| 现象 | 原因 |
|------|------|
| 生产启动报 mock 禁止 | `MODEL_PROVIDER` / `MAIL_PROVIDER` / `DEFAULT_PAYMENT_PROVIDER` 仍是 mock；支付请用 `manual` |
| 验证码发不出 | 域名未过 SPF/DKIM，或 SMTP 密码错 |
| 登录后积分/组织空 | 注册流程异常；看后端日志 |
| Agent 报上游错误 | 1701 Key、模型名、`LLM_BASE_URL` 是否带 `/v1` |
| CORS / 无效 token | 前端还在打 localhost，或旧 JWT；清本地登录态 |

---

## 还不需要马上做的事

- 微信/支付宝官方 SDK 自动到账  
- 每用户独立 1701 Key  
- 完整官网与管理后台 UI  
- 完全撕掉 Electron 里遗留的有道 Portal（一期可先保证「工作站路径」可用）

有卡点时把：**系统镜像、是否已有云数据库、`curl ready` 结果、pm2 日志最后 30 行**发出来，可以按报错继续往下排。
