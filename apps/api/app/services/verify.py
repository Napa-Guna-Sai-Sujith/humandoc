"""Post-rebuild verification: page count, image fingerprints, page geometry and font sets."""
from __future__ import annotations

from typing import Any

from app.services.rebuild_pdf import page_metrics


def verify_document(src: str, dst: str, kind: str) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True, "issues": [], "details": {}}
    if kind != "pdf":
        result["details"] = {"note": "non-PDF files verified structurally during rebuild"}
        return result

    before = page_metrics(src)
    after = page_metrics(dst)
    result["details"] = {"before_pages": before["page_count"], "after_pages": after["page_count"]}

    if before["page_count"] != after["page_count"]:
        result["ok"] = False
        result["issues"].append(f"page count changed {before['page_count']} → {after['page_count']}")

    for b, a in zip(before["pages"], after["pages"], strict=False):
        if b["images"] != a["images"]:
            result["ok"] = False
            result["issues"].append(f"page {b['number']}: image fingerprint changed")
        if abs(b["width"] - a["width"]) > 0.5 or abs(b["height"] - a["height"]) > 0.5:
            result["ok"] = False
            result["issues"].append(f"page {b['number']}: page size changed")
        if b["rotation"] != a["rotation"]:
            result["ok"] = False
            result["issues"].append(f"page {b['number']}: rotation changed")
        if b["drawings"] >= 0 and a["drawings"] >= 0 and b["drawings"] != a["drawings"]:
            result["issues"].append(f"page {b['number']}: vector drawing count {b['drawings']}→{a['drawings']}")

    missing_fonts = sorted({f for p in before["pages"] for f in p["fonts"]} - {f for p in after["pages"] for f in p["fonts"]})
    if missing_fonts:
        result["issues"].append(f"fonts no longer embedded: {', '.join(missing_fonts[:5])}")

    total_chars_before = sum(p["chars"] for p in before["pages"])
    total_chars_after = sum(p["chars"] for p in after["pages"])
    result["details"]["chars_before"] = total_chars_before
    result["details"]["chars_after"] = total_chars_after
    if total_chars_before and total_chars_after == 0:
        result["ok"] = False
        result["issues"].append("output contains no text")
    return result
