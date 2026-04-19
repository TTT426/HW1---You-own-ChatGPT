// ── Long-term Memory Module ──
// Persists extracted facts across conversations via localStorage['ltm_bank']
// Data structure: [{ id, content, ts, source_conv_id }]

const LTM_KEY = 'ltm_bank';
const LTM_MAX = 30;

function getLTMBank() {
  try { return JSON.parse(localStorage.getItem(LTM_KEY) || '[]'); }
  catch { return []; }
}

function saveLTMBank(bank) {
  localStorage.setItem(LTM_KEY, JSON.stringify(bank));
}

function addLTMItems(items, convId) {
  if (!items || items.length === 0) return;
  const bank = getLTMBank();
  items.forEach(content => {
    content = content.trim();
    if (!content) return;
    // Skip near-duplicate entries (case-insensitive exact match)
    const exists = bank.some(m => m.content.toLowerCase() === content.toLowerCase());
    if (!exists) {
      bank.unshift({
        id: `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content,
        ts: Date.now(),
        source_conv_id: convId || null,
      });
    }
  });
  while (bank.length > LTM_MAX) bank.pop();
  saveLTMBank(bank);
  renderMemoryPanel();
}

function deleteLTMItem(id) {
  saveLTMBank(getLTMBank().filter(m => m.id !== id));
  renderMemoryPanel();
}

function clearAllLTM() {
  localStorage.removeItem(LTM_KEY);
  renderMemoryPanel();
}

// Returns a string to append to the system prompt
function getLTMInjection() {
  const bank = getLTMBank();
  if (bank.length === 0) return '';
  const lines = bank.map(m => `• ${m.content}`).join('\n');
  return `\n\n---長期記憶（請參考但不需主動提及）---\n${lines}\n---`;
}

// Called after a conversation ends; extracts memorable facts via AI (background, silent)
async function extractMemoriesFromHistory(messages, convId) {
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length < 2) return;

  // getConfig() is defined in app.js
  const cfg = (typeof getConfig === 'function') ? getConfig() : null;
  if (!cfg) return;
  if (cfg.provider !== 'ollama' && !cfg.apiKey) return;

  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 200)}`)
    .join('\n');

  const lang = document.getElementById('lang-select')?.value || 'zh-TW';
  let sysPrompt, userPrompt;

  if (lang === 'en') {
    sysPrompt  = 'You are a memory extractor. Extract facts worth remembering long-term about the user (name, preferences, ongoing projects, skills, goals). Output one fact per line, plain text. If nothing is worth remembering, output exactly: NONE';
    userPrompt = `Extract memorable facts:\n\n${conversationText}`;
  } else if (lang === 'ja') {
    sysPrompt  = 'あなたはメモリ抽出器です。ユーザーについて長期的に覚える価値のある事実（名前、好み、プロジェクト、スキル、目標）を1行1件で抽出してください。なければ NONE と出力。';
    userPrompt = `記憶すべき事実を抽出：\n\n${conversationText}`;
  } else {
    sysPrompt  = '你是記憶萃取器。從對話中萃取值得長期記住的使用者資訊（名字、偏好、正在進行的專案、技能、目標）。每行一條，純文字。若無值得記憶的內容，輸出：NONE';
    userPrompt = `從以下對話萃取值得記憶的事實：\n\n${conversationText}`;
  }

  try {
    // buildRequest() is defined in app.js
    const req  = buildRequest(
      { ...cfg, maxTokens: 150 },
      [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
      false
    );
    const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
    if (!resp.ok) return;
    const data  = await resp.json();
    const text  = (data.choices?.[0]?.message?.content || '').trim();
    if (!text || text.toUpperCase() === 'NONE') return;
    const items = text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(l => l && l.toUpperCase() !== 'NONE');
    if (items.length > 0) addLTMItems(items, convId);
  } catch { /* silent fail — memory extraction must never break chat */ }
}

// ── Memory Panel UI ──
function _ltmLabels() {
  const lang = document.getElementById('lang-select')?.value || 'zh-TW';
  return {
    'zh-TW': { title: '長期記憶', clear: '全部清除', empty: '尚無記憶', badge: '條' },
    'en':    { title: 'Long-term Memory', clear: 'Clear All', empty: 'No memories yet', badge: '' },
    'ja':    { title: '長期記憶', clear: 'すべて削除', empty: 'まだ記憶がありません', badge: '件' },
  }[lang] || { title: '長期記憶', clear: '全部清除', empty: '尚無記憶', badge: '條' };
}

function renderMemoryPanel() {
  const panel = document.getElementById('ltm-panel');
  if (!panel) return;
  const bank = getLTMBank();
  const L    = _ltmLabels();

  if (bank.length === 0) {
    panel.innerHTML = `
      <div class="ltm-header">
        <span class="ltm-title">🧠 ${L.title}</span>
      </div>
      <div class="ltm-empty">${L.empty}</div>`;
    return;
  }

  const items = bank.map(m => `
    <div class="ltm-item" data-id="${m.id}">
      <span class="ltm-content">${_escLTM(m.content)}</span>
      <button class="ltm-delete" onclick="deleteLTMItem('${m.id}')" title="刪除">✕</button>
    </div>`).join('');

  panel.innerHTML = `
    <div class="ltm-header">
      <span class="ltm-title">🧠 ${L.title}</span>
      <span class="ltm-badge">${bank.length}${L.badge}</span>
      <button class="ltm-clear-all" onclick="_confirmClearLTM()">${L.clear}</button>
    </div>
    <div class="ltm-list">${items}</div>`;
}

function _confirmClearLTM() {
  const lang = document.getElementById('lang-select')?.value || 'zh-TW';
  const msg = lang === 'en' ? 'Clear all long-term memories?' :
              lang === 'ja' ? 'すべての長期記憶を削除しますか？' :
              '確定清除所有長期記憶？';
  if (confirm(msg)) clearAllLTM();
}

function _escLTM(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  renderMemoryPanel();
  window.addEventListener('languageChanged', () => renderMemoryPanel());
});
