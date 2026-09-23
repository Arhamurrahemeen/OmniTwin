import logging
from influxdb_client import InfluxDBClient
from influxdb_client.client.query_api import QueryApi
from config import settings

log = logging.getLogger("twinlab.influx")

_client: InfluxDBClient = None
_query_api: QueryApi = None


def get_query_api() -> QueryApi:
    global _client, _query_api
    if _query_api is None:
        _client = InfluxDBClient(
            url=settings.influx_url,
            token=settings.influx_token,
            org=settings.influx_org,
        )
        _query_api = _client.query_api()
        log.info("[InfluxDB] Client ready")
    return _query_api


def close_influx():
    global _client
    if _client:
        _client.close()
        log.info("[InfluxDB] Disconnected")
