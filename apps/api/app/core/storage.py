"""S3-compatible storage: presigned URLs, multipart upload, lifecycle cleanup."""
from __future__ import annotations

import datetime as dt
import hashlib
import mimetypes
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

_STORAGE_DIR = settings.tmp_dir / "storage"
_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
_PARTS_DIR = settings.tmp_dir / "upload_parts"
_PARTS_DIR.mkdir(parents=True, exist_ok=True)


def _local_path(key: str) -> Path:
    safe = key.replace("/", os.sep).replace("\\", os.sep)
    p = _STORAGE_DIR / safe
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint_url,
    aws_access_key_id=settings.s3_access_key_id,
    aws_secret_access_key=settings.s3_secret_access_key,
    region_name=settings.s3_region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path" if settings.s3_force_path_style else "virtual"}),
)


def safe_key_part(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return cleaned[:120] or "file"


def build_key(user_id: str, job_id: str, filename: str, kind: str = "source") -> str:
    stamp = dt.datetime.now(dt.UTC).strftime("%Y/%m/%d")
    return f"{kind}/{stamp}/{user_id}/{job_id}/{safe_key_part(filename)}"


def _public_s3_url(url: str) -> str:
    pub = getattr(settings, "s3_public_url", "").rstrip("/")
    base = settings.s3_endpoint_url.rstrip("/")
    if pub and url.startswith(base):
        return pub + url[len(base):]
    return url


def _guess_type(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def presign_put(key: str, content_type: str | None = None, expires: int | None = None) -> str:
    try:
        params: dict[str, Any] = {"Bucket": settings.s3_bucket, "Key": key}
        if content_type:
            params["ContentType"] = content_type
        return _public_s3_url(_s3.generate_presigned_url(
            "put_object", Params=params, ExpiresIn=expires or settings.s3_presign_expires
        ))
    except Exception:
        return f"/backend/uploads/download?key={quote(key)}"


def presign_get(key: str, expires: int = 300, download_name: str | None = None) -> str:
    if getattr(settings, "s3_public_url", "").startswith("/"):
        name_param = f"&download_name={quote(download_name)}" if download_name else ""
        return f"/backend/uploads/download?key={quote(key)}{name_param}"
    try:
        params: dict[str, Any] = {"Bucket": settings.s3_bucket, "Key": key}
        if download_name:
            params["ResponseContentDisposition"] = f"attachment; filename*=UTF-8''{quote(download_name)}"
        return _public_s3_url(_s3.generate_presigned_url("get_object", Params=params, ExpiresIn=expires))
    except Exception:
        name_param = f"&download_name={quote(download_name)}" if download_name else ""
        return f"/backend/uploads/download?key={quote(key)}{name_param}"


def create_multipart(key: str, content_type: str | None = None) -> str:
    try:
        args: dict[str, Any] = {
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ServerSideEncryption": "AES256",
        }
        if content_type:
            args["ContentType"] = content_type
        return _s3.create_multipart_upload(**args)["UploadId"]
    except Exception:
        upload_id = f"local-{uuid.uuid4()}"
        part_dir = _PARTS_DIR / upload_id
        part_dir.mkdir(parents=True, exist_ok=True)
        return upload_id


def presign_part(key: str, upload_id: str, part_number: int) -> str:
    if upload_id.startswith("local-"):
        return f"/backend/uploads/{upload_id}/parts/{part_number}"
    try:
        return _public_s3_url(_s3.generate_presigned_url(
            "upload_part",
            Params={"Bucket": settings.s3_bucket, "Key": key, "UploadId": upload_id, "PartNumber": part_number},
            ExpiresIn=settings.s3_presign_expires,
        ))
    except Exception:
        return f"/backend/uploads/{upload_id}/parts/{part_number}"


def upload_part_bytes(key: str, upload_id: str, part_number: int, data: bytes) -> str:
    if upload_id.startswith("local-"):
        part_dir = _PARTS_DIR / upload_id
        part_dir.mkdir(parents=True, exist_ok=True)
        part_file = part_dir / f"part_{part_number}"
        part_file.write_bytes(data)
        etag = hashlib.md5(data).hexdigest()
        return f'"{etag}"'
    try:
        resp = _s3.upload_part(
            Bucket=settings.s3_bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=int(part_number),
            Body=data,
        )
        return str(resp.get("ETag", ""))
    except Exception:
        part_dir = _PARTS_DIR / upload_id
        part_dir.mkdir(parents=True, exist_ok=True)
        part_file = part_dir / f"part_{part_number}"
        part_file.write_bytes(data)
        etag = hashlib.md5(data).hexdigest()
        return f'"{etag}"'


def complete_multipart(key: str, upload_id: str, parts: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(parts, key=lambda p: int(p["part_number"]))
    if upload_id.startswith("local-"):
        dest_file = _local_path(key)
        hasher = hashlib.md5()
        with open(dest_file, "wb") as out:
            for p in ordered:
                p_file = _PARTS_DIR / upload_id / f"part_{p['part_number']}"
                if p_file.exists():
                    chunk = p_file.read_bytes()
                    out.write(chunk)
                    hasher.update(chunk)
        shutil.rmtree(_PARTS_DIR / upload_id, ignore_errors=True)
        return {"key": key, "etag": f'"{hasher.hexdigest()}"'}

    try:
        response = _s3.complete_multipart_upload(
            Bucket=settings.s3_bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": [{"PartNumber": int(p["part_number"]), "ETag": f'"{str(p["etag"]).strip(chr(34))}"'} for p in ordered]},
        )
        return {"key": response.get("Key", key), "etag": response.get("ETag")}
    except Exception:
        dest_file = _local_path(key)
        hasher = hashlib.md5()
        with open(dest_file, "wb") as out:
            for p in ordered:
                p_file = _PARTS_DIR / upload_id / f"part_{p['part_number']}"
                if p_file.exists():
                    chunk = p_file.read_bytes()
                    out.write(chunk)
                    hasher.update(chunk)
        shutil.rmtree(_PARTS_DIR / upload_id, ignore_errors=True)
        return {"key": key, "etag": f'"{hasher.hexdigest()}"'}


def abort_multipart(key: str, upload_id: str) -> None:
    if upload_id.startswith("local-"):
        shutil.rmtree(_PARTS_DIR / upload_id, ignore_errors=True)
        return
    try:
        _s3.abort_multipart_upload(Bucket=settings.s3_bucket, Key=key, UploadId=upload_id)
    except Exception:
        shutil.rmtree(_PARTS_DIR / upload_id, ignore_errors=True)


def head(key: str) -> dict[str, Any]:
    dest = _local_path(key)
    if dest.exists():
        return {"ContentLength": dest.stat().st_size, "ETag": f'"{dest.stat().st_mtime}"'}
    try:
        return _s3.head_object(Bucket=settings.s3_bucket, Key=key)
    except Exception:
        if dest.exists():
            return {"ContentLength": dest.stat().st_size, "ETag": f'"{dest.stat().st_mtime}"'}
        raise


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    dest = _local_path(key)
    dest.write_bytes(data)
    try:
        _s3.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
    except Exception:
        pass


def get_bytes(key: str) -> bytes:
    dest = _local_path(key)
    if dest.exists():
        return dest.read_bytes()
    try:
        return _s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
    except Exception:
        if dest.exists():
            return dest.read_bytes()
        raise


def delete(key: str) -> None:
    dest = _local_path(key)
    dest.unlink(missing_ok=True)
    try:
        _s3.delete_object(Bucket=settings.s3_bucket, Key=key)
    except Exception:
        pass


def delete_prefix(prefix: str) -> int:
    count = 0
    safe_prefix = prefix.replace("/", os.sep).replace("\\", os.sep)
    target_dir = _STORAGE_DIR / safe_prefix
    if target_dir.exists():
        for f in target_dir.rglob("*"):
            if f.is_file():
                f.unlink(missing_ok=True)
                count += 1
    try:
        paginator = _s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            objects = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objects:
                _s3.delete_objects(Bucket=settings.s3_bucket, Delete={"Objects": objects, "Quiet": True})
                count += len(objects)
    except Exception:
        pass
    return count


def download_to(key: str, dest: str, chunk_size: int = 1024 * 1024) -> int:
    dest_path = _local_path(key)
    if dest_path.exists():
        shutil.copyfile(dest_path, dest)
        return dest_path.stat().st_size
    try:
        response = _s3.get_object(Bucket=settings.s3_bucket, Key=key)
        written = 0
        with open(dest, "wb") as fh:
            for chunk in response["Body"].iter_chunks(chunk_size):
                fh.write(chunk)
                written += len(chunk)
        return written
    except Exception:
        if dest_path.exists():
            shutil.copyfile(dest_path, dest)
            return dest_path.stat().st_size
        raise


def apply_retention_tag(key: str, delete_at: dt.datetime) -> None:
    try:
        _s3.put_object_tagging(
            Bucket=settings.s3_bucket,
            Key=key,
            Tagging={"TagSet": [{"Key": "delete-at", "Value": delete_at.isoformat()}]},
        )
    except Exception:
        pass
