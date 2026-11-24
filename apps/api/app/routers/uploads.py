"""Resumable multipart uploads to S3-compatible object storage."""
from __future__ import annotations

import asyncio
import datetime as dt
import hmac
import math
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from app.auth_deps import CurrentUser, DbSession, parse_uuid, require_csrf
from app.core.config import settings
from app.core.security import clamav_scan
from app.core.storage import (
    abort_multipart,
    complete_multipart,
    create_multipart,
    delete,
    get_bytes,
    head,
    presign_part,
    safe_key_part,
    upload_part_bytes,
)
from app.models import Job, Upload
from app.schemas import UploadCompleteRequest, UploadInitRequest

router = APIRouter(prefix="/uploads", tags=["uploads"], dependencies=[Depends(require_csrf)])
part_router = APIRouter(prefix="/uploads", tags=["uploads"])


def _part_sig(upload_id: str, part_number: int) -> str:
    msg = f"{upload_id}:{part_number}".encode()
    return hmac.new(settings.session_secret.encode(), msg, "sha256").hexdigest()


@router.post("/init")
async def init_upload(payload: UploadInitRequest, user: CurrentUser, db: DbSession) -> dict:
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if payload.size > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File is {payload.size / 1048576:.1f} MB; the limit is {settings.max_upload_mb} MB",
        )
    filename = payload.filename.replace("\\", "/").split("/")[-1]
    if not filename or filename.startswith("."):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid filename")

    upload = Upload(
        user_id=user.id,
        key=f"uploads/{user.id}/{uuid.uuid4()}/{safe_key_part(filename)}",
        filename=filename,
        size=payload.size,
        mime=payload.content_type or "application/octet-stream",
        status="uploading",
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(days=1),
    )
    db.add(upload)
    await db.flush()

    part_size = settings.upload_part_mb * 1024 * 1024
    total_parts = max(1, math.ceil(payload.size / part_size))
    upload.s3_upload_id = create_multipart(upload.key, payload.content_type)

    use_proxy_parts = getattr(settings, "s3_public_url", "").startswith("/")
    if use_proxy_parts:
        urls = [
            f"/backend/uploads/{upload.id}/parts/{n}?sig={_part_sig(str(upload.id), n)}"
            for n in range(1, total_parts + 1)
        ]
    else:
        urls = [presign_part(upload.key, upload.s3_upload_id, n) for n in range(1, total_parts + 1)]

    upload.parts = [{"part_number": n, "url": u} for n, u in enumerate(urls, start=1)]
    await db.commit()

    return {
        "upload_id": str(upload.id),
        "key": upload.key,
        "part_size": part_size,
        "total_parts": total_parts,
        "part_urls": urls,
        "expires_in": settings.s3_presign_expires,
    }


@part_router.put("/{upload_id}/parts/{part_number}")
async def put_upload_part(
    upload_id: str,
    part_number: int,
    request: Request,
    db: DbSession,
    sig: str = Query(...),
) -> Response:
    expected = _part_sig(upload_id, part_number)
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid part signature")

    upload = await db.scalar(select(Upload).where(Upload.id == parse_uuid(upload_id)))
    if not upload or not upload.s3_upload_id or upload.status != "uploading":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Active upload not found")

    data = await request.body()
    loop = asyncio.get_running_loop()
    etag = await loop.run_in_executor(
        None, upload_part_bytes, upload.key, upload.s3_upload_id, part_number, data
    )
    clean_etag = etag.strip('"')
    return Response(
        status_code=status.HTTP_200_OK,
        headers={"ETag": f'"{clean_etag}"', "Access-Control-Expose-Headers": "ETag"},
    )


@part_router.get("/download")
async def download_file(key: str, download_name: str | None = None) -> Response:
    import mimetypes

    from fastapi.responses import FileResponse

    from app.core.storage import _local_path, _sync_engine, get_bytes

    p = _local_path(key)
    if p.exists():
        headers = {}
        if download_name:
            headers["Content-Disposition"] = f'attachment; filename="{download_name}"'
        return FileResponse(p, filename=download_name, headers=headers)

    try:
        from sqlalchemy import text
        eng = _sync_engine()
        with eng.connect() as conn:
            r = conn.execute(
                text("SELECT content, content_type FROM stored_files WHERE key = :key"),
                {"key": key},
            ).first()
            if r and r[0]:
                content = bytes(r[0])
                media_type = r[1] or mimetypes.guess_type(download_name or key)[0] or "application/octet-stream"
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(content)
                except Exception:
                    pass
                headers = {}
                if download_name:
                    headers["Content-Disposition"] = f'attachment; filename="{download_name}"'
                return Response(content=content, media_type=media_type, headers=headers)
    except Exception:
        pass

    try:
        content = get_bytes(key)
        headers = {}
        if download_name:
            headers["Content-Disposition"] = f'attachment; filename="{download_name}"'
        mime = mimetypes.guess_type(download_name or key)[0] or "application/octet-stream"
        return Response(content=content, media_type=mime, headers=headers)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None


@router.post("/{upload_id}/complete")
async def complete_upload(upload_id: str, payload: UploadCompleteRequest, user: CurrentUser, db: DbSession) -> dict:
    upload = await db.scalar(select(Upload).where(Upload.id == parse_uuid(upload_id), Upload.user_id == user.id))
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    if upload.status == "completed":
        return {"upload_id": str(upload.id), "status": "completed", "key": upload.key, "size": upload.size}
    if not upload.s3_upload_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload was not initialised")

    try:
        result = complete_multipart(
            upload.key,
            upload.s3_upload_id,
            [{"part_number": p.part_number, "etag": p.etag} for p in payload.parts],
        )
    except Exception as exc:
        abort_multipart(upload.key, upload.s3_upload_id)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not finalise upload: {exc}") from exc

    meta = head(upload.key)
    if meta["ContentLength"] != upload.size:
        delete(upload.key)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded size does not match the declared size")

    if settings.virus_scan_enabled:
        loop = asyncio.get_running_loop()
        body = await loop.run_in_executor(None, get_bytes, upload.key)
        clean, signature = await loop.run_in_executor(None, clamav_scan, body)
        if not clean:
            delete(upload.key)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"File failed virus scan: {signature}")

    upload.status = "completed"
    upload.etag = result.get("etag")
    upload.completed_at = dt.datetime.now(dt.UTC)
    await db.commit()
    return {"upload_id": str(upload.id), "status": "completed", "key": upload.key, "size": meta["ContentLength"]}


@router.get("/{upload_id}")
async def get_upload(upload_id: str, user: CurrentUser, db: DbSession) -> dict:
    upload = await db.scalar(select(Upload).where(Upload.id == parse_uuid(upload_id), Upload.user_id == user.id))
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    jobs = await db.scalar(select(Job).where(Job.source_key == upload.key))
    return {
        "upload_id": str(upload.id),
        "filename": upload.filename,
        "size": upload.size,
        "status": upload.status,
        "job_id": str(jobs.id) if jobs else None,
    }


@router.delete("/{upload_id}")
async def discard_upload(upload_id: str, user: CurrentUser, db: DbSession) -> dict:
    upload = await db.scalar(select(Upload).where(Upload.id == parse_uuid(upload_id), Upload.user_id == user.id))
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    if upload.status != "completed" and upload.s3_upload_id:
        abort_multipart(upload.key, upload.s3_upload_id)
    else:
        delete(upload.key)
    await db.delete(upload)
    await db.commit()
    return {"deleted": True}
