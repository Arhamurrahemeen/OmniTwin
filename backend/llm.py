"""Groq-backed chat for the OmniTwin tutor. Key is server-side only (GROQ_API_KEY)."""
import logging

import httpx

from config import settings

log = logging.getLogger("omnitwin.llm")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class LLMError(Exception):
    pass


_TUTOR_SYSTEM = (
    "You are OmniTwin's AI lab tutor for engineering students. You are shown the "
    "current state of the student's physical sensor rig (components detected, live "
    "readings, and any anomalies). Answer in plain language with a clear "
    "explanation and one actionable next step. Politely push the student to reason "
    "about the wiring themselves rather than handing them the whole answer. "
    "Stay grounded in the given readings; never invent numbers. "
    # The panel renders the reply as literal text in a <p>, so any markdown
    # arrives on screen as visible syntax: **, ##, and - bullets shown verbatim.
    # "Plain language" alone does not prevent this — models read it as plain
    # *English* and format anyway, so the ban has to be explicit.
    "Write plain text only: no markdown, no bold or italic markers, no headings, "
    "no bullet or numbered lists. Use short sentences and plain line breaks. "
    "If any WIRING FAULTS are listed, lead with them: they are already-diagnosed "
    "errors (a signal pin in a ground pin, and so on), so state the fault and what "
    "to change before discussing anything else. If any components are listed as NOT "
    "REPORTING, say so plainly too — that part has gone quiet, which is a wiring or "
    "power problem rather than a reading to interpret. Sensor anomaly flags are only "
    "threshold excursions and may well be a downstream effect of a wiring fault. "
    "When source-derived hardware is provided, cite its exact GPIO assignments, "
    "but say that the student's source declares them; never claim they verify the "
    "physical wiring."
)


def _source_hardware_summary(source_hardware: dict | None) -> str:
    if not isinstance(source_hardware, dict):
        return "none"

    details = []
    i2c = source_hardware.get("i2c")
    if isinstance(i2c, dict):
        sda, scl = i2c.get("sda"), i2c.get("scl")
        if sda is not None and scl is not None:
            details.append(f"I2C SDA GPIO{sda}, SCL GPIO{scl}")

    addresses = source_hardware.get("addresses", [])
    if addresses:
        formatted = [f"0x{addr:02X}" if isinstance(addr, int) else str(addr) for addr in addresses]
        details.append(f"I2C addresses {', '.join(formatted)}")

    for sensor in source_hardware.get("sensors", []):
        if not isinstance(sensor, dict):
            continue
        sensor_type = sensor.get("type", "sensor")
        pin = sensor.get("pin")
        details.append(f"{sensor_type} on GPIO{pin}" if pin is not None else str(sensor_type))

    for pin in source_hardware.get("pins", []):
        if not isinstance(pin, dict):
            continue
        label = pin.get("label") or f"GPIO{pin.get('pin')}"
        details.append(f"{label} (GPIO{pin['pin']})" if pin.get("pin") is not None else str(label))

    return "; ".join(details) or "no specific pin assignments parsed"


def build_prompt(context: dict, messages: list[dict]) -> list[dict]:
    context_block = (
        "Student rig state:\n"
        f"- Device: {context.get('device_id', 'unknown')}\n"
        f"- Online: {context.get('online', True)}\n"
        f"- Detected components: {', '.join(c.get('label', c.get('type')) for c in context.get('components', [])) or 'none reported'}\n"
        f"- Live readings: {context.get('readings', {})}\n"
        f"- Sensor anomaly flags: {context.get('anomalies', []) or 'none'}\n"
        f"- Not reporting (detected but its readings have gone quiet, so it is "
        f"unplugged or failing — a wiring/power fault, not a reading): "
        f"{context.get('disconnected', []) or 'none'}\n"
        f"- Wiring faults (a pin of one kind wired to a pin of another — the "
        f"student's connections, not a sensor reading): {context.get('wiring', []) or 'none'}\n"
        f"- Source-derived hardware (declared by code, not physically verified): "
        f"{_source_hardware_summary(context.get('sourceHardware'))}\n"
        f"- Static source-code findings: {context.get('codeFlags', []) or 'none'}\n"
    )
    convo = [{"role": "system", "content": _TUTOR_SYSTEM},
             {"role": "system", "content": context_block}]
    convo.extend([{"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages])
    return convo


async def groq_chat(messages: list[dict]) -> str:
    if not settings.groq_api_key:
        raise LLMError("GROQ_API_KEY is not set — set it in backend/.env")
    body = {
        "model": settings.groq_model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 400,
    }
    headers = {"Authorization": f"Bearer {settings.groq_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(_GROQ_URL, json=body, headers=headers)
            r.raise_for_status()
            payload = r.json()
            return payload["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError) as e:
        log.error("[tutor] LLM call failed: %s", e)
        raise LLMError("LLM call failed") from e