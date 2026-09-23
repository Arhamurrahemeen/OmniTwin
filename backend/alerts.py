"""
TwinLab alert engine — threshold-only with plain-language education hints.
Called synchronously from the MQTT handler thread; async helpers run on the main event loop.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

log = logging.getLogger("twinlab.alerts")

# ── Config ───────────────────────────────────────────────────
COOLDOWN_S = 600  # suppress re-fires of the same alert within 10 min
CACHE_TTL_S = 10  # how often to reload thresholds from Mongo

# Max-breach on these sensors → critical; everything else → warning
_CRITICAL_MAX = {"temperature", "vibration"}

# One-sentence plain-language guidance per sensor + breach side
_HINTS = {
    "temperature": {"max": "Overheating — check ventilation or the sensor is near a heat source.",
                    "min": "Temperature very low — check the sensor is seated correctly."},
    "humidity":    {"max": "Humidity very high — check the sensor is not damp or near steam.",
                    "min": "Humidity very low — check the sensor is connected."},
    "vibration":   {"max": "Strong vibration — check the mounting and that nothing is loose.",
                    "min": "No vibration signal — shake the kit to confirm it is on."},
}

# ── Module-level state (GIL-safe for CPython dict reads/replacements) ───
_threshold_cache: dict = {}   # {device_id: {sensor: {"min": v|None, "max": v|None}}}
_cache_loaded_at: float = 0.0

_cooldown: dict = {}          # {(device_id, sensor, alert_type): fired_ts_ms}


# ── Cache ────────────────────────────────────────────────────

async def refresh_cache() -> None:
    """Reload all device thresholds from Mongo."""
    global _threshold_cache, _cache_loaded_at
    from db.mongo import get_db
    try:
        db  = get_db()
        docs = await db.devices.find(
            {}, {"_id": 0, "device_id": 1, "thresholds": 1}
        ).to_list(length=500)
        _threshold_cache = {d["device_id"]: d.get("thresholds") or {} for d in docs}
        _cache_loaded_at = time.time()
        log.debug(f"[alerts] cache refreshed — {len(_threshold_cache)} devices")
    except Exception as e:
        log.error(f"[alerts] cache refresh failed: {e}")


async def cache_loop() -> None:
    """Background task: keep threshold cache fresh."""
    while True:
        await refresh_cache()
        await asyncio.sleep(CACHE_TTL_S)


def reset_state() -> None:
    """
    Clear all in-memory demo state. Called by POST /sim/reset.
    Does NOT touch _threshold_cache (config, not demo state).
    """
    _cooldown.clear()
    log.info("[alerts] state reset — cooldowns cleared")


# ── Helpers ──────────────────────────────────────────────────

def _severity(sensor: str, side: str) -> str:
    """side = 'min' | 'max'"""
    if side == "max" and sensor in _CRITICAL_MAX:
        return "critical"
    return "warning"


def _make_alert(
    device_id, sensor, alert_type, severity, value, unit, detail,
) -> dict:
    ts = int(time.time() * 1000)
    if severity == "critical":
        msg_en = f"CRITICAL: {device_id} — {sensor} = {value} {unit} ({detail})."
    else:
        msg_en = f"WARNING: {device_id} — {sensor} = {value} {unit} ({detail})."

    return {
        "device_id":     device_id,
        "sensor":        sensor,
        "alert_type":    alert_type,
        "severity":      severity,
        "value":         value,
        "unit":          unit,
        "detail":        detail,
        "message_en":    msg_en,
        "hint_en":       "",
        "ts":            ts,
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

    bounds = thresholds.get(sensor)
    if bounds:
        min_v = bounds.get("min")
        max_v = bounds.get("max")

        if min_v is not None and value < min_v:
            if not _in_cooldown(device_id, sensor, "threshold"):
                _set_cooldown(device_id, sensor, "threshold")
                alert = _make_alert(
                    device_id, sensor, "threshold",
                    _severity(sensor, "min"),
                    value, unit, f"below min {min_v}",
                )
                hint   = _HINTS.get(sensor, {}).get("min",
                        "Check the sensor and its connection.")
                return { **alert, "hint_en": hint }

        elif max_v is not None and value > max_v:
            if not _in_cooldown(device_id, sensor, "threshold"):
                _set_cooldown(device_id, sensor, "threshold")
                alert = _make_alert(
                    device_id, sensor, "threshold",
                    _severity(sensor, "max"),
                    value, unit, f"above max {max_v}",
                )
                hint   = _HINTS.get(sensor, {}).get("max",
                        "Check the sensor and its connection.")
                return { **alert, "hint_en": hint }

    return None


if __name__ == "__main__":
    # Self-check — no test framework, matches this repo's flat-script convention.
    _threshold_cache["TL-SELFTEST"] = {"vibration": {"min": None, "max": 0.15}}
    _threshold_cache["TL-NOCONFIG"] = {}

    # 1. Above max on a critical sensor — critical threshold alert with hint.
    a = evaluate("TL-SELFTEST", "vibration", 0.20, "g", {})
    assert a is not None and a["severity"] == "critical" and a["alert_type"] == "threshold"
    assert a["hint_en"] == _HINTS["vibration"]["max"] and len(a["hint_en"]) > 0

    # 2. Cooldown suppresses an immediate re-fire.
    assert evaluate("TL-SELFTEST", "vibration", 0.20, "g", {}) is None

    # 3. No thresholds configured → no alert for any value.
    assert evaluate("TL-NOCONFIG", "temperature", 99.0, "C", {}) is None

    # 4. Below min on a non-critical sensor → warning (not critical), with hint.
    _threshold_cache["TL-SELFTEST"] = {"temperature": {"min": 10.0, "max": None}}
    b = evaluate("TL-SELFTEST", "temperature", 5.0, "C", {})
    assert b is not None and b["severity"] == "warning" and b["alert_type"] == "threshold"
    assert b["hint_en"] == _HINTS["temperature"]["min"]

    # 5. Run-hours machinery is gone from the module namespace.
    assert "evaluate_run_hours" not in globals()
    assert "set_run_hours" not in globals()

    print("[alerts] self-check passed")