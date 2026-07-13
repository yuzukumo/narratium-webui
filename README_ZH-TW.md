# Narratium

![Narratium banner](./public/banner.png)

可自託管的 AI 角色聊天與故事工作台。

[English](./README.md) | [简体中文](./README_ZH.md) | 繁體中文 | [Español](./README_ES.md) | [Français](./README_FR.md)

本儲存庫由早期 fork 的本機備份重新建立，現由目前的儲存庫擁有者繼續維護。原始上游儲存庫與貢獻者儲存庫已無法存取。目前的專案儲存庫是 [yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui)。

本儲存庫只包含應用程式碼，不包含角色卡、故事、預設或其他使用者創作內容。

## 功能

- Next.js 前端、Go API 後端與 PostgreSQL 資料庫。
- 支援管理員與一般使用者登入。
- 角色卡、圖片、對話、預設、世界書、正規表示式腳本與使用者設定儲存在伺服器端。
- 支援匯入 SillyTavern PNG、JSON 與 CharX 角色卡，包括內嵌世界書、正規表示式腳本與 CharX 資源。
- 管理員可設定 API 渠道與模型參數。
- 支援 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 與 Gemini `generateContent`。
- 支援串流聊天、分支對話、上下文管理、提示詞快取、計費與使用日誌。

## 快速開始

需要 Docker Compose。

```bash
export NARRATIUM_SECRET='請替換為至少32字元且長期不變的隨機值'
docker compose up -d --build
```

開啟 <http://localhost:5000>，第一個成功註冊的帳戶會直接成為管理員。必須設定 `NARRATIUM_SECRET`，首次使用後不得變更。

在「管理面板」中建立 API 渠道，選擇介面格式，填寫 Base URL、密鑰及渠道支援的原始模型 ID。模型 ID 可自由填寫。一般使用者只能選擇已啟用渠道中的模型。

預設連接埠直接在 `docker-compose.yml` 中修改。`NARRATIUM_MAX_BLOB_TOTAL_GB` 預設為 `2`，設定為 `0` 可關閉每位使用者的總儲存限制。

請備份 `narratium-postgres`，並將 `NARRATIUM_SECRET` 儲存在可靠的密碼管理器中。

## 本機開發

工具鏈：Node.js `24.18.0` LTS、pnpm `11.12.0`、Go `1.26.5`、PostgreSQL `18`。

```bash
pnpm install --frozen-lockfile
```

後端與前端啟動方式請參考[入門指南](./docs/GETTING_STARTED.md)。

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend:race
pnpm build
```

## 授權條款

本專案使用 [MIT 授權條款](./LICENSE)。匯入或產生的內容仍受其來源與創作者條款約束。

## 連結

- [入門指南](./docs/GETTING_STARTED.md)
- [Issues](https://github.com/yuzukumo/narratium-webui/issues)
- [授權條款](./LICENSE)
