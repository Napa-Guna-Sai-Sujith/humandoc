from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class JobOptions(BaseModel):
    style: Literal["academic", "ieee", "professional", "casual", "creative"] = "professional"
    strength: Literal["light", "medium", "strong"] = "medium"
    tone: int = Field(default=50, ge=0, le=100, description="0 casual → 100 formal")
    language: str = "auto"
    keep_original_language: bool = True
    page_range: str = "all"
    protected_terms: list[str] = Field(default_factory=list, max_length=200)
    locked_blocks: list[str] = Field(default_factory=list, max_length=2000)
    skip: dict[str, bool] = Field(
        default_factory=lambda: {"references": True, "tables": True, "headers_footers": True, "captions": True}
    )
    custom_instructions: str = Field(default="", max_length=2000)
    notify_on_complete: bool = False

    @field_validator("protected_terms")
    @classmethod
    def _trim_terms(cls, value: list[str]) -> list[str]:
        return [v.strip()[:120] for v in value if v.strip()][:200]

    @field_validator("language")
    @classmethod
    def _lang(cls, value: str) -> str:
        return (value or "auto").strip()[:32]


class UploadInitRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size: int = Field(gt=0)
    content_type: str | None = None
    kind: str | None = None


class UploadPart(BaseModel):
    part_number: int = Field(ge=1, le=10000)
    etag: str = Field(min_length=1, max_length=255)


class UploadCompleteRequest(BaseModel):
    parts: list[UploadPart] = Field(min_length=1)


class JobCreateRequest(BaseModel):
    upload_id: str
    options: JobOptions = JobOptions()


class LockRequest(BaseModel):
    block_ids: list[str] = Field(min_length=1, max_length=500)
    locked: bool = True


class UserPatch(BaseModel):
    role: Literal["user", "admin"] | None = None
    name: str | None = Field(default=None, max_length=200)
