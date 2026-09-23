# Task 11 - USB-serial digital twin rework (DONE: stack removed, browser twin + on-demand tutor)

## Intent
Pivot OmniTwin from the MQTT/Influx/simulator data plane to a USB-serial architecture: the browser talks to the ESP32 over Web Serial, auto-detects the connected board, scans its components, and renders a draggable 2D digital twin - plus an on-demand AI tutor (Groq, key server-side).

## Done
- **Firmware** (`firmware/twinlab_node_v1`): MQTT/Wi-Fi fully removed; new line-delimited JSON protocol over UART0 (115200) with `IDENT` / `SCAN` / `STREAM on|off` / `PING`; board probe sweep 0x03..0x77; DHT22 probe on GPIO4; bench-verified MPU6050/DHT22 sampler code kept verbatim; `proto_selftest()` + `dht_selftest()` asserts at boot; `secrets.h*` deleted (no credentials needed). `idf.py build` clean. Commit `071408b`.
- **Backend** (`backend/`): MQTT subscriber, InfluxDB writer, websocket manager, alert engine, readings/sim/ws routers all deleted. `main.py` slimmed to `devices` + `roster` + new `tutor` routers, version 0.3.0. New `POST /tutor`: builds an OpenAI-shaped prompt from the rig snapshot, calls Groq (`llama-3.3-70b-versatile`), persists transcript to Mongo `tutor_sessions` (one per device), 502 on LLM failure. Key is server-side only (`backend/.env` -> `GROQ_API_KEY`, gitignored). `requirements.txt` drops paho-mqtt and influxdb-client. Commits `b4deb98` + `d2e2d7f`. Tests `tests/test_llm.py` 3/3.
- **Frontend** (`frontend/src/serial/`): pure node-testable `serialModel.mjs` (line reassembly w/ noise filtering, scan parse -> component map, layout add/move/wire, local anomaly flags, timeout helper) + thin Web Serial wrapper `serialBridge.js` (`SerialSession` with single in-flight command resolver). `node --test` 9/9. Commit `603d4ae`.
- **Frontend dashboard**: `App.jsx` rewritten to connect -> scan -> twin flow (Chrome/Edge Web Serial CTA, IDENT/PING/SCAN/STREAM states, live readings + anomaly flags) with `TwinCanvas.jsx` (draggable component sprites, live-value overlays, anomaly ring) + `ComponentSprite.jsx` (inline author-created SVG: ESP32, breadboard, MPU6050, DHT22) + `TutorPanel.jsx` ("Ask the Tutor" button + threaded chat, NEVER auto-fires). 9 dead components/hooks deleted. `api.js` trimmed to devices/roster + `askTutor`. Commits `468e9e4`, `8873cbe`. Build + oxlint clean.
- **Stack removal**: `git rm -r sim-control ingestion.py simulator.py mosquitto.conf`; `run.ps1` now starts only uvicorn (:8000) + vite (:5173). Commit `5fa29bb` + step-1 deletions.

## Expect
- `powershell -File .\run.ps1` -> dashboard :5173, API :8000 (no broker, no Influx, no sim-control).
- Plug ESP32 (USB) into Chrome/Edge -> **Connect your ESP32** -> pick COM port -> IDENT/SCAN place detected components on the canvas -> STREAM shows live values + anomaly flags -> **Ask the Tutor** for LLM coaching (needs `GROQ_API_KEY`).
- Unknown I2C addresses scan as `null` and are skipped; DHT22 missing probes as `ok:false`; add components manually via **+ Add component** if the scan missed one.

## Commands
```powershell
cd D:\OmniTwin; powershell -File .\run.ps1
.\.venv\Scripts\python -m pytest tests\test_roster.py tests\test_llm.py -q
cd backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
cd ..\frontend; npm run build; npm run lint; node --test tests
cd D:\OmniTwin\firmware\twinlab_node_v1; idf.py build
```

## Deferred / noted
- **No physical kit on hand**: firmware flash + live twin verification are human-demo steps (needs the ESP32 + COM port).
- Wire *drawing* on the canvas is model/rendering-ready (`addWire` + dashed SVG) but has no click-drag gesture in the UI yet - layout renders wires added programmatically.
- `stream_task` (core 1) and `reply_scan`'s DHT read can interleave printf on UART0; host-side `readLine` hardens against it but the lines are not perfectly atomic on the wire.