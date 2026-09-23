import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

import alerts as alert_engine
from db.mongo import get_db

router = APIRouter()

_ID_RE = re.compile(r'^[\w\-]+$')

INJECTORS = ("fuel_theft", "overheat", "overload", "offline")


def _default_ctrl(device_id: str) -> dict:
    return {
        "device_id":    device_id,
        "generator_on": True,
        "base_values":  {"fuel_level": 70.0, "load_current": 18.0, "temperature": 35.0, "humidity": 55.0},
        "inject": {name: {"active": False, "until_ts": 0} for name in INJECTORS},
        "updated_at":   datetime.now(timezone.utc).isoformat(),
    }


async def _get_or_create(db, device_id: str) -> dict:
    doc = await db.sim_control.find_one({"device_id": device_id}, {"_id": 0})
    if not doc:
        doc = _default_ctrl(device_id)
        await db.sim_control.insert_one(dict(doc))
    return doc


async def _assert_simulator(db, device_id: str) -> None:
    device = await db.devices.find_one({"device_id": device_id}, {"source": 1})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("source") != "simulator":
        raise HTTPException(status_code=400, detail="Not a simulator device")


@router.get("")
async def list_sim_devices():
    """All source:simulator devices merged with their sim_control docs."""
    db = get_db()
    devices = await db.devices.find(
        {"source": "simulator"},
        {"_id": 0, "device_id": 1, "name": 1, "sensors": 1, "status": 1},
    ).to_list(length=200)

    result = []
    for dev in devices:
        ctrl = await _get_or_create(db, dev["device_id"])
        result.append({**dev, "sim_control": ctrl})
    return result


@router.post("/reset")
async def reset_demo():
    """Nuke transient demo state so the demo can be re-run cleanly. Idempotent — safe to spam-click."""
    db = get_db()

    # 1. Reset alert-engine in-memory state (cooldowns, fuel buffer, run-hours)
    alert_engine.reset_state()

    # 2. Deactivate all injectors on all sim devices, restore generator_on
    sim_docs = await db.sim_control.find({}).to_list(length=200)
    for doc in sim_docs:
        for inj_name in INJECTORS:
            doc.setdefault("inject", {})[inj_name] = {"active": False, "until_ts": 0}
        doc["generator_on"] = True
        await db.sim_control.replace_one({"device_id": doc["device_id"]}, doc)

    # 3. Zero run_hours on all devices (in-memory already cleared by reset_state)
    await db.devices.update_many({}, {"$set": {"run_hours": 0.0, "last_run_hours_update": None}})

    # 4. Purge alerts from the last 30 min so the panel starts clean for the next run
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    result = await db.alerts.delete_many({"created_at": {"$gte": cutoff}})

    return {"ok": True, "purged_alerts": result.deleted_count}


@router.get("/{device_id}")
async def get_sim_ctrl(device_id: str):
    if not _ID_RE.match(device_id):
        raise HTTPException(status_code=400, detail="Invalid device_id")
    db = get_db()
    await _assert_simulator(db, device_id)
    return await _get_or_create(db, device_id)


@router.put("/{device_id}")
async def update_sim_ctrl(device_id: str, body: Dict[str, Any]):
    if not _ID_RE.match(device_id):
        raise HTTPException(status_code=400, detail="Invalid device_id")
    db = get_db()
    await _assert_simulator(db, device_id)

    body.pop("_id", None)
    body["device_id"]  = device_id
    body["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.sim_control.replace_one(
        {"device_id": device_id},
        body,
        upsert=True,
    )
    return await db.sim_control.find_one({"device_id": device_id}, {"_id": 0})
