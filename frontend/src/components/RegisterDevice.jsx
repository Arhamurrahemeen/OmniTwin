import { useEffect, useState } from 'react'
import { updateThreshold, buildThresholds } from '../threshold-utils'
import { sensorOptionsFor } from '../sensor-options'
import { discoverDevices } from '../api'

const BASE = '/api'

export default function RegisterDevice({ onCreated, onClose }) {
  const [form, setForm] = useState({
    device_id: '',
    name: '',
    location: '',
    sensors: [],
    source: 'simulator',
  })
  const [thresholds, setThresholds] = useState({})
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)
  const [discovered, setDiscovered] = useState([])

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
    if (form.source !== 'hardware') { setDiscovered([]); return }
    discoverDevices().then(setDiscovered).catch(() => setDiscovered([]))
    const allowed = sensorOptionsFor('hardware')
    setForm(f => ({ ...f, sensors: f.sensors.filter(s => allowed.includes(s)) }))
  }, [form.source])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.device_id.trim() || !form.name.trim()) {
      setError('Device ID and Name are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BASE}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id:  form.device_id.trim(),
          name:       form.name.trim(),
          location:   form.location.trim(),
          sensors:    sensorList,
          source:     form.source,
          thresholds: buildThresholds(sensorList, thresholds),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.detail ?? 'Registration failed.')
        return
      }
      onCreated()
    } catch {
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Register Device</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="modal-form" onSubmit={submit}>
          <label className="field-label">Device ID *</label>
          <input
            className="field-input"
            placeholder="e.g. shell-mpx-gen-1"
            value={form.device_id}
            onChange={set('device_id')}
          />
          {form.source === 'hardware' && discovered.length > 0 && (
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

          <label className="field-label">Name *</label>
          <input
            className="field-input"
            placeholder="e.g. Shell Mirpurkhas — Generator 1"
            value={form.name}
            onChange={set('name')}
          />

          <label className="field-label">Location</label>
          <input
            className="field-input"
            placeholder="e.g. Mirpurkhas"
            value={form.location}
            onChange={set('location')}
          />

          <label className="field-label">Source</label>
          <select className="field-input" value={form.source} onChange={set('source')}>
            <option value="simulator">Simulator</option>
            <option value="hardware">Hardware (ESP32)</option>
          </select>

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
                Thresholds <span className="field-hint">(optional — leave blank to skip)</span>
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
            {saving ? 'Registering…' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
