"""Word (.doc and .docx) reading, normalization, and multi-format export helpers.

Supports:
- OOXML .docx (paragraphs, tables, nested tables, textboxes, with raw XML fallback)
- Legacy MS Word 97-2003 OLE2 binary .doc (pure-Python CFB + FIB/Clx piece-table reader)
- RTF saved as .doc ({\\rtf...)
- HTML / WordprocessingML saved as .doc
- Plain text / Markdown saved as .doc
- Exporting documents to .pdf, .docx, .doc (Word-compatible RTF), and .txt
"""
from __future__ import annotations

import html
import io
import logging
import re
import struct
import zipfile
from collections.abc import Iterable
from pathlib import Path
from xml.etree import ElementTree as ET

log = logging.getLogger(__name__)

OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
END_OF_CHAIN = 0xFFFFFFFE
FREE_SECT = 0xFFFFFFFF
NO_STREAM = 0xFFFFFFFF

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

FORMAT_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
}


# ---------------------------------------------------------------------------
# Low-level Word (.docx / .doc) sniffers & extractors
# ---------------------------------------------------------------------------

def _is_zip_docx(data: bytes) -> bool:
    if not data.startswith(b"PK"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            return "word/document.xml" in names
    except Exception:
        return False


def _is_rtf(data: bytes) -> bool:
    return data.lstrip()[:6].lower().startswith(b"{\\rtf")


def _is_html_or_wordxml(data: bytes) -> bool:
    head = data.lstrip()[:512].lower()
    return (
        head.startswith(b"<!doctype html")
        or head.startswith(b"<html")
        or head.startswith(b"<xml")
        or head.startswith(b"<?xml")
        or b"worddocument" in head
        or b"mime-version:" in head
    )


def sniff_word_variant(data: bytes) -> str | None:
    """Return 'docx', 'ole2', 'rtf', 'html', or 'text' if recognizable as Word/text, else None."""
    if _is_zip_docx(data):
        return "docx"
    if data.startswith(OLE2_MAGIC):
        return "ole2"
    if _is_rtf(data):
        return "rtf"
    if _is_html_or_wordxml(data):
        return "html"
    sample = data[:65536]
    if b"\x00" not in sample:
        return "text"
    return None


def _extract_docx_raw_xml(data: bytes) -> list[str]:
    """Fallback paragraph+table+textbox extractor directly from word/document.xml."""
    paragraphs: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        targets = ["word/document.xml"] + sorted(
            n for n in zf.namelist() if re.match(r"^word/(header|footer)\d*\.xml$", n)
        )
        for name in targets:
            if name not in zf.namelist():
                continue
            try:
                root = ET.fromstring(zf.read(name))
            except ET.ParseError:
                continue
            for p in root.iter(f"{W_NS}p"):
                # Avoid duplicating nested textbox paragraphs inside outer paragraph iteration
                chunks: list[str] = []
                for elem in p.iter():
                    tag = elem.tag
                    if tag == f"{W_NS}t" and elem.text:
                        chunks.append(elem.text)
                    elif tag == f"{W_NS}tab":
                        chunks.append("\t")
                    elif tag in (f"{W_NS}br", f"{W_NS}cr"):
                        chunks.append("\n")
                joined = "".join(chunks).strip()
                if joined:
                    paragraphs.append(joined)
    return paragraphs


def _extract_docx_paragraphs(data: bytes) -> list[str]:
    """Extract ordered paragraphs, tables, and textboxes from a .docx payload."""
    try:
        from docx import Document

        from app.services.extract_docx import _iter_paragraphs

        doc = Document(io.BytesIO(data))
        out = [p.text.strip() for p in _iter_paragraphs(doc) if p.text and p.text.strip()]
        if out:
            return out
    except Exception as exc:
        log.warning("python-docx extraction fell back to XML parser: %s", exc)
    return _extract_docx_raw_xml(data)


# ---------------------------------------------------------------------------
# Pure-Python OLE2 Compound Binary File (MS-CFB) + MS-DOC WordDocument reader
# ---------------------------------------------------------------------------

def _read_ole2_streams(data: bytes) -> dict[str, bytes]:
    """Parse an OLE2 / CFB container and return {stream_name: bytes}."""
    if len(data) < 512 or not data.startswith(OLE2_MAGIC):
        raise ValueError("Not a valid OLE2 Compound Binary file")

    sector_shift = struct.unpack_from("<H", data, 30)[0]
    mini_sector_shift = struct.unpack_from("<H", data, 32)[0]
    sector_size = 1 << max(9, min(sector_shift, 12))
    mini_sector_size = 1 << max(6, min(mini_sector_shift, 9))

    # num_fat_sectors = struct.unpack_from("<I", data, 44)[0]
    first_dir_sect = struct.unpack_from("<I", data, 48)[0]
    mini_cutoff = struct.unpack_from("<I", data, 56)[0] or 4096
    first_minifat_sect = struct.unpack_from("<I", data, 60)[0]
    # num_minifat_sects = struct.unpack_from("<I", data, 64)[0]
    first_difat_sect = struct.unpack_from("<I", data, 68)[0]
    num_difat_sects = struct.unpack_from("<I", data, 72)[0]

    def read_sector(sid: int) -> bytes:
        offset = (sid + 1) * sector_size
        if offset < 0 or offset >= len(data):
            return b""
        return data[offset : offset + sector_size]

    # Collect FAT sector IDs from header DIFAT (109 entries at 76..512) + DIFAT chain
    fat_sects: list[int] = []
    for i in range(109):
        s = struct.unpack_from("<I", data, 76 + i * 4)[0]
        if s < FREE_SECT - 1:
            fat_sects.append(s)

    difat_sid = first_difat_sect
    seen_difat: set[int] = set()
    for _ in range(num_difat_sects + 4):
        if difat_sid >= END_OF_CHAIN or difat_sid in seen_difat:
            break
        seen_difat.add(difat_sid)
        sec = read_sector(difat_sid)
        if len(sec) < sector_size:
            break
        entries = (sector_size // 4) - 1
        for i in range(entries):
            s = struct.unpack_from("<I", sec, i * 4)[0]
            if s < FREE_SECT - 1:
                fat_sects.append(s)
        difat_sid = struct.unpack_from("<I", sec, entries * 4)[0]

    fat: list[int] = []
    for fs in fat_sects:
        sec = read_sector(fs)
        if not sec:
            continue
        fat.extend(struct.unpack_from(f"<{len(sec) // 4}I", sec, 0))

    def read_chain(start_sid: int, max_len: int | None = None) -> bytes:
        if start_sid >= END_OF_CHAIN:
            return b""
        buf = bytearray()
        sid = start_sid
        visited: set[int] = set()
        limit = (len(data) // sector_size) + 4
        while sid < len(fat) and sid < END_OF_CHAIN and sid not in visited and len(visited) < limit:
            visited.add(sid)
            buf.extend(read_sector(sid))
            if max_len is not None and len(buf) >= max_len:
                return bytes(buf[:max_len])
            sid = fat[sid]
        return bytes(buf[:max_len] if max_len is not None else buf)

    dir_bytes = read_chain(first_dir_sect)
    entries_list: list[tuple[str, int, int, int]] = []
    for off in range(0, len(dir_bytes) - 127, 128):
        name_len = struct.unpack_from("<H", dir_bytes, off + 64)[0]
        obj_type = dir_bytes[off + 66]
        if obj_type not in (2, 5):  # 2=stream, 5=root storage
            continue
        raw_name = dir_bytes[off : off + max(0, min(name_len - 2, 62))]
        try:
            name = raw_name.decode("utf-16-le", errors="ignore")
        except Exception:
            name = ""
        start_sect = struct.unpack_from("<I", dir_bytes, off + 116)[0]
        stream_size = struct.unpack_from("<Q", dir_bytes, off + 120)[0] & 0xFFFFFFFF
        entries_list.append((name, obj_type, start_sect, stream_size))

    mini_stream = b""
    minifat: list[int] = []
    root_entry = next((e for e in entries_list if e[1] == 5), None)
    if root_entry and root_entry[2] < END_OF_CHAIN and root_entry[3] > 0:
        mini_stream = read_chain(root_entry[2], root_entry[3])
        minifat_bytes = read_chain(first_minifat_sect)
        if minifat_bytes:
            minifat = list(struct.unpack_from(f"<{len(minifat_bytes) // 4}I", minifat_bytes, 0))

    def read_mini_chain(start_sid: int, size: int) -> bytes:
        buf = bytearray()
        sid = start_sid
        visited: set[int] = set()
        while sid < len(minifat) and sid < END_OF_CHAIN and sid not in visited and len(buf) < size:
            visited.add(sid)
            off = sid * mini_sector_size
            buf.extend(mini_stream[off : off + mini_sector_size])
            sid = minifat[sid]
        return bytes(buf[:size])

    streams: dict[str, bytes] = {}
    for name, obj_type, start_sect, size in entries_list:
        if obj_type != 2 or not name or size == 0:
            continue
        if size < mini_cutoff and mini_stream and minifat:
            streams[name] = read_mini_chain(start_sect, size)
        else:
            streams[name] = read_chain(start_sect, size)
    return streams


def _clean_word_text(raw: str) -> list[str]:
    """Turn MS-DOC piece-table text into clean readable paragraphs."""
    # Remove embedded Word field instructions: \x13 ... (\x14 ...)? \x15
    out_chars: list[str] = []
    depth = 0
    seen_sep = False
    for ch in raw:
        code = ord(ch)
        if code == 0x13:
            depth += 1
            seen_sep = False
        elif code == 0x14 and depth > 0:
            seen_sep = True
        elif code == 0x15 and depth > 0:
            depth -= 1
            seen_sep = False
        elif depth == 0 or seen_sep:
            out_chars.append(ch)
    cleaned = "".join(out_chars)
    cleaned = cleaned.replace("\x07\x07", "\r").replace("\x07", " | ").replace("\x0b", "\n").replace("\x0c", "\r")
    cleaned = re.sub(r"[\x00-\x08\x0e-\x1f]", "", cleaned)
    paras: list[str] = []
    for p in re.split(r"[\r\n]+", cleaned):
        line = re.sub(r"\s+\|\s+$", "", p.strip())
        if line and line != "|":
            paras.append(line)
    return paras


def _extract_ole2_doc_paragraphs(data: bytes) -> list[str]:
    """Extract clean Unicode paragraphs from an MS Word 97-2003 OLE2 .doc file."""
    streams = _read_ole2_streams(data)
    word_doc = streams.get("WordDocument")
    if not word_doc or len(word_doc) < 0x40:
        raise ValueError("Missing WordDocument stream in OLE2 .doc file")

    w_ident = struct.unpack_from("<H", word_doc, 0)[0]
    flags_a = struct.unpack_from("<H", word_doc, 10)[0]
    f_encrypted = bool(flags_a & 0x0100)
    if f_encrypted:
        raise ValueError("Password-protected / encrypted .doc files are not supported")

    table_name = "1Table" if (flags_a & 0x0200) else "0Table"
    table_stm = streams.get(table_name) or streams.get("1Table") or streams.get("0Table") or b""

    # Attempt Word 97+ FIB piece-table extraction (PlcPcd inside Clx)
    if w_ident in (0xA5EC, 0xA5DC, 0xA697, 0xA698) and table_stm:
        try:
            pos = 32  # end of FibBase
            csw = struct.unpack_from("<H", word_doc, pos)[0]
            pos += 2 + csw * 2
            cslw = struct.unpack_from("<H", word_doc, pos)[0]
            ccp_text = struct.unpack_from("<I", word_doc, pos + 2 + 3 * 4)[0] if cslw >= 4 else 0
            pos += 2 + cslw * 4
            cb_rg_fc_lcb = struct.unpack_from("<H", word_doc, pos)[0]
            pos += 2
            if cb_rg_fc_lcb > 33 and pos + 34 * 8 <= len(word_doc):
                fc_clx, lcb_clx = struct.unpack_from("<II", word_doc, pos + 33 * 8)
                if lcb_clx > 0 and fc_clx + lcb_clx <= len(table_stm):
                    clx = table_stm[fc_clx : fc_clx + lcb_clx]
                    cp = 0
                    while cp < len(clx) and clx[cp] == 0x01:
                        cb_grp = struct.unpack_from("<H", clx, cp + 1)[0]
                        cp += 3 + cb_grp
                    if cp + 5 <= len(clx) and clx[cp] == 0x02:
                        lcb_pcdt = struct.unpack_from("<I", clx, cp + 1)[0]
                        plc = clx[cp + 5 : cp + 5 + lcb_pcdt]
                        n_pieces = (len(plc) - 4) // 12
                        if n_pieces > 0:
                            cps = struct.unpack_from(f"<{n_pieces + 1}I", plc, 0)
                            pcd_base = (n_pieces + 1) * 4
                            pieces: list[str] = []
                            for i in range(n_pieces):
                                char_count = cps[i + 1] - cps[i]
                                if char_count <= 0:
                                    continue
                                fc_raw = struct.unpack_from("<I", plc, pcd_base + i * 8 + 2)[0]
                                compressed = bool(fc_raw & 0x40000000)
                                offset = (fc_raw & 0x3FFFFFFF) // 2 if compressed else fc_raw
                                if compressed:
                                    chunk = word_doc[offset : offset + char_count]
                                    pieces.append(chunk.decode("cp1252", errors="ignore"))
                                else:
                                    chunk = word_doc[offset : offset + char_count * 2]
                                    pieces.append(chunk.decode("utf-16-le", errors="ignore"))
                            full_text = "".join(pieces)
                            if ccp_text and len(full_text) >= ccp_text:
                                full_text = full_text[:ccp_text]
                            paras = _clean_word_text(full_text)
                            if paras:
                                return paras
        except Exception as exc:
            log.warning("MS-DOC piece table parse fell back: %s", exc)

    # Fallback: FIB fcMin..fcMac slice for older/simple .doc files
    fc_min, fc_mac = struct.unpack_from("<II", word_doc, 0x18)
    if 0x20 <= fc_min < fc_mac <= len(word_doc):
        slice_bytes = word_doc[fc_min:fc_mac]
        if slice_bytes.count(0) > len(slice_bytes) * 0.25:
            text = slice_bytes.decode("utf-16-le", errors="ignore")
        else:
            text = slice_bytes.decode("cp1252", errors="ignore")
        paras = _clean_word_text(text)
        if paras:
            return paras

    # Third fallback (Word 6.0 / Word95 / damaged FIB): scan printable runs in WordDocument
    scan_paras: list[str] = []
    for chunk in re.findall(rb"[A-Za-z0-9][A-Za-z0-9 ,.;:!?()'\"/%\-]{18,}", word_doc):
        decoded = chunk.decode("cp1252", errors="ignore").strip()
        if len(decoded.split()) >= 4 and not re.match(r"^(?:Normal|Heading|Times New Roman|Arial|Calibri|Microsoft)\b", decoded):
            scan_paras.append(decoded)
    if scan_paras:
        return scan_paras

    # UTF-16LE scan inside WordDocument
    u16_chunks = re.findall(rb"(?:[A-Za-z0-9 ,.;:!?()'\"/\-]\x00){18,}", word_doc)
    u16_paras = [c.decode("utf-16-le", errors="ignore").strip() for c in u16_chunks]
    u16_paras = [p for p in u16_paras if len(p.split()) >= 4]
    if u16_paras:
        return u16_paras

    raise ValueError("Could not extract readable text from .doc binary file")


# ---------------------------------------------------------------------------
# RTF & HTML-as-.doc extractors
# ---------------------------------------------------------------------------

_RTF_SKIP_DESTS = {
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "header",
    "footer",
    "headerl",
    "headerr",
    "headerf",
    "footerl",
    "footerr",
    "footerf",
    "footnote",
    "fldinst",
    "listtable",
    "listoverridetable",
    "revtbl",
    "rsidtbl",
    "generator",
    "xmlnstbl",
    "datastore",
    "themedata",
    "colorschememapping",
    "latentstyles",
}


def _extract_rtf_paragraphs(data: bytes) -> list[str]:
    text = data.decode("latin-1", errors="ignore")
    out: list[str] = []
    stack: list[tuple[int, bool]] = []
    uc_skip = 1
    skip_group = False
    skip_chars = 0
    i = 0
    n = len(text)
    hex_buf = bytearray()

    def flush_hex() -> None:
        if hex_buf:
            out.append(hex_buf.decode("cp1252", errors="replace"))
            hex_buf.clear()

    while i < n:
        ch = text[i]
        if ch == "{":
            flush_hex()
            stack.append((uc_skip, skip_group))
            i += 1
            # Check for ignorable destination \*
            if i + 1 < n and text[i : i + 2] == "\\*":
                skip_group = True
                i += 2
        elif ch == "}":
            flush_hex()
            if stack:
                uc_skip, skip_group = stack.pop()
            i += 1
        elif ch == "\\":
            i += 1
            if i >= n:
                break
            nxt = text[i]
            if nxt in ("\\", "{", "}"):
                flush_hex()
                if not skip_group and skip_chars <= 0:
                    out.append(nxt)
                skip_chars = max(0, skip_chars - 1)
                i += 1
            elif nxt == "'":
                hx = text[i + 1 : i + 3]
                if len(hx) == 2 and all(c in "0123456789abcdefABCDEF" for c in hx):
                    if not skip_group and skip_chars <= 0:
                        hex_buf.append(int(hx, 16))
                    skip_chars = max(0, skip_chars - 1)
                    i += 3
                else:
                    i += 1
            elif nxt in ("~", "-", "_"):
                flush_hex()
                if not skip_group and skip_chars <= 0:
                    out.append(" " if nxt == "~" else "-")
                i += 1
            elif nxt in ("\r", "\n"):
                flush_hex()
                if not skip_group:
                    out.append("\n")
                i += 1
            elif nxt.isalpha():
                flush_hex()
                j = i
                while j < n and text[j].isalpha():
                    j += 1
                word = text[i:j]
                k = j
                if k < n and (text[k] == "-" or text[k].isdigit()):
                    if text[k] == "-":
                        k += 1
                    while k < n and text[k].isdigit():
                        k += 1
                param_str = text[j:k]
                i = k + 1 if k < n and text[k] == " " else k

                if word in _RTF_SKIP_DESTS:
                    skip_group = True
                elif word == "uc" and param_str:
                    uc_skip = int(param_str)
                elif word == "u" and param_str:
                    if not skip_group:
                        code = int(param_str)
                        if code < 0:
                            code += 65536
                        try:
                            out.append(chr(code))
                        except ValueError:
                            pass
                        skip_chars = uc_skip
                elif not skip_group:
                    if word in ("par", "line", "row"):
                        out.append("\n")
                    elif word in ("tab", "cell"):
                        out.append(" ")
                    elif word == "emdash":
                        out.append("\u2014")
                    elif word == "endash":
                        out.append("\u2013")
                    elif word == "lquote":
                        out.append("\u2018")
                    elif word == "rquote":
                        out.append("\u2019")
                    elif word == "ldblquote":
                        out.append("\u201c")
                    elif word == "rdblquote":
                        out.append("\u201d")
                    elif word == "bullet":
                        out.append("\u2022")
            else:
                i += 1
        elif ch in ("\r", "\n"):
            i += 1
        else:
            flush_hex()
            if skip_chars > 0:
                skip_chars -= 1
            elif not skip_group:
                out.append(ch)
            i += 1

    flush_hex()
    joined = "".join(out)
    return [line.strip() for line in joined.splitlines() if line.strip()]


def _extract_html_doc_paragraphs(data: bytes) -> list[str]:
    text = data.decode("utf-8", errors="ignore")
    text = re.sub(r"<(script|style|head|xml)\b[^>]*>.*?</\1>", " ", text, flags=re.I | re.S)
    text = re.sub(r"</?(?:p|div|br|tr|h[1-6]|li|w:p)\b[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<td\b[^>]*>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines() if line.strip()]


def extract_word_paragraphs(src: bytes | str | Path, filename: str = "") -> tuple[list[str], str]:
    """Extract ordered paragraphs from any .docx or .doc payload.

    Returns (paragraphs, detected_variant). Raises ValueError on empty or corrupt input.
    """
    data = src if isinstance(src, (bytes, bytearray)) else Path(src).read_bytes()
    variant = sniff_word_variant(bytes(data))
    if variant == "docx":
        paras = _extract_docx_paragraphs(bytes(data))
    elif variant == "ole2":
        paras = _extract_ole2_doc_paragraphs(bytes(data))
    elif variant == "rtf":
        paras = _extract_rtf_paragraphs(bytes(data))
    elif variant == "html":
        paras = _extract_html_doc_paragraphs(bytes(data))
    elif variant == "text":
        decoded = bytes(data).decode("utf-8", errors="replace")
        paras = [line.strip() for line in decoded.splitlines() if line.strip()]
    else:
        raise ValueError(f"Unrecognized binary file format ({filename or 'document'})")

    if not paras:
        raise ValueError("No readable text found inside the Word document.")
    return paras, variant


# ---------------------------------------------------------------------------
# Normalization (.doc -> .docx) & multi-format exporters (.pdf/.docx/.doc/.txt)
# ---------------------------------------------------------------------------

def normalize_doc_to_docx(src: str | Path, dst: str | Path) -> str:
    """Convert any .doc variant into a valid OOXML .docx file at `dst`.

    If `src` is already a genuine OOXML .docx (e.g. a .docx renamed .doc), copies bytes directly.
    Returns the detected variant ('docx', 'ole2', 'rtf', 'html', 'text').
    """
    data = Path(src).read_bytes()
    variant = sniff_word_variant(data)
    if variant == "docx":
        Path(dst).write_bytes(data)
        return "docx"

    paras, detected = extract_word_paragraphs(data, Path(src).name)
    from docx import Document

    doc = Document()
    for idx, para in enumerate(paras):
        if idx == 0 and len(para) <= 120 and "\n" not in para and not para.endswith("."):
            doc.add_heading(para, level=1)
        else:
            doc.add_paragraph(para)
    doc.save(str(dst))
    return detected


def _paragraphs_from_text_or_seq(content: str | Iterable[str]) -> list[str]:
    if isinstance(content, str):
        paras = [p.strip() for p in re.split(r"\n\s*\n", content.strip()) if p.strip()]
        return paras or ([content.strip()] if content.strip() else [])
    return [str(p).strip() for p in content if str(p).strip()]


def _rtf_escape(text: str) -> str:
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "{":
            out.append("\\{")
        elif ch == "}":
            out.append("\\}")
        elif ch == "\n":
            out.append("\\line ")
        elif 32 <= code <= 126:
            out.append(ch)
        elif code <= 65535:
            signed = code if code < 32768 else code - 65536
            out.append(f"\\u{signed}?")
        else:
            # UTF-16 surrogate pair in RTF
            code -= 0x10000
            hi = 0xD800 + (code >> 10)
            lo = 0xDC00 + (code & 0x3FF)
            out.append(f"\\u{hi - 65536}?\\u{lo - 65536}?")
    return "".join(out)


def export_document_bytes(title: str, content: str | Iterable[str], fmt: str) -> tuple[bytes, str]:
    """Render `content` as 'pdf', 'docx', 'doc', or 'txt'. Returns (bytes, media_type)."""
    fmt = fmt.lower().strip()
    if fmt not in ("pdf", "docx", "doc", "txt"):
        raise ValueError(f"Unsupported export format: {fmt}")

    clean_title = (title or "HumanDoc Document").strip() or "HumanDoc Document"
    paragraphs = _paragraphs_from_text_or_seq(content)
    if not paragraphs:
        raise ValueError("Document has no text content to export.")

    if fmt == "txt":
        body = content.strip() if isinstance(content, str) else "\n\n".join(paragraphs)
        return body.encode("utf-8"), FORMAT_MEDIA_TYPES["txt"]

    if fmt == "doc":
        lines = [
            r"{\rtf1\ansi\ansicpg1252\deff0\nouicompat{\fonttbl{\f0\fswiss\fcharset0 Calibri;}}",
            r"\paperw11906\paperh16838\margl1440\margr1440\margt1440\margb1440",
            r"\pard\sa180\sl276\slmult1\b\f0\fs30 " + _rtf_escape(clean_title) + r"\b0\par",
        ]
        for para in paragraphs:
            lines.append(r"\pard\sa160\sl276\slmult1\f0\fs22 " + _rtf_escape(para) + r"\par")
        lines.append("}")
        return "\r\n".join(lines).encode("ascii", errors="ignore"), FORMAT_MEDIA_TYPES["doc"]

    if fmt == "docx":
        from docx import Document
        from docx.shared import Pt

        d = Document()
        style = d.styles["Normal"]
        style.font.name = "Calibri"
        style.font.size = Pt(11)
        d.add_heading(clean_title, level=1)
        for para in paragraphs:
            p = d.add_paragraph(para)
            p.paragraph_format.space_after = Pt(6)
        buf = io.BytesIO()
        d.save(buf)
        return buf.getvalue(), FORMAT_MEDIA_TYPES["docx"]

    # fmt == "pdf": Story + DocumentWriter supports full Unicode, crisp spaces, and auto multi-page layout
    import fitz

    escaped_title = html.escape(clean_title[:180])
    body_parts = [f"<h1>{escaped_title}</h1>", "<hr/>"]
    for para in paragraphs:
        body_parts.append(f"<p>{html.escape(para).replace(chr(10), '<br/>')}</p>")

    story_html = (
        "<html><head><style>"
        "body { font-family: sans-serif; font-size: 10.5pt; line-height: 1.48; color: #1e293b; }"
        "h1 { font-size: 15pt; line-height: 1.25; color: #0f172a; margin: 0 0 8pt 0; }"
        "hr { border: none; border-top: 1px solid #cbd5e1; margin: 0 0 14pt 0; }"
        "p { margin: 0 0 9pt 0; }"
        "</style></head><body>"
        + "".join(body_parts)
        + "</body></html>"
    )
    story = fitz.Story(html=story_html)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox = fitz.Rect(0, 0, 595, 842)
    where = fitz.Rect(50, 52, 545, 792)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev, None)
        writer.end_page()
    writer.close()
    return buf.getvalue(), FORMAT_MEDIA_TYPES["pdf"]
