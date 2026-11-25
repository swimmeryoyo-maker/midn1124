# StageSync 團隊企劃與人力調遣系統

使用 **Astro + Hono + Cloudflare Workers + Cloudflare D1** 建構的團隊企劃管理與人力調查系統（台灣時間 UTC+8）。

## 技術架構

- **前端 UI**：Astro（`output: 'server'`，暗色系 RWD 介面）
- **後端 API**：Hono（掛載於 `src/pages/api/[...path].ts`，核心路由位於 `src/server/app.ts`）
- **資料庫**：Cloudflare D1（SQLite，Schema 與種子資料位於 `migrations/0001_init.sql`）
- **驗證機制**：Web Crypto PBKDF2 密碼雜湊 + HMAC-SHA256 HttpOnly Cookie Session

---

## 預設帳號（初次 Migration 自動建立）

| 帳號 (姓名) | 密碼 | 身分 |
| --- | --- | --- |
| `midnight` | `midnight1027` | 管理者 (`admin`) |
| `空羽` | `1234` | 一般成員 (`user`) |

> 亦可於登入畫面直接使用「📝 首次註冊」建立新成員帳號。

---

## 本地開發與測試操作

### 1. 安裝套件

```bash
npm install
```

### 2. 執行本地 D1 遷移與建置

`build` 指令已整合本地 D1 Migration 與 Astro 建置：

```bash
npm run build
```

若僅需單獨執行 D1 本地遷移或型別檢查：

```bash
npm run db:migrate:local
npm run typecheck
```

### 3. 啟動本地預覽伺服器（含 D1 模擬環境）

```bash
npm run preview
```

或使用 Astro 開發模式（熱重載）：

```bash
npm run dev
```

啟動後於瀏覽器開啟終端機顯示的本地網址（`wrangler dev` 預設為 `http://localhost:8787`，`astro dev` 預設為 `http://localhost:4321`）。

> **Windows PowerShell 注意事項**：若系統停用 `.ps1` 指令碼執行，請改用 `npm.cmd` 與 `npx.cmd`（例如 `npm.cmd run build`、`npm.cmd run preview`）。

---

## 部署至 Cloudflare Workers

### 1. 登入 Cloudflare

```bash
npx wrangler login
```

### 2. 建立遠端 D1 資料庫

```bash
npx wrangler d1 create stagesync-db
```

若使用 Cloudflare Workers Builds 或需要手動指定 ID，再將輸出的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`（本地開發與自動綁定可省略）。

### 3. 設定 Session 簽章密鑰

```bash
npx wrangler secret put SESSION_SECRET
```

輸入一組隨機高強度字串作為 Cookie 簽章密鑰。

### 4. 套用遠端資料庫遷移並部署

`deploy` 指令會依序執行 **遠端 D1 Migration → Astro Build → Wrangler Deploy**：

```bash
npm run deploy
```

---

## 常用指令一覽

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 啟動 Astro 開發伺服器（支援 HMR） |
| `npm run build` | 套用本地 D1 遷移並建置 Worker (`dist/`) |
| `npm run build:app` | 僅建置 Astro 應用程式（不執行遷移） |
| `npm run preview` | 啟動 `wrangler dev` 本地 Worker 預覽 |
| `npm run db:migrate:local` | 套用遷移至本地 `.wrangler` D1 |
| `npm run db:migrate:remote` | 套用遷移至 Cloudflare 遠端 D1 |
| `npm run deploy` | 套用遠端 D1 遷移、建置並部署至 Cloudflare Workers |
| `npm run typecheck` | 執行 `astro check` 與 `tsc --noEmit` |
