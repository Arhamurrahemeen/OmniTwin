"""
TwinLab sensor simulator — registry-driven + sim_control aware.
Reads active simulator devices from MongoDB and publishes their sensors.
Each tick checks the sim_control doc to apply base values, generator state, and injectors.
"""

import json
import math
import random
import time

import paho.mqtt.client as mqtt
import pymongo

MQTT_HOST  = "localhost"
MQTT_PORT  = 1883
MONGO_URI  = "mongodb://admin:twinlab123@localhost:27017"
MONGO_DB   = "twinlab"
REFRESH_S  = 30   # seconds between device-list reloads from Mongo

# Fuel-theft injection drain rate per tick (1 s) — drops 5 L in ~5 s to trigger alert fast
THEFT_DRAIN_PER_TICK  = 1.0
NORMAL_DRAIN_PER_TICK = 0.01   # slow burn when generator is on

# In-memory fuel level per device (stateful — drains over time)
_fuel_level:    dict = {}   # {device_id: float}
_doc_base_fuel: dict = {}   # {device_id: float}  last seen base_values.fuel_level


def _injector_active(ctrl: dict, name: str) -> bool:
    now_ms = int(time.time() * 1000)
    inj    = ctrl.get("inject", {}).get(name, {})
    return bool(inj.get("active")) and int(inj.get("until_ts", 0)) > now_ms


def _sensor_value(sensor: str, t: int) -> tuple:
    """Fallback for sensors not driven by sim_control (accel, gyro, etc.)."""
    if sensor == "accel_x":
        return round(random.uniform(-0.05, 0.05), 4), "g"
    if sensor == "accel_y":
        return round(random.uniform(-0.05, 0.05), 4), "g"
    if sensor == "accel_z":
        return round(1.0 + random.uniform(-0.02, 0.02), 4), "g"
    if sensor == "gyro_x":
        return round(random.uniform(-0.5, 0.5), 3), "deg/s"
    if sensor == "gyro_y":
        return round(random.uniform(-0.5, 0.5), 3), "deg/s"
    if sensor == "gyro_z":
        return round(random.uniform(-0.5, 0.5), 3), "deg/s"
    return round(50.0 + 10 * math.sin(t * 0.1) + random.uniform(-1, 1), 2), ""


def _get_sim_ctrl(sim_col, device_id: str) -> dict:
    """Fetch sim_control doc for a device, return defaults if missing."""
    try:
        return sim_col.find_one({"device_id": device_id}, {"_id": 0}) or {}
    except Exception as e:
        print(f"[ERROR] sim_control fetch failed ({device_id}): {e}")
        return {}


def _compute_values(device_id: str, sensors: list, ctrl: dict, t: int) -> dict | None:
    """
    Compute {sensor: (value, unit)} for all sensors using the sim_control doc.
    Returns None if the device should not publish this tick: offline-injection,
    or generator_on is False (unless a fuel-theft injection is in progress,
    which needs fuel_level readings to keep flowing so the theft rule can fire).
    """
    gen_on   = ctrl.get("generator_on", True)
    base     = ctrl.get("base_values", {})
    theft    = _injector_active(ctrl, "fuel_theft")
    overheat = _injector_active(ctrl, "overheat")
    overload = _injector_active(ctrl, "overload")
    offline  = _injector_active(ctrl, "offline")

    if offline:
        return None
    if not gen_on and not theft:
        return None

    values = {}
    for sensor in sensors:

        if sensor == "fuel_level":
            doc_fuel = base.get("fuel_level", 70.0)

            # Reset tracked level when the operator moves the slider to a new value
            if device_id not in _fuel_level:
                _fuel_level[device_id]    = doc_fuel
                _doc_base_fuel[device_id] = doc_fuel
            elif _doc_base_fuel.get(device_id) != doc_fuel:
                if not theft:   # don't interrupt an active theft scenario
                    _fuel_level[device_id] = doc_fuel
                _doc_base_fuel[device_id] = doc_fuel

            if theft:
                _fuel_level[device_id] = max(0.0, _fuel_level[device_id] - THEFT_DRAIN_PER_TICK)
            elif gen_on:
                _fuel_level[device_id] = max(0.0, _fuel_level[device_id] - NORMAL_DRAIN_PER_TICK)
            # generator off → level stays flat

            values[sensor] = (round(_fuel_level[device_id], 2), "L")

        elif sensor == "load_current":
            if not gen_on or theft:
                val = round(random.uniform(0.0, 0.5), 2)
            elif overload:
                val = round(55.0 + random.uniform(0, 5), 2)
            else:
                base_lc = base.get("load_current", 18.0)
                val     = round(base_lc + random.uniform(-2, 2), 2)
            values[sensor] = (val, "A")

        elif sensor == "temperature":
            if overheat:
                val = round(95.0 + random.uniform(0, 5), 2)
            else:
                base_temp = base.get("temperature", 35.0)
                val = round(base_temp + random.uniform(-1, 1), 2)
            values[sensor] = (val, "C")

        elif sensor == "humidity":
            base_hum = base.get("humidity", 55.0)
            values[sensor] = (round(base_hum + random.uniform(-2, 2), 2), "%")

        else:
            values[sensor] = _sensor_value(sensor, t)

    return values


def _load_devices(col):
    """Return list of {device_id, sensors} for active simulator devices."""
    try:
        return list(col.find(
            {"source": "simulator", "status": "active"},
            {"_id": 0, "device_id": 1, "sensors": 1},
        ))
    except Exception as e:
        print(f"[ERROR] Mongo query failed: {e}")
        return []


def _log_devices(devices):
    if not devices:
        print("[SIM] No active simulator devices in registry. Waiting...")
        return
    for d in devices:
        print(f"[SIM] Tracking '{d['device_id']}' -> sensors: {d.get('sensors', [])}")


def main():
    mqtt_client = mqtt.Client()
    mqtt_client.connect(MQTT_HOST, MQTT_PORT)
    mqtt_client.loop_start()

    mongo   = pymongo.MongoClient(MONGO_URI)
    col     = mongo[MONGO_DB]["devices"]
    sim_col = mongo[MONGO_DB]["sim_control"]

    print("[TwinLab Simulator] Starting — registry-driven + sim_control mode")
    devices      = _load_devices(col)
    last_refresh = time.time()
    _log_devices(devices)

    t = 0
    while True:
        # Reload device list on schedule
        if time.time() - last_refresh >= REFRESH_S:
            fresh = _load_devices(col)
            if fresh != devices:
                devices = fresh
                print(f"[SIM] Registry refreshed — {len(devices)} active simulator device(s)")
                _log_devices(devices)
            last_refresh = time.time()

        # Publish one reading per sensor per device
        for device in devices:
            device_id = device["device_id"]
            ctrl      = _get_sim_ctrl(sim_col, device_id)
            values    = _compute_values(device_id, device.get("sensors", []), ctrl, t)

            if values is None:
                print(f"[SIM-CTRL] {device_id} not publishing (offline or generator off) — skipping")
                continue

            for sensor, (value, unit) in values.items():
                topic   = f"twinlab/device/{device_id}/sensor/{sensor}"
                payload = json.dumps({"value": value, "unit": unit, "ts": int(time.time() * 1000)})
                mqtt_client.publish(topic, payload)
                print(f"[SIM] {topic} -> {value} {unit}")

        t += 1
        time.sleep(1)


if __name__ == "__main__":
    main()
