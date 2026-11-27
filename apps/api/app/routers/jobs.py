from __future__ import annotations

import asyncio
import datetime as dt
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import CurrentUser, DbSession, parse_uuid, require_csrf
from app.core.config import settings
from app.core.redis import redis_client
from app.core.security import audit_meta
from app.core.storage import delete, get_bytes, presign_get
from app.models import AuditLog, Job, JobPage, Upload
from app.schemas import JobCreateRequest, LockRequest
from app.services import doc_convert
from app.services import usage as usage_service
from app.services.blocks import blocks_from_dicts
from app.services.detect import MIME_BY_KIND
from app.workers.tasks import analyze_job, publish, resume_job, start_job

router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(require_csrf)])


def job_to_dict(job: Job, pages: list[JobPage] | None = None) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "status": job.status,
        "filename": job.source_filename,
        "size": job.source_size,
        "kind": job.file_kind,
        "total_pages": job.total_pages,
        "processed_pages": job.processed_pages,
        "total_blocks": job.total_blocks,
        "rewritten_blocks": job.rewritten_blocks,
        "flagged_blocks": job.flagged_blocks,
        "skipped_blocks": job.skipped_blocks,
        "words": job.total_words,
        "tokens_in": job.tokens_in,
        "tokens_out": job.tokens_out,
        "cost_usd": float(job.cost_usd or 0),
        "options": job.options or {},
        "analysis": job.analysis,
        "current_section": job.current_section,
        "error": job.error,
        "has_output": bool(job.output_key),
        "has_qa": bool(job.qa_key),
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "expires_at": job.expires_at,
        "pages": [
            {"page": p.page_number, "status": p.status, "notes": p.notes} for p in (pages or [])
        ],
    }


async def _owned_job(db: AsyncSession, job_id: str, user) -> Job:
    job = await db.scalar(select(Job).where(Job.id == parse_uuid(job_id), Job.user_id == user.id))
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@router.post("")
async def create_job(payload: JobCreateRequest, user: CurrentUser, db: DbSession) -> dict:
    upload = await db.scalar(
        select(Upload).where(Upload.id == parse_uuid(payload.upload_id), Upload.user_id == user.id)
    )
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    if upload.status != "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload is not complete yet")

    allowed, quota = await usage_service.check_quota(db, user.id, 1)
    if not allowed:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Monthly page quota exceeded")

    options = payload.options.model_dump()
    options["locked_blocks"] = sorted(set(options.get("locked_blocks") or []))
    job = Job(
        user_id=user.id,
        status="queued",
        source_key=upload.key,
        source_filename=upload.filename,
        source_size=upload.size,
        source_mime=upload.mime,
        file_kind=(upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else "txt"),
        options=options,
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(hours=settings.retention_hours),
    )
    db.add(job)
    db.add(AuditLog(user_id=user.id, action="job.created", meta=audit_meta(filename=upload.filename, size=upload.size)))
    await db.commit()
    await db.refresh(job)

    analyze_job.delay(str(job.id))
    return {"job": job_to_dict(job), "quota": quota}


@router.get("")
async def list_jobs(user: CurrentUser, db: DbSession, limit: int = 50, offset: int = 0) -> dict:
    limit = min(max(1, limit), 100)
    offset = max(0, offset)
    rows = await db.scalars(
        select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc()).limit(limit).offset(offset)
    )
    total = await db.scalar(select(func.count(Job.id)).where(Job.user_id == user.id))
    return {"jobs": [job_to_dict(j) for j in rows], "total": int(total or 0), "limit": limit, "offset": offset}


@router.get("/usage")
async def usage(user: CurrentUser, db: DbSession) -> dict:
    entitlement = await usage_service.get_entitlement(db, user.id)
    pages_used = await usage_service.pages_used(db, user.id)
    words_used = await usage_service.words_used(db, user.id)
    return {
        "period": usage_service.current_period(),
        "pages_used": pages_used,
        "words_used": words_used,
        "pages_remaining": max(0, entitlement["pages_per_month"] - pages_used),
        "pages_per_month": entitlement["pages_per_month"],
        "tier": entitlement["tier"],
        "current_period_end": entitlement.get("current_period_end"),
        "cancel_at_period_end": entitlement.get("cancel_at_period_end"),
    }


@router.get("/{job_id}")
async def get_job(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    pages = list(await db.scalars(select(JobPage).where(JobPage.job_id == job.id).order_by(JobPage.page_number)))
    return {"job": job_to_dict(job, pages)}


@router.post("/{job_id}/start")
async def start(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if job.status not in ("analyzed", "queued", "failed"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Job cannot start from state {job.status}")
    allowed, quota = await usage_service.check_quota(db, user.id, job.total_pages)
    if not allowed:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Monthly page quota exceeded")
    job.status = "queued"
    job.error = None
    db.add(AuditLog(user_id=user.id, action="job.started", meta=audit_meta(job_id=str(job.id), pages=job.total_pages)))
    await db.commit()
    start_job.delay(str(job.id))
    return {"job": job_to_dict(job)}


@router.post("/{job_id}/resume")
async def resume(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if job.status not in ("failed", "rewriting", "rebuilding", "verifying"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Job is not resumable")
    job.error = None
    await db.commit()
    resume_job.delay(str(job.id))
    return {"job": job_to_dict(job)}


@router.post("/{job_id}/cancel")
async def cancel(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if job.status not in ("queued", "analyzing", "analyzed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Job is already running")
    job.status = "canceled"
    job.finished_at = dt.datetime.now(dt.UTC)
    await db.commit()
    publish(str(job.id), {"type": "status", "status": "canceled"})
    return {"job": job_to_dict(job)}


@router.delete("/{job_id}")
async def delete_job(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    for key in (job.source_key, job.output_key, job.qa_key):
        if key:
            delete(key)
    await db.delete(job)
    db.add(AuditLog(user_id=user.id, action="job.deleted", meta=audit_meta(job_id=str(job.id))))
    await db.commit()
    return {"deleted": True}


@router.patch("/{job_id}/locks")
async def set_locks(job_id: str, payload: LockRequest, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if job.status not in ("analyzed", "queued"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Blocks can only be locked before processing starts")
    wanted = set(payload.block_ids)
    pages = list(await db.scalars(select(JobPage).where(JobPage.job_id == job.id)))
    touched = 0
    for row in pages:
        blocks = blocks_from_dicts(row.blocks)
        changed = False
        for block in blocks:
            if block.id in wanted:
                block.locked = payload.locked
                if payload.locked:
                    block.skip, block.skip_reason = True, "locked"
                elif block.skip_reason == "locked":
                    block.skip, block.skip_reason = False, ""
                touched += 1
                changed = True
        if changed:
            row.blocks = [b.to_dict() for b in blocks]
    options = dict(job.options or {})
    locked = set(options.get("locked_blocks") or [])
    locked = (locked | wanted) if payload.locked else (locked - wanted)
    options["locked_blocks"] = sorted(locked)
    job.options = options
    await db.commit()
    return {"locked_blocks": sorted(locked), "touched": touched}


@router.get("/{job_id}/preview/{page_number}")
async def preview(job_id: str, page_number: int, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    row = await db.scalar(
        select(JobPage).where(JobPage.job_id == job.id, JobPage.page_number == page_number)
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page not found")
    blocks = blocks_from_dicts(row.blocks)
    return {
        "page": page_number,
        "total_pages": job.total_pages,
        "blocks": [
            {
                "id": b.id,
                "type": b.type,
                "bbox": b.bbox,
                "original": b.text,
                "rewritten": b.new_text,
                "skip": b.skip,
                "skip_reason": b.skip_reason,
                "locked": b.locked,
                "flag": b.flag,
                "font": b.font,
                "size": b.size,
            }
            for b in blocks
        ],
    }


@router.get("/{job_id}/render/{page_number}")
async def render_page(
    job_id: str,
    page_number: int,
    user: CurrentUser,
    db: DbSession,
    variant: str = "before",
) -> Response:
    import fitz

    job = await _owned_job(db, job_id, user)
    if job.file_kind != "pdf":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Visual page rendering is only supported for PDFs")
    key = job.output_key if (variant == "after" and job.output_key) else job.source_key
    loop = asyncio.get_running_loop()
    pdf_bytes = await loop.run_in_executor(None, get_bytes, key)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if page_number < 1 or page_number > doc.page_count:
        doc.close()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page out of range")
    pix = doc[page_number - 1].get_pixmap(dpi=130)
    png = pix.tobytes("png")
    doc.close()
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=120"})

@router.get("/{job_id}/download")
async def download(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if not job.output_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Output is not ready yet")
    name = job.source_filename.rsplit(".", 1)[0] + ".humanized." + (job.file_kind or "pdf")
    return {"url": presign_get(job.output_key, expires=300, download_name=name), "expires_in": 300}


@router.get("/{job_id}/export")
async def export_job_format(
    job_id: str,
    user: CurrentUser,
    db: DbSession,
    format: str = "pdf",
) -> Response:
    """Download the completed job in the user's chosen format (.pdf, .docx, .doc, or .txt).

    When the requested format matches the job's native layout-preserved output (e.g. PDF
    on a PDF job or DOCX on a DOCX job), streams the rebuilt file verbatim so original
    layout stays intact; otherwise converts the rewritten content cleanly on the fly.
    """
    import re

    fmt = (format or "pdf").lower().strip()
    if fmt not in ("pdf", "docx", "doc", "txt"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Supported formats are pdf, docx, doc, and txt.")

    job = await _owned_job(db, job_id, user)
    if job.status != "done" or not job.output_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Output is not ready yet")

    stem = job.source_filename.rsplit(".", 1)[0] if "." in job.source_filename else job.source_filename
    safe_base = re.sub(r"[^a-zA-Z0-9_-]", "_", stem or "HumanDoc_Document")[:80]
    download_name = f"{safe_base}.humanized.{fmt}"

    loop = asyncio.get_running_loop()

    # Exact native rebuilt file match preserves 100% original layout (PDF->PDF, DOCX->DOCX, DOC->DOC, TXT->TXT)
    if fmt == job.file_kind or (fmt == "txt" and job.file_kind == "md"):
        raw = await loop.run_in_executor(None, get_bytes, job.output_key)
        media = MIME_BY_KIND.get(job.file_kind, "application/octet-stream")
        if fmt == "txt":
            media = "text/plain; charset=utf-8"
        return Response(
            content=raw,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )

    # Otherwise gather rewritten text from JobPage checkpoints, falling back to output_key
    rows = list(
        await db.scalars(
            select(JobPage).where(JobPage.job_id == job.id).order_by(JobPage.page_number)
        )
    )
    paragraphs: list[str] = []
    for row in rows:
        for b in blocks_from_dicts(row.blocks):
            txt = (b.new_text or b.text or "").strip()
            if txt:
                paragraphs.append(txt)

    if not paragraphs:
        raw = await loop.run_in_executor(None, get_bytes, job.output_key)
        if job.file_kind in ("docx", "doc"):
            paragraphs, _ = doc_convert.extract_word_paragraphs(raw, job.source_filename)
        elif job.file_kind == "pdf":
            import fitz

            pdf_doc = fitz.open(stream=raw, filetype="pdf")
            paragraphs = [p.get_text("text").strip() for p in pdf_doc if p.get_text("text").strip()]
            pdf_doc.close()
        else:
            paragraphs = [raw.decode("utf-8", errors="replace").strip()]

    out_bytes, media_type = doc_convert.export_document_bytes(stem, paragraphs, fmt)
    return Response(
        content=out_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


@router.get("/{job_id}/qa")
async def qa_report(job_id: str, user: CurrentUser, db: DbSession) -> dict:
    job = await _owned_job(db, job_id, user)
    if not job.qa_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QA report is not ready yet")
    return {"url": presign_get(job.qa_key, expires=300, download_name="humandoc-qa-report.json"), "expires_in": 300}


@router.get("/{job_id}/stream")
async def stream(job_id: str, request: Request, user: CurrentUser, db: DbSession) -> StreamingResponse:
    job = await _owned_job(db, job_id, user)
    initial = json.dumps(
        {
            "job_id": str(job.id),
            "type": "snapshot",
            "status": job.status,
            "total_pages": job.total_pages,
            "processed_pages": job.processed_pages,
            "analysis": job.analysis,
            "error": job.error,
        },
        default=str,
    )

    async def generator():
        yield f"event: snapshot\ndata: {initial}\n\n"
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(f"job-events:{job_id}")
        try:
            while True:
                if await request.is_disconnected():
                    break
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
                if message and message["type"] == "message":
                    yield f"event: message\ndata: {message['data']}\n\n"
                    data = json.loads(message["data"])
                    if data.get("type") in ("done", "error"):
                        break
                else:
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:  # client closed the tab
            pass
        finally:
            await pubsub.unsubscribe(f"job-events:{job_id}")
            await pubsub.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
