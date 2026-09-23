"""
TwinLab alert engine — threshold evaluation + fuel-theft rule.
Called synchronously from the MQTT handler thread; async helpers run on the main event loop.
"""

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone

from config import settings

log = logging.getLogger("twinlab.alerts")

# ── Config ───────────────────────────────────────────────────
COOLDOWN_S     = 600    # suppress re-fires of the same alert within 10 min
THEFT_DROP_L   = 5.0    # litres lost in window to trigger theft
THEFT_WINDOW_S = 300    # sliding window for theft detection (5 min)
OFF_AMPS       = 2.0    # load_current below this means generator is off
CACHE_TTL_S    = 10     # how often to reload thresholds from Mongo
RUN_HOURS_FLUSH_S = 60  # how often to batch-persist in-memory run-hours to Mongo

# EMA-vibration (|accel|-1g, see firmware main.c) above this = hardware asset
# running. UNCALIBRATED placeholder — no hardware node has ever been mounted
# on a spinning machine yet (TL-B49244 is bench-only). Recalibrate once one is.
VIB_RUNNING_G  = 0.03

# Max-breach on these sensors → critical; everything else → warning
_CRITICAL_MAX = {"load_current", "temperature", "vibration"}

# ── Module-level state (GIL-safe for CPython dict reads/replacements) ───
_threshold_cache: dict = {}   # {device_id: {sensor: {"min": v|None, "max": v|None}}}
_run_hours_threshold_cache: dict = {}  # {device_id: int}
_cache_loaded_at: float = 0.0

_cooldown: dict = {}          # {(device_id, sensor, alert_type): fired_ts_ms}
_fuel_buf: dict = {}          # {device_id: deque of (ts_ms, fuel_level)}

_run_hours_mem: dict = {}     # {device_id: float} accumulated run-hours since last reset
_last_hr_ts: dict = {}        # {device_id: float} unix seconds of last accumulation tick


# ── Cache ────────────────────────────────────────────────────

async def refresh_cache() -> None:
    """Reload all device thresholds + run_hours_threshold from Mongo."""
    global _threshold_cache, _run_hours_threshold_cache, _cache_loaded_at
    from db.mongo import get_db
    try:
        db  = get_db()
        docs = await db.devices.find(
            {}, {"_id": 0, "device_id": 1, "thresholds": 1, "run_hours_threshold": 1}
        ).to_list(length=500)
        _threshold_cache = {d["device_id"]: d.get("thresholds") or {} for d in docs}
        _run_hours_threshold_cache = {d["device_id"]: d.get("run_hours_threshold") or 500 for d in docs}
        _cache_loaded_at = time.time()
        log.debug(f"[alerts] cache refreshed — {len(_threshold_cache)} devices")
    except Exception as e:
        log.error(f"[alerts] cache refresh failed: {e}")


async def cache_loop() -> None:
    """Background task: keep threshold cache fresh."""
    while True:
        await refresh_cache()
        await asyncio.sleep(CACHE_TTL_S)


async def seed_run_hours() -> None:
    """One-time startup seed of in-memory run-hours from Mongo, so a backend
    restart doesn't zero hours accumulated before the last periodic flush."""
    from db.mongo import get_db
    try:
        db   = get_db()
        docs = await db.devices.find({}, {"_id": 0, "device_id": 1, "run_hours": 1}).to_list(length=500)
        for d in docs:
            _run_hours_mem[d["device_id"]] = d.get("run_hours") or 0.0
        log.info(f"[alerts] run_hours seeded for {len(docs)} device(s)")
    except Exception as e:
        log.error(f"[alerts] run_hours seed failed: {e}")


async def flush_run_hours_loop() -> None:
    """Background task: batch-persist in-memory run-hours to Mongo every
    RUN_HOURS_FLUSH_S seconds (the hot path never writes to Mongo per-tick)."""
    from db.mongo import get_db
    while True:
        await asyncio.sleep(RUN_HOURS_FLUSH_S)
        if not _run_hours_mem:
            continue
        try:
            db  = get_db()
            now = datetime.now(timezone.utc)
            for device_id, hours in list(_run_hours_mem.items()):
                await db.devices.update_one(
                    {"device_id": device_id},
                    {"$set": {"run_hours": hours, "last_run_hours_update": now}},
                )
        except Exception as e:
            log.error(f"[alerts] run_hours flush failed: {e}")


def set_run_hours(device_id: str, hours: float) -> None:
    """Sync in-memory run-hours to a value written directly via PATCH /devices/{id}
    (e.g. the demo trigger), so the next accumulation tick builds on it correctly."""
    _run_hours_mem[device_id] = hours
    _last_hr_ts.pop(device_id, None)


def reset_state() -> None:
    """
    Clear all in-memory demo state. Called by POST /sim/reset.
    Does NOT touch _threshold_cache / _run_hours_threshold_cache (config, not demo state).
    """
    _cooldown.clear()
    _fuel_buf.clear()
    _run_hours_mem.clear()
    _last_hr_ts.clear()
    log.info("[alerts] state reset — cooldowns/fuel_buf/run_hours cleared")


# ── Helpers ──────────────────────────────────────────────────

def _severity(sensor: str, side: str) -> str:
    """side = 'min' | 'max'"""
    if side == "max" and sensor in _CRITICAL_MAX:
        return "critical"
    return "warning"


def _make_alert(
    device_id, sensor, alert_type, severity, value, unit, detail,
    drop_litres: float = 0.0, window_s: float = 0.0,
) -> dict:
    ts = int(time.time() * 1000)
    if alert_type == "fuel_theft":
        mins   = round(window_s / 60, 1)
        rupees = round(drop_litres * settings.diesel_price_pkr)
        msg_en = (
            f"⚠️ {device_id} — fuel dropped {drop_litres:.1f}L in {mins} min "
            f"while generator OFF. Suspected theft. Est. loss ~PKR {rupees:,}."
        )
        msg_ur = (
            f"{device_id} — generator BAND honay ke bawajood {mins} min mein "
            f"{drop_litres:.1f}L fuel kam hua. Chori ka shak. Taqreeban PKR {rupees:,} nuqsan."
        )
    elif alert_type == "consumable_reorder":
        msg_en = (
            f"🟠 {device_id} — {value:.0f}h run-hours reached ({detail}). "
            f"Consumable reorder due to avoid SLOB accumulation."
        )
        msg_ur = (
            f"{device_id} — {value:.0f} ghante ho gaye ({detail}). "
            f"Consumable order karein — SLOB nuqsaan se bachne ke liye."
        )
    elif severity == "critical":
        msg_en = f"CRITICAL: {device_id} — {sensor} = {value} {unit} ({detail})."
        msg_ur = f"KHATRNAK: {device_id} — {sensor} = {value} {unit} ({detail})."
    else:
        msg_en = f"WARNING: {device_id} — {sensor} = {value} {unit} ({detail})."
        msg_ur = f"KHABARDAR: {device_id} — {sensor} = {value} {unit} ({detail})."

    return {
        "device_id":     device_id,
        "sensor":        sensor,
        "alert_type":    alert_type,
        "severity":      severity,
        "value":         value,
        "unit":          unit,
        "detail":        detail,
        "message_en":    msg_en,
        "message_ur":    msg_ur,
        "drop_litres":   drop_litres,
        "window_s":      window_s,
        "ts":            ts,
        "push_sent":     False,
        "created_at":    datetime.now(timezone.utc),
    }


def _in_cooldown(device_id: str, sensor: str, alert_type: str) -> bool:
    key  = (device_id, sensor, alert_type)
    last = _cooldown.get(key, 0)
    return (time.time() * 1000 - last) < COOLDOWN_S * 1000


def _set_cooldown(device_id: str, sensor: str, alert_type: str) -> None:
    _cooldown[(device_id, sensor, alert_type)] = time.time() * 1000


# ── Public API ───────────────────────────────────────────────

def evaluate(
    device_id: str,
    sensor: str,
    value: float,
    unit: str,
    last_known: dict,
) -> dict | None:
    """
    Evaluate one MQTT reading. Returns an alert dict if one should fire, else None.
    Called synchronously from the MQTT thread — must never block or await.
    """
    thresholds = _threshold_cache.get(device_id, {})

    # ── Threshold rule ───────────────────────────────────────
    bounds = thresholds.get(sensor)
    if bounds:
        min_v = bounds.get("min")
        max_v = bounds.get("max")

        if min_v is not None and value < min_v:
            if not _in_cooldown(device_id, sensor, "threshold"):
                _set_cooldown(device_id, sensor, "threshold")
                return _make_alert(
                    device_id, sensor, "threshold",
                    _severity(sensor, "min"),
                    value, unit, f"below min {min_v}",
                )

        elif max_v is not None and value > max_v:
            if not _in_cooldown(device_id, sensor, "threshold"):
                _set_cooldown(device_id, sensor, "threshold")
                return _make_alert(
                    device_id, sensor, "threshold",
                    _severity(sensor, "max"),
                    value, unit, f"above max {max_v}",
                )

    # ── Fuel-theft rule ──────────────────────────────────────
    if sensor == "fuel_level":
        buf    = _fuel_buf.setdefault(device_id, deque())
        ts_now = int(time.time() * 1000)
        buf.append((ts_now, value))

        # Evict readings outside the window
        cutoff = ts_now - THEFT_WINDOW_S * 1000
        while buf and buf[0][0] < cutoff:
            buf.popleft()

        if len(buf) >= 2:
            drop = buf[0][1] - value   # positive = fuel decreased
            if drop >= THEFT_DROP_L:
                dev_known = last_known.get(device_id, {})
                lc_entry  = dev_known.get("load_current")
                lc        = lc_entry["value"] if lc_entry else None
                gen_off   = lc is None or lc < OFF_AMPS

                if gen_off and not _in_cooldown(device_id, "fuel_level", "fuel_theft"):
                    _set_cooldown(device_id, "fuel_level", "fuel_theft")
                    return _make_alert(
                        device_id, "fuel_level", "fuel_theft", "critical",
                        value, unit,
                        f"dropped {drop:.1f} L in {THEFT_WINDOW_S // 60} min while generator off",
                        drop_litres=drop,
                        window_s=float(THEFT_WINDOW_S),
                    )

    return None


def _evaluate_run_hours(device_id: str, running: bool) -> dict | None:
    """
    Shared accumulator behind both load_current- and vibration-driven run
    detection. Fires a consumable_reorder alert when accumulated hours cross
    the device's run_hours_threshold, then resets the counter. Sync — called
    from the MQTT thread, same as evaluate().
    """
    if not running:
        _last_hr_ts.pop(device_id, None)
        return None

    now  = time.time()
    last = _last_hr_ts.get(device_id, now)
    _run_hours_mem[device_id] = _run_hours_mem.get(device_id, 0.0) + (now - last) / 3600
    _last_hr_ts[device_id] = now

    hours     = _run_hours_mem[device_id]
    threshold = _run_hours_threshold_cache.get(device_id, 500)

    if hours >= threshold and not _in_cooldown(device_id, "run_hours", "consumable_reorder"):
        _set_cooldown(device_id, "run_hours", "consumable_reorder")
        _run_hours_mem[device_id] = 0.0
        return _make_alert(
            device_id, "run_hours", "consumable_reorder", "warning",
            round(hours, 1), "h", f"reached {threshold}h threshold",
        )

    return None


def evaluate_run_hours(device_id: str, value: float) -> dict | None:
    """Load-current-driven run detection (simulator gensets with a CT clamp)."""
    return _evaluate_run_hours(device_id, value > OFF_AMPS)


def evaluate_run_hours_vibration(device_id: str, value: float) -> dict | None:
    """
    Vibration-driven run detection (hardware nodes with no CT clamp) — see
    VIB_RUNNING_G above for the calibration caveat.
    """
    return _evaluate_run_hours(device_id, value > VIB_RUNNING_G)


if __name__ == "__main__":
    # Self-check — no test framework, matches this repo's flat-script convention.
    _threshold_cache["TL-SELFTEST"] = {"vibration": {"min": None, "max": 0.15}}
    _run_hours_threshold_cache["TL-SELFTEST"] = 1.0 / 3600  # 1 second, for a fast test

    # 1. Below threshold — no alert.
    assert evaluate("TL-SELFTEST", "vibration", 0.05, "g", {}) is None

    # 2. Above threshold — critical threshold alert (vibration is in _CRITICAL_MAX).
    a = evaluate("TL-SELFTEST", "vibration", 0.20, "g", {})
    assert a is not None and a["severity"] == "critical" and a["alert_type"] == "threshold"

    # 3. Cooldown suppresses an immediate re-fire.
    assert evaluate("TL-SELFTEST", "vibration", 0.20, "g", {}) is None

    # 4. Idle (below VIB_RUNNING_G) never accumulates run-hours.
    assert evaluate_run_hours_vibration("TL-SELFTEST", 0.01) is None
    assert _run_hours_mem.get("TL-SELFTEST", 0.0) == 0.0

    # 5. Running (above VIB_RUNNING_G) accumulates, then fires consumable_reorder
    #    once the (artificially tiny) run_hours_threshold is crossed.
    evaluate_run_hours_vibration("TL-SELFTEST", 0.10)
    time.sleep(1.1)
    r = evaluate_run_hours_vibration("TL-SELFTEST", 0.10)
    assert r is not None and r["alert_type"] == "consumable_reorder"
    assert _run_hours_mem["TL-SELFTEST"] == 0.0  # reset after firing

    print("[alerts] self-check passed")
