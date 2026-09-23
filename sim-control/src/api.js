const BASE = "http://localhost:8000"

async function _get(path) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}

async function _put(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`)
  return r.json()
}

async function _patch(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status}`)
  return r.json()
}

async function _post(path) {
  const r = await fetch(`${BASE}${path}`, { method: "POST" })
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`)
  return r.json()
}

export const getSimDevices  = ()       => _get("/sim")
export const getSimCtrl     = (id)     => _get(`/sim/${id}`)
export const putSimCtrl     = (id, b)  => _put(`/sim/${id}`, b)
export const getDevice      = (id)     => _get(`/devices/${id}`)
export const patchDevice    = (id, b)  => _patch(`/devices/${id}`, b)
export const postSimReset   = ()       => _post("/sim/reset")
