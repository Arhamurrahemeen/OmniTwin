# OmniTwin MVP Implementation Plan (DUET Pilot)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OmniTwin DUET-pilot MVP in `D:\OmniTwin` by copying and adapting the working TwinLab_v2 codebase: a live digital-twin dashboard (virtual simulated twins + one real ESP32 kit) with threshold-based fault detection and a student roster/quota layer.

**Architecture:** Reuse the proven TwinLab_v2 pipeline (MQTT Mosquitto → `ingestion.py` → InfluxDB; `main.py` MQTT→WebSocket bridge + threshold alert engine; FastAPI routers; React/Vite dashboard; Vite sim-control). Add a thin education layer: `owner` on devices, roster import with per-student project quota, `/demo-kit` rotation for the shared hardware project, education default thresholds + hint text on alerts. Strip TwinLab's industrial features (chat, RUL, FCM push, fuel-theft, run-hours, generator sim) and all branding.

**Tech Stack:** Python 3.12 + FastAPI + Motor (async Mongo) + paho-mqtt; Mosquitto + MongoDB + InfluxDB as **native Windows services (no Docker)**; React + Vite + recharts; Vite sim-control app; ESP-IDF 6.x firmware (ESP32).

**Spec:** `docs/superpowers/specs/2026-09-23-omnitwin-mvp-design.md`

## Global Constraints

- **Never modify `D:\TwinLab_v2`.** It is read-only upstream. All work happens in `D:\OmniTwin`.
- **No Docker.** Mosquitto, MongoDB 7.0, InfluxDB 2.7 run as native Windows services. Deployment is the founder's laptop (LAN).
- **No `git push`.** Commit locally only. Remote/push actions are the owner's.
- **Python runs from `.venv`** in `D:\OmniTwin`. JS apps keep their own `node_modules` (reinstalled after copy — never copied).
- **Stripped features (do not reintroduce):** Groq chat, RUL, FCM push, WhatsApp/Twilio, fuel-theft rule, run-hours/consumable-reorder, generator + fuel/load sim, Android app, Isolation Forest, bilingual/Urdu UI, LMS, billing, authentication. MQTT stays on topic `twinlab/device/{id}/sensor/{sensor}`, payload `{"value","unit","ts"}` (ms).
- **Wordmark:** dashboard header must use the rendered asset from `docs/OmniTwin_Wordmark_Dark.pdf` — never a re-approximation. Correct capitalization is **OmniTwin**.
- **Brand colors (from `docs/Brand.md`):** deep signal green `#0F6E56` (primary), ink `#04342C`, kit orange `#D85A30` (student-facing only), paper `#F1EFE8`. Typefaces: Space Grotesk (headings), JetBrains Mono (data), system sans (body). Fonts are free Google Fonts.
- Device-ID discipline preserved: ids match `^[\w\-]+$` everywhere.
- Powershell: commands run with `workdir` set to the owning directory; use `;`/`if ($?)` chaining, never `&&`.

## Review Focus

These inputs are not exercised by any single task's happy-path test but must not break the MVP; each is pinned to the task that owns the code:

1. **CSV roster import with junk rows** — an empty file, missing header, or rows missing a name or a valid email must skip cleanly, never crash the endpoint, and report created/skipped counts. → Task 5 test `test_parse_roster_csv`.
2. **Quota boundary exactly at the limit** — a student with `used == project_limit` must get 403 on a new project; deleting one of their projects frees a slot (live count, not a stored counter). → Task 5 test `test_quota_boundary`.
3. **Duplicate alert suppression** — a breach that keeps firing within the 600 s cooldown must produce exactly one alert. → Task 4 self-check.
4. **demo-kit mis-targeting** — assigning the demo kit to a student when the device isn't `source:hardware` must 400, and assigning to a fresh student must 200 (rotation overwrites `owner`). → Task 5 tests.
5. **Devices with no thresholds** — a project with empty `thresholds` must never alert (no crashes in the hot path). → Task 4 self-check.

---

### Task 1: Copy TwinLab_v2 scaffold into OmniTwin

**Files:**
- Create: copy of listed TwinLab_v2 paths into `D:\OmniTwin`
- Create: `D:\OmniTwin\.gitignore`
- Create: `D:\OmniTwin\README.md`

**Interfaces:**
- Consumes: the TwinLab_v2 tree at `D:\TwinLab_v2`
- Produces: the working tree every later task modifies

- [ ] **Step 1: Copy the code**

```powershell
# From D:\OmniTwin (already a git repo with the spec committed)
Copy-Item -Recurse "D:\TwinLab_v2\backend"  "D:\OmniTwin\backend"
Copy-Item -Recurse "D:\TwinLab_v2\frontend" "D:\OmniTwin\frontend"
Copy-Item -Recurse "D:\TwinLab_v2\sim-control" "D:\OmniTwin\sim-control"
Copy-Item -Recurse "D:\TwinLab_v2\firmware" "D:\OmniTwin\firmware"
Copy-Item "D:\TwinLab_v2\simulator.py","D:\TwinLab_v2\ingestion.py","D:\TwinLab_v2\mosquitto.conf","D:\TwinLab_v2\requirements.txt" "D:\OmniTwin\"
```
Do **not** copy: `node_modules`, `.venv`, `build/`, `__pycache__`, `.git`, `.env`, `fcm-service-account.json`, `secrets.h`, `*.log`, `mosquitto/data`, `mosquitto/log`, `android/`, `phase/`, `*.db`, `seed_nfl.py`, `test_mqtt.py`, `git-commands.md`, `docker-compose.yml`.

- [ ] **Step 2: Delete industrial leftovers**

```powershell
Remove-Item -Recurse -Force "D:\OmniTwin\firmware\twinlab_node_v1\build","D:\OmniTwin\firmware\twinlab_node_v1\main\build"
Remove-Item -Force "D:\OmniTwin\backend\.env","D:\OmniTwin\backend\fcm-service-account.json" -ErrorAction SilentlyContinue
Remove-Item -Force "D:\OmniTwin\firmware\twinlab_node_v1\main\secrets.h" -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Directory -Filter __pycache__ "D:\OmniTwin" | Remove-Item -Recurse -Force
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
# Python
.venv/
__pycache__/
*.pyc
*.pyo
*.egg-info/
.idea/
.claude

# Environment — contains credentials, never commit
backend/.env
backend/fcm-service-account.json
firmware/twinlab_node_v1/main/secrets.h

# ESP-IDF build output
firmware/twinlab_node_v1/build/
firmware/twinlab_node_v1/main/build/
firmware/twinlab_node_v1/sdkconfig
firmware/twinlab_node_v1/sdkconfig.old

# Mosquitto runtime
mosquitto/data/
mosquitto/log/

# Node
node_modules/
dist/

# Runtime logs
*.log
```

- [ ] **Step 4: Write a minimal `README.md`** (one paragraph: what OmniTwin is, the pilot goal, and a pointer to `docs/`).

- [ ] **Step 5: Verify the copy**

```powershell
cd "D:\OmniTwin"; git status --short   # only new additions of the copied tree
Test-Path "D:\OmniTwin\backend\main.py"; Test-Path "D:\OmniTwin\frontend\src\App.jsx"
# Confirmed ABSENT (stripped): android/, docker-compose.yml, backend/push.py, routers/chat.py
```

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "chore: import TwinLab_v2 scaffold as OmniTwin baseline"
```

---

### Task 2: Native services + venv + pipeline runs

**Files:**
- Create: `run.ps1`
- Create: `.venv` (Python 3.12)

**Interfaces:**
- Produces: running Mosquitto:1883, MongoDB:27017, InfluxDB:8086; `D:\OmniTwin\.venv\Scripts\python`; `run.ps1`

- [ ] **Step 1: Install native services (Windows)**

- **Mosquitto:** install via `winget install EclipseMosquitto.Mosquitto` (or the Windows installer from mosquitto.org). Start service `net start mosquitto`.
- **MongoDB 7.0 Community Server:** installer from mongodb.com, keep default port 27017. Start `net start MongoDB`.
- **InfluxDB 2.7:** download the Windows zip from influxdata.com; run `influxd.exe` as a scheduled task / background process on port 8086. First-run setup via `http://localhost:8086`: org `twinlab`, bucket `twinlab`, user `admin`, password `twinlab123`, token `twinlab-super-secret-token`.
- Because no Docker init script exists now, document these exact setup values in `run.ps1` header comments.

- [ ] **Step 2: Create venv and install deps**

```powershell
cd "D:\OmniTwin"; python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install --upgrade paho-mqtt influxdb-client fastapi "uvicorn[standard]" motor pydantic-settings pytest httpx
```

- [ ] **Step 3: Write `run.ps1`**

```powershell
# OmniTwin local dev run (native services already installed/running)
# T1: Mosquitto  , T2: InfluxDB 2.7 , T3: MongoDB 7.0  (native, NOT Docker)
# InfluxDB setup values: org=twinlab bucket=twinlab user=admin pwd=twinlab123 token=twinlab-super-secret-token
param([switch]$DashboardOnly)
$py = "D:\OmniTwin\.venv\Scripts\python"

Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "D:\OmniTwin\ingestion.py"
Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "D:\OmniTwin\simulator.py"
if (-not $DashboardOnly) {
  Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "-m","uvicorn","main:app","--reload","--host","0.0.0.0","--port","8000" -WorkingDirectory "D:\OmniTwin\backend"
}
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\frontend"
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\sim-control"
Write-Host "OmniTwin running — dashboard http://localhost:5173  sim-control http://localhost:5174  API http://localhost:8000/docs"
```

- [ ] **Step 4: Reinstall JS deps**

```powershell
cd "D:\OmniTwin\frontend"; npm install
cd "D:\OmniTwin\sim-control"; npm install
```

- [ ] **Step 5: Verify the copied pipeline runs end-to-end**

```powershell
cd "D:\OmniTwin"; & .\.venv\Scripts\python -c "import fastapi, motor, influxdb_client, paho.mqtt.client; print('deps ok')"
# Start ingestion, simulator, backend per run.ps1 (or run each in its own terminal), then:
curl.exe -s http://localhost:8000/health            # {"status":"ok"}
curl.exe -s "http://localhost:8000/readings" -o $null -w "%{http_code}\n"   # expected 404 (no route) — sanity only
# Register a throwaway sim device via POST /devices then confirm /devices returns it:
#   body {"device_id":"pg-test-1","name":"Pipeline Test","location":"lab","sensors":["temperature","humidity"],"source":"simulator"}
# Within one simulator refresh (30s), GET /devices/pg-test-1/readings?sensor=temperature returns values.
```

- [ ] **Step 6: Commit**

```powershell
git add run.ps1 README.md .gitignore; git commit -m "chore: native run setup + venv + run.ps1"
```

---

### Task 3: Strip industrial backend — config, requirements, pruned routers

**Files:**
- Delete: `backend/routers/chat.py`, `backend/routers/rul.py`, `backend/routers/push.py`, `backend/push.py`
- Modify: `backend/config.py`, `requirements.txt`
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: Task 1 tree
- Produces: `Settings` without groq/fcm/diesel fields; `main.py` imports only `devices, readings, alerts, sim, ws` routers plus the new `roster` (mounted in Task 5); no `twinlab.chat`/`rul`/`push` references anywhere

- [ ] **Step 1: Trim `backend/config.py`** — delete `groq_api_key`, `fcm_credentials_file`, `diesel_price_pkr` from `Settings`. Keep mqtt/influx/mongo settings.

- [ ] **Step 2: Trim `requirements.txt`** — remove `groq`, `firebase-admin`; keep `paho-mqtt`, `influxdb-client`, `fastapi`, `uvicorn[standard]`, `motor`, `pydantic-settings`; add `pytest` and `httpx` (test deps; `httpx` is needed by fastapi TestClient).

- [ ] **Step 3: Delete pruned routers**

```powershell
Remove-Item -Force "D:\OmniTwin\backend\routers\chat.py","D:\OmniTwin\backend\routers\rul.py","D:\OmniTwin\backend\routers\push.py","D:\OmniTwin\backend\push.py"
```

- [ ] **Step 4: Rewrite `backend/main.py` imports + lifespan**

Remove `import push`, `from routers import chat, rul, push as push_router`. Remove the `push_tokens` FCM block and the `consumable_reorder` branch in `_persist_alert`. Remove the `load_current`/`vibration` run-hours evaluation in `_on_mqtt_message`. In `lifespan`, keep only `await alert_engine.refresh_cache()` and `asyncio.create_task(alert_engine.cache_loop())` — delete the `seed_run_hours()` and `flush_run_hours_loop()` calls (those functions are removed in Task 4). New router mounts:

```python
app.include_router(devices.router,       prefix="/devices", tags=["devices"])
app.include_router(readings.router,      prefix="/devices", tags=["readings"])
app.include_router(alerts_router.router, prefix="/devices", tags=["alerts"])
app.include_router(sim_router.router,    prefix="/sim",     tags=["sim-control"])
app.include_router(ws.router,            tags=["websocket"])
# app.include_router(roster.router, tags=["roster"])   # ADDED in Task 5
```
Change `log = logging.getLogger("twinlab")` to `"omnitwin"`. Do **not** create `roster` yet — its mount comes with its implementation in Task 5, and `main.py` must boot before then (Task 3 Step 6 smoke test runs with the line commented).

- [ ] **Step 5: Grep-verify no industrial references remain in active code**

```powershell
rg -n "chat|rul|push|firebase|groq|diesel|fuel_theft|run_hours" --glob "!*.pyc" "D:\OmniTwin\backend"
# Only TASK 4/5/6 will still match alerts.py / simulator.py / routers/sim.py — those are fixed next.
```

- [ ] **Step 6: Smoke test backend boots**

```powershell
cd "D:\OmniTwin\backend"; ..\.venv\Scripts\uvicorn main:app --port 8000
# Starts without ImportError; /openapi.json contains no /chat, /devices/{id}/rul, or /push routes.
```

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "chore: strip industrial backend (groq/rul/push/fcm)"
```

---

### Task 4: Alert engine — threshold-only with education hints

**Files:**
- Modify: `backend/alerts.py`

**Interfaces:**
- Consumes: Task 3
- Produces: `evaluate(device_id, sensor, value, unit, last_known) -> dict | None` (unchanged signature), each alert dict now includes `hint_en` (one-sentence plain-language guidance). Removes `evaluate_run_hours`, `evaluate_run_hours_vibration`, `set_run_hours`, `seed_run_hours`, `flush_run_hours_loop`, `reset_state`'s run-hours pieces, `_CRITICAL_MAX` = `{"temperature", "vibration"}` only.

- [ ] **Step 1: Rewrite the alert body with a hint map**

```python
_HINTS = {
    "temperature": {"max": "Overheating — check ventilation or the sensor is near a heat source.",
                     "min": "Temperature very low — check the sensor is seated correctly."},
    "humidity":    {"max": "Humidity very high — check the sensor is not damp or near steam.",
                     "min": "Humidity very low — check the sensor is connected."},
    "vibration":   {"max": "Strong vibration — check the mounting and that nothing is loose.",
                     "min": "No vibration signal — shake the kit to confirm it is on."},
}
```
In `_make_alert`, drop the `fuel_theft` and `consumable_reorder` branches and the `message_ur` field (English only for the pilot), and add:

```python
detail = f"above max {max_v}"   # or f"below min {min_v}"
hint   = _HINTS.get(sensor, {}).get("max" if "above" in detail else "min",
              "Check the sensor and its connection.")
return { **alert, "hint_en": hint }
```
Set `_CRITICAL_MAX = {"temperature", "vibration"}`. Add `hint: ""` default in the returned dict for every alert type.

- [ ] **Step 2: Update the `__main__` self-check** in `backend/alerts.py` to assert:
  1. vibration `0.20` above max `0.15` → alert, `severity == "critical"`, `alert_type == "threshold"`, `hint_en` non-empty;
  2. immediate re-fire with the same value within cooldown → `None`;
  3. a device with `_threshold_cache` entry `{}` (no thresholds) → `None` for any value;
  4. `temperature` below min fires a **warning** (not in `_CRITICAL_MAX`).
  Also confirm `evaluate_run_hours` is gone from the module namespace.

- [ ] **Step 3: Run the self-check**

```powershell
cd "D:\OmniTwin\backend"; ..\.venv\Scripts\python alerts.py
# Expected: "[alerts] self-check passed"
```

- [ ] **Step 4: Commit**

```powershell
git add backend/alerts.py; git commit -m "feat: threshold-only alert engine with education hints"
```

---

### Task 5: Roster router — import, quota gate, demo-kit, project creation

**Files:**
- Create: `backend/edu_defaults.py`
- Create: `backend/routers/roster.py`
- Create: `backend/models/student.py`
- Create: `tests/test_roster.py`
- Modify: `backend/main.py` (mount router — already in Task 3 Step 4)
- Modify: `backend/models/device.py` (add `owner`)

**Interfaces:**
- Consumes: Task 3/4
- Produces (exact names/locations for the frontend in Task 6):
  - `parse_roster_csv(text: str) -> list[dict]` — list of `{"name","email"}`; skips header (`name`,`email` in first row) and any row missing a name or a valid email. Pure, testable.
  - `make_project_id(name: str, owner: str) -> str` — slug + `-` + 6-char hash, matches `^[\w\-]+$`. Pure.
  - `is_over_limit(used: int, limit: int) -> bool`.
  - `DEFAULT_THRESHOLDS: dict` in `edu_defaults.py` — `{"temperature": {"min": None, "max": 40.0}, "humidity": {"min": 20.0, "max": 90.0}, "vibration": {"min": None, "max": 0.2}}`.
  - Routes: `POST /roster/import` (multipart file upload), `GET /roster`, `GET /roster/{student_id}/projects`, `POST /projects`, `POST /demo-kit`.
  - Students live in `students` collection: `{"student_id": email, "name", "email", "project_limit": 1}`. `owner` on a device = the student's email.

- [ ] **Step 1: Add `owner` to `backend/models/device.py`** — `owner: Optional[str] = None` on `DeviceCreate`, `DeviceUpdate`, `DeviceResponse`.

- [ ] **Step 2: Write `backend/edu_defaults.py`**

```python
DEFAULT_THRESHOLDS = {
    "temperature": {"min": None, "max": 40.0},
    "humidity":    {"min": 20.0, "max": 90.0},
    "vibration":   {"min": None, "max": 0.2},
}
```

- [ ] **Step 3: Write the failing test**

```python
# tests/test_roster.py
import pytest
from routers.roster import is_over_limit, make_project_id, parse_roster_csv

def test_parse_roster_csv_skips_header_and_junk():
    text = "name,email\nAli Khan,ali@duet.edu.pk\n,broken@\nNoatSign.co\nSara, sara@duet.edu.pk\n"
    rows = parse_roster_csv(text)
    assert len(rows) == 2
    assert {"name": "Ali Khan", "email": "ali@duet.edu.pk"} in rows
    assert {"name": "Sara", "email": "sara@duet.edu.pk"} in rows

def test_parse_roster_csv_empty():
    assert parse_roster_csv("") == []
    assert parse_roster_csv("name,email\n") == []

def test_quota_boundary():
    assert not is_over_limit(0, 1)
    assert is_over_limit(1, 1)      # exactly at limit → denied
    assert not is_over_limit(1, 2)
    assert is_over_limit(2, 2)

def test_make_project_id_safe():
    pid = make_project_id("Boiler Twin 2", "ali@duet.edu.pk")
    import re
    assert re.fullmatch(r"[\w\-]+", pid)
```

- [ ] **Step 4: Run it to verify it fails**

```powershell
cd "D:\OmniTwin"; .\.venv\Scripts\pytest tests/test_roster.py -v
# Expected: collection error (module routers.roster doesn't exist)
```

- [ ] **Step 5: Implement `backend/routers/roster.py`**

```python
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


@router.post("/projects")
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
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
cd "D:\OmniTwin"; .\.venv\Scripts\pytest tests/test_roster.py -v
# Expected: 4 passed
```

- [ ] **Step 7: Verify routes mount + fastapi app imports** (also pin the Review-Focus case: demo-kit on a simulator device → 400 is covered by code; run a manual curl check)

```powershell
cd "D:\OmniTwin\backend"; ..\.venv\Scripts\python -c "from routers import roster; print('roster ok')"
# Manual (services up): POST /devices with sample hardware device, then POST /demo-kit
#   {"device_id": "...", "owner": "ali@duet.edu.pk"} → 200; on a simulator device → 400.
```

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "feat: roster import, quota gate, demo-kit, project creation"
```

- [ ] **Step 9: Mount roster + verify app boots with it** — in `backend/main.py`, replace the Task 3 comment with `from routers import roster` in the imports and `app.include_router(roster.router, tags=["roster"])` in the router block, then:

```powershell
cd "D:\OmniTwin\backend"; ..\.venv\Scripts\python -c "import main; print('app ok')"
# Expected: no ImportError; /openapi.json lists /roster/import, /roster, /projects, /demo-kit
```

---

### Task 6: Simulator + sim-control — hardware-only sensors, education injectors

**Files:**
- Modify: `simulator.py`
- Modify: `backend/routers/sim.py`
- Modify: `sim-control/src/components/DeviceControl.jsx`
- Delete: `sim-control/src/components/DemoControlPanel.jsx`

**Interfaces:**
- Consumes: Task 5 (sim router still gates on `source:simulator`)
- Produces: simulator publishes only hardware sensors (`temperature, humidity, accel_x/y/z, vibration`); sim_control docs use `base_values {temperature, humidity}`; injectors = `{"overheat", "vibration", "offline"}`; `generator_on`, `fuel_level`, `load_current`, `fuel_theft`, `overload` removed everywhere.

- [ ] **Step 1: Rewrite `simulator.py` `_compute_values` + main loop**

- Drop `_fuel_level`, `_doc_base_fuel`, `THEFT_DRAIN_PER_TICK`, `NORMAL_DRAIN_PER_TICK`.
- `_sensor_value`: keep only `accel_x/y/z` (return `random.uniform(-0.05, 0.05)` g with `accel_z` around `1.0`) plus a `vibration` fallback (`random.uniform(0.02, 0.08)` g). Remove gyro/fuel/load branches.
- `_compute_values(device_id, sensors, ctrl, t)`:
  - `offline` active → return `None`.
  - `temperature`: `overheat` active → `random.uniform(96, 100)`; else `base.get("temperature", 30.0) + random.uniform(-1, 1)`, unit `C`.
  - `humidity`: `base.get("humidity", 55.0) + random.uniform(-2, 2)`, unit `%`.
  - `vibration`: normal `random.uniform(0.02, 0.08)`; `vibration` injector active → `random.uniform(0.5, 0.8)` (must breach default max `0.2`), unit `g`.
  - everything else → `_sensor_value(sensor, t)`.
- Startup log string `"[TwinLab Simulator]"` → `"[OmniTwin Simulator]"`.

- [ ] **Step 2: Rewrite `backend/routers/sim.py` constants + defaults**

```python
INJECTORS = ("overheat", "vibration", "offline")

def _default_ctrl(device_id: str) -> dict:
    return {
        "device_id":    device_id,
        "base_values":  {"temperature": 30.0, "humidity": 55.0},
        "inject": {name: {"active": False, "until_ts": 0} for name in INJECTORS},
        "updated_at":   datetime.now(timezone.utc).isoformat(),
    }
```
Remove `generator_on` from `_default_ctrl`, and remove the `generator_on` reset line in `reset_demo`.

- [ ] **Step 3: Remove DemoControlPanel** — delete the file and its usage in `sim-control/src/App.jsx` (hardcoded NFL device IDs no longer exist).

- [ ] **Step 4: Rewrite `DeviceControl.jsx`**

```javascript
const INJECT_DURATION_MS = 120_000
const INJECTORS = [
  { key: "overheat",   label: "Inject Overheat",     icon: "🌡" },
  { key: "vibration",  label: "Inject Vibration",    icon: "📳" },
  { key: "offline",    label: "Drop Connectivity",   icon: "📡" },
]
```
Remove the generator toggle, the Fuel Level and Load Current sliders, and the `merge` fields for `generator_on`. Keep Temperature + Humidity sliders and the injector buttons (same `update`/`putSimCtrl` pattern). Header text `sim-title` → `OmniTwin`, `sim-subtitle` → `Instructor Console`.

- [ ] **Step 5: Verify injector + sensor flow end-to-end**

```powershell
# services up; create a sim project via POST /projects (owner = a rostered student)
curl.exe -s http://localhost:8000/sim
# Sim device listed with base_values {temperature, humidity}, inject keys overheat/vibration/offline.
# PUT /sim/<id> {"device_id":<id>,"base_values":{"temperature":30,"humidity":55},"inject":{"overheat":{"active":true,"until_ts": (unix ms + 120000)},"vibration":{"active":false,"until_ts":0},"offline":{"active":false,"until_ts":0}},"updated_at":"..."}
# Within 2 s the dashboard temperature chart spikes above 95 and an alert fires (see Task 4 rules).
```

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: hardware-only simulator + education injectors"
```

---

### Task 7: Frontend — project framing, roster UI, alerts hints

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/DeviceList.jsx`
- Modify: `frontend/src/components/RegisterDevice.jsx`
- Modify: `frontend/src/components/AlertsPanel.jsx`
- Modify: `frontend/src/components/EditDevice.jsx`
- Create: `frontend/src/components/RosterPanel.jsx`
- Delete: `frontend/src/components/RulCard.jsx`, `frontend/src/components/ChatPanel.jsx`

**Interfaces:**
- Consumes: Task 5 routes, Task 6 sim
- Produces: dashboard speaks "project" not "device"; roster import UI; project creation opens the student dropdown and posts to `POST /projects`; alerts render `hint_en`; RUL strip and chat FAB gone.

- [ ] **Step 1: Rewrite `frontend/src/api.js`** — remove `getRul`, `postChat`. Add:

```javascript
export const getRoster   = () => _get('/roster')
export const getProjects = getDevices   // renaming for readability; keep getDevices as-is (used by DeviceList)
export async function importRoster(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE}/roster/import`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`POST /roster/import → ${res.status}`)
  return res.json()
}
export async function createProject(payload) {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? `POST /projects → ${res.status}`) }
  return res.json()
}
export async function assignDemoKit(deviceId, owner) {
  const res = await fetch(`${BASE}/demo-kit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, owner }),
  })
  if (!res.ok) throw new Error(`POST /demo-kit → ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: Rewrite `frontend/src/App.jsx`** — remove `RulCard` + `ChatPanel` imports/renders; brand header becomes the wordmark image (place the rendered PNG at `frontend/src/assets/wordmark.png` in Task 8); navbar subtext → `Digital twin learning lab`; add a `RosterPanel` in a left rail under the project list; empty-state copy → `Select a project to view live sensor data.`

- [ ] **Step 3: Rework `DeviceList.jsx`** — panel title `Projects`; plant-grouping preserved but header falls back to `(owner || 'Shared')` when `d.owner` is set; rename `+` button tooltip to `Create project`; summary strip → `{n} projects · {m} shared demo kit`. Keep device-card markup (name, source badge, sensors).

- [ ] **Step 4: Rework `RegisterDevice.jsx` → project creation** — add a required **Owner** field (email), keep Name/Location/Sensors/Thresholds, call `createProject` (drops the source dropdown for students — projects are always `simulator`); on success call `onCreated`. Keep hardware registration path on the RosterPanel or a small `+` on the shared kit card (instructor-only, uses `POST /devices` with `source:"hardware"` once, then `assignDemoKit` to rotate).

- [ ] **Step 5: Update `AlertsPanel.jsx`** — render `a.hint_en` under `a.detail`; drop the `🛒`/`fuel theft` branches; tag always renders `threshold`; remove the `push_sent` routing line.

- [ ] **Step 6: Slim `EditDevice.jsx`** — remove asset_type, plant, criticality, warranty, purchase date, vendor fields, run-hours; keep name/location/source/status/sensors/thresholds; show `owner` read-only.

- [ ] **Step 7: Create `RosterPanel.jsx`** — file input (accepts `.csv`) → `importRoster`; lists students with `name / email · 1 project limit · remaining`; clicking a student with remaining quota opens project creation pre-filled with `owner`.

- [ ] **Step 8: Verify**

```powershell
cd "D:\OmniTwin\frontend"; npm run dev   # http://localhost:5173
# Visual check: no RUL strip, no chat FAB, Projects panel, RosterPanel imports a CSV,
# alerts show hint text, "+" create project submits with owner.
```

- [ ] **Step 9: Commit**

```powershell
git add -A; git commit -m "feat: project framing + roster UI in dashboard"
```

---

### Task 8: OmniTwin brand retheme (dashboard + sim-control)

**Files:**
- Create: `scripts/render_wordmark.py`
- Modify: `frontend/index.html` (fonts), `frontend/src/assets/wordmark.png` (generated), `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/index.css`
- Modify: `sim-control/src/App.jsx`, `sim-control/src/App.css`

**Interfaces:**
- Consumes: `docs/OmniTwin_Wordmark_Dark.pdf`
- Produces: light paper navbar hosting the wordmark PNG; brand palette tokens; Space Grotesk + JetBrains Mono loaded; no `TwinLab`/`OmniteX` string anywhere.

- [ ] **Step 1: Write `scripts/render_wordmark.py`** (uses PyMuPDF, installed via `.\.venv\Scripts\pip install pymupdf`)

```python
"""One-off: render docs/OmniTwin_Wordmark_Dark.pdf page 1 -> frontend/src/assets/wordmark.png."""
import fitz
pdf = fitz.open("docs/OmniTwin_Wordmark_Dark.pdf")
page = pdf[0]
pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
pix.save("frontend/src/assets/wordmark.png")
print("saved frontend/src/assets/wordmark.png")
```

- [ ] **Step 2: Run it and commit the PNG** (verification: PNG exists and is non-empty; open it once to confirm legibility)

```powershell
cd "D:\OmniTwin"; .\.venv\Scripts\python scripts\render_wordmark.py
```

- [ ] **Step 3: Add fonts to `frontend/index.html`**

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500&family=JetBrains+Mono&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Retheme `App.css`** — add palette CSS variables and swap the surfaces:

```css
:root {
  --ot-green:   #0F6E56;   /* deep signal green — primary */
  --ot-ink:     #04342C;   /* text / dark UI */
  --ot-paper:   #F1EFE8;   /* neutral background */
  --ot-orange:  #D85A30;   /* kit orange — student-facing accents only */
}
```
- `.navbar` → background `var(--ot-paper)`, border-bottom `1px solid #e3e0d6`; navbar hosts the wordmark `<img>` at height ~30px.
- `.app` background → `#F6F5F0` (paper-adjacent), text → `var(--ot-ink)`.
- Panels/cards/charts → white `#fff` surfaces, border `1px solid #E3E0D6`.
- Muted text → `#6A7888`; sensor tags, primary buttons, status fuel → `var(--ot-green)`; alert warning → `var(--ot-orange)`, alert critical → keep `#E05252`.
- Headings use `font-family: 'Space Grotesk', system-ui, sans-serif` (`.navbar`, `.panel-title`, `.charts-device-name`); sensor readouts/chart latest values use `'JetBrains Mono', monospace`.
- Remove/drop `.bm-a`, `.bm-b` brand-mark span styles and all `.chat-*`, `.rul-*`, `.criticality-*`, `.device-warranty` blocks (components deleted).

- [ ] **Step 5: Retheme `frontend/src/index.css`** — set `body { font-family: system-ui, sans-serif; }`, ink text color, paper bg; remove any per-brand overrides.

- [ ] **Step 6: Update `App.jsx` navbar** to use the wordmark image and `OmniTwin` identity (header already touched in Task 7).

- [ ] **Step 7: Retheme sim-control** — `sim-control/src/App.css` to the same palette (paper bg, green accents); header `OmniTwin · Instructor Console`.

- [ ] **Step 8: Grep for branding leaks**

```powershell
rg -in "twinlab|omnitex" --glob "!*.pyc" --glob "!node_modules/**" --glob "!*.json" "D:\OmniTwin"
# Only hits allowed: the MQTT topic prefix "twinlab/#" in backend/main.py, ingestion.py,
# simulator.py, mosquitto.conf (leave the broker topic untouched). Everything else clean.
```

- [ ] **Step 9: Verify visuals** — load `http://localhost:5173`: paper navbar, wordmark legible, green accents, mono data numbers, no stale brand colors; `http://localhost:5174` matches.

- [ ] **Step 10: Commit**

```powershell
git add -A; git commit -m "feat: OmniTwin brand retheme + wordmark"
```

---

### Task 9: Firmware bring-up (real kit)

**Files:**
- Modify: `firmware/twinlab_node_v1/main/secrets.h` (create from `.example`; gitignored)

**Interfaces:**
- Consumes: `firmware/twinlab_node_v1` source copied in Task 1; backend/storage from Tasks 2–6
- Produces: the physical ESP32 publishing `temperature`, `humidity`, `accel_x/y/z`, `vibration` to the laptop's MQTT broker; the shared `source:hardware` project.

- [ ] **Step 1: Copy `secrets.h.example` → `secrets.h`** and fill: `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST` = laptop LAN IP from `ipconfig` (never `localhost`).

- [ ] **Step 2: Build + flash**

```powershell
cd "D:\OmniTwin\firmware\twinlab_node_v1"; idf.py build; idf.py -p COM<x> flash monitor
```

- [ ] **Step 3: Register the kit server-side** — `POST /devices` with `device_id` = the MAC-derived ID printed in the monitor (`TL-XXXXXXXX`, from the firmware), `source: "hardware"`, sensors `["temperature","humidity","accel_x","accel_y","accel_z","vibration"]`.

- [ ] **Step 4: Verify** — dashboard shows live hardware readings; `GET /devices/<id>/last-known` non-empty; touch the kit's temperature sensor (or shake it to spike vibration) and confirm the alert panel + `hint_en` fires per default thresholds.

- [ ] **Step 5: Commit** (firmware source changes only — `secrets.h` stays untracked)

```powershell
git add -A; git commit -m "feat: firmware bring-up ready (secrets.h local)"
```

---

### Task 10: Pilot dry-run checklist + fixes

**Files:**
- Modify: anything that breaks during rehearsal

**Interfaces:**
- Consumes: Tasks 1–9
- Produces: a rehearsed DUET session runnable on the laptop

- [ ] **Step 1: Rehearse the full session** using `run.ps1` (services + ingestion + simulator + backend + dashboard + sim-control all native):
  1. Instructor imports a 10-student CSV via the RosterPanel.
  2. A student creates exactly 1 simulated project; creating a second → 403 shown in the UI.
  3. Live twin charts populate without any code change (registry-driven).
  4. Instructor opens sim-control → `Inject Overheat` → dashboard temperature chart breaches → alert + `hint_en` appears.
  5. Shake the real kit → vibration alert fires with correct hint.
  6. `Drop Connectivity` → load-shedding banner shows last-known readings; release → live resumes.
  7. `demo-kit` assigns the kit to student B after A; both used it in turn.
- [ ] **Step 2: Fix whatever breaks**, re-running the affected step until the checklist is green.
- [ ] **Step 3: Final commit** `git add -A; git commit -m "chore: pilot dry-run hardening"`.

---

## Self-Review Notes (recorded during planning)

- `parse_roster_csv` lowercases email via `parts[1].lower()` (case-insensitive `owner`).
- `POST /projects` sets `body.source = "simulator"` regardless of client value — students cannot create hardware artifacts.
- Task 5's demo-kit 400-on-simulator review case is enforced by code (KIT); its test is the manual Step 7 curl check.
- Cooldown uniqueness (Review focus #3) is owned by Task 4's existing `_cooldown` behavior; Task 4 self-check asserts the immediate re-fire returns `None`.
- Wordmark file is committed (rendered PNG), never copied from a build cache.