// ── Conversation History Module ──
// 方案 A+C：localStorage 儲存 + AI 自動命名
//
// 資料結構：
//   localStorage['conv_list'] = JSON array of { id, title, ts, preview }
//   localStorage['conv_${id}'] = JSON { id, title, ts, messages: [...], htmlSnapshot }

const CONV_LIST_KEY = 'conv_list';
const MAX_CONVS     = 50;   // 最多保留幾份對話

let _currentConvId  = null;   // 目前對話的 id
let _titleGenerated = false;  // 本輪對話是否已生成標題

// ══════════════════════════════════════════════
//  localStorage helpers
// ══════════════════════════════════════════════

function convList() {
  try { return JSON.parse(localStorage.getItem(CONV_LIST_KEY) || '[]'); }
  catch { return []; }
}

function saveConvList(list) {
  localStorage.setItem(CONV_LIST_KEY, JSON.stringify(list));
}

function loadConv(id) {
  try { return JSON.parse(localStorage.getItem(`conv_${id}`) || 'null'); }
  catch { return null; }
}

function saveConv(conv) {
  localStorage.setItem(`conv_${conv.id}`, JSON.stringify(conv));
  // 更新 list 裡的 meta
  const list = convList();
  const idx  = list.findIndex(c => c.id === conv.id);
  const meta = { id: conv.id, title: conv.title, ts: conv.ts, preview: conv.preview || '' };
  if (idx >= 0) list[idx] = meta;
  else          list.unshift(meta);
  // 超過上限刪舊的
  while (list.length > MAX_CONVS) {
    const removed = list.pop();
    localStorage.removeItem(`conv_${removed.id}`);
  }
  saveConvList(list);
}

function deleteConv(id) {
  localStorage.removeItem(`conv_${id}`);
  const list = convList().filter(c => c.id !== id);
  saveConvList(list);
}

// ══════════════════════════════════════════════
//  目前對話管理
// ══════════════════════════════════════════════

function newConversation() {
  _currentConvId  = `conv_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  _titleGenerated = false;
  // 清空 UI
  history = [];  // app.js 的全域 history
  const wrap = document.querySelector('.msg-wrap');
  if (wrap) wrap.innerHTML =
    `<div id="empty-state"><div class="icon">💬</div><p>${t.emptyState || '開始對話吧！'}</p></div>`;
  renderHistorySidebar();
}

// 儲存目前對話快照
function saveCurrentConv(title) {
  if (!_currentConvId || history.length === 0) return;
  const existing = loadConv(_currentConvId) || {};
  const conv = {
    id     : _currentConvId,
    title  : title || existing.title || '新對話',
    ts     : existing.ts || Date.now(),
    preview: history.find(m => m.role === 'user')?.content?.slice(0, 60) || '',
    messages: JSON.parse(JSON.stringify(history)),  // deep copy
    htmlSnapshot: (() => {
    // PPT carousel 依賴 JS 狀態，還原時只保留訊息文字，不保留互動元件
    const clone = document.querySelector('.msg-wrap')?.cloneNode(true);
    if (!clone) return '';
    clone.querySelectorAll('.ppt-msg').forEach(el => {
      el.innerHTML = '<em style="color:var(--muted)">${t.pptRestorePlaceholder}</em>';
    });
    return clone.innerHTML;
  })(),
  };
  saveConv(conv);
  renderHistorySidebar();
}

// ══════════════════════════════════════════════
//  AI 自動命名（背景執行，不阻塞回覆）
// ══════════════════════════════════════════════

async function autoGenerateTitle() {
  if (_titleGenerated || history.length < 2) return;
  _titleGenerated = true;

  const cfg = getConfig();  // app.js 的 getConfig
  if (cfg.provider !== 'ollama' && !cfg.apiKey) return;

  try {
    const snippet = history.slice(0, 4)
      .map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content.slice(0, 80)}`)
      .join('\n');

    const req = buildRequest(  // app.js 的 buildRequest
      { ...cfg, maxTokens: 20 },
      [
        { role: 'system', content: (() => {
          const lang = document.getElementById('lang-select')?.value || 'zh-TW';
          if (lang === 'en') return 'You are a title generator. Given a conversation, write a short English title (max 6 words). Output only the title, no punctuation or explanation.';
          if (lang === 'ja') return 'あなたはタイトル生成器です。会話内容をもとに、10文字以内の日本語タイトルを生成してください。タイトルのみ出力し、説明や記号は不要です。';
          return '你是標題生成器。根據對話內容，用繁體中文生成一個 10 字以內的簡短標題。只輸出標題文字，不加任何標點或說明。';
        })() },
        { role: 'user',   content: snippet },
      ],
      false
    );
    const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
    if (!resp.ok) return;
    const data  = await resp.json();
    const title = (data.choices?.[0]?.message?.content || '').trim().slice(0, 20);
    if (title) {
      saveCurrentConv(title);
      // 更新 sidebar 的標題
      const el = document.querySelector(`[data-conv-id="${_currentConvId}"] .conv-title`);
      if (el) el.textContent = title;
    }
  } catch { /* 靜默失敗 */ }
}

// ══════════════════════════════════════════════
//  切換到舊對話
// ══════════════════════════════════════════════

function switchToConv(id) {
  if (id === _currentConvId) return;

  // 先儲存目前對話
  saveCurrentConv();

  const conv = loadConv(id);
  if (!conv) return;

  _currentConvId  = id;
  _titleGenerated = true;   // 舊對話不需要重新命名

  // 還原 history
  history = JSON.parse(JSON.stringify(conv.messages || []));

  // 還原 HTML（最簡單可靠的方式）
  const wrap = document.querySelector('.msg-wrap');
  if (wrap && conv.htmlSnapshot) {
    wrap.innerHTML = conv.htmlSnapshot;
  } else if (wrap) {
    wrap.innerHTML = `<div style="color:var(--muted);padding:20px;text-align:center">無法還原畫面</div>`;
  }

  renderHistorySidebar();
  document.getElementById('messages').scrollTop = 99999;
}

// ══════════════════════════════════════════════
//  側欄渲染
// ══════════════════════════════════════════════

function getOrCreateHistorySection() {
  let section = document.getElementById('history-section');
  if (section) return section;

  section = document.createElement('div');
  section.id        = 'history-section';
  section.className = 'history-section';

  // 插在 sidebar-content 的最上方
  const content = document.querySelector('.sidebar-content');
  if (content) content.prepend(section);
  return section;
}

function renderHistorySidebar() {
  const section = getOrCreateHistorySection();
  const list    = convList();

  if (list.length === 0) {
    section.innerHTML = '';
    return;
  }

  const items = list.map(c => {
    const isActive = c.id === _currentConvId;
    const date     = formatRelativeDate(c.ts);
    return `
      <div class="conv-item ${isActive ? 'active' : ''}" data-conv-id="${c.id}"
           onclick="switchToConv('${c.id}')">
        <div class="conv-item-body">
          <div class="conv-title">${escHist(c.title || '新對話')}</div>
          <div class="conv-meta">${date}</div>
        </div>
        <button class="conv-delete" title="刪除"
          onclick="event.stopPropagation(); confirmDeleteConv('${c.id}')">✕</button>
      </div>`;
  }).join('');

  section.innerHTML = `
    <div class="history-header">
      <span class="history-label">${t.recents || 'Recents'}</span>
      <button class="btn-new-conv" onclick="newConversation()" title="${t.newConv || '新對話'}">＋</button>
    </div>
    <div class="history-list">${items}</div>`;
}

function confirmDeleteConv(id) {
  deleteConv(id);
  if (id === _currentConvId) newConversation();
  else renderHistorySidebar();
}

function formatRelativeDate(ts) {
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min  <  1) return t.timeJustNow || '剛才';
  if (min  < 60) return `${min} ${t.timeMinAgo || '分鐘前'}`;
  if (hr   < 24) return `${hr} ${t.timeHrAgo  || '小時前'}`;
  if (day  <  7) return `${day} ${t.timeDayAgo || '天前'}`;
  const lang = document.getElementById('lang-select')?.value || 'zh-TW';
  return new Date(ts).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
}

function escHist(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════
//  Hook 進 app.js 的 sendMessage / clearHistory
// ══════════════════════════════════════════════

// 在 DOM ready 後攔截 sendMessage 的完成事件
document.addEventListener('DOMContentLoaded', () => {
  // 1. 啟動時建立新對話 id
  newConversation();

  // 2. Patch switchLanguage：切換語言後重新 render sidebar
  const _origSwitchLang = window.switchLanguage;
  window.switchLanguage = async function(lang) {
    await _origSwitchLang?.(lang);
    renderHistorySidebar();
  };

  // 3. Patch clearHistory：清除後也重置 id
  const _origClear = window.clearHistory;
  window.clearHistory = function() {
    saveCurrentConv();   // 先存現有的
    _origClear?.();
    newConversation();
  };

  // 3. Patch sendMessage：回覆結束後自動存檔 + 命名
  const _origSend = window.sendMessage;
  window.sendMessage = async function() {
    // 如果是第一則訊息，先建立對話 id
    if (history.length === 0 && !_currentConvId) newConversation();
    await _origSend?.();
    // 回覆完成後
    saveCurrentConv();
    if (!_titleGenerated) autoGenerateTitle();
    // 背景萃取長期記憶（至少 2 輪對話才觸發）
    if (typeof extractMemoriesFromHistory === 'function' && history.filter(m => m.role === 'user').length >= 2) {
      extractMemoriesFromHistory([...history], _currentConvId);
    }
  };
});