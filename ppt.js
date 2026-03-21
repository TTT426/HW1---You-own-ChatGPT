// ── PPT Module ──
const _pptDataMap = {};
// 新流程：
//   1. 使用者在 input-area 選好範本（btn-pick-template 顯示在輸入框旁）
//   2. 按 🎞️ → AI 生成 slides JSON → POST /generate-pptx → 後端產生 pptx + 轉 PDF
//   3. chat 訊息內顯示 PDF iframe 預覽
//   4. 使用者滿意後按「⬇️ 下載 .pptx」取得檔案

const PPT_THEMES = {
    midnight:   { bg: '1E2761', slideBg: '162054', title: 'FFFFFF', body: 'CADCFC', accent: 'CADCFC' },
    coral:      { bg: '2F3C7E', slideBg: '232D5E', title: 'F9E795', body: 'FFFFFF', accent: 'F96167' },
    minimal:    { bg: 'F2F2F2', slideBg: 'FFFFFF', title: '36454F', body: '4A5568', accent: '2563EB' },
    forest:     { bg: '2C5F2D', slideBg: '234A24', title: 'FFFFFF', body: 'F5F5F5', accent: '97BC62' },
    terracotta: { bg: 'B85042', slideBg: '9A3F35', title: 'E7E8D1', body: 'F5F0E8', accent: 'A7BEAE' },
    ocean:      { bg: '065A82', slideBg: '054A6B', title: 'FFFFFF', body: 'D0EAF5', accent: '02C39A' },
  };
  
  const API_BASE = 'http://localhost:8000';
  
  // ── 目前選中的範本（全域，跨訊息共用） ──
  let _selectedTemplate = null;   // { name, label, preview }
  
  // ══════════════════════════════════════════════
  //  輸入區：範本選擇按鈕（注入到 input-box）
  // ══════════════════════════════════════════════
  
  function initTemplatePickerBtn() {
    const inputBox = document.querySelector('.input-box');
    if (!inputBox || document.getElementById('global-pick-template-btn')) return;
  
    const btn = document.createElement('button');
    btn.id        = 'global-pick-template-btn';
    btn.className = 'btn-pick-template';
    btn.title     = '選擇簡報範本';
    btn.textContent = '📁 範本';
    btn.onclick   = () => openTemplatePicker(btn, onGlobalTemplateConfirm);
  
    // 插在 ppt-btn 前面
    const pptBtn = document.getElementById('ppt-btn');
    inputBox.insertBefore(btn, pptBtn);
  }
  
  function onGlobalTemplateConfirm(template) {
    _selectedTemplate = template;
    const btn = document.getElementById('global-pick-template-btn');
    if (btn) {
      btn.textContent = `📁 ${template.label}`;
      btn.classList.add('selected');
    }
  }
  
  // ══════════════════════════════════════════════
  //  Template Picker Modal
  // ══════════════════════════════════════════════
  
  let _templates   = [];
  let _pickerCb    = null;   // confirm callback
  
  async function fetchTemplates() {
    if (_templates.length) return _templates;
    try {
      const resp = await fetch(`${API_BASE}/templates`);
      if (!resp.ok) throw new Error();
      const { templates } = await resp.json();
      _templates = templates;
    } catch { _templates = []; }
    return _templates;
  }
  
  function getModal() {
    let m = document.getElementById('template-modal-overlay');
    if (m) return m;
    m = document.createElement('div');
    m.id        = 'template-modal-overlay';
    m.className = 'template-modal-overlay';
    m.innerHTML = `
      <div class="template-modal">
        <div class="template-modal-header">
          <span>選擇簡報範本</span>
          <button class="template-modal-close" onclick="closeTemplatePicker()">✕</button>
        </div>
        <div class="template-grid" id="template-grid"></div>
        <div class="template-modal-footer">
          <button class="btn-template-cancel" onclick="closeTemplatePicker()">取消</button>
          <button class="btn-template-confirm" onclick="confirmTemplate()">確認</button>
        </div>
      </div>`;
    m.addEventListener('click', e => { if (e.target === m) closeTemplatePicker(); });
    document.body.appendChild(m);
    return m;
  }
  
  async function openTemplatePicker(triggerBtn, callback) {
    _pickerCb = callback || null;
    const overlay = getModal();
    overlay.classList.add('open');
  
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '<div style="color:#666;padding:20px">⏳ 載入中…</div>';
  
    const templates = await fetchTemplates();
    if (!templates.length) {
      grid.innerHTML = '<div style="color:#666;padding:20px">⚠️ 找不到任何範本，請確認 input/ 資料夾</div>';
      return;
    }
  
    const current = _selectedTemplate?.name || '';
    grid.innerHTML = templates.map(t => `
      <div class="template-card ${t.name === current ? 'active' : ''}"
           data-name="${t.name}" data-label="${t.label}"
           data-thumbnail="${t.thumbnail || ''}"
           onclick="selectTemplateCard(this)">
        ${t.thumbnail
          ? `<img class="template-card-preview"
               src="${API_BASE}${t.thumbnail}"
               loading="lazy" style="width:100%;height:140px;object-fit:cover;display:block;" />`
          : `<div class="template-card-preview-placeholder">📄</div>`}
        <div class="template-card-label">${t.label}</div>
      </div>`).join('');
  }
  
  function selectTemplateCard(card) {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  }
  
  function confirmTemplate() {
    const active = document.querySelector('.template-card.active');
    if (!active) { closeTemplatePicker(); return; }
    const tmpl = {
      name   : active.dataset.name,
      label  : active.dataset.label,
      preview: active.dataset.preview,
    };
    if (_pickerCb) _pickerCb(tmpl);
    closeTemplatePicker();
  }
  
  function closeTemplatePicker() {
    const m = document.getElementById('template-modal-overlay');
    if (m) m.classList.remove('open');
  }
  
  // ══════════════════════════════════════════════
  //  🎞️ 按鈕觸發
  // ══════════════════════════════════════════════
  
  function generatePptFromInput() {
    const prompt = input.value.trim();
    if (!prompt) { alert('請先在輸入框輸入簡報主題！'); return; }
    input.value = '';
    input.style.height = 'auto';
    startPptGeneration(prompt);
  }
  
  function checkPptCommand(text) {
    if (text.toLowerCase().startsWith('/ppt ')) {
      const topic = text.slice(5).trim();
      if (topic) { startPptGeneration(topic); return true; }
    }
    return false;
  }
  
  // ══════════════════════════════════════════════
  //  主生成流程
  // ══════════════════════════════════════════════
  
  async function startPptGeneration(topic) {
    const cfg = getConfig();
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      alert(t.noApiKey || '請先確認 API Key 已載入！');
      return;
    }
  
    // ── 顯示 user 訊息 ──
    const wrap  = document.querySelector('.msg-wrap');
    const empty = document.getElementById('empty-state');
    if (empty) empty.remove();
  
    const userDiv = document.createElement('div');
    userDiv.className = 'msg user';
    userDiv.innerHTML = `
      <div class="msg-avatar">You</div>
      <div class="msg-body">
        <div class="msg-name">${t.youLabel || 'You'}</div>
        <div class="msg-text">🎞️ ${esc(topic)}${_selectedTemplate ? ` <span style="opacity:.5;font-size:.85em">（${_selectedTemplate.label}）</span>` : ''}</div>
      </div>`;
    wrap.appendChild(userDiv);
  
    // ── AI 訊息 placeholder ──
    const aiDiv = document.createElement('div');
    aiDiv.className = 'msg ai';
    aiDiv.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-body">
        <div class="msg-name">${t.aiLabel || 'Assistant'}</div>
        <div class="msg-text ppt-msg">
          <div class="ppt-loading">⏳ 正在生成簡報內容…</div>
        </div>
      </div>`;
    wrap.appendChild(aiDiv);
    document.getElementById('messages').scrollTop = 99999;
  
    const msgText = aiDiv.querySelector('.msg-text');
  
    // ── Step 1：讓 AI 生成 slides JSON ──
    const systemPrompt = `你是一個專業的簡報設計師。根據使用者的主題生成一份結構清晰的簡報。
  你必須只回傳一個合法的 JSON 物件，不含任何 markdown 語法或說明文字，格式如下：
  {
    "theme": "選擇最適合主題的配色方案，從以下選一個: midnight | coral | minimal | forest | terracotta | ocean",
    "slides": [
      { "type": "title",   "title": "投影片標題", "subtitle": "副標題" },
      { "type": "bullets", "title": "章節標題",   "bullets": ["要點1","要點2","要點3"] },
      { "type": "content", "title": "章節標題",   "body": "內文段落" },
      { "type": "quote",   "title": "來源",        "quote": "引言文字" },
      { "type": "closing", "title": "結語標題",   "subtitle": "結語副標" }
    ]
  }
  第一張必須是 title，最後一張必須是 closing，中間 4-6 張自由搭配。`;
  
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `請為「${topic}」製作簡報。直接輸出 JSON。` },
      ];
      const req  = buildRequest({ ...cfg, maxTokens: 2048 }, messages, false);
      const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      let raw = data.choices?.[0]?.message?.content ?? '';
      raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const result   = JSON.parse(raw);
      const slides   = result.slides || [];
      const themeName = result.theme || 'midnight';
  
      // ── Step 2：送後端產生 pptx + PDF 預覽 ──
      msgText.innerHTML = '<div class="ppt-loading">⚙️ 正在套用範本並產生預覽…</div>';
  
      const genResp = await fetch(`${API_BASE}/generate-pptx-preview`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          topic,
          theme   : themeName,
          template: _selectedTemplate?.name || null,
          slides,
        }),
      });
  
      if (!genResp.ok) {
        const err = await genResp.json().catch(() => ({}));
        throw new Error(err.detail || `後端錯誤 HTTP ${genResp.status}`);
      }
  
      const { preview_url, job_id } = await genResp.json();
  
      // ── Step 3：取得縮圖清單並渲染輪播預覽 ──
      const previewResp = await fetch(`${API_BASE}${preview_url}`);
      const { slides: slideUrls } = await previewResp.json();
  
      msgText.innerHTML = renderSlideCarousel(slideUrls, job_id, topic, themeName);
  
      // 儲存完整資料供 editor 使用（存在全域 Map，避免 innerHTML 還原後遺失）
      const _uid = 'carousel-' + job_id.slice(0, 8);
      _pptDataMap[_uid] = {
        slides, topic, themeName,
        jobId   : job_id,
        template: _selectedTemplate?.name || null,
      };
  
    } catch (e) {
      msgText.innerHTML = `<span style="color:var(--danger)">⚠️ PPT 生成失敗：${e.message}</span>`;
    }
  
    document.getElementById('messages').scrollTop = 99999;
  }
  
  // ══════════════════════════════════════════════
  //  投影片輪播預覽
  // ══════════════════════════════════════════════
  
  function renderSlideCarousel(slideUrls, jobId, topic, themeName) {
    const uid = 'carousel-' + jobId.slice(0, 8);
    const imgs = slideUrls.map((url, i) =>
      `<div class="carousel-slide ${i === 0 ? 'active' : ''}" data-idx="${i}">
         <img src="${API_BASE}${url}" loading="lazy"
              onclick="openSlideEditor('${uid}', ${i})"
              title="點擊編輯此頁內容" />
         <div class="slide-edit-hint">✏️ 點擊編輯</div>
       </div>`
    ).join('');
  
    return `
      <div class="ppt-result-wrap" id="wrap-${uid}">
        <div class="ppt-result-header">
          <span>🎞️ ${esc(topic)}</span>
          <span class="ppt-theme-badge">${esc(themeName)}</span>
        </div>
        <div class="slide-carousel" id="${uid}">
          <button class="carousel-btn prev" onclick="carouselMove('${uid}',-1)">&#8592;</button>
          <div class="carousel-viewport">${imgs}</div>
          <button class="carousel-btn next" onclick="carouselMove('${uid}',1)">&#8594;</button>
        </div>
        <div class="carousel-counter" id="${uid}-counter">1 / ${slideUrls.length}</div>
        <div class="ppt-result-footer">
          <span class="ppt-edit-hint">✏️ 點擊投影片可編輯內容</span>
          <button class="btn-ppt-dl" onclick="downloadPptx(this,'${esc(jobId)}','${esc(topic)}')">⬇️ 下載 .pptx</button>
        </div>
      </div>`;
  }
  
  function carouselMove(uid, dir) {
    const carousel = document.getElementById(uid);
    if (!carousel) return;
    const slides = carousel.querySelectorAll('.carousel-slide');
    let cur = [...slides].findIndex(s => s.classList.contains('active'));
    slides[cur].classList.remove('active');
    cur = (cur + dir + slides.length) % slides.length;
    slides[cur].classList.add('active');
    const counter = document.getElementById(uid + '-counter');
    if (counter) counter.textContent = `${cur + 1} / ${slides.length}`;
  }
  
  // ── Slide Editor ──
  function openSlideEditor(uid, slideIdx) {
    // 找到這個 carousel 對應的 msgText，從裡面取 _pptData
    const wrap    = document.getElementById('wrap-' + uid);
    if (!wrap) return;
    const pptData = _pptDataMap[uid];
    if (!pptData) { console.warn('_pptData not found for uid:', uid); return; }
  
    const { slides, jobId, topic, themeName, template } = pptData;
    const sd = slides[slideIdx];
  
    // 建立 editor overlay
    let overlay = document.getElementById('slide-editor-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'slide-editor-overlay';
      overlay.className = 'slide-editor-overlay';
      overlay.addEventListener('click', e => {
        if (e.target === overlay) closeSlideEditor();
      });
      document.body.appendChild(overlay);
    }
  
    overlay.innerHTML = `
      <div class="slide-editor-modal">
        <div class="slide-editor-header">
          <span>✏️ 編輯第 ${slideIdx + 1} 頁（${sd.type}）</span>
          <button onclick="closeSlideEditor()">✕</button>
        </div>
        <div class="slide-editor-body" id="slide-editor-body">
          ${buildEditorFields(sd, slideIdx)}
        </div>
        <div class="slide-editor-footer">
          <button class="btn-template-cancel" onclick="closeSlideEditor()">取消</button>
          <button class="btn-template-confirm" onclick="applySlideEdit('${uid}', ${slideIdx})">
            ✅ 套用並重新產生
          </button>
        </div>
      </div>`;
  
    overlay.classList.add('open');
  }
  
  function buildEditorFields(sd, idx) {
    let html = `<input type="hidden" id="edit-type" value="${sd.type}" />`;
  
    // Title
    html += `<label>標題</label>
      <input class="edit-field" id="edit-title" type="text" value="${esc(sd.title || '')}" />`;
  
    if (sd.type === 'title' || sd.type === 'closing') {
      html += `<label>副標題</label>
        <textarea class="edit-field" id="edit-subtitle" rows="2">${esc(sd.subtitle || '')}</textarea>`;
    } else if (sd.type === 'bullets') {
      html += `<label>條列要點（每行一條）</label>
        <textarea class="edit-field" id="edit-bullets" rows="6">${(sd.bullets || []).join('\n')}</textarea>`;
    } else if (sd.type === 'content') {
      html += `<label>內文</label>
        <textarea class="edit-field" id="edit-body" rows="6">${esc(sd.body || '')}</textarea>`;
    } else if (sd.type === 'quote') {
      html += `<label>引言</label>
        <textarea class="edit-field" id="edit-quote" rows="3">${esc(sd.quote || '')}</textarea>`;
    }
    return html;
  }
  
  function closeSlideEditor() {
    const o = document.getElementById('slide-editor-overlay');
    if (o) o.classList.remove('open');
  }
  
  async function applySlideEdit(uid, slideIdx) {
    const wrap    = document.getElementById('wrap-' + uid);
    if (!wrap) return;
    const data = _pptDataMap[uid];
    if (!data) return;
    const sd   = data.slides[slideIdx];
  
    // 讀取欄位更新 slides
    sd.title    = document.getElementById('edit-title')?.value    || sd.title;
    sd.subtitle = document.getElementById('edit-subtitle')?.value || sd.subtitle;
    sd.body     = document.getElementById('edit-body')?.value     || sd.body;
    sd.quote    = document.getElementById('edit-quote')?.value    || sd.quote;
    const bulletsEl = document.getElementById('edit-bullets');
    if (bulletsEl) sd.bullets = bulletsEl.value.split('\n').filter(l => l.trim());
  
    closeSlideEditor();
  
    // 顯示 loading
    const carousel = document.getElementById(uid);
    const activeSlide = carousel?.querySelector('.carousel-slide.active');
    if (activeSlide) activeSlide.querySelector('img').style.opacity = '0.3';
  
    try {
      // 重新送後端產生
      const genResp = await fetch(`${API_BASE}/generate-pptx-preview`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          topic   : data.topic,
          theme   : data.themeName,
          template: data.template,
          slides  : data.slides,
        }),
      });
      if (!genResp.ok) throw new Error(`HTTP ${genResp.status}`);
      const { preview_url, job_id } = await genResp.json();
  
      // 更新 job_id
      data.jobId = job_id;
  
      // 取新縮圖
      const previewResp = await fetch(`${API_BASE}${preview_url}`);
      const { slides: newUrls } = await previewResp.json();
  
         // 重建整個輪播 viewport，強制瀏覽器重新載入所有圖片
      const ts = Date.now();
      const viewport = carousel.querySelector('.carousel-viewport');
      viewport.innerHTML = newUrls.map((url, i) => `
        <div class="carousel-slide ${i === slideIdx ? 'active' : ''}" data-idx="${i}">
          <img src="${API_BASE}${url}?t=${ts + i}" loading="lazy"
               onclick="openSlideEditor('${uid}', ${i})"
               title="點擊編輯此頁內容" />
          <div class="slide-edit-hint">✏️ 點擊編輯</div>
        </div>`).join('');

      // 更新下載按鈕的 jobId
      const dlBtn = wrap.querySelector('.btn-ppt-dl');
      if (dlBtn) dlBtn.onclick = () => downloadPptx(dlBtn, job_id, data.topic);

      // 更新頁數計數器
      const counter = document.getElementById(uid + '-counter');
      if (counter) counter.textContent = `${slideIdx + 1} / ${newUrls.length}`;
  
    } catch(e) {
      alert('重新產生失敗：' + e.message);
      if (activeSlide) activeSlide.querySelector('img').style.opacity = '1';
    }
  }
  
  // ══════════════════════════════════════════════
  //  下載 .pptx（用 job_id 跟後端拿）
  // ══════════════════════════════════════════════
  
  async function downloadPptx(btn, jobId, topic) {
    btn.disabled    = true;
    btn.textContent = '⏳ 下載中…';
    try {
      const resp = await fetch(`${API_BASE}/download/${jobId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${topic}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`下載失敗：${e.message}`);
    } finally {
      btn.disabled    = false;
      btn.textContent = '⬇️ 下載 .pptx';
    }
  }
  
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  // ── 初始化：DOM ready 後注入範本按鈕 ──
  document.addEventListener('DOMContentLoaded', initTemplatePickerBtn);