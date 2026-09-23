"""On-demand AI tutor. context holds the current rig snapshot; messages are the
student's chat turns. Persists the session to Mongo. NEVER called on its own."""
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

import llm
from db.mongo import get_db

log = logging.getLogger("omnitwin.tutor")
router = APIRouter()
_ID_RE = re.compile(r"^[\w\-]+$")


@router.post("")
async def tutor(body: dict):
    device_id = body.get("device_id") or "local"
    if not _ID_RE.match(device_id):
        raise HTTPException(400, "Invalid device_id")
    context = body.get("context", {})
    context.setdefault("device_id", device_id)
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages is required")

    prompt = llm.build_prompt(context, messages)

    db = get_db()
    try:
        reply = await llm.groq_chat(prompt)
    except llm.LLMError as e:
        raise HTTPException(502, f"Tutor unavailable: {e}")

    session = await db.tutor_sessions.find_one({"device_id": device_id}, {"_id": 0})
    if session is None:
        session = {"device_id": device_id, "session_id": str(uuid.uuid4()), "messages": []}
    session["messages"] = [
        *[m for m in session["messages"]],
        {"role": "user", "content": messages[-1].get("content", "")},
        {"role": "assistant", "content": reply},
    ]
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tutor_sessions.replace_one({"device_id": device_id}, session, upsert=True)

    return {"reply": reply, "session_id": session["session_id"]}