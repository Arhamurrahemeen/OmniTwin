# OmniTwin — MVP Design (DUET Pilot)

**Date:** 2026-09-23 · **Owner:** Arham · **Status:** approved by Arham (chat), ready for implementation plan

---

## 1. Purpose & Success

**Goal:** Run a DUET pilot canary — a small class of students engages with real live sensor data reflected in a digital twin, and at least one threshold fault is detected and explained.

**Success criteria for the MVP:**
- A student, hands-on with no prior setup, creates a virtual project and sees live sensor data in a dashboard within minutes.
- The single real ESP32 kit publishes to the laptop server and its readings appear live.
- A breached threshold raises a visible alert (fault detection) with a plain-language hint.
- Instructor imports a class roster from CSV; quota gate works server-side.

**Non-goals (deferred, explicitly out of MVP):** LLM/Groq coaching, bilingual Urdu UI, LMS integration, billing, authentication hardening, mobile app, RUL/ML anomaly models, fuel-theft rule (no fuel sensor), WhatsApp/push.

**Scale:** pilot shaped as a single-kit canary. Everything scale-dependent lives behind config, not architecture.

---

## 2. Reuse Decision

OmniTwin MVP is **built by copying and adapting the working TwinLab_v2 codebase** (`D:\TwinLab_v2`), which already implements the same pipeline. Rebuild-from-scratch is rejected.

**Hard rules:**
- `D:\TwinLab_v2` files are **never modified**. It remains the read-only upstream.
- New repo lives at **`D:\OmniTwin`** — fresh `git init`, committed locally only. **Never `git push`** — that is the owner's action.
- Development runs inside **`.venv`** (Python) in the OmniTwin repo.
- **No Docker.** Mosquitto, MongoDB, InfluxDB run as native Windows services; a `run.ps1` starts the pipeline.

**Copied in (source only, no `node_modules`, `.venv`, `build/`, `__pycache__`, `.db`, artifact/log/secret files):**
- `backend/` (routers: devices, readings, alerts, sim, ws; db, models, config, main, alerts)
- `frontend/` (React + Vite + recharts dashboard)
- `sim-control/` (Vite instructor console)
- `simulator.py`, `ingestion.py`, `mosquitto.conf`, `requirements.txt`
- `firmware/twinlab_node_v1/` (ESP-IDF source: `main/`, `CMakeLists.txt`; built fresh in place)

**Stripped from the copy:** `android/` app, `backend/push.py`, `routers/push.py`, FCM credentials, `chat.py`/`routers/chat.py`, `rul.py`/`routers/rul.py`, fuel-theft rule, Groq/firebase requirements, phase docs, all "TwinLab"/"OmniteX" branding.

**Removed dependencies from `requirements.txt`:** `groq`, `firebase-admin`.

---

## 3. Architecture

Unchanged pipeline (this is why we reuse):

```
        ESP32 kit (hardware) ┐
                             ├─ MQTT (Mosquitto) ──> FastAPI ──> WebSocket ──> React dashboard (students)
        simulator (virtual)  ┘                       │              │
                                                    ├─ REST ───────┴─> sim-control (instructor console)
                                                    └─ InfluxDB (readings) + MongoDB (registry, alerts, students)
```

- **Transport:** MQTT topic `twinlab/device/{device_id}/sensor/{sensor}` payload `{value, unit, ts}`.
- **Ingestion:** `ingestion.py` persists readings to InfluxDB.
- **Backend:** `main.py` runs MQTT handler → alert evaluation → WebSocket push; routers serve REST.
- **Simulator:** registry-driven; every `source:simulator & status:active` device publishes automatically → a student's virtual project produces data the moment it's created, with zero sim code change.

**Server = Arham's laptop** (LAN). Kits reach it via WiFi to laptop LAN IP in firmware config.

---

## 4. OmniTwin Added Layer

All additions are thin; the DB concept stays `devices`, only the UI calls it "project."

### 4.1 Owner + project model
- Add `owner` (nullable `student_id`; `null` = shared/instructor twin) to the devices document + Pydantic models (create/update/response).
- UI renames device → project. No schema migration decisions otherwise — additive field only.

### 4.2 Roster import + quota gate
- New `routers/roster.py`: `POST /roster/import` accepts CSV (`name,email`) → creates student records; `project_limit` default 1 (configurable).
- `GET /roster` lists students; `GET /roster/{id}/projects` returns project(s) + remaining quota.
- `POST /projects` creates a `source:simulator` project for a named student; **server rejects with 403 when quota exceeded** — the freemium gate lives in the backend, not the UI.
- `POST /demo-kit` (instructor-only shape, no auth for pilot) assigns the shared `source:hardware` project to a student briefly so everyone gets a rotation on real silicon.
- Storage: reuse MongoDB (new `students` collection + `owner` field on devices).

### 4.3 Fault detection (existing threshold engine, education defaults)
- Keep `alerts.py` threshold evaluation + WS push + AlertsPanel.
- Provide sensible default thresholds per sensor (temperature, humidity, accel/vibration) so an alert fires when data breaches — editable per project in the UI.
- Plain-language hint text attached to each alert ("Vibration too high — check loose mounting") = trimmed AI coaching. No LLM.

### 4.4 sim-control = instructor console
- Unchanged app; drives simulator baselines + fault injection live. Used for class demos and the "break it" moment.

---

## 5. Brand & UI

- Re-theme to OmniTwin identity per `docs/Brand.md`: deep green `#0F6E56`, ink `#04342C`, paper `#F1EFE8`, Space Grotesk headings / JetBrains Mono data / system body. Kit orange `#D85A30` fenced to student-facing elements only.
- Dashboard header uses the wordmark asset **`docs/OmniTwin_Wordmark_Dark.pdf`** as-is (render to png/svg for web — asset must be used, not re-approximated).
- Replace "TwinLab" / "OmniteX" strings with OmniTwin in UI + system prompt-adjacent strings (`grep -ri` check before done).
- UI text adopts education tone (student-facing playful, per Brand.md §5).

---

## 6. Hardware

- Kit: ESP32 + DHT22 (temp/humidity) + MPU6050 (vibration), firmware `firmware/twinlab_node_v1` (ESP-IDF, MAC-derived device ID, MQTT-over-TCP).
- Flash the existing firmware with WiFi SSID/password + `MQTT_HOST` = laptop LAN IP in `secrets.h` (from `secrets.h.example`).
- Register the kit as `source:hardware`, `owner: null` shared project. Class rotation via `/demo-kit`.
- Firmware publishes exactly the sensors it already does: `temperature`, `humidity`, `accel_x/y/z`, `vibration`.
- **Biggest schedule risk** (WiFi/LAN bring-up) — treated as buffer (Track 4), not critical path. Platform development does not block on hardware: simulator is the same pipeline.

---

## 7. Out of Scope (explicit)

- Authentication, passwords, roles, billing. Roster is scope-only (quota), not security.
- LLM coaching, RAG, Groq, bilingual/Urdu UI, LMS, mobile app, push notifications.
- ML anomaly detection (Isolation Forest stays parked), RUL forecasts.
- Fuel-theft rule, fuel/load sensors, MQTT auth, TLS.
- Containerization / cloud deployment / remote access (LAN laptop server only for pilot).

---

## 8. Build Sequence (4 weeks)

| Track | Days | Deliverables / acceptance |
|---|---|---|
| 1 — Copy & clean | 1–3 | Clean copy in `D:\OmniTwin`, `.gitignore`, `git init`, native services installed, `.venv` deps, `simulator + ingestion + backend + frontend` run; simulated data flows end-to-end |
| 2 — OmniTwin layer | 4–12 | `owner`, roster import, quota gate, `/demo-kit`, default thresholds. Acceptance: CSV → student creates virtual project → simulator streams it → threshold breach raises alert |
| 3 — Brand & UI | 13–16 | Palette, device→project rename, wordmark header, education copy. Acceptance: grep shows no TwinLab/OmniteX; wordmark renders |
| 4 — Real kit | 17–24 | Flash firmware → kit publishes → live on dashboard → real threshold alert. Acceptance: hardware readings live + alert verified |
| 5 — Pilot dry-run | 25–30 | DUET-style rehearsal: roster import, virtual twin, demo-kit rotation, fault inject, alert. Whatever breaks, fix |

Verification throughout: run + observe, plus small focused tests for non-trivial logic (quota gate, alert cooldown). No test framework mandate; one assert-based check or tiny `test_*.py` per non-trivial path.

---

## 9. Values (design principles for this MVP — not figures)

- **Prove it in a real classroom** — every feature must survive a student/demo moment, not a screenshot.
- **Reuse over rebuild** — upstream TwinLab_v2 is the fastest correct path; don't reinvent a working pipeline.
- **Smallest honest slice** — cut anything not needed to answer "does a class engage with live twin + fault detection?"
- **Local ownership** — runs on the founder's laptop, native services, no cloud dependency; the team owns every layer.
- **Feedback visible immediately** — a reading arrives → an alert fires → a hint explains, in a loop a student can see.
- **Be honest about constraints** — no auth beyond quota, LAN-only, single kit, rule-based detection. Named, not hidden.

---

## 10. Open Questions Carried Into Planning

- Exact CSV roster format (columns/headers) — decide in plan phase.
- Render path for the wordmark PDF (png/svg source available?) — plan phase.
- Default threshold values per sensor for education defaults — plan phase table.