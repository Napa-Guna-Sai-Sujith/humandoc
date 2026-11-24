"""File-type sniffing. Never trust the user-supplied extension or content-type."""
from __future__ import annotations

import zipfile
from pathlib import Path

SUPPORTED_KINDS = {"pdf", "docx", "pptx", "txt", "md"}

KIND_BY_EXT = {
    "pdf": "pdf",
    "docx": "docx",
    "pptx": "pptx",
    "txt": "txt",
    "md": "md",
    "markdown": "md",
}

MIME_BY_KIND = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "md": "text/markdown",
}


class UnsupportedFileError(ValueError):
    pass


def sniff(path: str | Path, filename: str) -> tuple[str, str]:
    """Return (kind, mime). Raises UnsupportedFileError when the bytes don't match."""
    p = Path(path)
    head = b""
    with open(p, "rb") as fh:
        head = fh.read(8)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    kind: str | None = None

    if head.startswith(b"%PDF-"):
        kind = "pdf"
    elif head[:2] == b"PK":
        try:
            with zipfile.ZipFile(p) as zf:
                names = set(zf.namelist())
                types = zf.read("[Content_Types].xml").decode("utf-8", "ignore") if "[Content_Types].xml" in names else ""
        except zipfile.BadZipFile as exc:
            raise UnsupportedFileError("File looks like a zip but is not readable") from exc
        if "word/document.xml" in names or "wordprocessingml" in types:
            kind = "docx"
        elif "ppt/presentation.xml" in names or "presentationml" in types:
            kind = "pptx"
        else:
            raise UnsupportedFileError("Office package has no document part")
    else:
        # Plain text: reject if it contains NUL bytes or mostly non-text bytes.
        sample = p.read_bytes()[:65536]
        if b"\x00" in sample:
            raise UnsupportedFileError("Binary file is not a supported document type")
        if ext in ("txt", "md", "markdown"):
            kind = "md" if ext in ("md", "markdown") else "txt"
        else:
            try:
                sample.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise UnsupportedFileError("File is not UTF-8 text") from exc
            kind = "txt"

    if kind not in SUPPORTED_KINDS:
        raise UnsupportedFileError(f"Unsupported file type: {kind}")
    return kind, MIME_BY_KIND[kind]


def output_filename(source_filename: str) -> str:
    stem = source_filename.rsplit(".", 1)[0] if "." in source_filename else source_filename
    return f"{stem}.humanized"
