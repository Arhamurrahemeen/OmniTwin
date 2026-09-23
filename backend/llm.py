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
    "Stay grounded in the given readings; never invent numbers."
)


def build_prompt(context: dict, messages: list[dict]) -> list[dict]:
    context_block = (
        "Student rig state:\n"
        f"- Device: {context.get('device_id', 'unknown')}\n"
        f"- Online: {context.get('online', True)}\n"
        f"- Detected components: {', '.join(c.get('label', c.get('type')) for c in context.get('components', [])) or 'none reported'}\n"
        f"- Live readings: {context.get('readings', {})}\n"
        f"- Anomaly flags: {context.get('anomalies', []) or 'none'}\n"
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