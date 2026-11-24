from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "humandoc",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_default_queue="humandoc",
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    task_publish_retry=True,
    task_publish_retry_policy={"max_retries": 3, "interval_start": 5},
    result_expires=86400,
    broker_connection_retry_on_startup=True,
    worker_max_tasks_per_child=50,
    beat_schedule={
        "sweep-stale-jobs": {
            "task": "app.workers.tasks.sweep_stale_jobs",
            "schedule": 300.0,
        },
        "purge-expired": {
            "task": "app.workers.tasks.purge_expired_files",
            "schedule": 3600.0,
        },
    },
)
