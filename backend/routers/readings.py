import logging
import re
from fastapi import APIRouter, HTTPException, Query

from config import settings
from db.influx import get_query_api

log = logging.getLogger("twinlab.readings")
router = APIRouter()

_SAFE_ID = re.compile(r'^[\w\-]+$')


def _validate_id(value: str, label: str) -> str:
    if not _SAFE_ID.match(value):
        raise HTTPException(400, f"Invalid {label} format")
    return value


@router.get("/{device_id}/readings")
async def get_readings(
    device_id: str,
    sensor: str = Query(..., description="Sensor name e.g. temperature"),
    limit: int = Query(20, ge=1, le=500),
    range_hours: int = Query(24, ge=1, le=168),
):
    _validate_id(device_id, "device_id")
    _validate_id(sensor, "sensor")

    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -{range_hours}h)
  |> filter(fn: (r) => r._measurement == "sensor_reading")
  |> filter(fn: (r) => r.device_id == "{device_id}")
  |> filter(fn: (r) => r.sensor == "{sensor}")
  |> tail(n: {limit})
"""
    try:
        tables = get_query_api().query(flux, org=settings.influx_org)
    except Exception as e:
        log.error(f"[InfluxDB] Query failed: {e}")
        raise HTTPException(500, "InfluxDB query failed")

    results = []
    for table in tables:
        for record in table.records:
            results.append({
                "ts": record.get_time().isoformat(),
                "value": record.get_value(),
                "unit": record.values.get("unit", ""),
                "sensor": sensor,
                "device_id": device_id,
            })
    return results
