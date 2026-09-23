# Task 5 — Roster router: import, quota gate, demo-kit, project creation (DONE)

## Intent
Add the education layer: import students from CSV, give each 1 project slot, create student-owned simulated projects, and rotate the shared hardware kit via `/demo-kit`.

## Done
- `owner: Optional[str] = None` added to the 3 device models.
- `backend/edu_defaults.py` — `DEFAULT_THRESHOLDS` (temp max 40, humidity 20–90, vibration max 0.2).
- `backend/routers/roster.py` + root `conftest.py` (puts `backend/` on pytest's path).
- Routes: `POST /roster/import` (multipart CSV, upsert dedupe) · `GET /roster` (with project counts + remaining) · `GET /roster/{student_id}/projects` · `POST /projects` (owner required, quota 403, **always `source=simulator`**) · `POST /demo-kit` (hardware-only, owner rotation).
- TDD: `tests/test_roster.py` 4/4 passing (header/junk CSV skip · empty · quota boundary `used==limit`→denied · safe device id).
- Route handlers exercised directly with a stubbed DB (no services yet) — covers demo-kit 400/404, quota 403, owner-forced simulator.
- **Fix round 1:** `python-multipart` pinned in `requirements.txt` (FastAPI needs it for file upload).
- Commits: `417d173` + `7a84a27`. Review: clean.

## Expect
- A CSV (`name,email` header) imports students; each gets 1 project slot; a student at quota gets 403; only the shared hardware device rotates via demo-kit.
- `backend/models/student.py` deliberately NOT created — nothing uses a student model (doc shape is inline).
- Live Mongo/MQTT behavior still unverified — that's Task 10.

## Commands
```powershell
cd D:\OmniTwin; .\.venv\Scripts\python -m pytest tests/test_roster.py -v   # 4 passed
cd D:\OmniTwin\backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
# openapi (services running): http://localhost:8000/openapi.json → /roster/import, /roster, /projects, /demo-kit
```