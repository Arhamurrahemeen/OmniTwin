import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("twinlab.ws")
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, device_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(device_id, []).append(ws)
        log.info(f"[WS] Client connected — device={device_id}")

    def disconnect(self, device_id: str, ws: WebSocket):
        bucket = self._connections.get(device_id, [])
        if ws in bucket:
            bucket.remove(ws)
        log.info(f"[WS] Client disconnected — device={device_id}")

    async def broadcast(self, device_id: str, data: dict):
        for ws in list(self._connections.get(device_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                pass


manager = ConnectionManager()


@router.websocket("/ws/{device_id}")
async def websocket_endpoint(ws: WebSocket, device_id: str):
    await manager.connect(device_id, ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; client messages ignored for now
    except WebSocketDisconnect:
        manager.disconnect(device_id, ws)
