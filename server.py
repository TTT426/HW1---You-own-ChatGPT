"""
server.py  —  FastAPI 後端
─────────────────────────────────────────────────────
啟動方式：
    pip install fastapi uvicorn python-pptx
    uvicorn server:app --reload --port 8000

前端呼叫：
    POST http://localhost:8000/generate-pptx
    Content-Type: application/json
    Body: { "topic": "...", "theme": "midnight", "slides": [...] }

回傳：
    application/octet-stream  (.pptx 二進位)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict, List
import io

from render_ppt import detect_layouts, render_slide, TEMPLATE_PATH
from pptx import Presentation

app = FastAPI()

# ── 允許前端跨來源呼叫（本機開發用） ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 上線後改成你的網域
    allow_methods=["POST"],
    allow_headers=["*"],
)

# ── Request schema ──
class SlideData(BaseModel):
    type: str                        # title | closing | bullets | content | quote
    title: Optional[str] = ''
    subtitle: Optional[str] = None
    bullets: Optional[List[str]] = None
    body: Optional[str] = None
    quote: Optional[str] = None

class GenerateRequest(BaseModel):
    topic: str
    theme: Optional[str] = 'midnight'
    slides: List[SlideData]

# ── 預先偵測 layout，避免每次請求都掃描 ──
_layout_map: Dict = {}

@app.on_event("startup")
def startup():
    global _layout_map
    print("🔍 偵測範本 layout…")
    _layout_map = detect_layouts(TEMPLATE_PATH)
    print("✅ Layout 偵測完成")

# ── 主要端點 ──
@app.post("/generate-pptx")
def generate_pptx(req: GenerateRequest):
    try:
        prs = Presentation(TEMPLATE_PATH)

        # 清空範本內既有投影片
        while len(prs.slides) > 0:
            rId = prs.slides._sldIdLst[0].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[0]

        for sd in req.slides:
            layout_idx = _layout_map.get(sd.type, 1)
            render_slide(prs, layout_idx, sd.model_dump())

        # 存到記憶體 buffer，直接回傳，不寫磁碟
        buf = io.BytesIO()
        prs.save(buf)
        buf.seek(0)

        from urllib.parse import quote
        safe_name = req.topic.replace("/", "-")
        # RFC 5987：支援中文檔名
        encoded = quote(safe_name + ".pptx", safe="")
        disposition = f"attachment; filename*=UTF-8''{encoded}"
        return Response(
            content=buf.read(),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": disposition},
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))