# Narratium

![Narratium banner](./public/banner.png)

可自托管的 AI 角色聊天与故事工作台。

[English](./README.md) | 简体中文 | [繁體中文](./README_ZH-TW.md) | [Español](./README_ES.md) | [Français](./README_FR.md)

本仓库由早期 fork 的本地备份重新创建，现由当前仓库所有者继续维护。原始上游仓库和贡献者仓库已经无法访问。当前项目仓库为 [yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui)。

本仓库只包含应用代码，不包含角色卡、故事、预设或其他用户创作内容。

## 功能

- Next.js 前端、Go API 后端和 PostgreSQL 数据库。
- 支持管理员和普通用户登录。
- 角色卡、图片、对话、预设、世界书、正则脚本和用户设置存储在服务端。
- 支持导入 SillyTavern PNG、JSON 和 CharX 角色卡，包括内嵌世界书、正则脚本和 CharX 资源。
- 管理员配置 API 渠道和模型参数。
- 支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 和 Gemini `generateContent`。
- 支持流式聊天、分支对话、上下文管理、提示词缓存、计费和用户使用日志。

## 快速开始

需要 Docker Compose。

```bash
export NARRATIUM_SECRET='请替换为至少32字符且长期不变的随机值'
docker compose up -d --build
```

打开 <http://localhost:5000>，第一个成功注册的账户会直接成为管理员。必须配置 `NARRATIUM_SECRET`，它用于派生 JWT 和渠道密钥加密密钥，首次使用后不得更改。

在“管理面板”中创建 API 渠道，选择接口格式，填写 Base URL、密钥和该渠道支持的原始模型 ID。模型 ID 可以自由填写。普通用户只能选择已启用渠道中的模型。

默认端口直接在 `docker-compose.yml` 中修改。`NARRATIUM_MAX_BLOB_TOTAL_GB` 默认值为 `2`，设置为 `0` 可关闭每个用户的总存储限制。

请备份 `narratium-postgres`，并将 `NARRATIUM_SECRET` 保存在可靠的密码管理器中。

## 本地开发

工具链：Node.js `24.18.0` LTS、pnpm `11.12.0`、Go `1.26.5`、PostgreSQL `18`。

```bash
pnpm install --frozen-lockfile
```

后端和前端启动方式见[入门指南](./docs/GETTING_STARTED.md)。运行检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend:race
pnpm build
```

## 许可证

本项目使用 [MIT 许可证](./LICENSE)。导入或生成的内容仍受其来源和创作者条款约束。

## 链接

- [入门指南](./docs/GETTING_STARTED.md)
- [Issues](https://github.com/yuzukumo/narratium-webui/issues)
- [许可证](./LICENSE)

## 友链

**LinuxDo** — [https://linux.do](https://linux.do/)

这个社区为项目提供了一些支持。
