import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from db.mongo import get_db

log = logging.getLogger("twinlab.push")
router = APIRouter()


class TokenBody(BaseModel):
    token: str


@router.post("/register", status_code=204)
async def register(body: TokenBody):
    db = get_db()
    now = datetime.now(timezone.utc)
    await db.push_tokens.update_one(
        {"token": body.token},
        {"$set": {"token": body.token, "last_seen": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    log.info(f"[PUSH] token registered ({body.token[:12]}…)")


@router.delete("/register/{token}", status_code=204)
async def unregister(token: str):
    db = get_db()
    await db.push_tokens.delete_one({"token": token})
    log.info(f"[PUSH] token removed ({token[:12]}…)")
