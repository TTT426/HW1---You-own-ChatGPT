// ── PPT Module ──
// Depends on: app.js globals (apiKeys, PROVIDERS, getConfig, buildRequest, t)
// Requires:   PptxGenJS loaded via CDN

const PPT_THEMES = {
    midnight: { bg: '1E2761', slideBg: '162054', title: 'FFFFFF', body: 'CADCFC', accent: 'CADCFC' },
    coral:    { bg: '2F3C7E', slideBg: '232D5E', title: 'F9E795', body: 'FFFFFF', accent: 'F96167' },
    minimal:  { bg: 'F2F2F2', slideBg: 'FFFFFF', title: '36454F', body: '4A5568', accent: '2563EB' },
    forest:   { bg: '2C5F2D', slideBg: '234A24', title: 'FFFFFF', body: 'F5F5F5', accent: '97BC62' },
    terracotta:{ bg: 'B85042', slideBg: '9A3F35', title: 'E7E8D1', body: 'F5F0E8', accent: 'A7BEAE' },
    ocean:    { bg: '065A82', slideBg: '054A6B', title: 'FFFFFF', body: 'D0EAF5', accent: '02C39A' },
  };
  
  // ── Called when 🎞️ button clicked ──
  function generatePptFromInput() {
    const prompt = input.value.trim();
    if (!prompt) { alert('請先在輸入框輸入簡報主題！'); return; }
    input.value = '';
    input.style.height = 'auto';
    startPptGeneration(prompt);
  }
  
  // ── Also support /ppt command ──
  function checkPptCommand(text) {
    if (text.toLowerCase().startsWith('/ppt ')) {
      const topic = text.slice(5).trim();
      if (topic) { startPptGeneration(topic); return true; }
    }
    return false;
  }
  
  // ── Main generation flow ──
  async function startPptGeneration(topic) {
    const cfg = getConfig();
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      alert(t.noApiKey || '請先確認 API Key 已載入！');
      return;
    }
  
    // Show user bubble
    const wrap  = document.querySelector('.msg-wrap');
    const empty = document.getElementById('empty-state');
    if (empty) empty.remove();
  
    const userDiv = document.createElement('div');
    userDiv.className = 'msg user';
    userDiv.innerHTML = `
      <div class="msg-avatar">You</div>
      <div class="msg-body">
        <div class="msg-name">${t.youLabel || 'You'}</div>
        <div class="msg-text">🎞️ ${topic}</div>
      </div>`;
    wrap.appendChild(userDiv);
  
    // AI placeholder
    const aiDiv = document.createElement('div');
    aiDiv.className = 'msg ai';
    aiDiv.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-body">
        <div class="msg-name">${t.aiLabel || 'Assistant'}</div>
        <div class="msg-text ppt-msg">
          <div class="ppt-loading">⏳ 正在生成簡報，請稍候…</div>
        </div>
      </div>`;
    wrap.appendChild(aiDiv);
    document.getElementById('messages').scrollTop = 99999;
  
    const msgText = aiDiv.querySelector('.msg-text');
  
    const systemPrompt = `你是一個專業的簡報設計師。根據使用者的主題生成一份結構清晰的簡報。
  你必須只回傳一個合法的 JSON 物件，不含任何 markdown 語法或說明文字，格式如下：
  {
    "theme": "選擇最適合主題的配色方案，從以下選一個: midnight | coral | minimal | forest | terracotta | ocean",
    "slides": [
      {
        "type": "title",
        "title": "投影片標題",
        "subtitle": "副標題"
      },
      {
        "type": "bullets",
        "title": "章節標題",
        "bullets": ["要點1", "要點2", "要點3"]
      },
      {
        "type": "content",
        "title": "章節標題",
        "body": "內文段落"
      },
      {
        "type": "quote",
        "title": "來源或脈絡",
        "quote": "引言文字"
      },
      {
        "type": "closing",
        "title": "結語標題",
        "subtitle": "結語副標"
      }
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
  
      const result = JSON.parse(raw);
      const slides = result.slides || [];
      const theme  = PPT_THEMES[result.theme] || PPT_THEMES.midnight;
      const themeName = result.theme || 'midnight';
  
      // Render inline slides
      msgText.innerHTML = renderInlineSlides(slides, theme, topic, themeName);
  
      // Store for export
      msgText._pptData = { slides, theme, themeName, topic };
  
    } catch (e) {
      msgText.innerHTML = `<span style="color:var(--danger)">⚠️ PPT 生成失敗：${e.message}</span>`;
    }
  
    document.getElementById('messages').scrollTop = 99999;
  }
  
  // ── Render slides inline in chat ──
  function renderInlineSlides(slides, theme, topic, themeName) {
    const slidesHTML = slides.map((slide, idx) => buildInlineSlide(slide, theme, idx, slides.length)).join('');
  
    return `
      <div class="ppt-inline-wrap">
        <div class="ppt-inline-header">
          <span>🎞️ ${esc(topic)}</span>
          <span class="ppt-theme-badge">${themeName}</span>
        </div>
        <div class="ppt-inline-slides">${slidesHTML}</div>
        <div class="ppt-inline-footer">
          <span class="ppt-edit-hint">💡 點擊文字可直接編輯</span>
          <button class="btn-ppt-dl" onclick="exportPptxFromMsg(this)">⬇️ 下載 .pptx</button>
        </div>
      </div>`;
  }
  
  function buildInlineSlide(slide, theme, idx, total) {
    const tc = '#' + theme.title;
    const bc = '#' + theme.body;
    const ac = '#' + theme.accent;
    const bg = '#' + (slide.type === 'title' || slide.type === 'closing' ? theme.bg : theme.slideBg);
  
    let inner = `<div class="ppt-slide-num" style="color:${bc}88">${idx + 1}/${total}</div>`;
  
    switch (slide.type) {
      case 'title':
      case 'closing':
        inner += `<div class="ppt-slide-center">
          <div class="ppt-editable ppt-slide-title" data-field="title" data-idx="${idx}"
               style="color:${tc};font-size:1.8em;font-weight:700"
               contenteditable="true">${esc(slide.title)}</div>
          ${slide.subtitle ? `<div class="ppt-editable ppt-slide-subtitle" data-field="subtitle" data-idx="${idx}"
               style="color:${ac};font-size:1em;margin-top:0.4em"
               contenteditable="true">${esc(slide.subtitle)}</div>` : ''}
        </div>`;
        break;
  
      case 'bullets':
        inner += `
          <div class="ppt-editable ppt-slide-title" data-field="title" data-idx="${idx}"
               style="color:${tc};font-size:1.3em;font-weight:700;margin-bottom:0.5em"
               contenteditable="true">${esc(slide.title)}</div>
          <ul class="ppt-slide-bullets" style="color:${bc}">
            ${(slide.bullets || []).map((b, bi) => `
              <li class="ppt-editable" data-field="bullets" data-idx="${idx}" data-bi="${bi}"
                  style="color:${bc}" contenteditable="true">${esc(b)}</li>`).join('')}
          </ul>`;
        break;
  
      case 'quote':
        inner += `<div class="ppt-slide-center">
          <div class="ppt-editable ppt-slide-quote" data-field="quote" data-idx="${idx}"
               style="color:${ac};font-size:1.2em;font-style:italic;text-align:center"
               contenteditable="true">"${esc(slide.quote)}"</div>
          <div class="ppt-editable" data-field="title" data-idx="${idx}"
               style="color:${tc};font-size:0.85em;margin-top:0.8em;text-align:center"
               contenteditable="true">${esc(slide.title)}</div>
        </div>`;
        break;
  
      default: // content
        inner += `
          <div class="ppt-editable ppt-slide-title" data-field="title" data-idx="${idx}"
               style="color:${tc};font-size:1.3em;font-weight:700;margin-bottom:0.5em"
               contenteditable="true">${esc(slide.title)}</div>
          <div class="ppt-editable ppt-slide-body" data-field="body" data-idx="${idx}"
               style="color:${bc};font-size:0.85em;line-height:1.7"
               contenteditable="true">${esc(slide.body || '')}</div>`;
        break;
    }
  
    return `<div class="ppt-inline-slide" style="background:${bg}">${inner}</div>`;
  }
  
  // ── Sync edits: read DOM back into data before export ──
  function readSlidesFromDom(container, slides) {
    const updated = JSON.parse(JSON.stringify(slides)); // deep clone
    container.querySelectorAll('.ppt-editable').forEach(el => {
      const idx   = parseInt(el.dataset.idx);
      const field = el.dataset.field;
      const bi    = el.dataset.bi;
      const val   = el.innerText.trim();
      if (field === 'bullets' && bi !== undefined) {
        if (updated[idx].bullets) updated[idx].bullets[parseInt(bi)] = val;
      } else {
        updated[idx][field] = val;
      }
    });
    return updated;
  }
  
  // ── FastAPI 後端位址（依你的部署環境修改） ──
  const API_BASE = 'http://localhost:8000';

  // ── Export from inline chat message ──
  async function exportPptxFromMsg(btn) {
    const msgText = btn.closest('.ppt-msg') || btn.closest('.msg-text');
    if (!msgText?._pptData) { alert('找不到簡報資料！'); return; }

    const { theme, themeName, topic } = msgText._pptData;
    const slides = readSlidesFromDom(msgText, msgText._pptData.slides);

    btn.disabled = true;
    btn.textContent = '⏳ 匯出中…';

    try {
      const resp = await fetch(`${API_BASE}/generate-pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, theme: themeName, slides }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      // 把回傳的二進位存成 .pptx 下載
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${topic}.pptx`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (e) {
      // 若後端無法連線，fallback 到 PptxGenJS 本地匯出
      console.warn('⚠️ 後端無回應，改用本地 PptxGenJS：', e.message);
      await buildAndDownloadPptx(slides, theme, topic);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇️ 下載 .pptx';
    }
  }
  
  // ── PptxGenJS builder ──
  async function buildAndDownloadPptx(slides, theme, topic) {
    const pres  = new PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    pres.title  = topic;
  
    slides.forEach(slide => {
      const s = pres.addSlide();
      s.background = { color: (slide.type === 'title' || slide.type === 'closing') ? theme.bg : theme.slideBg };
  
      switch (slide.type) {
        case 'title':
        case 'closing':
          s.addText(slide.title || '', {
            x: 1, y: 1.8, w: 8, h: 1.2,
            fontSize: 40, bold: true, color: theme.title, align: 'center',
          });
          if (slide.subtitle) {
            s.addText(slide.subtitle, {
              x: 1.5, y: 3.2, w: 7, h: 0.8,
              fontSize: 20, color: theme.accent, align: 'center',
            });
          }
          break;
  
        case 'bullets':
          s.addText(slide.title || '', {
            x: 0.5, y: 0.4, w: 9, h: 0.8,
            fontSize: 28, bold: true, color: theme.title,
          });
          if (slide.bullets?.length) {
            // Each bullet as a separate text run with breakLine
            const bulletRuns = slide.bullets.map((b, i) => ({
              text: b,
              options: {
                bullet:    true,
                breakLine: i < slide.bullets.length - 1,
                fontSize:  16,
                color:     theme.body,
              },
            }));
            s.addText(bulletRuns, {
              x: 0.7, y: 1.4, w: 8.5, h: 3.6,
              paraSpaceAfter: 6,
            });
          }
          break;
  
        case 'quote':
          s.addText(`"${slide.quote || ''}"`, {
            x: 1, y: 1.5, w: 8, h: 1.8,
            fontSize: 22, italic: true, color: theme.accent, align: 'center',
          });
          s.addText(slide.title || '', {
            x: 1, y: 3.5, w: 8, h: 0.6,
            fontSize: 14, color: theme.title, align: 'center',
          });
          break;
  
        default:
          s.addText(slide.title || '', {
            x: 0.5, y: 0.4, w: 9, h: 0.8,
            fontSize: 28, bold: true, color: theme.title,
          });
          s.addText(slide.body || '', {
            x: 0.7, y: 1.4, w: 8.5, h: 3.6,
            fontSize: 16, color: theme.body,
            valign: 'top', wrap: true,
          });
          break;
      }
  
      if (slide.speaker_notes) s.addNotes(slide.speaker_notes);
    });
  
    await pres.writeFile({ fileName: `${topic}.pptx` });
  }
  
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }