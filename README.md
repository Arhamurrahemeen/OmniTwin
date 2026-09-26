# OmniTwin

OmniTwin is a hands-on digital twin learning platform: students connect a low-cost ESP32 + sensor kit over USB and the platform auto-detects the connected board, scans the rig's components, and builds a live 2D digital twin of their physical setup — with an on-demand AI tutor for coaching (never autonomous control). The MVP pilot targets engineering students in Pakistan — starting at DUET — and consists of this codebase, adapted from the TwinLab_v2 prototype, spanning a FastAPI backend (`backend/`), a Vite/React dashboard (`frontend/`), the ESP32 firmware (`firmware/`), and Web Serial in Chrome/Edge. See `docs/` for the full product spec, design, and team details.

## Quick start

Services run natively on Windows (no Docker). The stack requires:

- MongoDB 7.0 on `:27017` — db `twinlab`, user `admin`/`twinlab123`, auth enabled
- Chrome or Edge (desktop) for the browser-side Web Serial bridge to the ESP32

Mosquitto and InfluxDB were REMOVED — the data plane is USB-serial: the board streams JSON to the browser over Web Serial, and Mongo stores device/roster/history.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
npm install   # in frontend/
```

For the AI tutor, set your Groq key server-side (the browser never sees it):

```powershell
# edit backend/.env
GROQ_API_KEY=sk-...
```

## Run

```powershell
powershell -File .\run.ps1
```

Spawns the backend and the dashboard:

- Dashboard: http://localhost:5173
- API docs: http://localhost:8000/docs

Plug in the ESP32, click **Connect your ESP32**, pick its COM port, and the twin canvas fills in from the board's scan. Note the venv python path is hardcoded in `run.ps1` — create it first (see Setup).

The board works even with sensors unplugged: IDENT/PING/SCAN answer and the stream degrades to DHT-only rows (accel `null`) when the MPU is absent. The full 2D twin and anomaly flags need the kit attached. SCAN can take ~12 s on an empty bus — wait for the status to reach `streaming`.

## Tests

```powershell
.\.venv\Scripts\python -m pytest tests\test_roster.py tests\test_llm.py -q
node --test "frontend/tests/*.test.mjs"
```

## Layout

- `backend/` — FastAPI app (`main:app`): device roster, demo-kit quota, on-demand `/tutor` (Groq, key server-side)
- `frontend/` — student dashboard: USB connect → scan → 2D digital twin canvas + AI tutor chat
- `firmware/` — ESP32 sensor firmware, UART0 JSON protocol (see `docs/tasks/task-11.md` for build/flash)
- `run.ps1` — local launcher (backend + dashboard)

## Environment

- OS: Windows (win32), PowerShell 5.1, Python 3.13 (venv at `.venv`), ESP-IDF v6.0.2 for firmware.
- The hardware kit is ESP32 (`firmware/twinlab_node_v1`); flash and serial-output docs in `docs/tasks/task-11.md`. No Wi-Fi/MQTT credentials needed — the board speaks the serial protocol over its USB port.