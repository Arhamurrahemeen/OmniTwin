const BASE = '/api'

async function _get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export const getDevices = () => _get('/devices')

export const discoverDevices = () => _get('/devices/discover')

export async function deleteDevice(deviceId) {
  const res = await fetch(`${BASE}/devices/${deviceId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /devices/${deviceId} → ${res.status}`)
}

export const getReadings = (deviceId, sensor, limit = 50, rangeHours = 24) =>
  _get(`/devices/${deviceId}/readings?sensor=${sensor}&limit=${limit}&range_hours=${rangeHours}`)

export const getAlerts = (deviceId, limit = 50) =>
  _get(`/devices/${deviceId}/alerts?limit=${limit}`)

export const getRul = (deviceId) => _get(`/devices/${deviceId}/rul`)

export async function postChat(deviceId, message) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, message }),
  })
  if (!res.ok) throw new Error(`POST /chat → ${res.status}`)
  return res.json()
}
