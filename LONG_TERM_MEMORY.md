# Long-term Memory — 實作文件

## 功能概述

每次對話結束後，AI 自動從對話內容萃取值得長期記住的使用者資訊，
存入瀏覽器的 `localStorage`，並在每次新對話時自動注入 system prompt，
讓 AI 跨對話「記住」使用者。

---

## 架構

```
memory.js          ← 核心模組（新增）
  ├── getLTMBank()            讀取記憶庫
  ├── saveLTMBank()           寫入記憶庫
  ├── addLTMItems()           新增記憶（含去重）
  ├── deleteLTMItem()         刪除單條記憶
  ├── clearAllLTM()           清空記憶庫
  ├── getLTMInjection()       產生注入字串
  ├── extractMemoriesFromHistory()  背景 AI 萃取
  └── renderMemoryPanel()     側欄 UI 渲染

app.js             ← 修改：sendMessage() 注入長期記憶
history.js         ← 修改：sendMessage patch 觸發萃取
index.html         ← 修改：加入 ltm-panel div + <script> 引入
style.css          ← 修改：加入 ltm-* CSS 樣式
```

---

## 資料結構

```
localStorage['ltm_bank'] = [
  {
    id:             "ltm_1710000000000_ab12",  // 唯一 id
    content:        "使用者正在開發 HW1 ChatGPT 專案",
    ts:             1710000000000,             // Unix ms
    source_conv_id: "conv_1710000000000_xyz"   // 來源對話 id
  },
  ...
]
```

- 上限：30 條，超過自動淘汰最舊的
- 去重：內容完全相同（不分大小寫）的條目不重複寫入

---

## 流程

### 萃取流程（每次對話回覆後觸發）

```
使用者送出訊息 → AI 回覆
  → history.js: sendMessage patch 完成
  → 條件：user 訊息 >= 2 則
  → 呼叫 extractMemoriesFromHistory([...history], convId)
      → 組裝 AI prompt（依介面語言切換 zh-TW / en / ja）
      → 背景呼叫 API（max_tokens: 150，不影響主對話）
      → 解析回傳內容（每行一條事實）
      → 去重後寫入 localStorage['ltm_bank']
      → 重新渲染側欄面板
```

### 注入流程（每次送出訊息時）

```
sendMessage()
  → getLTMInjection() 讀取記憶庫
  → 若有記憶，附加到 system prompt 尾端：

    ---長期記憶（請參考但不需主動提及）---
    • 使用者正在開發 HW1 ChatGPT 專案
    • 使用者偏好繁體中文回覆
    ---

  → 傳送給 API
```

---

## 萃取 Prompt（繁中版）

```
System:
你是記憶萃取器。從對話中萃取值得長期記住的使用者資訊
（名字、偏好、正在進行的專案、技能、目標）。
每行一條，純文字。若無值得記憶的內容，輸出：NONE

User:
從以下對話萃取值得記憶的事實：
User: ...
AI: ...
```

---

## UI 操作

側欄下方「🧠 長期記憶」區塊：
- 顯示所有記憶條目，含時間戳
- 每條旁有 `✕` 按鈕可單獨刪除
- 「全部清除」按鈕（帶確認提示）清空所有記憶
- 多語言支援（zh-TW / en / ja）

---

## 除錯指南

### 記憶沒有被萃取
1. 確認對話至少有 **2 則 user 訊息**（條件：`history.filter(m => m.role === 'user').length >= 2`）
2. 打開 DevTools → Console，確認沒有 JS 錯誤
3. 確認 API Key 有設定（非 Ollama 必須有 key）
4. 萃取是「背景靜默」執行，失敗不會顯示錯誤訊息；可在 `extractMemoriesFromHistory` 的 `catch` 加 `console.warn` 除錯

### 記憶有了但 AI 沒有使用
1. DevTools → Console 搜尋 `getLTMInjection`，或在 `sendMessage()` 的 `messages` 建構處加 `console.log(messages[0].content)` 確認注入內容
2. 確認 `memory.js` 在 `app.js` **之後**載入（index.html 順序：app.js → ppt.js → history.js → memory.js）

### localStorage 查看
DevTools → Application → Local Storage → http://localhost:5000
- `ltm_bank`：記憶庫 JSON
- `conv_list`：對話歷史列表

### 手動新增測試記憶
```javascript
// 在 Console 輸入：
addLTMItems(['測試：使用者叫做小明', '測試：偏好 Python'], 'test');
```

### 清空記憶
```javascript
// 在 Console 輸入：
clearAllLTM();
```

---

## 設計決策

| 決策 | 原因 |
|------|------|
| 純前端 localStorage，不改 server.py | 最小改動，不增加後端依賴 |
| 萃取背景執行、靜默失敗 | 記憶功能不能影響主對話體驗 |
| 至少 2 則 user 訊息才萃取 | 避免單句對話產生無意義記憶 |
| max_tokens: 150 | 萃取只需簡短輸出，節省 token |
| 上限 30 條 | 防止 system prompt 過長影響模型 |
| 注入語加「不需主動提及」 | 避免 AI 每次回覆都刻意提起記憶 |
