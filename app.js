// ── Provider config ──
const PROVIDERS = {
  groq: {
    label:       'Groq',
    keyPrefix:   'gsk_',
    placeholder: 'gsk_...',
    endpoint:    'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { value: 'moonshotai/kimi-k2-instruct',       label: 'Kimi K2' },
      { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
      { value: 'llama-3.3-70b-versatile',            label: 'Llama 3.3 70B' },
      { value: 'llama-3.1-8b-instant',               label: 'Llama 3.1 8B' },
      { value: 'gemma2-9b-it',                       label: 'Gemma 2 9B' },
    ],
  },
  nvidia: {
    label:       'NVIDIA NIM',
    keyPrefix:   'nvapi-',
    placeholder: 'nvapi-...',
    endpoint:    'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      { value: 'moonshotai/kimi-k2',                          label: 'Kimi K2' },
      { value: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',     label: 'Nemotron Ultra 253B' },
      { value: 'meta/llama-4-maverick-17b-128e-instruct',     label: 'Llama 4 Maverick 17B' },
      { value: 'meta/llama-3.3-70b-instruct',                 label: 'Llama 3.3 70B' },
      { value: 'mistralai/mistral-large-2-instruct',          label: 'Mistral Large 2' },
    ],
  },
  ollama: {
    label:       'Ollama',
    keyPrefix:   null,   // no key needed
    placeholder: '',
    endpoint:    null,   // built dynamically from base URL
    models: [
      // populated dynamically; fallback list shown before fetch
      { value: 'llama3.2',      label: 'llama3.2' },
      { value: 'llama3.1',      label: 'llama3.1' },
      { value: 'gemma3',        label: 'gemma3' },
      { value: 'qwen2.5',       label: 'qwen2.5' },
      { value: 'mistral',       label: 'mistral' },
    ],
  },
};

// ── Sidebar toggle ──
const sidebar  = document.getElementById('sidebar');
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

// ── Provider change handler ──
function onProviderChange() {
  const provider = document.getElementById('provider-select').value;
  const cfg      = PROVIDERS[provider];
  const isOllama = provider === 'ollama';

  // Show/hide API key vs Ollama URL
  document.getElementById('api-key-section').style.display  = isOllama ? 'none' : '';
  document.getElementById('ollama-url-section').style.display = isOllama ? '' : 'none';

  // Update placeholder
  document.getElementById('api-key').placeholder = cfg.placeholder;

  // Populate model list
  populateModels(cfg.models);

  // If Ollama, try to fetch live model list
  if (isOllama) fetchOllamaModels();
}

function populateModels(models) {
  const sel = document.getElementById('model-select');
  sel.innerHTML = models.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
  updateBadge();
}

function onModelChange() { updateBadge(); }

function updateBadge() {
  const sel = document.getElementById('model-select');
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('model-badge').textContent =
    opt ? opt.text : sel.value;
}

// ── Fetch Ollama local models ──
async function fetchOllamaModels() {
  const base = document.getElementById('ollama-url').value.replace(/\/$/, '');
  try {
    const res  = await fetch(`${base}/api/tags`);
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      const models = data.models.map(m => ({ value: m.name, label: m.name }));
      populateModels(models);
    }
  } catch {
    // Keep fallback list if Ollama is unreachable
  }
}

// Re-fetch when Ollama URL changes
document.getElementById('ollama-url').addEventListener('change', () => {
  if (document.getElementById('provider-select').value === 'ollama') {
    fetchOllamaModels();
  }
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
  const base     = document.getElementById('ollama-url').value.replace(/\/$/, '');
  return {
    provider,
    apiKey:       document.getElementById('api-key').value.trim(),
    ollamaBase:   base,
    model:        document.getElementById('model-select').value,
    systemPrompt: document.getElementById('system-prompt').value.trim(),
    temperature:  parseFloat(document.getElementById('temperature').value) || 0.7,
    maxTokens:    parseInt(document.getElementById('max-tokens').value)    || 1024,
    topP:         parseFloat(document.getElementById('top-p').value)       || 1,
    memoryTurns:  parseInt(document.getElementById('memory-turns').value)  || 10,
    streaming:    document.getElementById('streaming-toggle').checked,
  };
}

// ── Build fetch options per provider ──
function buildRequest(cfg) {
  const messages = [
    { role: 'system', content: cfg.systemPrompt },
    ...history,
  ];

  const body = JSON.stringify({
    model:       cfg.model,
    max_tokens:  cfg.maxTokens,
    temperature: cfg.temperature,
    top_p:       cfg.topP,
    stream:      cfg.streaming,
    messages,
  });

  if (cfg.provider === 'ollama') {
    return {
      url: `${cfg.ollamaBase}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  }

  // Groq & NVIDIA both use OpenAI-compatible Bearer auth
  return {
    url: PROVIDERS[cfg.provider].endpoint,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body,
  };
}

// ── Parse OpenAI-compatible SSE delta ──
function parseDelta(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try {
    const obj = JSON.parse(data);
    return obj.choices?.[0]?.delta?.content ?? null;
  } catch { return null; }
}

// ── UI helpers ──
function addMessage(role, text) {
  const wrap  = document.querySelector('.msg-wrap');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const div    = document.createElement('div');
  div.className = `msg ${role}`;
  const avatar = role === 'user' ? 'You' : 'AI';
  const name   = role === 'user' ? 'You' : 'Assistant';

  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">
      <div class="msg-name">${name}</div>
      <div class="msg-text"></div>
    </div>`;

  wrap.appendChild(div);
  const textEl = div.querySelector('.msg-text');
  if (text) textEl.textContent = text;

  document.getElementById('messages').scrollTop = 99999;
  return textEl;
}

// ── Send ──
async function sendMessage() {
  if (isStreaming) return;
  const cfg = getConfig();

  if (cfg.provider !== 'ollama' && !cfg.apiKey) {
    alert('請先在左側填入 API Key！');
    return;
  }

  const text = input.value.trim();
  if (!text) return;

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

  try {
    const req  = buildRequest(cfg);
    const resp = await fetch(req.url, {
      method:  'POST',
      headers: req.headers,
      body:    req.body,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status} ${resp.statusText}`);
    }

    if (cfg.streaming) {
      // ── Streaming mode ──
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
      // ── Non-streaming mode ──
      const data = await resp.json();
      fullReply = data.choices?.[0]?.message?.content ?? '';
      aiTextEl.textContent = fullReply;
    }

  } catch (e) {
    aiTextEl.textContent = `⚠️ 錯誤：${e.message}`;
  } finally {
    cursor.remove();
    if (fullReply) history.push({ role: 'assistant', content: fullReply });
    document.getElementById('send-btn').disabled = false;
    isStreaming = false;
    document.getElementById('messages').scrollTop = 99999;
  }
}

// ── Init ──
onProviderChange();
