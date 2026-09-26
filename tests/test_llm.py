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


def test_build_prompt_separates_wiring_faults_from_sensor_anomalies():
    # A wiring fault reads like "SDA (GPIO21) wired to GND (MPU6050)" — with no
    # framing the tutor cannot tell it from a temperature excursion.
    ctx = dict(_ctx())
    ctx["wiring"] = ["SDA (GPIO21) (ESP32) wired to GND (MPU6050)"]
    ctx["anomalies"] = ["temperature above 40 C"]
    block = llm.build_prompt(ctx, [{"role": "user", "content": "what is wrong?"}])[1]["content"]
    assert "SDA (GPIO21) (ESP32) wired to GND (MPU6050)" in block
    assert "temperature above 40 C" in block
    assert "Wiring" in block or "wiring" in block
    # The two sources must be labelled, not concatenated into one list.
    assert block.index("SDA (GPIO21)") < block.index("temperature above 40 C") or "Wiring" in block


def test_build_prompt_handles_absent_wiring_key():
    # Older browser builds send no wiring key at all — must not raise.
    block = llm.build_prompt(_ctx(), [{"role": "user", "content": "hi"}])[1]["content"]
    assert "temperature above 40 C" in block


def test_system_prompt_tells_tutor_to_lead_with_wiring_faults():
    # Verified against the live model: with only the data line labelling the
    # faults, the tutor discussed the vibration anomaly and never mentioned the
    # SDA-into-GND short. The instruction has to be in the system prompt, which
    # is what actually steers the answer.
    system = llm.build_prompt(_ctx(), [{"role": "user", "content": "hi"}])[0]["content"]
    assert "wiring" in system.lower()
    assert "lead" in system.lower() or "first" in system.lower() or "start" in system.lower()


def test_groq_chat_raises_on_missing_key(monkeypatch):
    monkeypatch.setattr(llm.settings, "groq_api_key", None)
    with pytest.raises(llm.LLMError):
        import asyncio
        asyncio.run(llm.groq_chat([{"role": "user", "content": "hi"}]))