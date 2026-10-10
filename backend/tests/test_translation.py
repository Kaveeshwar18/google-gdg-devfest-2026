import pytest

from app import llm, translation
from app.schemas import Answer
from tests.test_agent import answer


def hindi_answer(original: Answer, **changes) -> Answer:
    """What a faithful model returns: translated text, but it also tampers with the fixed fields."""
    translated = original.model_copy(deep=True)
    translated.diagnosis = "आपके दो दस्तावेज़ों में नाम अलग-अलग लिखे हैं।"
    translated.recommended_path.steps = ["एक शपथ पत्र तैयार करें"]
    translated.recommended_path.where = "पासपोर्ट सेवा केंद्र"  # should be restored to the original
    translated.confidence = "high"  # should be restored
    translated.citations = []  # should be restored
    translated.disclaimer = "सब कुछ गारंटी है"  # must be replaced by the fixed local disclaimer
    for k, v in changes.items():
        setattr(translated, k, v)
    return translated


@pytest.fixture
def live(monkeypatch):
    async def provider():
        return "gemini"

    monkeypatch.setattr(llm, "active_provider", provider)

    def script(*replies):
        replies = list(replies)
        calls = []

        async def structured(schema, **kwargs):
            calls.append(kwargs)
            return replies.pop(0)

        monkeypatch.setattr(llm, "structured", structured)
        return calls

    return script


async def test_english_is_returned_untouched(live):
    a = answer(confidence="medium")
    assert await translation.localize_answer(a, "en") is a


async def test_mock_mode_falls_back_to_english(monkeypatch):
    async def provider():
        return "mock"

    monkeypatch.setattr(llm, "active_provider", provider)
    with pytest.raises(translation.LocalizationUnavailable):
        await translation.localize_answer(answer(), "hi")


async def test_fixed_fields_always_come_from_the_english_original(live):
    original = answer(confidence="medium")
    live(hindi_answer(original))
    out = await translation.localize_answer(original, "hi")

    assert out.diagnosis.startswith("आपके") and out.recommended_path.steps == ["एक शपथ पत्र तैयार करें"]
    assert out.citations == original.citations  # restored
    assert out.confidence == "medium"  # restored, not "high"
    assert out.recommended_path.where == original.recommended_path.where
    assert out.disclaimer == translation.DISCLAIMER_LOCAL["hi"] and "गारंटी" not in out.disclaimer


async def test_prompt_carries_the_glossary_and_the_language(live):
    original = answer()
    calls = live(hindi_answer(original))
    await translation.localize_answer(original, "hi")
    system = calls[0]["system"]
    assert "Hindi" in system and "police verification" in system and "शपथ पत्र" in system


async def test_changed_list_lengths_are_retried_then_rejected(live):
    original = answer()
    bad = hindi_answer(original, escalation=original.escalation + ["extra invented channel"])
    calls = live(bad, bad)
    with pytest.raises(translation.LocalizationUnavailable):
        await translation.localize_answer(original, "hi")
    assert len(calls) == 2


async def test_untranslated_output_is_rejected_and_a_retry_can_succeed(live):
    original = answer()
    untranslated = original.model_copy(deep=True)  # still English
    calls = live(untranslated, hindi_answer(original))
    out = await translation.localize_answer(original, "hi")
    assert len(calls) == 2 and out.diagnosis.startswith("आपके")


async def test_a_model_refusal_means_english_not_an_error(live, monkeypatch):
    async def refuse(schema, **kwargs):
        raise llm.LLMRefusal("declined")

    live()
    monkeypatch.setattr(llm, "structured", refuse)
    with pytest.raises(translation.LocalizationUnavailable):
        await translation.localize_answer(answer(), "hi")


def test_every_supported_language_has_a_disclaimer():
    assert set(translation.DISCLAIMER_LOCAL) == {"hi", "ta", "mr", "bn"}
