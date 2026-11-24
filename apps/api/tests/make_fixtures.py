"""Deterministic test fixtures: text PDF, PDF with images + a table, DOCX, PPTX."""
from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageDraw


def make_sample_pdf(path: Path, pages: int = 5) -> None:
    doc = fitz.open()
    for index in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 90), f"Sample Document — Page {index + 1}", fontsize=20, fontname="hebo")
        y = 130
        for para in range(4):
            text = (
                f"This paragraph on page {index + 1} explains how the sample document is structured. "
                f"It contains the number {index * 10 + para} and a date such as 12 March 2021. "
                "The rewrite engine should preserve every fact, name and figure while making the "
                "prose read more naturally than a machine summary."
            )
            rect = fitz.Rect(72, y, 523, y + 80)
            page.insert_textbox(rect, text, fontsize=11, fontname="tiro", align=fitz.TEXT_ALIGN_LEFT)
            y += 95
        page.insert_text((72, 800), f"{index + 1}", fontsize=10, fontname="helv")
    doc.save(path)
    doc.close()


def make_pdf_with_images(path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    img_path = path.with_suffix(".png")
    image = Image.new("RGB", (320, 200), (36, 99, 235))
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 300, 180), outline=(255, 255, 255), width=4)
    draw.text((40, 90), "CHART", fill=(255, 255, 255))
    image.save(img_path)
    page.insert_image(fitz.Rect(72, 400, 372, 600), filename=str(img_path))
    page.insert_text((72, 90), "Quarterly Report", fontsize=22, fontname="hebo")
    page.insert_textbox(
        fitz.Rect(72, 120, 523, 360),
        "Revenue grew 18% in Q3 2023 while churn fell to 2.1%. The team shipped 14 features "
        "and closed 3 enterprise deals, including Acme Corp and Globex Ltd.",
        fontsize=11,
        fontname="tiro",
    )
    # a simple table drawn with vector lines
    for row in range(4):
        page.draw_line((72, 650 + row * 25), (523, 650 + row * 25))
        page.insert_text((80, 645 + row * 25), f"Row {row + 1} value {row * 7}", fontsize=9)
    page.insert_text((72, 800), "1", fontsize=10)
    doc.save(path)
    doc.close()
    img_path.unlink(missing_ok=True)


def make_docx(path: Path) -> None:
    from docx import Document

    doc = Document()
    doc.add_heading("Tracked Styles Sample", level=1)
    doc.add_paragraph("This document uses real Word styles so the rebuild can prove they survive.")
    for i in range(3):
        p = doc.add_paragraph(style="List Number")
        run = p.add_run(f"List item {i + 1} mentions Q3 2023 revenue of ${i * 12}k.")
        run.bold = True
        run.italic = True
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Metric"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "Churn"
    table.cell(1, 1).text = "2.1%"
    doc.add_paragraph("Closing paragraph with a citation (Smith et al., 2019) and a URL https://example.com.")
    doc.save(path)


def make_pptx(path: Path) -> None:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Q3 Results"
    body = slide.placeholders[1]
    body.text = "Revenue grew 18% while churn fell to 2.1%."
    second = prs.slides.add_slide(prs.slide_layouts[1])
    box = second.shapes.add_textbox(Inches(1), Inches(2), Inches(6), Inches(2))
    box.text_frame.text = "Three priorities for Q4"
    run = box.text_frame.paragraphs[0].add_run()
    run.text = " Ship faster."
    run.font.size = Pt(24)
    prs.save(path)



def make_two_column_pdf(path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 60), "Two-Column Paper: Layout-Preserving Prose Editing", fontsize=16, fontname="hebo")
    for i in range(5):
        page.insert_textbox(
            fitz.Rect(45, 95 + i * 110, 280, 190 + i * 110),
            f"Left column section {i + 1}: In 2024, 128 participants evaluated latency across 3 tiers (p < 0.01).",
            fontsize=10,
            fontname="tiro",
        )
        page.insert_textbox(
            fitz.Rect(315, 95 + i * 110, 550, 190 + i * 110),
            f"Right column section {i + 1}: Accuracy remained 99.2% while readability improved across all cohorts.",
            fontsize=10,
            fontname="tiro",
        )
    doc.save(path)
    doc.close()


if __name__ == "__main__":
    out = Path(__file__).parent / "fixtures"
    out.mkdir(exist_ok=True)
    make_sample_pdf(out / "sample.pdf")
    make_pdf_with_images(out / "with_images.pdf")
    make_docx(out / "sample.docx")
    make_pptx(out / "sample.pptx")
    make_sample_pdf(out / "hundred.pdf", pages=100)
    make_two_column_pdf(out / "two_column.pdf")
    print("fixtures written")
