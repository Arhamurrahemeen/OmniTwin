const BASE = '/api'

async function _get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export const getDevices = () => _get('/devices')

export const getProjects = getDevices // readability alias; DeviceList keeps getDevices

export const discoverDevices = () => _get('/devices/discover')

export async function deleteDevice(deviceId) {
  const res = await fetch(`${BASE}/devices/${deviceId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /devices/${deviceId} → ${res.status}`)
}

export const getReadings = (deviceId, sensor, limit = 50, rangeHours = 24) =>
  _get(`/devices/${deviceId}/readings?sensor=${sensor}&limit=${limit}&range_hours=${rangeHours}`)

export const getAlerts = (deviceId, limit = 50) =>
  _get(`/devices/${deviceId}/alerts?limit=${limit}`)

export const getRoster = () => _get('/roster')

export async function importRoster(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE}/roster/import`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`POST /roster/import → ${res.status}`)
  return res.json()
}

export async function createProject(payload) {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? `POST /projects → ${res.status}`) }
  return res.json()
}

export async function assignDemoKit(deviceId, owner) {
  const res = await fetch(`${BASE}/demo-kit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, owner }),
  })
  if (!res.ok) throw new Error(`POST /demo-kit → ${res.status}`)
  return res.json()
}