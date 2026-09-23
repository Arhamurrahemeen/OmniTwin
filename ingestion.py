"""
TwinLab ingestion service
Subscribes to all MQTT sensor topics and writes to InfluxDB
"""

import json
import time
import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

# ── Config ──────────────────────────────────────────────
MQTT_HOST   = "localhost"
MQTT_PORT   = 1883
MQTT_TOPIC  = "twinlab/#"

INFLUX_URL   = "http://localhost:8086"
INFLUX_TOKEN = "twinlab-super-secret-token"
INFLUX_ORG   = "twinlab"
INFLUX_BUCKET = "twinlab"

# ── InfluxDB client ─────────────────────────────────────
influx = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx.write_api(write_options=SYNCHRONOUS)

def parse_topic(topic: str):
    """
    Expected format: twinlab/device/{device_id}/sensor/{sensor_name}
    Returns (device_id, sensor_name) or None if malformed
    """
    parts = topic.split("/")
    if len(parts) == 5 and parts[0] == "twinlab" and parts[1] == "device" and parts[3] == "sensor":
        return parts[2], parts[4]
    return None, None

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Connected. Subscribing to {MQTT_TOPIC}")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"[MQTT] Connection failed with code {rc}")

def on_message(client, userdata, msg):
    topic   = msg.topic
    device_id, sensor_name = parse_topic(topic)

    if not device_id:
        print(f"[SKIP] Unrecognised topic: {topic}")
        return

    try:
        payload = json.loads(msg.payload.decode())
        value   = float(payload["value"])
        unit    = payload.get("unit", "")
        ts_ms   = payload.get("ts", int(time.time() * 1000))
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[ERROR] Bad payload on {topic}: {e}")
        return

    point = (
        Point("sensor_reading")
        .tag("device_id", device_id)
        .tag("sensor", sensor_name)
        .tag("unit", unit)
        .field("value", value)
        .time(ts_ms * 1_000_000)  # InfluxDB expects nanoseconds
    )

    try:
        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
        print(f"[OK] {device_id}/{sensor_name} = {value} {unit}")
    except Exception as e:
        print(f"[ERROR] InfluxDB write failed: {e}")

# ── Start ────────────────────────────────────────────────
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

print("[TwinLab] Starting ingestion service...")
client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
client.loop_forever()
