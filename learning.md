# Debug 學習紀錄

## Bug 1：API Key 一直跳出「請先確認 API Key 已載入！」

### 現象
- `config/api_key.config` 已填入真實 key
- Console 顯示 `✅ API keys loaded`
- 但 `apiKeys.groq` 實際上是空字串 `""`
- 每次送出訊息都跳出 alert

### 根本原因
**瀏覽器快取了舊的空回應。**

`app.js` 的 `loadApiKeys()` 用 `fetch('./config/api_key.config')` 讀取 key 檔。
在 server 還沒跑起來時，這個 fetch 曾回傳失敗（404 或 connection refused），Firefox 把該空結果快取下來。
之後即使 server 正常了，瀏覽器仍從快取拿到空字串，導致 parse 後 `apiKeys.groq` 永遠是 `""`。

Console 印出 `✅ API keys loaded` 是因為程式只要 `fetch()` 不丟出 exception 就會印成功，並不代表實際 parse 到 key。

### 解法
在 `fetch()` 加上 `cache: 'no-store'`，強制每次都向 server 要新資料：

```js
// app.js - loadApiKeys()
const res = await fetch('./config/api_key.config', { cache: 'no-store' });
```

---

## Bug 2：`Could not import module "server"`

### 現象
```
ERROR: Error loading ASGI app. Could not import module "server".
```

### 根本原因
在錯誤的目錄執行 `uvicorn`。`server.py` 在 `HW1---You-own-ChatGPT/` 子目錄，但指令從 `/project` 執行，找不到模組。

### 解法
先 `cd` 進正確目錄再啟動：
```bash
cd /project/HW1---You-own-ChatGPT
uvicorn server:app --reload --port 8000
```

---

## 架構說明：雙 Server 設計

| Server | 指令 | 用途 |
|--------|------|------|
| Port 8000 | `uvicorn server:app --reload --port 8000` | FastAPI 後端（PPT 生成、範本、下載） |
| Port 5000 | `python3 -m http.server 5000` | 靜態前端（index.html、app.js、config/ 等） |

- 前端透過 `API_BASE = 'http://localhost:8000'`（`ppt.js` 第 18 行）呼叫後端
- FastAPI 已設定 `allow_origins=["*"]`，跨 port 的 CORS 不會擋

---

## Bug 3：「找不到任何範本」但 input/ 資料夾有檔案

### 現象
點開範本選擇器，顯示「⚠️ 找不到任何範本，請確認 input/ 資料夾」，但 `input/` 內確實有 `.pptx` 檔，後端 `/templates` 也回傳正確資料。

### 根本原因
與 Bug 1 相同：`ppt.js` 的 `fetchTemplates()` 曾在 server 未啟動時 fetch 失敗，Firefox 快取了空結果，之後即使 server 正常也拿到舊的失敗回應。

### 解法
同樣加上 `cache: 'no-store'`：
```js
// ppt.js - fetchTemplates()
const resp = await fetch(`${API_BASE}/templates`, { cache: 'no-store' });
```

---

## 補充：Model 名稱錯誤（404）

`config/providers.json` 裡的 `moonshotai/kimi-k2-instruct` 在 Groq 上不存在或無權限存取，改成有效的 model（如 `llama-3.3-70b-versatile`）即可。
