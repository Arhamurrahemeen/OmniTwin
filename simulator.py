"""
OmniTwin sensor simulator — registry-driven + sim_control aware.
Reads active simulator devices from MongoDB and publishes their sensors.
Each tick checks the sim_control doc to apply base values and injectors.
"""

import json
import random
import time

import paho.mqtt.client as mqtt
import pymongo

MQTT_HOST  = "localhost"
MQTT_PORT  = 1883
MONGO_URI  = "mongodb://admin:twinlab123@localhost:27017"
MONGO_DB   = "twinlab"
REFRESH_S  = 30   # seconds between device-list reloads from Mongo


def _injector_active(ctrl: dict, name: str) -> bool:
    now_ms = int(time.time() * 1000)
    inj    = ctrl.get("inject", {}).get(name, {})
    return bool(inj.get("active")) and int(inj.get("until_ts", 0)) > now_ms


def _sensor_value(sensor: str, t: int) -> tuple:
    """Fallback for hardware sensors not driven by sim_control (accel, vibration)."""
    if sensor in ("accel_x", "accel_y"):
        return round(random.uniform(-0.05, 0.05), 4), "g"
    if sensor == "accel_z":
        return round(1.0 + random.uniform(-0.02, 0.02), 4), "g"
    if sensor == "vibration":
        return round(random.uniform(0.02, 0.08), 4), "g"
    return 0.0, ""


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
    Returns None if the device should not publish this tick (offline injection).
    """
    base         = ctrl.get("base_values", {})
    overheat     = _injector_active(ctrl, "overheat")
    vib_injected = _injector_active(ctrl, "vibration")
    offline      = _injector_active(ctrl, "offline")

    if offline:
        return None

    values = {}
    for sensor in sensors:

        if sensor == "temperature":
            if overheat:
                val = round(random.uniform(96, 100), 2)
            else:
                val = round(base.get("temperature", 30.0) + random.uniform(-1, 1), 2)
            values[sensor] = (val, "C")

        elif sensor == "humidity":
            values[sensor] = (round(base.get("humidity", 55.0) + random.uniform(-2, 2), 2), "%")

        elif sensor == "vibration":
            if vib_injected:
                val = round(random.uniform(0.5, 0.8), 4)
            else:
                val = round(random.uniform(0.02, 0.08), 4)
            values[sensor] = (val, "g")

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

    print("[OmniTwin Simulator] Starting — registry-driven + sim_control mode")
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
                print(f"[SIM-CTRL] {device_id} offline — skipping")
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
