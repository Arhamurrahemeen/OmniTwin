import hashlib
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, UploadFile

import edu_defaults
from db.mongo import get_db
from models.device import DeviceCreate

log = logging.getLogger("omnitwin.roster")
router = APIRouter()
_ID_RE = re.compile(r"^[\w\-]+$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def parse_roster_csv(text: str) -> list[dict]:
    rows = []
    for raw in text.strip().splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        name, email = parts[0], parts[1].lower()
        if name.lower() == "name" and email.lower() == "email":
            continue  # header
        if _EMAIL_RE.match(email) and name:
            rows.append({"name": name, "email": email})
    return rows


def make_project_id(name: str, owner: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9\-]+", "-", name.strip().lower()).strip("-") or "project"
    digest = hashlib.sha1(owner.encode()).hexdigest()[:6]
    return f"{slug}-{digest}"


def is_over_limit(used: int, limit: int) -> bool:
    return used >= limit


async def _student(db, student_id: str) -> dict:
    doc = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Student '{student_id}' not found")
    return doc


async def _project_count(db, owner: str) -> int:
    return await db.devices.count_documents({"owner": owner})


@router.post("/roster/import")
async def import_roster(file: UploadFile = File(...)):
    db = get_db()
    text = (await file.read()).decode("utf-8")
    rows = parse_roster_csv(text)
    created = 0
    for row in rows:
        res = await db.students.update_one(
            {"student_id": row["email"]},
            {"$setOnInsert": {**row, "student_id": row["email"], "project_limit": 1,
                              "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        created += 1 if res.upserted_id else 0
    return {"created": created, "skipped": len(rows) - created}


@router.get("/roster")
async def list_roster():
    db = get_db()
    out = []
    for s in await db.students.find({}, {"_id": 0}).to_list(length=500):
        s["projects"] = await _project_count(db, s["student_id"])
        s["remaining"] = max(0, s["project_limit"] - s["projects"])
        out.append(s)
    return out


@router.get("/roster/{student_id}/projects")
async def student_projects(student_id: str):
    db = get_db()
    await _student(db, student_id)
    return await db.devices.find({"owner": student_id}, {"_id": 0}).to_list(length=100)


@router.post("/projects", status_code=201)
async def create_project(body: DeviceCreate):
    db = get_db()
    if not body.owner:
        raise HTTPException(400, "owner (student email) is required")
    student = await _student(db, body.owner)
    if is_over_limit(await _project_count(db, body.owner), student["project_limit"]):
        raise HTTPException(403, "Project limit reached for this student")
    if body.thresholds:
        for patched in body.sensors:
            body.thresholds.setdefault(patched, {})
    else:
        body.thresholds = {s: edu_defaults.DEFAULT_THRESHOLDS.get(s, {}) for s in body.sensors}
    now = datetime.now(timezone.utc)
    body.device_id = make_project_id(body.name, body.owner)
    body.source = "simulator"
    doc = {**body.model_dump(), "created_at": now, "updated_at": now}
    await db.devices.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/demo-kit")
async def demo_kit(body: dict):
    db = get_db()
    device_id = body.get("device_id")
    owner = body.get("owner", None)
    if not _ID_RE.match(device_id or ""):
        raise HTTPException(400, "Invalid device_id")
    dev = await db.devices.find_one({"device_id": device_id}, {"_id": 0})
    if not dev:
        raise HTTPException(404, f"Device '{device_id}' not found")
    if dev.get("source") != "hardware":
        raise HTTPException(400, "Only the shared hardware kit can be rotated")
    if owner is None:
        raise HTTPException(400, "owner is required")
    await _student(db, owner)
    await db.devices.update_one({"device_id": device_id}, {"$set": {"owner": owner, "status": "active"}})
    return await db.devices.find_one({"device_id": device_id}, {"_id": 0})