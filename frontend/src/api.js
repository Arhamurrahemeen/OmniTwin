const BASE = '/api'

async function _get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export const getDevices = () => _get('/devices')
export const getProjects = getDevices

export async function askTutor({ deviceId, context, messages }) {
  const res = await fetch(`${BASE}/tutor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, context, messages }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.detail ?? `POST /tutor → ${res.status}`)
  }
  return res.json()
}

export const getRoster = () => _get('/roster')