import pytest

from app.services.blocks import Block
from app.services.validators import banned_phrases, validate_rewrite


def block(text: str, words: int | None = None) -> Block:
    b = Block(id="p1b0", page=1, text=text, spans=[])
    return b


LONG = (
    "The quarterly report shows revenue of 1.2 million dollars, up 18 percent from Q3 2023. "
    "Acme Corp and Globex Ltd both renewed, while churn fell to 2.1 percent overall."
)
REWRITE = (
    "Revenue reached 1.2 million dollars in the quarter, an 18 percent rise from Q3 2023. "
    "Both Acme Corp and Globex Ltd renewed, and churn dropped to 2.1 percent."
)


def test_accepts_valid_rewrite():
    result = validate_rewrite(block(LONG), REWRITE)
    assert result.ok, result.reasons


def test_rejects_missing_number():
    bad = REWRITE.replace("2.1", "two point one")
    result = validate_rewrite(block(LONG), bad)
    assert not result.ok
    assert any("numbers dropped" in r for r in result.reasons)


def test_rejects_length_drift():
    result = validate_rewrite(block(LONG), REWRITE[: int(len(LONG) * 0.4)])
    assert not result.ok
    assert any("length ratio" in r for r in result.reasons)


def test_rejects_stock_phrase():
    bad = REWRITE + " This delves into the landscape of modern leverage."
    result = validate_rewrite(block(LONG), bad)
    assert not result.ok


def test_banned_phrase_detector():
    assert banned_phrases("We delve into the tapestry of the landscape.")


def test_short_block_gets_wider_tolerance():
    result = validate_rewrite(block("Ship it."), "Ship it now.")
    assert result.ok


def test_identical_text_passes():
    assert validate_rewrite(block(LONG), LONG).ok


@pytest.mark.parametrize("phrase", ["furthermore", "it is important to note", "plays a crucial role"])
def test_each_banned_phrase_is_caught(phrase):
    assert not validate_rewrite(block(LONG), REWRITE + " " + phrase.capitalize() + ".").ok
