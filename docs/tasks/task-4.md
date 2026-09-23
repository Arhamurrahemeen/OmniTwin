# Task 4 — Alert engine: threshold-only + education hints (DONE)

## Intent
Cut the industrial alert machinery (fuel-theft, diesel price, run-hours) out of `backend/alerts.py` and make it threshold-only, where every alert carries a plain-language student hint (`hint_en`). Also strip run-hours fields from the device models so the backend still imports.

## Done
- Added `_HINTS` (temperature/humidity/vibration × max/min, exact brief wording); each alert now carries `hint_en`.
- `_CRITICAL_MAX = {"temperature", "vibration"}` → those breaching max are `critical`, everything else `warning`.
- Removed: fuel_theft, `consumable_reorder`, `message_ur`, `push_sent`, and ALL run-hours machinery (`set_run_hours`, `evaluate_run_hours*`, `seed/flush_run_hours_loop`, caches). `evaluate()` signature and the 600 s cooldown unchanged.
- **Ruling-7 sweep (same commit):** dropped `run_hours`/`run_hours_threshold`/`last_run_hours_update` from `DeviceCreate`/`Update`/`Response` and the `set_run_hours` PATCH branch in `routers/devices.py`.
- Self-check (`python alerts.py` → `[alerts] self-check passed`) asserts: critical vibration + hint · cooldown re-fire → None · empty thresholds → None · below-min temp → warning.
- Commit: `fba61a0`. Review: clean.

## Expect
- Alerts fire only on configured thresholds and always include student-friendly `hint_en` text.
- `routers/sim.py` still mentions fuel_theft/run_hours — Task 6 removes those next (planned).
- Still no live HTTP until Mosquitto + MongoDB installed (see task-2.md).

## Commands
```powershell
cd D:\OmniTwin\backend; ..\.venv\Scripts\python alerts.py
# [alerts] self-check passed
..\.venv\Scripts\python -c "import main; print('app ok')"
# app ok
```