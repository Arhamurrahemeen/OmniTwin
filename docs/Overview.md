# OmniTwin — Overview

## 1. Problem Statement

Engineering students across Pakistan learn embedded systems, IoT, and industrial automation almost entirely through theory. Real hardware labs are expensive to build, expensive to maintain, and rarely available at scale — most students never get hands-on time outside a lucky few final-year projects. Universities either lack modern IoT/digital-twin labs entirely, or they're locked in a handful of top-tier institutions. Students graduate having read about sensor networks, predictive maintenance, and industrial monitoring, but never actually built, broke, or debugged one in real conditions.

## 2. Solution — what's built today

OmniTwin is a hands-on digital twin learning platform. The student owns a low-cost kit (ESP32 + MPU6050 + DHT22 on a breadboard) and the software mirrors the physical rig live on screen. Instead of simulating a system on paper, students see actual physical behavior — temperature, humidity, vibration — rendered in a virtual twin they can arrange, monitor, analyze, and get AI coaching on. The AI coaching is **guidance, never autonomous control** of the hardware, and it only runs when the student asks.

### Architecture

```
ESP32 rig ──USB cable──> browser (Web Serial) ──live twin canvas (frontend)
                                      │
                                      ├─/tutor (Groq, on-demand, key server-side)
                                      └─FastAPI ──> MongoDB (devices, roster, tutor_sessions)
```

- **Firmware** (`firmware/twinlab_node_v1`, ESP-IDF): line-delimited JSON protocol over UART0 (the board's USB console line) — `IDENT` / `SCAN` / `STREAM on|off` / `PING` / `DIAG`. `SCAN` sweeps the I2C bus (0x68/0x69 → MPU6050), probes the DHT22 on GPIO4, and reports unknown addresses as `null` for manual add. Device ID is MAC-derived (`TL-xxxxxx`). **No Wi-Fi, no MQTT, no credentials of any kind** — the board needs only its USB cable.
- **Browser bridge** (`frontend/src/serial/`): thin Web Serial wrapper + a pure, node-tested model that reassembles raw UART bytes into JSON lines, maps scan results to components, and computes cheap local anomaly flags (NaN / out-of-range / no-data) at zero LLM cost.
- **Dashboard** (`frontend/`, Vite/React): Connect your ESP32 → pick the COM port → IDENT/SCAN place detected components on a draggable 2D twin canvas (ESP32, breadboard, MPU6050, DHT22 sprites) → streaming live values with anomaly rings → "Ask the Tutor" chat. A `?demo=1` query param swaps the board for an offline fake session. Works even with sensors unplugged: the board still answers IDENT/PING/SCAN and the stream degrades to DHT-only rows (`accel null`).
- **Backend** (`backend/`, FastAPI v0.3.0 + MongoDB db `twinlab`): `devices` CRUD, `roster` (CSV import + server-side project-count quota + `/demo-kit` rotation for the shared hardware kit), and `POST /tutor` — builds an OpenAI-shaped prompt from the live rig snapshot and calls Groq with the key server-side only (`GROQ_API_KEY` in `backend/.env`); transcripts persist to `tutor_sessions`. The MQTT broker, InfluxDB, WebSocket router, and simulator stack were **removed** — the data plane is USB-serial.

Nothing runs autonomously: the LLM fires only when a student asks, anomaly flags are computed in the browser, and the backend stores registry/history, not a live stream.

## 3. Product Tiers (business model)

**Model:** Universal hardware — the platform works with any microcontroller + sensor/component set a student wires up (ESP32 included, not exclusive). Twin rendering, live telemetry, and local anomaly flags are free for everyone; the only paid gate is the **AI diagnostic tutor** — Freemium does not include it, every paid tier does.

| Tier | Target user | Pricing | AI tutor | Twin + live hardware | Build status |
|---|---|---|---|---|---|
| Freemium | Solo self-learners, high-schoolers, curious tinkerers | **Free forever** | ❌ Not included | ✅ Yes — full twin + telemetry on any hardware | **Built-ish** — roster quota gate server-side; twin + demo mode ship today |
| Student Pro (Regional) | Pakistani engineering undergrads, FYP teams | **PKR 1,490/month** or **PKR 4,999/semester** (6-month pass) | ✅ Included | ✅ Yes | Planned — pricing set, not yet built |
| Student Pro (Global) | International students, makers, indie engineers | **$19/month** | ✅ Included | ✅ Yes | Planned — pricing set, not yet built |
| University Enterprise | Engineering departments, polytechnic colleges | **PKR 500,000/year** (50-seat cohort bundle) | ✅ Included (cohort-wide) | ✅ Yes — department-wide fleet + LMS | Planned — pricing set, not yet built (pilot at DUET) |

**Pricing rationale (regional calibration, resolving the earlier B2C disconnect):** Pro is no longer a single global $20/month (~PKR 66,600/yr ≈ 30–70% of a student's discretionary spend, and an inverted arbitrage vs. the 10,000 PKR/seat institutional rate). Regional Pro at PKR 1,490/month (~$5.35) aligns with student data budgets + final-year-project group pooling, and infrastructure cost stays <$0.70/user/month (edge deadband compression, diagnostics only on anomaly triggers) — gross margin >85%.

**Not built yet (explicit MVP non-goals):** billing (incl. Raast/Easypaisa regional and Stripe global), authentication/roles, LMS integration, Urdu/bilingual UI, multi-rig orchestration. The roster/quota endpoints exist and are pilot-scoped (not security).

## 4. Why It's Needed (the honest version)

This is not a category being invented from scratch — digital twin education kits are an active, growing academic and commercial space globally (Siemens, PTC, National Instruments all have education tiers; Labtech International sells a near-identical "physical lab equipment → live digital twin" product commercially today). The real gap: none of these are built for Pakistani universities — priced for Pakistani budgets or running in Urdu. The honest wedge is not "no one does this," but "no one does this affordably and locally for this market."

## 5. Competitive Landscape

The market is polarized between enterprise-grade industrial suites universities can't afford and hobbyist dashboards lacking pedagogical scaffolding. Per the project brief:

| Platform | Primary focus | Institutional cost (50 seats) | Student tier | Hands-on hardware | Fault injection & AI coaching |
|---|---|---|---|---|---|
| Quanser QLabs | Mechatronics & control systems | $5,000–10,000+/yr (PKR 1.4M–2.8M/yr) | None (trial only) | Virtual-first; optional proprietary benches ($$$) | Rule-based simulation; no generative tutor |
| Factory I/O | PLC & industrial ladder logic | €2,500–4,000 perpetual (PKR 750k–1.2M) | 30-day trial only | Software only (connects to physical PLCs) | Pre-built failure modes; zero embedded AI guidance |
| Arduino Cloud for Schools | K-12 & entry microcontrollers | $1,000–1,250/yr (PKR 280k–350k/yr) | 2-device free tier | Yes (Arduino/ESP32 ecosystem) | Simple IDE code assistant; no digital twin or diagnostic engine |
| Blynk IoT | Rapid IoT dashboards & remote control | $350–1,200/yr (Business tiers) | Strict free plan (5 virtual pins) | Yes (generic microcontrollers) | None (dashboard UI only) |
| **OmniTwin** | **Industrial IoT & digital twin diagnostics** | **PKR 500,000/yr (~$1,800/yr flat)** | **Free tier, no AI tutor** | **Yes (any microcontroller + open local BOM)** | **Real-time anomaly detection & pedagogical AI tutor (paid)** |

**Positioning:** digital simulation-only tools (Wokwi, Tinkercad) sit at one pole; enterprise-grade suites at the other. OmniTwin sits at "any real hardware + AI diagnostics" — cheap, student-owned kits wired to any microcontroller, with an honest twin and AI coaching no vendor in this list ships.



