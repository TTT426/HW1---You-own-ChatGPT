"""
server.py  —  FastAPI 後端
端點：
    GET  /templates                  → 範本清單 + PDF 預覽 URL
    GET  /previews/{filename}        → 範本 PDF 預覽（靜態）
    POST /generate-pptx-preview      → AI 內容 → pptx → PDF，回傳預覽 URL + job_id
    GET  /download/{job_id}          → 下載已產生的 pptx
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
from pathlib import Path
from urllib.parse import quote
import subprocess, uuid, io, tempfile, shutil

from render_ppt import detect_layouts, render_slide
from pptx import Presentation

TEMPLATE_DIR = Path('./input')
PREVIEW_DIR  = Path('./cache/previews')   # 範本預覽 PDF
JOBS_DIR     = Path('./cache/jobs')       # 每次生成的暫存 pptx / pdf

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Schemas ──
class SlideData(BaseModel):
    type: str
    title: Optional[str] = ''
    subtitle: Optional[str] = None
    bullets: Optional[List[str]] = None
    body: Optional[str] = None
    quote: Optional[str] = None

class GenerateRequest(BaseModel):
    topic: str
    theme: Optional[str] = 'midnight'
    template: Optional[str] = None
    slides: List[SlideData]

# ── Layout cache ──
_layout_cache: Dict = {}

def get_layout_map(template_name: str) -> Dict:
    if template_name not in _layout_cache:
        path = TEMPLATE_DIR / template_name
        if not path.exists():
            raise FileNotFoundError(f"找不到範本：{template_name}")
        _layout_cache[template_name] = detect_layouts(str(path))
    return _layout_cache[template_name]


# ══════════════════════════════════════════════
#  soffice 轉 PDF 工具函數
# ══════════════════════════════════════════════

def pptx_to_pdf(pptx_path: Path, out_dir: Path) -> Optional[Path]:
    """pptx → pdf"""
    out_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ['soffice', '--headless', '--convert-to', 'pdf',
         '--outdir', str(out_dir), str(pptx_path)],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        print(f"⚠️  soffice 失敗：{result.stderr}")
        return None
    pdf_path = out_dir / (pptx_path.stem + '.pdf')
    return pdf_path if pdf_path.exists() else None


def pdf_to_thumbnail(pdf_path: Path, out_path: Path, dpi: int = 150) -> bool:
    """PDF 第一頁 → PNG 縮圖"""
    stem = out_path.stem + '-thumb'
    subprocess.run(
        ['pdftoppm', '-png', '-r', str(dpi), '-f', '1', '-l', '1',
         str(pdf_path), str(out_path.parent / stem)],
        capture_output=True, text=True, timeout=30
    )
    # pdftoppm 輸出可能是 stem-1.png 或 stem-01.png，用 glob 找
    matches = sorted(out_path.parent.glob(f"{stem}*.png"))
    if matches:
        matches[0].rename(out_path)
        return True
    return False


# ══════════════════════════════════════════════
#  Startup：預先產生所有範本的 PDF 預覽
# ══════════════════════════════════════════════

@app.on_event("startup")
def startup():
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    if not TEMPLATE_DIR.exists():
        print("⚠️  input/ 資料夾不存在"); return

    for pptx in TEMPLATE_DIR.glob("*.pptx"):
        pdf  = PREVIEW_DIR / (pptx.stem + '.pdf')
        thumb = PREVIEW_DIR / (pptx.stem + '.png')
        stale = not pdf.exists() or pdf.stat().st_mtime < pptx.stat().st_mtime
        if stale:
            print(f"🔄 產生預覽：{pptx.name}")
            pdf = pptx_to_pdf(pptx, PREVIEW_DIR)
        if pdf and (stale or not thumb.exists()):
            print(f"🖼  產生縮圖：{pptx.stem}.png")
            pdf_to_thumbnail(pdf, thumb)
        try:
            get_layout_map(pptx.name)
        except Exception as e:
            print(f"⚠️  layout 偵測失敗 {pptx.name}：{e}")
    print("✅ 啟動完成")


# ══════════════════════════════════════════════
#  GET /templates
# ══════════════════════════════════════════════

@app.get("/templates")
def list_templates():
    if not TEMPLATE_DIR.exists():
        return {"templates": []}
    result = []
    for pptx in sorted(TEMPLATE_DIR.glob("*.pptx")):
        thumb = PREVIEW_DIR / (pptx.stem + '.png')
        result.append({
            "name"     : pptx.name,
            "label"    : pptx.stem,
            "thumbnail": f"/thumbnails/{pptx.stem}.png" if thumb.exists() else None,
        })
    return {"templates": result}


# ══════════════════════════════════════════════
#  GET /previews/{filename}
# ══════════════════════════════════════════════

@app.get("/previews/{filename}")
def get_preview(filename: str):
    if not filename.endswith('.pdf'):
        raise HTTPException(400, "只提供 PDF 檔")
    path = PREVIEW_DIR / filename
    if not path.exists():
        raise HTTPException(404, "預覽不存在")
    return FileResponse(str(path), media_type="application/pdf")


@app.get("/thumbnails/{filename}")
def get_thumbnail(filename: str):
    if not filename.endswith('.png'):
        raise HTTPException(400, "只提供 PNG 檔")
    path = PREVIEW_DIR / filename
    if not path.exists():
        raise HTTPException(404, "縮圖不存在")
    return FileResponse(str(path), media_type="image/png")


# ══════════════════════════════════════════════
#  POST /generate-pptx-preview
#  → 產生 pptx + PDF，回傳 { preview_url, job_id }
# ══════════════════════════════════════════════

@app.post("/generate-pptx-preview")
def generate_pptx_preview(req: GenerateRequest):
    template_name = req.template or next(
        (p.name for p in sorted(TEMPLATE_DIR.glob("*.pptx"))), None
    )
    if not template_name:
        raise HTTPException(400, "input/ 內沒有任何範本")
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        raise HTTPException(404, f"找不到範本：{template_name}")

    try:
        # 1. 產生 pptx
        layout_map = get_layout_map(template_name)
        prs = Presentation(str(template_path))
        while len(prs.slides) > 0:
            rId = prs.slides._sldIdLst[0].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[0]
        for sd in req.slides:
            layout_idx = layout_map.get(sd.type, 1)
            render_slide(prs, layout_idx, sd.model_dump())

        # 2. 存到 jobs/
        job_id   = str(uuid.uuid4())
        job_dir  = JOBS_DIR / job_id
        job_dir.mkdir(parents=True)
        pptx_path = job_dir / 'result.pptx'
        prs.save(str(pptx_path))

        # 3. 轉 PDF
        pdf_path = pptx_to_pdf(pptx_path, job_dir)
        if not pdf_path:
            raise RuntimeError("PDF 轉換失敗，請確認 soffice 是否正常")

        # 4. 產生每頁縮圖（用 pdftoppm 轉所有頁）
        thumb_dir = job_dir / 'thumbs'
        thumb_dir.mkdir(exist_ok=True)
        subprocess.run(
            ['pdftoppm', '-png', '-r', '150',
             str(pdf_path), str(thumb_dir / 'slide')],
            capture_output=True, text=True, timeout=60
        )
        # 統一檔名格式為 slide-001.png, slide-002.png ...
        for f in sorted(thumb_dir.glob('slide*.png')):
            # 已經是正確格式，不需要更名
            pass

        return {
            "job_id"     : job_id,
            "preview_url": f"/job-preview/{job_id}",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ══════════════════════════════════════════════
#  GET /job-preview/{job_id}  — 預覽 PDF
# ══════════════════════════════════════════════

@app.get("/job-preview/{job_id}")
def job_preview(job_id: str):
    """回傳各頁縮圖的 URL 清單"""
    thumb_dir = JOBS_DIR / job_id / 'thumbs'
    if not thumb_dir.exists():
        raise HTTPException(404, "預覽不存在")
    slides = sorted(thumb_dir.glob("*.png"))
    urls = [f"/job-slide/{job_id}/{p.name}" for p in slides]
    return {"slides": urls}


@app.get("/job-slide/{job_id}/{filename}")
def job_slide(job_id: str, filename: str):
    path = JOBS_DIR / job_id / 'thumbs' / filename
    if not path.exists():
        raise HTTPException(404, "圖片不存在")
    return FileResponse(str(path), media_type="image/png")


# ══════════════════════════════════════════════
#  GET /download/{job_id}  — 下載 pptx
# ══════════════════════════════════════════════

# ══════════════════════════════════════════════
#  PATCH /job/{job_id}/slide/{idx}
#  更新單張投影片內容 → 重新產生 pptx + 該頁 PNG
# ══════════════════════════════════════════════

class SlideUpdate(BaseModel):
    slide: SlideData
    template: Optional[str] = None
    all_slides: List[SlideData]   # 完整 slides，重新產生整份 pptx

@app.patch("/job/{job_id}/slide/{slide_idx}")
def update_slide(job_id: str, slide_idx: int, body: SlideUpdate):
    job_dir   = JOBS_DIR / job_id
    pptx_path = job_dir / 'result.pptx'
    if not pptx_path.exists():
        raise HTTPException(404, "Job 不存在")

    template_name = body.template or next(
        (p.name for p in sorted(TEMPLATE_DIR.glob("*.pptx"))), None
    )
    template_path = TEMPLATE_DIR / template_name
    if not template_path.exists():
        raise HTTPException(404, f"找不到範本：{template_name}")

    try:
        # 用完整 slides 重建整份 pptx
        layout_map = get_layout_map(template_name)
        prs = Presentation(str(template_path))
        while len(prs.slides) > 0:
            rId = prs.slides._sldIdLst[0].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[0]
        for sd in body.all_slides:
            layout_idx = layout_map.get(sd.type, 1)
            render_slide(prs, layout_idx, sd.model_dump())
        prs.save(str(pptx_path))

        # 重新轉 PDF
        pdf_path = pptx_to_pdf(pptx_path, job_dir)
        if not pdf_path:
            raise RuntimeError("PDF 轉換失敗")

        # 重新產生所有縮圖
        thumb_dir = job_dir / 'thumbs'
        for old_img in thumb_dir.glob("*.png"):
            old_img.unlink()
        subprocess.run(
            ['pdftoppm', '-png', '-r', '150',
             str(pdf_path), str(thumb_dir / 'slide')],
            capture_output=True, timeout=60
        )

        # 回傳更新後的該頁圖片 URL
        thumbs = sorted(thumb_dir.glob("*.png"))
        urls = [f"/job-slide/{job_id}/{p.name}" for p in thumbs]
        return {"slides": urls, "updated_idx": slide_idx}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/download/{job_id}")
def download_pptx(job_id: str):
    pptx = JOBS_DIR / job_id / 'result.pptx'
    if not pptx.exists():
        raise HTTPException(404, "檔案不存在（可能已過期）")
    return FileResponse(
        str(pptx),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename="result.pptx",
    )