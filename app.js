// ── Provider config (loaded from config/providers.json) ──
let PROVIDERS = {};

// ── Sidebar toggle ──
const sidebar   = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggle-sidebar');

function toggleSidebar() {
  const collapsed = sidebar.classList.toggle('collapsed');
  toggleBtn.textContent = collapsed ? '▶' : '◀';
  toggleBtn.title = collapsed ? '展開設定' : '收合設定';
}

// ── Sidebar drag resize ──
const handle = document.getElementById('resize-handle');
let isResizing = false, startX = 0, startWidth = 0;

handle.addEventListener('mousedown', (e) => {
  if (sidebar.classList.contains('collapsed')) return;
  isResizing = true;
  startX = e.clientX;
  startWidth = sidebar.offsetWidth;
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newW = Math.min(520, Math.max(220, startWidth + (e.clientX - startX)));
  sidebar.style.width = newW + 'px';
  sidebar.style.minWidth = newW + 'px';
});
document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false;
  handle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

let history = [];
let isStreaming = false;

// ── Auto-resize textarea ──
const input = document.getElementById('user-input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
});

// ── Enter to send ──
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Provider change ──
function onProviderChange() {
  const provider = document.getElementById('provider-select').value;
  const cfg      = PROVIDERS[provider];
  if (!cfg) return;
  const isOllama = provider === 'ollama';

  document.getElementById('ollama-url-section').style.display = isOllama ? '' : 'none';
  document.getElementById('api-key').placeholder = cfg.keyPrefix ? `${cfg.keyPrefix}...` : '';

  populateModels(cfg.models || []);
  if (isOllama) fetchOllamaModels();
}

function populateModels(models) {
  const sel = document.getElementById('model-select');
  sel.innerHTML = models.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  updateBadge();
}

function onModelChange() { updateBadge(); }

function updateBadge() {
  const sel = document.getElementById('model-select');
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('model-badge').textContent = opt ? opt.text : sel.value;
}

// ── Fetch Ollama local models ──
async function fetchOllamaModels() {
  const base = document.getElementById('ollama-url').value.replace(/\/$/, '');
  try {
    const res  = await fetch(`${base}/api/tags`);
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      populateModels(data.models.map(m => ({ value: m.name, label: m.name })));
    }
  } catch {}
}

document.getElementById('ollama-url').addEventListener('change', () => {
  if (document.getElementById('provider-select').value === 'ollama') fetchOllamaModels();
});

function toggleKey() {
  const k = document.getElementById('api-key');
  k.type = k.type === 'password' ? 'text' : 'password';
}

function clearHistory() {
  history = [];
  document.querySelector('.msg-wrap').innerHTML =
    `<div id="empty-state"><div class="icon">💬</div><p>對話已清除，重新開始吧！</p></div>`;
}

function getConfig() {
  const provider = document.getElementById('provider-select').value;
  return {
    provider,
    apiKey:       apiKeys[provider] || '',
    ollamaBase:   document.getElementById('ollama-url').value.replace(/\/$/, ''),
    model:        document.getElementById('model-select').value,
    systemPrompt: document.getElementById('system-prompt').value.trim(),
    temperature:  parseFloat(document.getElementById('temperature').value) || 0.7,
    maxTokens:    parseInt(document.getElementById('max-tokens').value)    || 1024,
    topP:         parseFloat(document.getElementById('top-p').value)       || 1,
    memoryTurns:  parseInt(document.getElementById('memory-turns').value)  || 10,
    streaming:    document.getElementById('streaming-toggle').checked,
  };
}

// ── Build request ──
function buildRequest(cfg, messages, stream) {
  const body = JSON.stringify({
    model:       cfg.model,
    max_tokens:  cfg.maxTokens,
    temperature: cfg.temperature,
    top_p:       cfg.topP,
    stream:      stream,
    messages,
  });

  if (cfg.provider === 'ollama') {
    return {
      url:     `${cfg.ollamaBase}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  }
  return {
    url:     PROVIDERS[cfg.provider].endpoint,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body,
  };
}

// ── Parse SSE delta ──
function parseDelta(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try {
    const obj = JSON.parse(data);
    return obj.choices?.[0]?.delta?.content ?? null;
  } catch { return null; }
}

// ── Non-streaming fetch helper ──
async function fetchOnce(req) {
  const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Add message to UI ──
function addMessage(role, text) {
  const wrap  = document.querySelector('.msg-wrap');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? (t.youLabel||'You') : 'AI'}</div>
    <div class="msg-body">
      <div class="msg-name">${role === 'user' ? (t.youLabel||'You') : (t.aiLabel||'Assistant')}</div>
      <div class="msg-text"></div>
    </div>`;
  wrap.appendChild(div);

  const textEl = div.querySelector('.msg-text');
  if (text) textEl.textContent = text;
  document.getElementById('messages').scrollTop = 99999;
  return textEl;
}

// ── Summarize conversation ──
async function summarizeHistory() {
  if (history.length === 0) {
    alert(t.noHistory || '目前沒有對話可以摘要！');
    return;
  }
  if (isStreaming) return;

  const btn = document.getElementById('summarize-btn');
  btn.disabled = true;
  btn.textContent = t.summarizing || '⏳ 摘要中…';

  const cfg = getConfig();

  if (cfg.provider !== 'ollama' && !cfg.apiKey) {
    alert(t.noApiKey || '請先確認 API Key 已載入！');
    btn.disabled = false;
    btn.textContent = t.summarizeBtn || '📝 摘要對話 → System Prompt';
    return;
  }

  try {
    const conversationText = history
      .map(m => `${m.role === 'user' ? '使用者' : 'AI'}：${m.content}`)
      .join('\n');

    const summaryMessages = [
      {
        role: 'system',
        content: '你是一個摘要助手，請將以下對話內容整理成簡潔的繁體中文摘要，保留重要資訊、結論與上下文，以便後續對話參考。直接輸出摘要內容，不要加任何前綴說明。',
      },
      {
        role: 'user',
        content: `請摘要以下對話：\n\n${conversationText}`,
      },
    ];

    const req     = buildRequest({ ...cfg, maxTokens: 512 }, summaryMessages, false);
    const summary = await fetchOnce(req);

    // Put summary into system prompt
    const systemPromptEl = document.getElementById('system-prompt');
    const originalPrompt = systemPromptEl.value.trim();
    systemPromptEl.value = `${originalPrompt}\n\n【對話摘要】\n${summary}`.trim();

    // Clear history and show notice in chat
    history = [];
    const noticeEl = addMessage('ai', '');
    noticeEl.innerHTML = `<em style="color:var(--muted)">${t.summarizeDone || "✅ 對話已摘要並更新至 System Prompt，記憶已重置。"}</em>`;

  } catch (e) {
    alert(`${t.summarizeFail || '摘要失敗：'}${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '📝 摘要對話 → System Prompt';
  }
}

// ── Send message ──
async function sendMessage() {
  if (isStreaming) return;
  const cfg = getConfig();

  if (cfg.provider !== 'ollama' && !cfg.apiKey) {
    alert(t.noApiKey || '請先在左側填入 API Key！');
    return;
  }

  const text = input.value.trim();
  if (!text) return;

  // /ppt command
  if (checkPptCommand(text)) {
    input.value = '';
    input.style.height = 'auto';
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('send-btn').disabled = true;
  isStreaming = true;

  addMessage('user', text);
  history.push({ role: 'user', content: text });

  // Trim memory
  const maxMsgs = cfg.memoryTurns * 2;
  if (history.length > maxMsgs) history = history.slice(history.length - maxMsgs);

  const aiTextEl = addMessage('ai', '');
  const cursor   = document.createElement('span');
  cursor.className = 'cursor';
  aiTextEl.appendChild(cursor);

  let fullReply = '';

  const messages = [{ role: 'system', content: cfg.systemPrompt }, ...history];

  try {
    const req  = buildRequest(cfg, messages, cfg.streaming);
    const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status} ${resp.statusText}`);
    }

    if (cfg.streaming) {
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const delta = parseDelta(line);
          if (delta) {
            fullReply += delta;
            aiTextEl.textContent = fullReply;
            aiTextEl.appendChild(cursor);
            document.getElementById('messages').scrollTop = 99999;
          }
        }
      }
    } else {
      const data = await resp.json();
      fullReply = data.choices?.[0]?.message?.content ?? '';
      aiTextEl.textContent = fullReply;
    }

  } catch (e) {
    aiTextEl.textContent = `${t.errPrefix || '⚠️ 錯誤：'}${e.message}`;
  } finally {
    cursor.remove();
    if (fullReply) history.push({ role: 'assistant', content: fullReply });
    document.getElementById('send-btn').disabled = false;
    isStreaming = false;
    document.getElementById('messages').scrollTop = 99999;
  }
}

// ── Apply fonts for a language (with console diagnostics) ──
function applyFontsForLang(lang) {
  const keyUI   = `FONT_UI_${lang}`;
  const keyMono = `FONT_MONO_${lang}`;

  const fontUI   = uiCfg[keyUI]   || uiCfg['FONT_UI']   || 'IBM Plex Sans';
  const fontMono = uiCfg[keyMono] || uiCfg['FONT_MONO'] || 'IBM Plex Mono';
  const fontSize = uiCfg['FONT_SIZE'] || '14';

  const uiSource   = uiCfg[keyUI]   ? `✅ ${keyUI}`   : `⚠️ fallback → FONT_UI`;
  const monoSource = uiCfg[keyMono] ? `✅ ${keyMono}` : `⚠️ fallback → FONT_MONO`;

  console.group(`🔤 Font applied for [${lang}]`);
  console.log(`UI Font   : "${fontUI}"  (${uiSource})`);
  console.log(`Mono Font : "${fontMono}"  (${monoSource})`);
  console.log(`Font Size : ${fontSize}px`);
  console.groupEnd();

  document.documentElement.style.setProperty('--sans', `'${fontUI}', sans-serif`);
  document.documentElement.style.setProperty('--mono', `'${fontMono}', monospace`);
  document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);

  // Dynamically load Google Font if not already loaded
  const fontsToLoad = [fontUI, fontMono].filter(f =>
    !document.querySelector(`link[href*="${encodeURIComponent(f)}"]`)
  );
  fontsToLoad.forEach(font => {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600&display=swap`;
    document.head.appendChild(link);
    console.log(`📦 Loading Google Font: "${font}"`);
  });
}

// ── Switch language ──
async function switchLanguage(lang) {
  try {
    const res  = await fetch('./config/i18n.json');
    const data = await res.json();
    t = data[lang] || data['zh-TW'];

    // Update html lang attribute
    document.documentElement.lang = lang;

    // Re-apply all translations
    applyTranslations();

    // Update lang selector to match
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = lang;

    // Apply fonts for the new language
    applyFontsForLang(lang);

    console.log(`✅ Switched to ${lang}`);
    // 通知其他模組語言已切換
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
  } catch (e) {
    console.warn('⚠️ Failed to switch language:', e.message);
  }
}

// ── API Keys ──
let apiKeys = { groq: '', hf: '' };

async function loadApiKeys() {
  try {
    const res  = await fetch('./config/api_key.config');
    const text = await res.text();
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      if (key.trim() === 'GROQ_API_KEY') apiKeys.groq = value;
      if (key.trim() === 'HF_API_KEY')   apiKeys.hf   = value;
    });
    console.log('✅ API keys loaded');
  } catch (e) {
    console.warn('⚠️ 無法讀取 config/api_key.config：', e.message);
  }
}

async function loadProviders() {
  try {
    const res  = await fetch('./config/providers.json');
    const data = await res.json();
    PROVIDERS = data.providers;

    // Rebuild provider dropdown from JSON
    const sel = document.getElementById('provider-select');
    sel.innerHTML = Object.entries(PROVIDERS)
      .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
      .join('');

    console.log('✅ Providers loaded from config/providers.json');
  } catch (e) {
    console.warn('⚠️ 無法讀取 config/providers.json：', e.message);
  }
}


// ── i18n & UI Config ──
let t = {};      // current translations
let uiCfg = {};  // current UI config

async function loadUI() {
  // 1. Load ui.config
  try {
    const res  = await fetch('./config/ui.config');
    const text = await res.text();
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...rest] = line.split('=');
      uiCfg[key.trim()] = rest.join('=').trim();
    });
  } catch (e) {
    console.warn('⚠️ 無法讀取 ui.config，使用預設值');
    uiCfg = { LANGUAGE: 'zh-TW', FONT_UI: 'IBM Plex Sans', FONT_MONO: 'IBM Plex Mono', FONT_SIZE: '14' };
  }

  // 2. Load i18n.json
  try {
    const res  = await fetch('./config/i18n.json');
    const data = await res.json();
    const lang = uiCfg.LANGUAGE || 'zh-TW';
    t = data[lang] || data['zh-TW'];
    console.log(`✅ Language: ${lang}`);
  } catch (e) {
    console.warn('⚠️ 無法讀取 i18n.json');
    t = {};
  }

  // 3. Apply fonts for default language
  applyFontsForLang(uiCfg.LANGUAGE || 'zh-TW');

  // 4. Sync lang selector with loaded language
  const langSel = document.getElementById('lang-select');
  if (langSel) langSel.value = uiCfg.LANGUAGE || 'zh-TW';

  // 5. Apply translations to static UI elements
  applyTranslations();
}

function applyTranslations() {
  if (!t || Object.keys(t).length === 0) return;

  // Header
  document.querySelector('#chat-header h1').textContent        = t.appTitle       || 'HW1 - Your own ChatGPT';
  document.querySelector('.sidebar-header-text').textContent   = t.settings       || 'Settings';

  // Sidebar labels (using data-i18n attributes)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });

  // Placeholders
  const userInput = document.getElementById('user-input');
  if (userInput) userInput.placeholder = t.inputPh || '';

  const sysPr = document.getElementById('system-prompt');
  if (sysPr) {
    sysPr.placeholder = t.systemPromptPh || '';
    // Only set default if still at original value
    if (sysPr.value.includes('有幫助') || sysPr.value.includes('helpful') || sysPr.value.includes('役立つ') || sysPr.value.includes('有帮助')) {
      sysPr.value = t.systemPromptDef || sysPr.value;
    }
  }

  // Hint text
  const hint = document.querySelector('.hint');
  if (hint) hint.textContent = t.hintText || '';

  // Buttons
  const summarizeBtn = document.getElementById('summarize-btn');
  if (summarizeBtn && !summarizeBtn.disabled) summarizeBtn.textContent = t.summarizeBtn || '';

  const clearBtn = document.querySelector('.btn-clear');
  if (clearBtn) clearBtn.textContent = t.clearBtn || '';

  // Empty state
  const emptyP = document.querySelector('#empty-state p');
  if (emptyP) emptyP.textContent = t.emptyState || '';

  // Image & send buttons
  const imageBtn = document.getElementById('image-btn');
  if (imageBtn) imageBtn.textContent = t.imgBtn || '🎨';

  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.textContent = t.sendBtn || '➤';

  // Streaming toggle label
  const streamLabel = document.querySelector('.toggle-label');
  if (streamLabel) streamLabel.textContent = t.streaming || '';
}

// ── Init ──
Promise.all([loadApiKeys(), loadProviders(), loadUI()]).then(() => onProviderChange());

// ── Image Generation (Hugging Face FLUX.1-schnell) ──
function generateImageFromInput() {
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = '';
  input.style.height = 'auto';
  showGeneratedImage(prompt);
}

async function showGeneratedImage(prompt) {
  const wrap  = document.querySelector('.msg-wrap');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  // User message
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.innerHTML = `
    <div class="msg-avatar">You</div>
    <div class="msg-body">
      <div class="msg-name">You</div>
      <div class="msg-text">🎨 ${prompt}</div>
    </div>`;
  wrap.appendChild(userDiv);

  // AI image message placeholder
  const aiDiv = document.createElement('div');
  aiDiv.className = 'msg ai';
  aiDiv.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-body">
      <div class="msg-name">Assistant</div>
      <div class="msg-text img-msg">
        <div class="img-loading">${t.imgLoading || "⏳ 生圖中，請稍候（約 10–30 秒）…"}</div>
      </div>
    </div>`;
  wrap.appendChild(aiDiv);
  document.getElementById('messages').scrollTop = 99999;

  const msgText = aiDiv.querySelector('.msg-text');

  if (!apiKeys.hf) {
    msgText.innerHTML = `<span style="color:var(--danger)">${t.imgNoKey || "⚠️ 請在 config/api_key.config 加入 HF_API_KEY=hf_..."}</span>`;
    return;
  }

  try {
    const resp = await fetch(
      'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKeys.hf}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ inputs: prompt }),
      }
    );

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    // Response is raw image binary
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);

    msgText.innerHTML = `
      <img src="${url}" alt="${prompt}" class="generated-img" />
      <div class="img-caption">${prompt}</div>`;
    document.getElementById('messages').scrollTop = 99999;

  } catch (e) {
    msgText.innerHTML = `<span style="color:var(--danger)">${t.imgFail || "⚠️ 生圖失敗："}${e.message}</span>`;
  }
}