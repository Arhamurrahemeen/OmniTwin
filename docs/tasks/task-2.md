# Task 2 — Native services + venv + run.ps1 + pipeline runs (DONE, partial)

## Intent
Make the laptop able to run the copied stack: Python venv, dependency install, a one-command `run.ps1` launcher, JS deps, and an end-to-end pipeline check.

## Done
- Created `.venv` (python 3.13.15 — plan said 3.12; ruled acceptable) and installed `paho-mqtt influxdb-client fastapi "uvicorn[standard]" motor pydantic-settings pytest httpx`. Import check: `deps ok`.
- Wrote `run.ps1` per plan (starts ingestion, simulator, uvicorn on :8000, frontend :5173, sim-control :5174; `-DashboardOnly` skips the API).
- `npm install` in frontend + sim-control; both Vite apps boot and serve 200.
- **Native services ARE NOT INSTALLED on this laptop** (Mosquitto, MongoDB, InfluxDB all absent). Per controller ruling, the implementer only reported state — did not install. This is the one human step needed before the pilot runs.
- Commit: `9d5f429`. Review: clean (2 minors deferred: em-dash mojibake risk in run.ps1:14; run.ps1 spawns processes that crash while services are down).

## Expect
- `.\run.ps1` launches all processes, but ingestion/simulator will fail until Mosquitto+InfluxDB exist; the backend won't serve until Mongo exists (also: chat.py needs `groq` — removed in Task 3).
- You must install: **Eclipse Mosquitto** (winget), **MongoDB 7.0 Community**, **InfluxDB 2.7**. Influx first-run values are documented in `run.ps1` header (`org=twinlab bucket=twinlab user=admin pwd=twinlab123 token=twinlab-super-secret-token`).

## Commands
```powershell
D:\OmniTwin\.venv\Scripts\python -c "import fastapi, motor, influxdb_client, paho.mqtt.client; print('deps ok')"
# service state (pre-install):
Get-Process mosquitto -ErrorAction SilentlyContinue; Test-NetConnection localhost -Port 1883
Get-Service -Name MongoDB -ErrorAction SilentlyContinue; Get-NetTCPConnection -LocalPort 8086 -ErrorAction SilentlyContinue
# after services are installed:
cd D:\OmniTwin; .\run.ps1
# dashboard http://localhost:5173 · sim-control http://localhost:5174 · API http://localhost:8000/docs
```