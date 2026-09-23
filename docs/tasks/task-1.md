# Task 1 — Copy TwinLab_v2 scaffold into OmniTwin (DONE)

## Intent
Bring the working TwinLab_v2 codebase into the new `D:\OmniTwin` repo as the baseline: backend, frontend, sim-control, firmware, simulator.py, ingestion.py, mosquitto.conf, requirements.txt — stripped of industrial/inert leftovers.

## Done
- Copied the 8 paths above from `D:\TwinLab_v2` (read-only — never modified upstream).
- Removed what must not commit: `node_modules`, `build/`, `__pycache__`, `.env`, `fcm-service-account.json`, `secrets.h`, `android/`, `*.db`, `*.log`, `mosquitto/data+log`, `docker-compose.yml`, `seed_nfl.py`, `test_mqtt.py`, `git-commands.md`.
- **Fix round:** initially stripped `backend/push.py` and `backend/routers/chat.py` too, but `main.py` imports them — restoring kept the scaffold runnable (correct; Task 3 deletes them properly, together with their imports).
- Wrote `.gitignore` (venue, deps, configs, ESP-IDF build, dist) and a minimal `README.md`.
- Commits: `e6ffeea` (scaffold), `0fd746d` (restore push/chat). Review: clean.

## Expect
- Working tree has the full TwinLab_v2 code + `.gitignore` + `README.md`; `git status` clean.
- Backend not yet runnable: `main.py` imports resolve, but third-party deps (paho, etc.) aren't installed until Task 2's venv.

## Commands
```powershell
git log --oneline -3                    # e6ffeea, 0fd746d
Test-Path D:\OmniTwin\backend\main.py; Test-Path D:\OmniTwin\frontend\src\App.jsx
Test-Path D:\OmniTwin\android           # False (stripped)
```