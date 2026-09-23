import pytest
import backend.llm as llm  # Path handling: run tests from repo root with .venv python


def _ctx():
    return {
        "device_id": "TL-A1B2C3",
        "components": [{"type": "mpu6050", "label": "MPU6050"}, {"type": "dht22", "label": "DHT22"}],
        "readings": {"temp": 41.2, "hum": 30.0},
        "anomalies": ["temperature above 40 C"],
    }


def test_build_prompt_is_openai_shaped():
    msgs = llm.build_prompt(_ctx(), [{"role": "user", "content": "why hot?"}])
    assert msgs[0]["role"] == "system"
    assert "MPU6050" in msgs[1]["content"]
    assert "online" in msgs[1]["content"].lower() or "grounded" in msgs[1]["content"].lower()
    assert msgs[-1]["role"] == "user" and msgs[-1]["content"] == "why hot?"


def test_build_prompt_never_leaks_key(tmp_path):
    prompt = llm.build_prompt(_ctx(), [{"role": "user", "content": "hi"}])
    assert "\n".join(str(m) for m in prompt).find("GROQ_API_KEY") == -1


def test_groq_chat_raises_on_missing_key(monkeypatch):
    monkeypatch.setattr(llm.settings, "groq_api_key", None)
    with pytest.raises(llm.LLMError):
        import asyncio
        asyncio.run(llm.groq_chat([{"role": "user", "content": "hi"}]))