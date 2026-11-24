from pathlib import Path

from docx import Document
from pptx import Presentation

from app.services import rebuild_docx, rebuild_pptx
from app.services.blocks import Block, Span
from app.services.extract_docx import extract_docx
from app.services.extract_pptx import extract_pptx


def _clone(b: Block, new_text: str) -> Block:
    data = b.to_dict()
    data.pop("spans", None)
    data.pop("new_text", None)
    return Block(**data, spans=[Span(**vars(x)) for x in b.spans], new_text=new_text)


def test_docx_rebuild_keeps_styles(sample_docx: Path, tmp_path: Path):
    pages, meta = extract_docx(sample_docx)
    blocks = [_clone(b, "Rewritten text here.") for b in pages[0]]
    out = tmp_path / "out.docx"
    info = rebuild_docx.rebuild_docx(str(sample_docx), str(out), [blocks])
    assert info["replaced_blocks"] > 0

    original = Document(sample_docx)
    result = Document(out)
    assert "Rewritten text here." in "\n".join(p.text for p in result.paragraphs)
    assert len(result.tables) == len(original.tables) == 1
    assert [p.style.name for p in result.paragraphs][:4] == [p.style.name for p in original.paragraphs][:4]


def test_docx_keeps_bold_run_formatting(sample_docx: Path, tmp_path: Path):
    pages, _ = extract_docx(sample_docx)
    blocks = [_clone(b, "Totally new list text.") for b in pages[0]]
    out = tmp_path / "out.docx"
    rebuild_docx.rebuild_docx(str(sample_docx), str(out), [blocks])
    doc = Document(out)
    bold_runs = [r for p in doc.paragraphs for r in p.runs if r.bold]
    assert bold_runs, "bold formatting should survive"


def test_pptx_rebuild(sample_pptx: Path, tmp_path: Path):
    pages, _ = extract_pptx(sample_pptx)
    blocks = [_clone(b, "Fresh slide copy.") for b in pages[0]]
    out = tmp_path / "out.pptx"
    info = rebuild_pptx.rebuild_pptx(str(sample_pptx), str(out), [blocks])
    assert info["replaced_blocks"] > 0
    prs = Presentation(out)
    texts = " ".join(sh.text_frame.text for sl in prs.slides for sh in sl.shapes if sh.has_text_frame)
    assert "Fresh slide copy." in texts
