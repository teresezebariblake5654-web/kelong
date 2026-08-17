# Workhorse AI 官网下载页

静态站点，部署到 `https://bx-aigc.com`（也可挂在 `/#/download-list`，同源根路径即可）。

## 本地预览

```bash
npx --yes serve website -p 4173
# 打开 http://127.0.0.1:4173
```

## 发布安装包

在仓库根目录：

```bash
# Windows 本机
npm run ship:win:prod
npm run publish:downloads -- --platform win

# Mac 本机（Apple 芯片）
npm run ship:mac:prod
npm run publish:downloads -- --platform mac-arm64

# Mac 本机（Intel）
npm run ship:mac:prod:x64
npm run publish:downloads -- --platform mac-x64
```

`publish:downloads` 会把 `release/` 里最新产物复制为稳定文件名：

- `website/downloads/WorkhorseAI-Windows-Setup.exe`
- `website/downloads/WorkhorseAI-macOS-arm64.dmg`
- `website/downloads/WorkhorseAI-macOS-x64.dmg`

并更新 `website/releases.json` 的 `available` / `version`。

## 上传到服务器

```bash
# 示例：整站同步到 Nginx 根目录
rsync -avz --delete website/ ubuntu@VM-0-2-ubuntu:/var/www/bx-aigc.com/
```

Nginx 配置见 `deploy/nginx/bx-aigc.com.conf`。
