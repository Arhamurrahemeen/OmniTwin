# Task 3 — Strip industrial backend: config, requirements, pruned routers (DONE)

## Intent
Remove the industrial machinery from the copied backend so the app is OmniTwin-only: no Groq chat, no RUL prediction, no FCM push, no diesel price config. Keep the proven pipeline (MQTT→WebSocket bridge, threshold alerts, devices/readings/sim/ws routers).

## Done
- `config.py`: dropped `groq_api_key`, `fcm_credentials_file`, `diesel_price_pkr` (mqtt/influx/mongo kept).
- `requirements.txt`: removed `groq`, `firebase-admin`; added `pytest`, `httpx` (for the Task 5 roster tests).
- Deleted `routers/chat.py`, `routers/rul.py`, `routers/push.py`, `push.py`.
- `main.py`: removed their imports + FCM `push_tokens` block + `consumable_reorder` branch + run-hours eval; lifespan trimmed to `refresh_cache` + `cache_loop`; logger renamed `omnitwin`; roster mount left **commented** (Task 5 turns it on).
- Verification (no native services yet, so an import check stands in for a live boot): `import main` → **`app ok`**; OpenAPI has no `/chat`, `/rul`, `/push`.
- **Fix round 1:** dropped a dead `timezone` import (reviewer caught a vague justification for it — corrected in the report too).
- Commits: `7905dd9` + `28bb341`. Review: clean.

## Expect
- Backend imports clean; the industrial features are unreachable. Alerts/devices code still carries run-hours fields and fuel-theft logic — Tasks 4 and 6 remove those next (planned, not missed).
- Still cannot serve live HTTP until you install Mosquitto + MongoDB (see `docs/tasks/task-2.md`).

## Commands
```powershell
cd D:\OmniTwin\backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
# app ok
# (after services are installed) ..\.venv\Scripts\python -m uvicorn main:app --port 8000
# openapi: http://localhost:8000/openapi.json — no /chat, /rul, /push
```