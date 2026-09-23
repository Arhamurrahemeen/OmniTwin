import logging
import re

from fastapi import APIRouter, HTTPException
from groq import Groq
from pydantic import BaseModel

from config import settings
from db.influx import get_query_api

log = logging.getLogger("twinlab.chat")
router = APIRouter()

_SAFE_ID = re.compile(r'^[\w\-]+$')

SYSTEM_PROMPT = """You are TwinLab, an industrial IoT assistant for factory monitoring.
You help factory operators — many of whom speak Urdu — understand their equipment health.

Rules:
- If the user writes in Urdu or Roman Urdu, reply in Roman Urdu (easy to read on any device).
- If the user writes in English, reply in English.
- Keep answers short, practical, and jargon-free.
- Always refer to specific sensor values from the context when explaining an issue.
- If asked about an anomaly, explain what it likely means for the equipment in plain language.
"""


def _fetch_latest_readings(device_id: str) -> dict:
    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "sensor_reading")
  |> filter(fn: (r) => r.device_id == "{device_id}")
  |> last()
"""
    try:
        tables = get_query_api().query(flux, org=settings.influx_org)
    except Exception:
        return {}

    readings = {}
    for table in tables:
        for record in table.records:
            sensor = record.values.get("sensor", "")
            if sensor:
                readings[sensor] = {
                    "value": round(record.get_value(), 4),
                    "unit": record.values.get("unit", ""),
                }
    return readings


def _build_context(device_id: str, readings: dict) -> str:
    lines = [f"Device ID: {device_id}"]
    if readings:
        lines.append("Latest sensor readings:")
        for sensor, data in readings.items():
            lines.append(f"  - {sensor}: {data['value']} {data['unit']}")
    else:
        lines.append("No recent sensor data available.")
    return "\n".join(lines)


class ChatRequest(BaseModel):
    device_id: str
    message: str


@router.post("/chat")
async def chat(req: ChatRequest):
    if not _SAFE_ID.match(req.device_id):
        raise HTTPException(400, "Invalid device_id format")
    if not req.message.strip():
        raise HTTPException(400, "Message cannot be empty")
    if not settings.groq_api_key:
        raise HTTPException(503, "Groq API key not configured")

    readings = _fetch_latest_readings(req.device_id)
    context = _build_context(req.device_id, readings)

    try:
        client = Groq(api_key=settings.groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"{context}\n\nOperator question: {req.message}"},
            ],
            max_tokens=512,
            temperature=0.4,
        )
        reply = response.choices[0].message.content.strip()
    except Exception as e:
        log.error(f"[Groq] API error: {e}")
        raise HTTPException(502, "Groq API error")

    return {"reply": reply}
