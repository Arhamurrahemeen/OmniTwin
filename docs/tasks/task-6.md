# Task 6 — Simulator + sim-control: hardware-only sensors, education injectors (DONE)

## Intent
Make the simulator mirror ONLY real-kit sensors (temperature, humidity, accel_x/y/z, vibration) with education injectors (overheat, vibration, offline), and rewrite the sim-control UI to match — cutting all industrial generator/fuel/load machinery.

## Done
- `simulator.py`: dropped fuel/load/generator + gyro branches; `_compute_values` now `offline→None`, overheat `uniform(96,100)` C, base temp/humidity `30.0±1` C / `55.0±2` %, vibration normal `0.02–0.08` g / injected `0.5–0.8` g. Startup log `[OmniTwin Simulator]`.
- `backend/routers/sim.py`: `INJECTORS = ("overheat", "vibration", "offline")`; `_default_ctrl` = base_values + inject map + updated_at (no generator_on); `reset_demo` no longer zeroes run_hours in Mongo (Ruling 7 tail finished).
- Deleted `sim-control/src/components/DemoControlPanel.jsx` + its App.jsx usage (hardcoded NFL device IDs gone).
- `DeviceControl.jsx` rewrite: 3 injector buttons (`🌡 Inject Overheat`, `📳 Inject Vibration`, `📡 Drop Connectivity`, 120 s duration), Temperature + Humidity sliders, header `OmniTwin` / `Instructor Console`.
- Verified: `_compute_values` behavioral asserts (default/offline/overheat/vibration all pass) · `import main` → `app ok` · `npm run build` clean · grep clean (no fuel/generator/gyro/demo refs).
- Commit `b31d8aa`. Review: clean (0 findings).

## Expect
- Sim-control now controls only the 3 education injectors + temp/humidity base. Injecting vibration pushes vibration past the 0.2 g threshold → real alert fires through the Task 4 engine. Dropping connectivity freezes the device (offline).
- Live MQTT end-to-end still unverified — that's Task 10.

## Commands
```powershell
cd D:\OmniTwin; .\.venv\Scripts\python -c "import simulator; print('simulator ok')"
cd D:\OmniTwin\backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
cd D:\OmniTwin\sim-control; npm run build
# with services up: py simulator.py  → streams twinlab/device/{id}/sensor/{sensor}
```