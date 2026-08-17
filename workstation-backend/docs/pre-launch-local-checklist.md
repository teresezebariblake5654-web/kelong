# 今天上线前：本地先跑通（再上传服务器）

原则：**本地四条链路全绿，再上传腾讯云。**  
四条：数据库 · 验证码 · 注册/登录 · 扫码充值（人工确认）。

服务器部署细节见 `tencent-cvm-deploy-beginner.md`。

---

## A. 本地准备（上午建议做完）

### A1. 数据库

```bash
cd workstation-backend
# 确保本地 Postgres 在跑（你们常用 npm run db:up 或本机 Docker）
npx prisma migrate deploy
npx prisma db seed
```

种子会包含：

- 充值套餐（¥50 / ¥100 / ¥500）
- demo 用户（若 `ALLOW_DEMO_USER=true`）
- **管理员** `admin@bx-aigc.com`（密码默认 `AdminPass123!`，可用 env 改）

生产务必改：

```env
ADMIN_SEED_EMAIL=你的邮箱
ADMIN_SEED_PASSWORD=强密码
```

再执行一次 `npx prisma db seed`。

### A2. 验证码（本地先用 mock）

`.env`：

```env
MAIL_PROVIDER=mock
```

重启后端。侧边栏点「获取验证码」会提示 **开发模式验证码**（也会打日志）。  
联调通过后，再换腾讯云 SMTP（见 `tencent-email-otp-setup.md`）。

### A3. 注册 / 登录（必须用验证码注册）

1. 启动 `workstation-backend` + 前端工作站  
2. 用户中心 → **邮箱注册**  
3. 邮箱 → 获取验证码 → 用户名/密码/验证码 → 注册并登录  
4. 退出 → 用**密码**再登录一次  
5. 再测一次**验证码登录**（可选）

注册接口已强制要求 `code`，无验证码不能注册。

### A4. 支付（一期：扫码 + 管理员确认）

本地 `.env` 可先：

```env
DEFAULT_PAYMENT_PROVIDER=manual
PAYMENT_WECHAT_QR_URL=https://例：你的收款码图片地址
PAYMENT_PAYEE_NAME=收款人姓名
PAYMENT_SUPPORT_TEXT=付款后点「我已付款」，客服确认后到账
PAYMENT_NOTICE=请备注注册邮箱
```

流程：

1. 登录普通用户 → 充值页看到套餐和收款码  
2. 下单 → 「我已付款」→ 订单变为待审核  
3. **管理员**登录拿 Token，确认订单：

```bash
# 1) 管理员登录
curl -s -X POST http://127.0.0.1:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@bx-aigc.com\",\"password\":\"AdminPass123!\"}"

# 2) 把返回的 accessToken 和下单得到的 orderId 填进去
curl -s -X POST "http://127.0.0.1:3001/api/v1/admin/recharge/orders/订单ID/confirm" \
  -H "Authorization: Bearer 管理员Token"
```

4. 用户刷新积分，余额应增加  

（微信/支付宝自动到账今天不必做。）

### A5. Agent / 模型（本地可选，上线必配）

本地可继续 `MODEL_PROVIDER=mock` 只测账号与充值。  
上线前必须改为：

```env
MODEL_PROVIDER=custom
LLM_BASE_URL=https://1701.store/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=你的模型名
```

---

## B. 本地打勾清单（全绿再上传）

- [ ] `migrate deploy` + `db seed` 成功  
- [ ] 能发验证码（mock 看到 mockCode）  
- [ ] 新邮箱能注册并登录  
- [ ] 密码登录 / 验证码登录至少一种稳定  
- [ ] 充值套餐能列出  
- [ ] 能下单 + 标记已付  
- [ ] 管理员能 confirm，积分到账  
- [ ] （上线前）腾讯云 SES 域名/SMTP 已备好  
- [ ] （上线前）1701 Key + 模型名已备好  
- [ ] （上线前）收款码图片 URL、收款人文案已定  

---

## C. 下午再上传服务器（顺序别乱）

1. DNS：`api.bx-aigc.com` → CVM 公网 IP  
2. 服务器装 Node / Nginx / PostgreSQL（或云数据库）  
3. 上传 `workstation-backend` + `workstation-packages`  
4. 写生产 `.env`（`NODE_ENV=production`，`MAIL_PROVIDER=smtp`，`DEFAULT_PAYMENT_PROVIDER=manual`，1701，强密钥）  
5. `migrate deploy` → `db seed` → `npm run build` → `pm2`  
6. Nginx + HTTPS  
7. 客户端 `VITE_WORKSTATION_API_BASE_URL=https://api.bx-aigc.com`  
8. 用真实邮箱再跑一遍 B 清单  

细节命令：`tencent-cvm-deploy-beginner.md`。

---

## D. 今天不要分心做的事

- 有道 Portal 整包拆除  
- 微信/支付宝 SDK  
- 每用户独立 1701 Key  
- 漂亮管理后台 UI  

先保证：**库通、码通、号通、钱（扫码）通**。
