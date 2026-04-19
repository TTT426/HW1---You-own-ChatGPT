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

];

// ── Tool Executors ────────────────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {

    case 'get_datetime': {
      const now = new Date();
      return {
        datetime: now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        weekday:  now.toLocaleDateString('zh-TW', { weekday: 'long', timeZone: 'Asia/Taipei' }),
        iso:      now.toISOString(),
      };
    }

    case 'calculate': {
      try {
        const expr = String(args.expression || '')
          .replace(/\^/g,        '**')
          .replace(/\bsqrt\b/g,  'Math.sqrt')
          .replace(/\babs\b/g,   'Math.abs')
          .replace(/\bceil\b/g,  'Math.ceil')
          .replace(/\bfloor\b/g, 'Math.floor')
          .replace(/\bround\b/g, 'Math.round')
          .replace(/\blog\b/g,   'Math.log')
          .replace(/\blog2\b/g,  'Math.log2')
          .replace(/\bsin\b/g,   'Math.sin')
          .replace(/\bcos\b/g,   'Math.cos')
          .replace(/\btan\b/g,   'Math.tan')
          .replace(/\bpi\b/gi,   'Math.PI')
          .replace(/\be\b/g,     'Math.E');
        // Safety: reject anything that still has non-math identifiers after substitution
        if (/[a-df-wyzA-DF-WYZ_$]/.test(expr.replace(/Math\.[a-zA-Z]+/g, ''))) {
          throw new Error('不允許的字元');
        }
        const result = Function('"use strict"; return (' + expr + ')')();
        return { expression: args.expression, result: String(result) };
      } catch (e) {
        return { error: '計算錯誤：' + e.message };
      }
    }

    case 'search_web': {
      try {
        const q    = encodeURIComponent(args.query || '');
        const max  = Math.min(args.max_results || 4, 8);
        const lang = args.lang === 'en' ? 'en' : 'zh';
        const resp = await fetch(`http://localhost:8000/search?q=${q}&max_results=${max}&lang=${lang}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      } catch (e) {
        return { error: '搜尋失敗：' + e.message };
      }
    }

    default:
      return { error: `未知工具：${name}` };
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
