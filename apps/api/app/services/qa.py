"""Build the downloadable QA report shown next to the rewritten file."""
from __future__ import annotations

from typing import Any

from app.services.blocks import blocks_from_dicts


def build_report(job, pages: list[list[dict]], rebuild: dict[str, Any], verify: dict[str, Any],
                 analysis: dict[str, Any] | None) -> dict[str, Any]:
    all_blocks = [b for page in pages for b in blocks_from_dicts(page)]
    flagged = [
        {
            "page": b.page,
            "block_id": b.id,
            "reason": b.flag,
            "type": b.type,
            "original": b.text[:240],
        }
        for b in all_blocks
        if b.flag
    ]
    skipped = [
        {"page": b.page, "block_id": b.id, "reason": b.skip_reason, "type": b.type}
        for b in all_blocks
        if b.skip and b.skip_reason
    ]
    rewritten = [b for b in all_blocks if b.new_text and b.new_text != b.text]
    return {
        "job_id": str(job.id),
        "file": job.source_filename,
        "generated_at": job.finished_at.isoformat() if job.finished_at else None,
        "summary": {
            "pages": job.total_pages,
            "blocks": job.total_blocks,
            "rewritten": len(rewritten),
            "flagged": len(flagged),
            "skipped": len(skipped),
            "words": job.total_words,
            "tokens_in": job.tokens_in,
            "tokens_out": job.tokens_out,
            "cost_usd": float(job.cost_usd or 0),
        },
        "analysis": analysis or {},
        "overflow_fixes": [
            {"page": f.block_id, "action": f.action, "detail": f.detail}
            for f in rebuild.get("overflow_fixes", [])
        ],
        "verification": verify,
        "flagged_blocks": flagged[:500],
        "skipped_regions": skipped[:500],
        "notes": [
            "Images, charts, equations, code, URLs, citations and page numbers were left untouched.",
            "Blocks that failed validation kept their original text and are listed above.",
        ],
    }
