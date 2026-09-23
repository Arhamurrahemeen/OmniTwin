import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from db.mongo import get_db

log    = logging.getLogger("twinlab.alerts_router")
router = APIRouter()

_SAFE_ID = re.compile(r"^[\w\-]+$")


@router.get("/{device_id}/alerts")
async def get_alerts(
    device_id: str,
    limit: int = Query(50, ge=1, le=200),
    since: str | None = Query(None, description="ISO timestamp — return only alerts after this time"),
):
    if not _SAFE_ID.match(device_id):
        raise HTTPException(400, "Invalid device_id format")

    db    = get_db()
    query = {"device_id": device_id}

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["created_at"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(400, "Invalid 'since' timestamp — use ISO 8601")

    docs = (
        await db.alerts.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(length=limit)
    )

    # Serialise datetime → ISO string for JSON
    for doc in docs:
        if isinstance(doc.get("created_at"), datetime):
            doc["created_at"] = doc["created_at"].isoformat()

    return docs
