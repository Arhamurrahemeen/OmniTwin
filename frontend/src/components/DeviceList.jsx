import { useMemo, useState } from 'react'
import { getDevices, deleteDevice } from '../api'
import RegisterDevice from './RegisterDevice'
import EditDevice from './EditDevice'

// Fixed demo order for legacy groups; unlisted locations sort after, alphabetically.
const PLANT_ORDER = ['SITE Karachi Plant', 'Faisalabad Plant', 'Sharjah Plant', 'Kunri (sourced by Faisalabad)']

function groupByPlant(devices) {
  const groups = new Map()
  for (const d of devices) {
    const key = d.location || 'Unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    const ia = PLANT_ORDER.indexOf(a)
    const ib = PLANT_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return sortedGroups.map(([plant, list]) => [plant, list])
}

export default function DeviceList({ selectedId, onSelect }) {
  const [devices, setDevices]       = useState([])
  const [error, setError]           = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [editDevice, setEditDevice] = useState(null)

  const load = () => {
    getDevices()
      .then(setDevices)
      .catch(() => setError('Could not load projects'))
  }

  const plantGroups = useMemo(() => groupByPlant(devices), [devices])

  const sharedKitCount = devices.filter(d => d.source === 'hardware').length

  const handleUpdated = (updated) => {
    setEditDevice(null)
    load()
    if (updated.device_id === selectedId) onSelect(updated)
  }

  const handleDelete = async (d) => {
    if (!window.confirm(`Delete ${d.name}?`)) return
    try {
      await deleteDevice(d.device_id)
      load()
      if (d.device_id === selectedId) onSelect(null)
    } catch {
      setError('Could not delete project')
    }
  }

  return (
    <aside className="panel device-list">
      <div className="panel-title-row">
        <p className="panel-title">Projects</p>
        <button className="add-btn" onClick={() => setShowRegister(true)} title="Create project">+</button>
      </div>

      {devices.length > 0 && (
        <p className="plant-summary-strip">
          {devices.length} projects · {sharedKitCount} shared demo kit
        </p>
      )}

      {error && <p className="muted">{error}</p>}
      {!error && devices.length === 0 && <p className="muted">No projects yet.</p>}

      {plantGroups.map(([plant, plantDevices]) => (
        <div key={plant} className="plant-group">
          <p className="plant-group-header">{plant} · {plantDevices.length} project{plantDevices.length === 1 ? '' : 's'}</p>

          {plantDevices.map(d => (
            <div
              key={d.device_id}
              className={`device-card${d.device_id === selectedId ? ' active' : ''}`}
              onClick={() => onSelect(d)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(d)}
            >
              <div className="device-card-top">
                <span className="device-name">{d.name}</span>
                <div className="device-card-actions">
                  <span className={`source-badge source-badge--${d.source ?? 'simulator'}`}>
                    {d.source === 'hardware' ? 'HW' : 'SIMULATED'}
                  </span>
                  <button
                    className="edit-btn"
                    title="Edit project"
                    onClick={(e) => { e.stopPropagation(); setEditDevice(d) }}
                  >
                    ✎
                  </button>
                  <button
                    className="delete-btn"
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); handleDelete(d) }}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <span className="device-location">{d.owner || 'Shared'}</span>
              {d.sensors?.length > 0 && (
                <div className="device-sensors">
                  {d.sensors.map(s => <span key={s} className="sensor-tag">{s}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {showRegister && (
        <RegisterDevice
          mode="project"
          onCreated={() => { setShowRegister(false); load() }}
          onClose={() => setShowRegister(false)}
        />
      )}

      {editDevice && (
        <EditDevice
          device={editDevice}
          onUpdated={handleUpdated}
          onClose={() => setEditDevice(null)}
        />
      )}
    </aside>
  )
}