# OmniTwin

OmniTwin is a hands-on digital twin learning platform: students connect a low-cost ESP32 + sensor kit to a software platform that mirrors real physical sensor data in a live interactive dashboard, with AI-assisted fault detection and coaching that guides (never autonomously controls) the hardware. The MVP pilot targets engineering students in Pakistan — starting at DUET — and consists of this codebase, adapted from the TwinLab_v2 prototype, spanning an MQTT-ingesting FastAPI backend (`backend/`), a Vite/React dashboard (`frontend/`), a device/simulation control service (`sim-control/`), and the ESP32 firmware (`firmware/`). See `docs/` for the full product spec, design, and team details.

## Quick start

Services run natively on Windows (no Docker). The MVP stack requires:

- Mosquitto (MQTT broker) on `:1883`
- InfluxDB 2.7 on `:8086` — org/bucket `twinlab`, token `twinlab-super-secret-token`
- MongoDB 7.0 on `:27017` — db `twinlab`, user `admin`/`twinlab123`, auth enabled

Install these (e.g. `winget`), then start the whole stack from the repo root:

```powershell
powershell -File .\run.ps1
```

That spawns `ingestion.py`, `simulator.py`, the backend (`:8000`), and both Vite apps. Note the venv python path is hardcoded in `run.ps1` — create it first:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
npm install   # in frontend/ and sim-control/
```

## Layout

- `backend/` — FastAPI app (`main:app`), routers, alert engine, demo kit + roster import with per-student project quota
- `frontend/` — student dashboard (live twin charts, alerts, roster)
- `sim-control/` — instructor console (simulator switches: overheat / vibration / offline)
- `firmware/` — ESP32 sensor firmware (see `docs/tasks/task-9.md` for build/flash)
- `ingestion.py` / `simulator.py` / `run.ps1` — local MQTT → Influx/Mongo data path launcher

## Tests

```powershell
.\.venv\Scripts\python -m pytest tests\test_roster.py -q
```

## Environment

- OS: Windows (win32), PowerShell 5.1, Python 3.13 (venv at `.venv`), ESP-IDF v6.0.2 for firmware.
- The hardware kit is ESP32 (`firmware/twinlab_node_v1`); you must add Wi-Fi/MQTT creds to the gitignored `firmware/twinlab_node_v1/main/secrets.h` before flashing.