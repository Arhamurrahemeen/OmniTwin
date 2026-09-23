# Task 10 — Pilot dry-run rehearsal (DONE: 9/9 PASS + service provisioning)

## Intent
Provision the three native services and rehearse the full DUET session end-to-end, fixing whatever breaks.

## Done
- **Services installed + running (all native, no Docker):**
  - Mosquitto (winget `EclipseFoundation.Mosquitto` 2.1.2) → service, :1883.
  - MongoDB 7.0.28 (winget MSI) → service :27017, `authorization: enabled`, user `admin`/`twinlab123` created; motor URI verified.
  - InfluxDB 2.7.12 (winget `InfluxData.InfluxDB.OSS`) → :8086 via scheduled task `OmniTwin-InfluxDB` (ONLOGON); `influx setup` org/bucket=twinlab, token=twinlab-super-secret-token (matches run.ps1/config.py).
- **Rehearsal 9/9 PASS** with `run.ps1`: roster import 10 students (remaining 1 each) · project 201 + `source=simulator` + 403 on second (quota) · live MQTT→ingestion→Influx→API charts (last-known + readings) · Inject Overheat → critical alert + `hint_en` · Inject Vibration → alert + hint · Drop Connectivity → freeze + load-shedding last-known, release → live resumes · demo-kit: TL-REHEARSAL rotate B→A, 400 on simulator device · both vite apps 200.
- **Fixes (2):** `run.ps1` re-encoded UTF-8-with-BOM — PS 5.1 choked on the em-dash in the launcher line, so the stack never started; this was the "deferred minor" from Task 2, actually a hard blocker. `backend/routers/roster.py:91` → `status_code=201` on `POST /projects` (sibling already 201; frontend only checks `res.ok`).
- Commit `2153017`. Review: clean.

## Expect
- Everything boots with `powershell -File .\run.ps1` — dashboard :5173, sim-control :5174, API :8000, ingestion + simulator publishing to the real local broker/store.
- **Alerts may be quiet for up to 10 min after the rehearsal**: run `POST /sim/reset` first (the 600 s per-sensor cooldown + leftover alerts from this run). Use fresh emails if you want a truly clean roster.
- Physical-kit steps were substituted with sim injectors (same data path minus the radio); shake-the-kit + real demo-kit still need the actual ESP32 (Task 9's deferred bring-up).

## Commands
```powershell
cd D:\OmniTwin; powershell -File .\run.ps1     # full stack
curl -i -X POST http://localhost:8000/sim/reset   # clear rehearsal cooldowns
# pilot eyeball: dashboards above; sim-control Inject Overheat → temp >40 alert + hint; Drop Connectivity → load-shedding banner
```

## Open product question (your call)
`/demo-kit` counts the hardware kit toward the assigned student's project quota (`_project_count` tallies all owned devices). So a kit rotation before a student creates their own project blocks them (quota reached). Acceptable — or exclude `source=="hardware"` from the count. Reviewer agreed it's a product decision, not a bug.