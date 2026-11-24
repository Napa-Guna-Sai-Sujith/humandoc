from __future__ import annotations

import datetime as dt
import os
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text

from app.auth_deps import AdminUser, DbSession, parse_uuid, require_csrf
from app.core.config import settings
from app.core.security import hash_password
from app.core.storage import delete, delete_prefix
from app.models import AuditLog, Job, JobPage, Subscription, UsageRecord, User
from app.routers.jobs import job_to_dict
from app.services import usage as usage_service
from app.workers.tasks import start_job

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_csrf)])


@router.get("/stats")
async def stats(db: DbSession, _admin: AdminUser) -> dict:
    users = await db.scalar(select(func.count(User.id)))
    jobs = await db.scalar(select(func.count(Job.id)))
    done = await db.scalar(select(func.count(Job.id)).where(Job.status == "done"))
    pages = await db.scalar(select(func.coalesce(func.sum(Job.total_pages), 0)))
    tokens = await db.scalar(select(func.coalesce(func.sum(Job.tokens_in + Job.tokens_out), 0)))
    return {
        "users": int(users or 0),
        "jobs": int(jobs or 0),
        "jobs_done": int(done or 0),
        "pages_processed": int(pages or 0),
        "tokens_processed": int(tokens or 0),
    }


@router.get("/users")
async def users(db: DbSession, _admin: AdminUser, limit: int = 100, offset: int = 0) -> dict:
    rows = await db.scalars(
        select(User).order_by(User.created_at.desc()).limit(min(limit, 200)).offset(max(offset, 0))
    )
    out = []
    for user in rows:
        used = await usage_service.pages_used(db, user.id)
        sub = await db.scalar(select(Subscription).where(Subscription.user_id == user.id))
        tier = sub.tier if sub else "free"
        pages_per_month = sub.pages_per_month if sub else settings.tier_free_pages
        out.append(
            {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "verified": user.email_verified_at is not None,
                "tier": tier,
                "pages_used": used,
                "pages_per_month": pages_per_month,
                "pages_remaining": max(0, pages_per_month - used),
                "sub_status": sub.status if sub else "active",
                "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
                "created_at": user.created_at,
            }
        )
    return {"users": out}


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, payload: dict, db: DbSession, admin: AdminUser) -> dict:
    user = await db.get(User, parse_uuid(user_id))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    if "role" in payload and payload["role"] in ("user", "admin"):
        user.role = payload["role"]
    if "name" in payload and payload["name"]:
        user.name = str(payload["name"])[:200]
    if "email" in payload and payload["email"]:
        new_email = str(payload["email"]).strip().lower()
        if new_email != user.email:
            existing = await db.scalar(select(User).where(func.lower(User.email) == new_email, User.id != user.id))
            if existing:
                raise HTTPException(status.HTTP_409_CONFLICT, "Email is already taken by another account")
            user.email = new_email
    if "verified" in payload:
        if payload["verified"]:
            user.email_verified_at = dt.datetime.now(dt.UTC) if not user.email_verified_at else user.email_verified_at
        else:
            user.email_verified_at = None
    if "password" in payload and payload["password"]:
        raw_pw = str(payload["password"])
        if len(raw_pw) < 8:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters")
        user.password_hash = hash_password(raw_pw)

    db.add(AuditLog(user_id=admin.id, action="admin.user_updated", meta={"target": str(user.id), "fields": list(payload.keys())}))
    await db.commit()
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "verified": user.email_verified_at is not None,
    }


@router.post("/users/{user_id}/plan")
async def assign_user_plan(user_id: str, payload: dict, db: DbSession, admin: AdminUser) -> dict:
    """Admin endpoint to add, change, or customize user plans/quotas."""
    user = await db.get(User, parse_uuid(user_id))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    tier = str(payload.get("tier", "starter")).lower()
    tier_pages_map = {
        "free": settings.tier_free_pages,
        "starter": settings.tier_starter_pages,
        "pro": settings.tier_pro_pages,
        "studio": settings.tier_studio_pages,
        "enterprise": 10000,
    }

    # Allow custom pages override
    pages_per_month = int(payload.get("pages_per_month") or tier_pages_map.get(tier, 500))
    sub_status = str(payload.get("status", "active")).lower()

    sub = await db.scalar(select(Subscription).where(Subscription.user_id == user.id))
    if not sub:
        sub = Subscription(
            user_id=user.id,
            tier=tier,
            status=sub_status,
            pages_per_month=pages_per_month,
            current_period_end=dt.datetime.now(dt.UTC) + dt.timedelta(days=30),
        )
        db.add(sub)
    else:
        sub.tier = tier
        sub.status = sub_status
        sub.pages_per_month = pages_per_month
        sub.current_period_end = dt.datetime.now(dt.UTC) + dt.timedelta(days=30)

    # Reset usage if requested
    if payload.get("reset_usage"):
        period = usage_service.current_period()
        await db.execute(
            text("DELETE FROM usage_records WHERE user_id = :uid AND period = :period"),
            {"uid": str(user.id), "period": period},
        )

    db.add(
        AuditLog(
            user_id=admin.id,
            action="admin.plan_assigned",
            meta={"target": str(user.id), "tier": tier, "pages": pages_per_month},
        )
    )
    await db.commit()
    await db.refresh(sub)
    used = await usage_service.pages_used(db, user.id)
    return {
        "user_id": str(user.id),
        "tier": sub.tier,
        "pages_per_month": sub.pages_per_month,
        "pages_used": used,
        "pages_remaining": max(0, sub.pages_per_month - used),
        "status": sub.status,
    }


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, db: DbSession, admin: AdminUser) -> dict:
    user = await db.get(User, parse_uuid(user_id))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account here")

    jobs = list(await db.scalars(select(Job).where(Job.user_id == user.id)))
    for job in jobs:
        for key in (job.source_key, job.output_key, job.qa_key):
            if key:
                delete(key)
        await db.execute(text("DELETE FROM job_pages WHERE job_id = :id"), {"id": str(job.id)})
        await db.delete(job)

    delete_prefix(f"uploads/{user.id}/")
    delete_prefix(f"output/{user.id}/")
    delete_prefix(f"qa/{user.id}/")

    await db.delete(user)
    db.add(AuditLog(user_id=admin.id, action="admin.user_deleted", meta={"target": str(user.id)}))
    await db.commit()
    return {"deleted": True, "jobs_removed": len(jobs)}


@router.get("/jobs")
async def jobs(db: DbSession, _admin: AdminUser, limit: int = 100, offset: int = 0) -> dict:
    rows = await db.scalars(
        select(Job).order_by(Job.created_at.desc()).limit(min(limit, 200)).offset(max(offset, 0))
    )
    jobs_list = []
    for j in rows:
        owner = await db.get(User, j.user_id)
        d = job_to_dict(j)
        d["user_id"] = str(j.user_id)
        d["user_email"] = owner.email if owner else "Unknown"
        d["user_name"] = owner.name if owner else "Unknown"
        jobs_list.append(d)
    return {"jobs": jobs_list}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, db: DbSession, admin: AdminUser) -> dict:
    """Admin endpoint to delete any job and purge its storage files."""
    job = await db.get(Job, parse_uuid(job_id))
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")

    for key in (job.source_key, job.output_key, job.qa_key):
        if key:
            delete(key)

    await db.execute(text("DELETE FROM job_pages WHERE job_id = :id"), {"id": str(job.id)})
    await db.delete(job)
    db.add(AuditLog(user_id=admin.id, action="admin.job_deleted", meta={"job_id": str(job.id)}))
    await db.commit()
    return {"deleted": True, "job_id": str(job_id)}


@router.post("/jobs/{job_id}/restart")
async def restart_job(job_id: str, db: DbSession, admin: AdminUser) -> dict:
    """Admin endpoint to re-run or restart any job."""
    job = await db.get(Job, parse_uuid(job_id))
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")

    job.status = "queued"
    job.error = None
    db.add(AuditLog(user_id=admin.id, action="admin.job_restarted", meta={"job_id": str(job.id)}))
    await db.commit()
    start_job.delay(str(job.id))
    return {"restarted": True, "job_id": str(job.id), "status": "queued"}


@router.get("/audit")
async def audit(db: DbSession, _admin: AdminUser, limit: int = 100) -> dict:
    rows = await db.scalars(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 500))
    )
    return {
        "logs": [
            {
                "id": str(a.id),
                "user_id": str(a.user_id) if a.user_id else None,
                "action": a.action,
                "meta": a.meta,
                "ip": a.ip,
                "created_at": a.created_at,
            }
            for a in rows
        ]
    }


@router.get("/settings")
async def get_settings(_admin: AdminUser) -> dict:
    return {
        "llm_provider": settings.llm_provider,
        "gemini_api_key_set": bool(settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")),
        "gemini_model": settings.gemini_model,
        "anthropic_api_key_set": bool(settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")),
        "anthropic_model": settings.anthropic_model,
        "openai_api_key_set": bool(settings.openai_api_key or os.environ.get("OPENAI_API_KEY")),
        "openai_model": settings.openai_model,
        "tier_free_pages": settings.tier_free_pages,
        "tier_starter_pages": settings.tier_starter_pages,
        "tier_pro_pages": settings.tier_pro_pages,
        "tier_studio_pages": settings.tier_studio_pages,
    }


@router.post("/settings")
async def update_settings(payload: dict, admin: AdminUser, db: DbSession) -> dict:
    if "gemini_api_key" in payload:
        settings.gemini_api_key = str(payload["gemini_api_key"]).strip()
    if "anthropic_api_key" in payload:
        settings.anthropic_api_key = str(payload["anthropic_api_key"]).strip()
    if "openai_api_key" in payload:
        settings.openai_api_key = str(payload["openai_api_key"]).strip()
    if "llm_provider" in payload:
        settings.llm_provider = str(payload["llm_provider"]).strip()

    db.add(AuditLog(user_id=admin.id, action="admin.settings_updated", meta={"keys": list(payload.keys())}))
    await db.commit()
    return {"updated": True}
