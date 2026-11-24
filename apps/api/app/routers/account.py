"""Self-service account deletion: removes every object in S3, then the user row (cascades)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth_deps import CurrentUser, DbSession, require_csrf
from app.core.security import audit_meta
from app.core.storage import delete, delete_prefix
from app.models import AuditLog, Job

router = APIRouter(prefix="/account", tags=["account"], dependencies=[Depends(require_csrf)])


@router.delete("")
async def delete_account(user: CurrentUser, db: DbSession) -> dict:
    removed_jobs = 0
    removed_objects = 0
    jobs = list(await db.scalars(Job.__table__.select().where(Job.__table__.c.user_id == user.id)))
    for job in jobs:
        for key in (job.source_key, job.output_key, job.qa_key):
            if key:
                delete(key)
                removed_objects += 1
        await db.delete(job)
        removed_jobs += 1

    removed_objects += delete_prefix(f"uploads/{user.id}/")

    db.add(
        AuditLog(
            user_id=user.id,
            action="account.deleted",
            meta=audit_meta(jobs=removed_jobs, objects=removed_objects),
        )
    )
    await db.commit()

    await db.delete(user)
    await db.commit()
    return {"deleted": True, "jobs_removed": removed_jobs, "objects_removed": removed_objects}
