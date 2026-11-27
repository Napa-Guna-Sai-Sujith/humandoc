"""Background pipeline.

States: queued → analyzing → analyzed → rewriting → rebuilding → verifying → done | failed

Every page is checkpointed to job_pages immediately after it is rewritten, so a crash or a
closed browser tab resumes from the last completed page instead of restarting.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Any

import redis as sync_redis
from celery import chord, group
from sqlalchemy import func, select, text

from app.core.config import settings
from app.core.db import worker_session_scope
from app.core.storage import apply_retention_tag, delete, download_to, put_bytes
from app.models import Job, JobPage, Upload, User
from app.services import analyze as analyze_service
from app.services import (
    extract_pdf,
    rebuild_docx,
    rebuild_pdf,
    rebuild_pptx,
    rebuild_text,
)
from app.services import prompts as prompts_service
from app.services import usage as usage_service
from app.services import verify as verify_service
from app.services.blocks import Block, blocks_from_dicts, blocks_to_dicts
from app.services.detect import MIME_BY_KIND
from app.services.glossary import TerminologyMemory, extract_terms
from app.services.qa import build_report
from app.services.rewrite import RewriteEngine
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)
logger = logging.getLogger("humandoc.worker")

redis_sync = sync_redis.Redis.from_url(settings.redis_url, decode_responses=True)


def publish(job_id: str, event: dict[str, Any]) -> None:
    payload = {"job_id": str(job_id), **event}
    try:
        redis_sync.publish(f"job-events:{job_id}", json.dumps(payload, default=str))
        redis_sync.set(f"job-last-event:{job_id}", json.dumps(payload, default=str), ex=86400)
    except Exception as exc:  # progress events must never break the job
        log.warning("progress publish failed: %s", exc)


def _chunks(values: list[int], size: int) -> list[list[int]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


async def _set_status(db, job_id, status: str, **fields) -> None:
    values = {"status": status, "updated_at": _now(), **fields}
    assignments = ", ".join(f"{k} = :{k}" for k in values)
    await db.execute(text(f"UPDATE jobs SET {assignments} WHERE id = :job_id"), {**values, "job_id": str(job_id)})
    await db.commit()
    publish(str(job_id), {"type": "status", "status": status})


# ============================================================ analysis
@celery_app.task(name="app.workers.tasks.analyze_job", bind=True, max_retries=3, default_retry_delay=10)
def analyze_job(self, job_id: str) -> None:
    try:
        asyncio.run(_analyze_job(job_id))
    except Exception as exc:
        log.exception("analyze failed")
        asyncio.run(_fail(job_id, f"Analysis failed: {exc}"))


async def _analyze_job(job_id: str) -> None:
    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job:
            return
        await _set_status(db, job_id, "analyzing")
        publish(job_id, {"type": "progress", "stage": "analyzing", "message": "Reading document structure"})

    tmpdir = tempfile.mkdtemp(dir=settings.tmp_dir)
    src = Path(tmpdir) / "source"
    source_key = job.source_key
    download_to(source_key, str(src))

    options = dict(job.options or {})
    kind, mime = job.file_kind, job.source_mime

    ocr_key: str | None = None
    if kind == "pdf":
        probe, _ = extract_pdf.extract_pdf(src)
        if extract_pdf.needs_ocr(probe, len(probe)):
            publish(job_id, {"type": "progress", "stage": "ocr", "message": "Running OCR on scanned pages"})
            ocr_path = extract_pdf.ocr_pdf(src)
            ocr_key = source_key.replace("/source/", "/ocr/")
            put_bytes(ocr_key, Path(ocr_path).read_bytes(), "application/pdf")
            src = Path(ocr_path)

    analysis = analyze_service.analyze_file(str(src), kind, mime, job.source_filename, options)

    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job:
            return
        job.file_kind = analysis.kind
        job.total_pages = analysis.total_pages
        job.total_blocks = analysis.blocks_total
        job.total_words = analysis.words
        job.analysis = analysis.to_dict()
        if ocr_key:
            job.source_key = ocr_key
        await db.execute(text("DELETE FROM job_pages WHERE job_id = :id"), {"id": job_id})
        for payload in analyze_service.analysis_pages_payload(analysis):
            db.add(
                JobPage(
                    job_id=job.id,
                    page_number=payload["page_number"],
                    status="pending",
                    blocks=payload["blocks"],
                    notes={},
                )
            )
        await db.commit()
        await _set_status(db, job_id, "analyzed")
        publish(
            job_id,
            {
                "type": "analyzed",
                "analysis": analysis.to_dict(),
            },
        )


# ============================================================ start / resume
@celery_app.task(name="app.workers.tasks.start_job")
def start_job(job_id: str) -> None:
    try:
        asyncio.run(_start_job(job_id))
    except Exception as exc:
        log.exception("start failed")
        asyncio.run(_fail(job_id, f"Could not start job: {exc}"))


async def _start_job(job_id: str) -> None:
    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job:
            return
        if job.status not in ("queued", "analyzed", "failed"):
            return
        allowed, quota = await usage_service.check_quota(db, job.user_id, job.total_pages)
        if not allowed:
            await _set_status(
                db, job_id, "failed",
                error=(
                    f"Monthly page quota exceeded: {quota['pages_used']}/{quota['pages_per_month']} pages used. "
                    "Upgrade your plan to continue."
                ),
            )
            publish(job_id, {"type": "error", "message": "quota_exceeded"})
            return
        pages = await db.scalars(
            select(JobPage.page_number).where(JobPage.job_id == job_id).order_by(JobPage.page_number)
        )
        numbers = list(pages)
        job.started_at = _now()
        job.expires_at = _now() + dt.timedelta(hours=settings.retention_hours)
        await db.commit()
        await _set_status(db, job_id, "rewriting", started_at=job.started_at, expires_at=job.expires_at)

    batches = _chunks(numbers, settings.batch_size)
    header = group([process_batch.s(job_id, batch) for batch in batches])
    callback = finalize_job.s(job_id)
    chord(header)(callback)
    publish(job_id, {"type": "progress", "stage": "rewriting", "page": 0, "total": len(numbers)})


@celery_app.task(name="app.workers.tasks.resume_job")
def resume_job(job_id: str) -> None:
    try:
        asyncio.run(_resume_job(job_id))
    except Exception as exc:
        log.exception("resume failed")
        asyncio.run(_fail(job_id, f"Could not resume job: {exc}"))


async def _resume_job(job_id: str) -> None:
    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job or job.status not in ("failed", "rewriting", "queued"):
            return
        pending = await db.scalars(
            select(JobPage.page_number)
            .where(JobPage.job_id == job_id, JobPage.status != "rewritten")
            .order_by(JobPage.page_number)
        )
        numbers = list(pending)
        if not numbers:
            await _set_status(db, job_id, "rebuilding")
            finalize_job.delay([], job_id)
            return
        job.error = None
        await db.commit()
        await _set_status(db, job_id, "rewriting")
    batches = _chunks(numbers, settings.batch_size)
    chord(group([process_batch.s(job_id, batch) for batch in batches]))(finalize_job.s(job_id))
    publish(job_id, {"type": "progress", "stage": "rewriting", "page": 0, "total": len(numbers)})


# ============================================================ rewrite
@celery_app.task(name="app.workers.tasks.process_batch", bind=True, max_retries=2, default_retry_delay=20)
def process_batch(self, job_id: str, page_numbers: list[int]) -> None:
    try:
        asyncio.run(_process_batch(job_id, page_numbers))
    except Exception as exc:
        log.exception("batch failed")
        if self.request.retries < 2:
            raise self.retry(exc=exc) from exc
        asyncio.run(_fail(job_id, f"Processing failed: {exc}"))


async def _process_batch(job_id: str, page_numbers: list[int]) -> None:
    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job or job.status in ("done", "failed", "canceled"):
            return
        rows = await db.scalars(
            select(JobPage).where(JobPage.job_id == job_id, JobPage.page_number.in_(page_numbers))
        )
        page_map = {r.page_number: r for r in rows}
        prev_rows = await db.scalars(
            select(JobPage).where(
                JobPage.job_id == job_id, JobPage.page_number.in_([p - 1 for p in page_numbers if p > 1])
            )
        )
        prev_map = {r.page_number: r for r in prev_rows}
        options = dict(job.options or {})
        analysis = dict(job.analysis or {})
        all_blocks: list[Block] = []
        for row in page_map.values():
            all_blocks.extend(blocks_from_dicts(row.blocks))

        memory = TerminologyMemory(redis_sync, str(job_id), extract_terms([b.text for b in all_blocks]))
        engine = RewriteEngine(
            style=options.get("style", "professional"),
            strength=options.get("strength", "medium"),
            language=options.get("language", "auto"),
            custom=options.get("custom_instructions", ""),
            document_type=analysis.get("kind", "document"),
            glossary=memory.load(),
        )

        started = time.time()
        done_count = int(
            await db.scalar(
                select(func.count())
                .select_from(JobPage)
                .where(JobPage.job_id == job_id, JobPage.status == "rewritten")
            )
            or 0
        )
        total_pages = job.total_pages or 1

        for number in sorted(page_map):
            row = page_map[number]
            if row.status == "rewritten":
                continue
            blocks = blocks_from_dicts(row.blocks)
            previous = blocks_from_dicts(prev_map[number - 1].blocks) if (number - 1) in prev_map else []
            prev_text = previous[-1].text if previous else ""
            heading = ""
            for block in blocks:
                if block.type == "heading" and block.text.strip():
                    heading = block.text.strip()

            page_ti = 0
            page_to = 0
            page_flagged = 0

            for index, block in enumerate(blocks):
                if block.skip:
                    continue
                nxt = ""
                for lookahead in blocks[index + 1 :]:
                    if not lookahead.skip and lookahead.text.strip():
                        nxt = lookahead.text
                        break
                result = engine.rewrite_block(
                    block, prev_text=prev_text, next_text=nxt, section_heading=heading
                )
                if result.terms:
                    memory.merge(result.terms)
                    engine.glossary = memory.load()
                    engine.system_prompt = prompts_service.build_system_prompt(
                        style=engine.style, strength=engine.strength, language=engine.language,
                        glossary=engine.glossary, custom=engine.custom, document_type=engine.document_type,
                    )
                if result.tokens_in or result.tokens_out:
                    page_ti += result.tokens_in
                    page_to += result.tokens_out
                if result.flagged:
                    page_flagged += 1
                prev_text = block.new_text or block.text

            row.blocks = blocks_to_dicts(blocks)
            row.status = "rewritten"
            row.notes = {
                **(row.notes or {}),
                "rewritten": sum(1 for b in blocks if b.new_text and b.new_text != b.text),
                "flagged": sum(1 for b in blocks if b.flag),
            }

            done_count += 1
            elapsed = max(time.time() - started, 0.001)
            eta = int(elapsed / done_count * max(0, total_pages - done_count))
            await db.execute(
                text(
                    "UPDATE jobs SET processed_pages = :done, current_section = :section, "
                    "tokens_in = tokens_in + :ti, tokens_out = tokens_out + :to, "
                    "cost_usd = cost_usd + :cost, flagged_blocks = flagged_blocks + :fb WHERE id = :id"
                ),
                {
                    "done": done_count,
                    "section": heading[:250],
                    "ti": page_ti,
                    "to": page_to,
                    "cost": (page_ti + page_to) / 1_000_000 * settings.price_per_1m_tokens,
                    "fb": page_flagged,
                    "id": str(job_id),
                },
            )
            await db.commit()
            publish(
                job_id,
                {
                    "type": "progress",
                    "stage": "rewriting",
                    "page": done_count,
                    "total": total_pages,
                    "current_page": number,
                    "section": heading[:120],
                    "eta_seconds": eta,
                },
            )


# ============================================================ finalize
@celery_app.task(name="app.workers.tasks.finalize_job", bind=True, max_retries=2, default_retry_delay=30)
def finalize_job(self, results, job_id: str) -> None:  # noqa: ANN001
    try:
        asyncio.run(_finalize_job(job_id))
    except Exception as exc:
        log.exception("finalize failed")
        if self.request.retries < 2:
            raise self.retry(exc=exc) from exc
        asyncio.run(_fail(job_id, f"Rebuild failed: {exc}"))


async def _finalize_job(job_id: str) -> None:
    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job:
            return
        rows = await db.scalars(
            select(JobPage).where(JobPage.job_id == job_id).order_by(JobPage.page_number)
        )
        pages = [blocks_from_dicts(r.blocks) for r in rows]
        options = dict(job.options or {})
        source_key = job.source_key
        source_filename = job.source_filename
        source_mime = job.source_mime
        user_id = job.user_id
        file_kind = job.file_kind
        analysis = dict(job.analysis or {})
        total_pages = job.total_pages
        total_words = job.total_words
        tokens_total = int(job.tokens_in + job.tokens_out)
        job.status = "rebuilding"
        await db.commit()
        publish(job_id, {"type": "progress", "stage": "rebuilding", "message": "Rebuilding your document"})

    tmpdir = Path(tempfile.mkdtemp(dir=settings.tmp_dir))
    src = tmpdir / "source"
    download_to(source_key, str(src))

    memory = TerminologyMemory(redis_sync, str(job_id), {})
    engine = (
        RewriteEngine(
            style=options.get("style", "professional"),
            strength=options.get("strength", "medium"),
            language=options.get("language", "auto"),
            custom=options.get("custom_instructions", ""),
            document_type=file_kind,
            glossary=memory.load(),
        )
    )

    suffix = {"pdf": ".pdf", "docx": ".docx", "doc": ".doc", "pptx": ".pptx", "txt": ".txt", "md": ".md"}[file_kind]
    dst = tmpdir / f"output{suffix}"

    rebuild_info: dict[str, Any] = {}
    if file_kind == "pdf":
        report = rebuild_pdf.rebuild_pdf(
            str(src), str(dst), pages, shorter=(engine.shorten if engine else None)
        )
        rebuild_info = {
            "overflow_fixes": report.overflow_fixes,
            "fonts_reused": report.fonts_reused,
            "fonts_substituted": report.fonts_substituted,
            "rewritten_blocks": report.rewritten_blocks,
        }
    elif file_kind == "docx":
        rebuild_info = rebuild_docx.rebuild_docx(str(src), str(dst), pages)
    elif file_kind == "doc":
        rebuild_info = rebuild_docx.rebuild_doc(str(src), str(dst), pages)
    elif file_kind == "pptx":
        rebuild_info = rebuild_pptx.rebuild_pptx(str(src), str(dst), pages)
    else:
        rebuild_info = rebuild_text.rebuild_text(str(src), str(dst), pages)

    publish(job_id, {"type": "progress", "stage": "verifying", "message": "Checking layout integrity"})
    verification = verify_service.verify_document(str(src), str(dst), file_kind)

    output_name = f"{Path(source_filename).stem}.humanized{suffix}"
    output_key = f"output/{user_id}/{job_id}/{output_name}"
    out_mime = MIME_BY_KIND.get(file_kind, source_mime)
    put_bytes(output_key, dst.read_bytes(), out_mime)

    qa_key = f"qa/{user_id}/{job_id}/qa-report.json"
    qa_payload = build_report(job, [blocks_to_dicts(p) for p in pages], rebuild_info, verification, analysis)
    put_bytes(qa_key, json.dumps(qa_payload, indent=2, default=str).encode(), "application/json")

    async with worker_session_scope() as db:
        job = await db.get(Job, job_id)
        if not job:
            return
        job.output_key = output_key
        job.qa_key = qa_key
        job.finished_at = _now()
        job.expires_at = _now() + dt.timedelta(hours=settings.retention_hours)
        job.processed_pages = total_pages
        job.status = "done"
        job.rewritten_blocks = int(
            await db.scalar(
                text("SELECT coalesce(sum((notes->>'rewritten')::int), 0) FROM job_pages WHERE job_id = :id"),
                {"id": job_id},
            )
            or 0
        )
        await usage_service.record_usage(
            db, user_id, total_pages, total_words, tokens_total
        )
        await db.commit()
        apply_retention_tag(output_key, job.expires_at)
        publish(job_id, {"type": "status", "status": "done"})
        publish(
            job_id,
            {
                "type": "done",
                "output_key": output_key,
                "qa_key": qa_key,
                "verification": verification,
                "summary": qa_payload.get("summary", {}),
            },
        )
        if (job.options or {}).get("notify_on_complete"):
            owner = await db.get(User, job.user_id)
            if owner and owner.email:
                _send_completion_email(
                    to_email=owner.email,
                    user_name=owner.name or "there",
                    filename=job.source_filename,
                    job_id=job_id,
                    total_pages=total_pages,
                    rewritten_blocks=job.rewritten_blocks or 0,
                )


def _send_completion_email(
    *,
    to_email: str,
    user_name: str,
    filename: str,
    job_id: str,
    total_pages: int,
    rewritten_blocks: int,
) -> None:
    import os
    import smtplib
    from email.message import EmailMessage

    app_url = (settings.app_url or os.environ.get("APP_URL") or "https://humandoc.vercel.app").rstrip("/")
    job_url = f"{app_url}/jobs/{job_id}"
    subject = f'HumanDoc — "{filename}" is ready to download'
    body_text = (
        f"Hi {user_name},\n\n"
        f'Your document "{filename}" ({total_pages} pages, {rewritten_blocks} blocks rewritten) has finished processing.\n\n'
        f"Open & download your file here:\n{job_url}\n\n"
        f"Thank you,\nHumanDoc Team"
    )
    body_html = (
        f"<p>Hi {user_name},</p>"
        f'<p>Your document <strong>{filename}</strong> ({total_pages} pages, {rewritten_blocks} blocks rewritten) '
        f"has finished processing and is ready to download.</p>"
        f'<p style="margin:20px 0"><a href="{job_url}" '
        f'style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;'
        f'display:inline-block;font-weight:600">Open &amp; Download Document</a></p>'
        f'<p style="font-size:12px;color:#6b7280">Or open: {job_url}</p>'
    )

    smtp_user = settings.smtp_user or os.environ.get("SMTP_USER", "")
    smtp_pass = (
        settings.smtp_password
        or settings.gmail_app_password
        or os.environ.get("SMTP_PASSWORD")
        or os.environ.get("GMAIL_APP_PASSWORD")
        or ""
    ).replace(" ", "")

    if smtp_user and smtp_pass:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = f"HumanDoc <{smtp_user}>"
            msg["To"] = to_email
            msg.set_content(body_text)
            msg.add_alternative(body_html, subtype="html")
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            return
        except Exception as exc:
            log.warning("completion SMTP email failed for job=%s: %s", job_id, exc)

    resend_key = settings.resend_api_key or os.environ.get("RESEND_API_KEY", "")
    if resend_key:
        try:
            import httpx

            httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {resend_key}", "Content-Type": "application/json"},
                json={"from": settings.email_from, "to": [to_email], "subject": subject, "html": body_html, "text": body_text},
                timeout=15,
            )
        except Exception as exc:
            log.warning("completion Resend email failed for job=%s: %s", job_id, exc)


async def _fail(job_id: str, message: str) -> None:
    try:
        async with worker_session_scope() as db:
            await _set_status(db, job_id, "failed", error=message[:4000], finished_at=_now())
            publish(job_id, {"type": "error", "message": message[:400]})
    except Exception:
        log.exception("could not mark job failed")


# ============================================================ maintenance
@celery_app.task(name="app.workers.tasks.sweep_stale_jobs")
def sweep_stale_jobs() -> int:
    """Jobs stuck in rewriting/rebuilding for > 30 minutes are resumable, never restarted from zero."""
    count = asyncio.run(_sweep())
    return count


async def _sweep() -> int:
    cutoff = _now() - dt.timedelta(minutes=30)
    async with worker_session_scope() as db:
        rows = await db.scalars(
            select(Job).where(
                Job.status.in_(("rewriting", "rebuilding", "verifying", "queued")),
                Job.updated_at < cutoff,
            )
        )
        stale = list(rows)
        for job in stale:
            job.status = "failed"
            job.error = "Worker stopped responding. Use Resume to continue from the last checkpoint."
        await db.commit()
    for job in stale:
        publish(str(job.id), {"type": "error", "message": "stale"})
    return len(stale)


@celery_app.task(name="app.workers.tasks.purge_expired_files")
def purge_expired_files() -> int:
    return asyncio.run(_purge())


async def _purge() -> int:
    removed = 0
    cutoff = _now()
    async with worker_session_scope() as db:
        rows = await db.scalars(select(Job).where(Job.expires_at.isnot(None), Job.expires_at < cutoff))
        for job in rows:
            for key in (job.source_key, job.output_key, job.qa_key):
                if key:
                    delete(key)
                    removed += 1
            job.output_key = None
            job.qa_key = None

        # Purge expired uploads (older than 24 hours)
        uploads = await db.scalars(select(Upload).where(Upload.expires_at < cutoff))
        for up in uploads:
            if up.key:
                delete(up.key)
                removed += 1
            await db.delete(up)

        # Purge stored_files in database older than 24 hours
        try:
            await db.execute(text("DELETE FROM stored_files WHERE created_at < NOW() - INTERVAL '24 hours'"))
        except Exception:
            pass

        await db.commit()
    return removed
