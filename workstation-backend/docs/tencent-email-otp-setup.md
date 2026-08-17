# 腾讯云邮箱验证码接入说明（workstation-backend）

## 推荐：模板 API（`MAIL_PROVIDER=ses-api`）

验证码必须用 **SendEmail + 模板**（每人一封、验证码不同）。  
不要用控制台的「批量发送任务 / BatchSendEmail」——那是营销群发，不适合 OTP。

### 1. 控制台准备

1. 开通 [邮件推送 SES](https://console.cloud.tencent.com/ses)
2. 发信域名 `bx-aigc.com` 验证通过（SPF / DKIM）
3. 新建发信地址，例如 `admin@bx-aigc.com`
4. **邮件模板** → 新建，变量须为：

| 变量 | 含义 |
|------|------|
| `username` | 用户称呼（当前用邮箱 @ 前一段） |
| `verify_code` | 6 位验证码 |

正文示例：

```text
尊敬的{{username}}:
您好！您正在操作账号，本次验证码为：{{verify_code}}
验证码有效期5分钟，请勿转发给他人。
```

5. [API 密钥](https://console.cloud.tencent.com/cam/capi) 拿到 `SecretId` / `SecretKey`（需 SES 权限）

### 2. `.env`

```env
MAIL_PROVIDER=ses-api
MAIL_FROM=admin@bx-aigc.com
MAIL_FROM_NAME=AI工作站
TENCENT_SECRET_ID=AKIDxxxx
TENCENT_SECRET_KEY=xxxx
TENCENT_SES_REGION=ap-guangzhou
TENCENT_SES_OTP_TEMPLATE_ID=55917
EMAIL_OTP_TTL_SEC=300
EMAIL_OTP_RESEND_COOLDOWN_SEC=60
EMAIL_OTP_DAILY_LIMIT=10
```

### 3. 本地联调

```env
MAIL_PROVIDER=mock
```

mock 下验证码写后端日志，且 `send` 接口返回 `mockCode`。

---

## 备选：SMTP

```env
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.qcloudmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=admin@bx-aigc.com
SMTP_PASS=你的SMTP密码
MAIL_FROM=admin@bx-aigc.com
MAIL_FROM_NAME=AI工作站
```

---

## 接口

- `POST /api/v1/auth/email-otp/send` `{ email, purpose: "register"|"login" }`
- `POST /api/v1/auth/register` `{ email, username, password, code }`
- `POST /api/v1/auth/login` `{ email, code }` 或 `{ email, password }`
