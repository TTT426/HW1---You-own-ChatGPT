// ── Tool Module ──
// 新增工具步驟：
//   1. 在 TOOL_DEFINITIONS 加一筆物件（OpenAI function-call 格式）
//   2. 在 executeTool() 的 switch 加對應 case
//   That's it — sendMessage() 會自動把工具帶入 API 請求並處理回呼

const TOOL_DEFINITIONS = [

  // ── 1. 日期時間 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: '取得目前的日期、時間與星期（台北時區）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── 2. 數學計算 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '計算數學運算式，支援 + - * / ^ sqrt abs sin cos tan log pi e 等',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '要計算的算式，例如 "2^10" 或 "sqrt(144) + pi"',
          },
        },
        required: ['expression'],
      },
    },
  },

  // ── 3. 網路搜尋 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: '透過 Wikipedia 搜尋主題資訊，回傳標題、摘要與連結。中文主題用 lang="zh"，英文主題用 lang="en"',
      parameters: {
        type: 'object',
        properties: {
          query:       { type: 'string', description: '搜尋關鍵字' },
          lang:        { type: 'string', description: '語言版本："zh" 中文維基（預設）或 "en" 英文維基', enum: ['zh', 'en'] },
          max_results: { type: 'number', description: '回傳筆數，預設 4，最多 8' },
        },
        required: ['query'],
      },
    },
  },

  // ── 4. 圖片生成 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '依照使用者的描述生成一張圖片（FLUX.1-schnell）。使用者說要「生成圖片」、「畫一張」、「generate an image」等時呼叫。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '詳細的圖片描述，英文效果較佳，例如 "a cute cat sitting on a wooden desk, photorealistic"',
          },
        },
        required: ['prompt'],
      },
    },
  },

];

// ── MCP Tool Executor ─────────────────────────────────────────────────────────
// All tools are executed server-side via the MCP-compatible endpoint.
// The browser acts as a thin MCP client: it sends { name, arguments } and
// receives { content: [{ type, text }] } per the MCP protocol spec.
const MCP_BASE = 'http://localhost:8000';

async function executeTool(name, args) {
  try {
    const resp = await fetch(`${MCP_BASE}/mcp/tools/call`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, arguments: args }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.detail || `MCP server error HTTP ${resp.status}` };
    }
    const data = await resp.json();
    // MCP response: { content: [{ type: "text", text: "..." }] }
    const text = data.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { result: text }; }
  } catch (e) {
    return { error: `MCP 呼叫失敗：${e.message}` };
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

// 回傳目前使用者勾選的工具定義（傳給 API 的 tools 欄位）
function getToolDefinitions() {
  if (!document.getElementById('tools-toggle')?.checked) return [];
  return TOOL_DEFINITIONS;
}

// ── UI Renderer ───────────────────────────────────────────────────────────────

// 在 AI 訊息泡泡內渲染一個工具呼叫區塊
function renderToolBlock(container, name, argsObj, resultObj) {
  const hasError = !!resultObj?.error;
  const block = document.createElement('div');
  block.className = 'tool-call-block' + (hasError ? ' tool-call-error' : '');

  // Special rendering for image generation results
  if (name === 'generate_image' && resultObj?.image_url && !hasError) {
    block.innerHTML = `
      <div class="tool-call-header">
        <span>🎨</span>
        <span class="tool-call-name">generate_image</span>
      </div>
      <img src="${MCP_BASE}${_escHTML(resultObj.image_url)}"
           class="generated-img"
           alt="${_escHTML(argsObj.prompt || '')}" />
      <div class="img-caption">${_escHTML(argsObj.prompt || '')}</div>`;
    container.appendChild(block);
    return;
  }

  block.innerHTML = `
    <div class="tool-call-header">
      <span>${hasError ? '⚠️' : '🔧'}</span>
      <span class="tool-call-name">${_escHTML(name)}</span>
    </div>
    <details class="tool-call-details">
      <summary>引數 / 結果</summary>
      <div class="tool-call-section-label">引數</div>
      <pre class="tool-call-pre">${_escHTML(JSON.stringify(argsObj, null, 2))}</pre>
      <div class="tool-call-section-label">結果</div>
      <pre class="tool-call-pre">${_escHTML(JSON.stringify(resultObj, null, 2))}</pre>
    </details>`;

  container.appendChild(block);
}
