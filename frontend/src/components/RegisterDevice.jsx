import { useEffect, useState } from 'react'
import { updateThreshold, buildThresholds } from '../threshold-utils'
import { sensorOptionsFor } from '../sensor-options'
import { discoverDevices, createProject } from '../api'

const BASE = '/api'

export default function RegisterDevice({ onCreated, onClose, mode = 'project', initialOwner = '' }) {
  const [form, setForm] = useState({
    device_id: '',
    owner: initialOwner,
    name: '',
    location: '',
    sensors: [],
    source: mode === 'hardware' ? 'hardware' : 'simulator',
  })
  const [thresholds, setThresholds] = useState({})
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)
  const [discovered, setDiscovered] = useState([])

  const isHardware = mode === 'hardware'

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const sensorList = form.sensors

  const toggleSensor = (sensor) =>
    setForm(f => ({
      ...f,
      sensors: f.sensors.includes(sensor)
        ? f.sensors.filter(s => s !== sensor)
        : [...f.sensors, sensor],
    }))

  const setThreshold = (sensor, bound, raw) =>
    setThresholds(prev => updateThreshold(prev, sensor, bound, raw))

  useEffect(() => {
    if (!isHardware) { setDiscovered([]); return }
    discoverDevices().then(setDiscovered).catch(() => setDiscovered([]))
    const allowed = sensorOptionsFor('hardware')
    setForm(f => ({ ...f, sensors: f.sensors.filter(s => allowed.includes(s)) }))
  }, [isHardware])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || (!isHardware && !form.owner.trim()) || (isHardware && !form.device_id.trim())) {
      setError(isHardware ? 'Device ID and Name are required.' : 'Owner (student email) and Project Name are required.')
      return
    }
    setSaving(true)
    try {
      if (isHardware) {
        const res = await fetch(`${BASE}/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id:  form.device_id.trim(),
            name:       form.name.trim(),
            location:   form.location.trim(),
            sensors:    sensorList,
            source:     'hardware',
            thresholds: buildThresholds(sensorList, thresholds),
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          setError(data.detail ?? 'Registration failed.')
          return
        }
      } else {
        await createProject({
          device_id: 'project',
          name:     form.name.trim(),
          owner:    form.owner.trim(),
          location: form.location.trim(),
          sensors:  sensorList,
          thresholds: buildThresholds(sensorList, thresholds),
        })
      }
      onCreated()
    } catch (err) {
      setError(err.message ?? 'Network error.')
    } finally {
      setSaving(false)
    }
  }

  const title = isHardware ? 'Register Hardware Kit' : 'Create Project'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="modal-form" onSubmit={submit}>
          {isHardware && (
            <>
              <label className="field-label">Device ID *</label>
              <input
                className="field-input"
                placeholder="e.g. TL-A1B2C3D4"
                value={form.device_id}
                onChange={set('device_id')}
              />
              {discovered.length > 0 && (
                <>
                  <label className="field-label">
                    Or pick a live unregistered device <span className="field-hint">(seen on MQTT)</span>
                  </label>
                  <select
                    className="field-input"
                    value=""
                    onChange={e => setForm(f => ({ ...f, device_id: e.target.value }))}
                  >
                    <option value="" disabled>Select a discovered device…</option>
                    {discovered.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                </>
              )}
            </>
          )}

          {!isHardware && (
            <>
              <label className="field-label">Owner (student email) *</label>
              <input
                className="field-input"
                placeholder="e.g. ali@duet.edu.pk"
                value={form.owner}
                onChange={set('owner')}
              />
            </>
          )}

          <label className="field-label">Project Name *</label>
          <input
            className="field-input"
            placeholder="e.g. Battery Health Twin"
            value={form.name}
            onChange={set('name')}
          />

          <label className="field-label">Location</label>
          <input
            className="field-input"
            placeholder="e.g. Lab 2"
            value={form.location}
            onChange={set('location')}
          />

          <label className="field-label">Sensors</label>
          <div className="sensor-checkbox-group">
            {sensorOptionsFor(form.source).map(sensor => (
              <label key={sensor} className="sensor-checkbox">
                <input
                  type="checkbox"
                  checked={form.sensors.includes(sensor)}
                  onChange={() => toggleSensor(sensor)}
                />
                {sensor}
              </label>
            ))}
          </div>

          {sensorList.length > 0 && (
            <>
              <label className="field-label">
                Thresholds <span className="field-hint">(optional — defaults applied if blank)</span>
              </label>
              <div className="threshold-header-row">
                <span />
                <span className="threshold-col-label">min</span>
                <span className="threshold-col-label">max</span>
              </div>
              {sensorList.map(sensor => (
                <div key={sensor} className="threshold-row">
                  <span className="threshold-sensor">{sensor}</span>
                  <input
                    className="field-input threshold-input"
                    type="number"
                    placeholder="—"
                    value={thresholds[sensor]?.min ?? ''}
                    onChange={e => setThreshold(sensor, 'min', e.target.value)}
                  />
                  <input
                    className="field-input threshold-input"
                    type="number"
                    placeholder="—"
                    value={thresholds[sensor]?.max ?? ''}
                    onChange={e => setThreshold(sensor, 'max', e.target.value)}
                  />
                </div>
              ))}
            </>
          )}

          {error && <p className="field-error">{error}</p>}

          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? (isHardware ? 'Registering…' : 'Creating…') : (isHardware ? 'Register Kit' : 'Create Project')}
          </button>
        </form>
      </div>
    </div>
  )
}