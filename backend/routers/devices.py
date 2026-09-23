import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

import alerts as alert_engine
from db.mongo import get_db
from models.device import DeviceCreate, DeviceResponse, DeviceUpdate

log = logging.getLogger("twinlab.devices")
router = APIRouter()


@router.post("", response_model=DeviceResponse, status_code=201)
async def create_device(body: DeviceCreate):
    db = get_db()
    if await db.devices.find_one({"device_id": body.device_id}):
        raise HTTPException(400, f"Device '{body.device_id}' already exists")
    now = datetime.now(timezone.utc)
    doc = {**body.model_dump(), "created_at": now, "updated_at": now}
    await db.devices.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("", response_model=list[DeviceResponse])
async def list_devices():
    db = get_db()
    return await db.devices.find({}, {"_id": 0}).to_list(length=200)


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: str):
    db = get_db()
    doc = await db.devices.find_one({"device_id": device_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Device '{device_id}' not found")
    return doc


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(device_id: str, body: DeviceUpdate):
    db = get_db()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields provided to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.devices.update_one({"device_id": device_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, f"Device '{device_id}' not found")

    if "run_hours" in updates:
        alert_engine.set_run_hours(device_id, updates["run_hours"])

    return await db.devices.find_one({"device_id": device_id}, {"_id": 0})


@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: str):
    db = get_db()
    result = await db.devices.delete_one({"device_id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(404, f"Device '{device_id}' not found")
