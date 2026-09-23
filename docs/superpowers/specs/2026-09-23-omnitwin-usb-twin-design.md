# OmniTwin USB Twin — Design Spec

Date: 2026-09-23
Status: approved (2026-09-23, architecture A + on-demand tutor)

## 1. Why this exists

The pilot's real value is the **autodetect flow**: a student plugs their ESP32 rig into a PC by USB cable, the software detects the connected microcontroller, scans the board's project, and renders its **digital twin** — with an on-demand **AI tutor** that explains/coaches when asked. The current MVP runs a Wi-Fi/MQTT simulated pipeline, which is the wrong assumption. This design replaces the data plane with a browser↔firmware USB serial link and adds the twin canvas + tutor.

## 2. Scope

### In scope (this iteration)
- ESP32 firmware serial protocol (identify / scan / stream / ping) over the USB console UART.
- Web Serial bridge in the dashboard: detect connected COM port, open, scan, live-stream.
- Auto-detection with manual fallback: I2C scan maps addresses to components; DHT22 probed via firmware; `+ Add component` for misses.
- 2D digital twin canvas: drag-and-place component sprites (ESP32, MPU6050, DHT22, breadboard), draw wires, animated data flow, live value overlays.
- On-demand AI tutor: "Ask the Tutor" button + chat UI, LLM call only on user action, key server-side.
- Remove the MQTT/Influx/simulator/sim-control stack.
- Keep FastAPI (add `/tutor`), Mongo (alert history), roster endpoints (future multi-rig), brand.

### Out of scope (deferred)
- Multi-user/multi-rig orchestration beyond the existing roster/quota/demo-kit endpoints.
- Full bus-level electrical auto-config (e.g. ADC/DHT pin re-probing beyond the wired GPIO).
- Mobile, LMS, billing, auth hardening, cloud deployment.

## 3. Design

### 3.1 Firmware serial protocol (`firmware/twinlab_node_v1`)

Line-based JSON on the USB console UART (the same serial line used for flashing; the board already enumerates a COM port).

| Command (browser → firmware) | Response (firmware → browser) |
|---|---|
| `IDENT\n` | `{"device":"ESP32","fw":"1.0","board":"<model>"}` |
| `SCAN\n` | `{"i2c":[{"addr":104,"name":"mpu6050"}],"dht22":{"gpio":4,"ok":true}}` |
| `STREAM on\n` / `STREAM off\n` | continuous lines ~10 Hz: `{"ts":...,"temp":24.3,"hum":55.1,"ax":-0.1,"ay":0.2,"az":9.8}` |
| `PING\n` | `{"pong":true}` |

- I2C 7-bit scan; known address registry maps addresses to component templates (0x68 → MPU6050). DHT22 is single-wire GPIO (not I2C), probed on its wired GPIO pin.
- Wiring: MPU6050 on I2C bus; DHT22 data on a configured GPIO (pin constant in firmware).

### 3.2 Browser ↔ board bridge

- Chrome/Edge Web Serial API (`navigator.serial`). Dashboard lists detected ports, opens the selected one, runs `SCAN`, then `STREAM on`.
- Port enumeration + read loop lives in a new `frontend/src/serial/` module (`serialBridge.js`), consumed by the twin + live data hooks.
- No background LLM calls ever; serial read loop is client-side only (streaming stays in-browser, optionally mirrored to backend later).

### 3.3 Auto-detection + manual fallback

- `SCAN` response → component registry maps `{addr,name}` to sprites with default placements on the breadboard canvas; DHT22 probe result marks its node ok/fail.
- A `+ Add component` control lets the student place any supported component manually (corrects a miss or mis-detection).
- Supported components: ESP32 devkit, MPU6050, DHT22, breadboard. Assets downloaded into `frontend/src/assets/twin/` (open-license).

### 3.4 Twin canvas

- 2D builder: SVG breadboard backdrop + draggable component sprites.
- Drag to place; click-drag between pins to draw wires; dashed animated stroke shows data flow direction.
- Live value overlays per component (temp/humidity on DHT22 node, accel on MPU6050 node), colored state for local anomaly flags.
- Layout persists to localStorage.

### 3.5 On-demand AI tutor (scan + chat)

- **"Ask the Tutor"** button: builds a context packet (detected components, current values, last N readings, local anomaly flags) → `POST /tutor` → LLM → returns explanation + next step, shown in the tutor panel.
- **Chat UI**: threaded panel; each user turn appends question + same live context; history sent with the request.
- No proactive/anomaly-triggered LLM calls. Local in-browser anomaly flags (NaN reading, out-of-range, frozen stream) show as badges at zero LLM cost.
- Backend `/tutor`: FastAPI route taking `{context, messages}`; calls Groq with server-side key (`GROQ_API_KEY` env); stores chat history in Mongo (`tutor_sessions`).

### 3.6 Stack changes

- **Delete:** `ingestion.py`, `simulator.py`, `sim-control/`, backend MQTT handler, InfluxDB/Mosquitto references.
- **Keep:** FastAPI + Mongo + roster/quota/demo-kit endpoints, `frontend/` as the app shell, OmniTwin brand, ESP-IDF build chain.
- `run.ps1`: start backend + frontend Vite only.

## 4. Error handling

- Serial open failure / port busy → clear UI message + retry.
- Firmware timeouts (no `PONG`/`SCAN` reply within N seconds) → "board not responding, check cable". `SCAN` partial results degrade gracefully (detected subset shown; misses recoverable via Add).
- LLM failure (no key, network, rate limit) → tutor shows a friendly offline message, does not break the twin UI; no crash cascade.

## 5. Testing

- Firmware: `idf.py build` green; protocol self-check via serial loopback script (`tests/test_serial.py`) asserts IDENT/SCAN/STREAM/PING contract.
- Backend: pytest for `/tutor` route (mock LLM client) + roster endpoints retained.
- Frontend: `npm run build`; manual demo flow (connect → detect → scan → twin → tutor).
- Messenger of last resort for unplugged hardware: run the twin empty and tutor explains "no board connected".

## 6. Acceptance (per approved architecture A)

1. Plug ESP32 (MPU6050 + DHT22 on breadboard) into the PC; open dashboard in Chrome/Edge.
2. Dashboard lists the detected COM port; clicking it runs the scan.
3. MPU6050 auto-appears (I2C 0x68); DHT22 shows with probe result; manual add available for misses.
4. Student arranges components + wires on the canvas; live values stream onto component overlays.
5. "Ask the Tutor" (and chat) returns LLM-generated explanation grounded in the current live readings; no LLM calls on their own.
6. MQTT/Influx/simulator stack removed; `run.ps1` boots backend + dashboard only.

## 7. Hard constraints

- Never modify `D:\TwinLab_v2` (read-only upstream).
- Never the LLM key in browser/client code.
- No `git push`.
- PowerShell only (`;` chaining, never `&&`), PS 5.1.