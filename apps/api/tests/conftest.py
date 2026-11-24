from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://humandoc:humandoc@localhost:5432/humandoc")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", "test-key")

FIXTURES = ROOT / "tests" / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    return FIXTURES


@pytest.fixture(scope="session")
def sample_pdf(fixtures_dir: Path) -> Path:
    path = fixtures_dir / "sample.pdf"
    if not path.exists():
        from tests.make_fixtures import make_sample_pdf

        make_sample_pdf(path)
    return path


@pytest.fixture(scope="session")
def image_pdf(fixtures_dir: Path) -> Path:
    path = fixtures_dir / "with_images.pdf"
    if not path.exists():
        from tests.make_fixtures import make_pdf_with_images

        make_pdf_with_images(path)
    return path


@pytest.fixture(scope="session")
def sample_docx(fixtures_dir: Path) -> Path:
    path = fixtures_dir / "sample.docx"
    if not path.exists():
        from tests.make_fixtures import make_docx

        make_docx(path)
    return path


@pytest.fixture(scope="session")
def sample_pptx(fixtures_dir: Path) -> Path:
    path = fixtures_dir / "sample.pptx"
    if not path.exists():
        from tests.make_fixtures import make_pptx

        make_pptx(path)
    return path
