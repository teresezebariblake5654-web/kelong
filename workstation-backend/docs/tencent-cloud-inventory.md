# 腾讯云资源总览（上线对照 · bx-aigc.com）

与仓库上线清单配套：[`go-live-product-readiness.md`](./go-live-product-readiness.md)、[`tencent-cvm-deploy-beginner.md`](./tencent-cvm-deploy-beginner.md)。

**本期范围只部署 `bx-aigc.com`。** `bx-robot.cn` → `47.251.77.106` 为外部机，不纳入本仓库 cutover。

---

## 已有资源

| 类型 | 详情 | 状态 |
|------|------|------|
| 域名 | `bx-aigc.com`（.com，至 2027-07-23） | ✅ |
| 辅助域名 | `bx-robot.cn`（外站，本期忽略） | ➖ |
| 服务器 | Lighthouse `Ubuntu-O2mi` / `lhins-bzlfqxpc` / 上海 | ✅ |
| 公网 IP | `106.54.15.76` | ✅ |
| 内网 IP | `10.0.0.2` | ✅ |
| DNS `@` / `www` / `api` | A → `106.54.15.76` | ✅ 已解析 |
| SES 发信域名 | `bx-aigc.com` 验证通过；信誉 1；500 封/天；共享 IP | ✅ |
| SES SPF / DKIM / DMARC | 已配置 | ✅ |
| 收款码图 | 仓库 `public/payment/` 六档 png | ✅（上机后需 HTTPS 可访问） |

## 尚未配置（上线阻塞）

| 资源 | 做法 |
|------|------|
| **SSL 证书** | 机上 `certbot --nginx -d api.bx-aigc.com -d bx-aigc.com -d www.bx-aigc.com`（无 CLB/CDN） |
| **PostgreSQL** | **无云数据库** → 装在同一台 Lighthouse（`127.0.0.1:5432`），见部署手册方案 B |
| **SES 发信地址** | 控制台新建例如 `noreply@bx-aigc.com`，生成 SMTP 密码写入 `.env` |
| 负载均衡 / CDN / VPC | 本期不需要 |

> 控制台若看到 MX=`mxbiz1.qq.com`：那是企业邮/其他服务记录。SES 发信主要靠 **SPF + DKIM**（你们已过验证）。OTP 只走 SES SMTP，不依赖该 MX。

---

## 一台机拓扑

```
客户端 / 官网
      │ HTTPS :443
      ▼
 Nginx（Lighthouse 106.54.15.76）
      ├─ api.bx-aigc.com  → 127.0.0.1:3001  (workstation-backend + pm2)
      └─ bx-aigc.com / www → 静态下载页（Win .exe + Mac .dmg，仓库 website/）
            │
            ├─ Postgres @ 127.0.0.1:5432
            ├─ SES SMTP（OTP）
            ├─ 126 SMTP（反馈）
            └─ 1701 LLM
```

防火墙（轻量应用服务器防火墙 / 安全组）只开：`22`（建议限 IP）、`80`、`443`。**不要**对公网开 `3001`、`5432`。

---

## SSH 后最短路径

```bash
ssh ubuntu@106.54.15.76   # 用户名以控制台为准

# 1) 本机 Postgres（无 RDS）
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER aw WITH PASSWORD '换成强密码';"
sudo -u postgres psql -c "CREATE DATABASE agent_workstation OWNER aw;"

# 2) 代码 + .env（从 .env.production.example 复制并填密钥）
# 3) bash scripts/server-cutover.sh
# 4) Nginx + certbot（见 tencent-cvm-deploy-beginner.md §6）
```

SES 仍缺发信地址时：控制台 → 邮件推送 → 发信地址 → 新建 `noreply@bx-aigc.com` → 把 SMTP 密码写入 `SMTP_PASS` / `SMTP_USER`。

---

## 与工程债对照

仓库阶段 1（模板 / 禁 mock 支付口 / 客户端强制真 API / seed 卫生 / 清单）已落地。  
本机「demo 企业版」界面是**本地开发 seed**；生产 `ALLOW_DEMO_USER=false` + `npm run db:cleanup-demo` 后不应再出现 `demo@example.com`。
