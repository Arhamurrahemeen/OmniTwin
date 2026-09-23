import { useState } from 'react'
import { updateThreshold, buildThresholds } from '../threshold-utils'
import { sensorOptionsFor } from '../sensor-options'

const BASE = '/api'

export default function EditDevice({ device, onUpdated, onClose }) {
  const [form, setForm] = useState({
    name:                device.name                ?? '',
    location:            device.location             ?? '',
    sensors:              device.sensors ?? [],
    source:               device.source               ?? 'simulator',
    status:                device.status               ?? 'active',
    asset_type:            device.asset_type           ?? '',
    plant:                 device.plant                ?? '',
    criticality:           device.criticality          ?? 'medium',
    warranty_expiry:       device.warranty_expiry       ?? '',
    purchase_date:         device.purchase_date         ?? '',
    vendor_name:           device.vendor_name           ?? '',
    vendor_whatsapp:       device.vendor_whatsapp       ?? '',
    run_hours_threshold:   device.run_hours_threshold   ?? 500,
  })

  const initThresholds = () => {
    const result = {}
    for (const [sensor, bounds] of Object.entries(device.thresholds ?? {})) {
      result[sensor] = {
        min: bounds.min !== null && bounds.min !== undefined ? String(bounds.min) : '',
        max: bounds.max !== null && bounds.max !== undefined ? String(bounds.max) : '',
      }
    }
    return result
  }

  const [thresholds, setThresholds] = useState(initThresholds)
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const sensorList = form.sensors

  const toggleSensor = (sensor) =>
    setForm(f => ({
      ...f,
      sensors: f.sensors.includes(sensor)
        ? f.sensors.filter(s => s !== sensor)
        : [...f.sensors, sensor],
    }))

  const setSource = (e) => {
    const source = e.target.value
    const allowed = sensorOptionsFor(source)
    setForm(f => ({ ...f, source, sensors: f.sensors.filter(s => allowed.includes(s)) }))
  }

  const setThreshold = (sensor, bound, raw) =>
    setThresholds(prev => updateThreshold(prev, sensor, bound, raw))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      const res = await fetch(`${BASE}/devices/${device.device_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                form.name.trim(),
          location:            form.location.trim(),
          sensors:             sensorList,
          source:              form.source,
          status:              form.status,
          thresholds:          buildThresholds(sensorList, thresholds),
          asset_type:          form.asset_type || null,
          plant:               form.plant || null,
          criticality:         form.criticality,
          warranty_expiry:     form.warranty_expiry || null,
          purchase_date:       form.purchase_date || null,
          vendor_name:         form.vendor_name.trim() || null,
          vendor_whatsapp:     form.vendor_whatsapp.trim() || null,
          run_hours_threshold: Number(form.run_hours_threshold),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.detail ?? 'Update failed.')
        return
      }
      onUpdated(await res.json())
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
          <span className="modal-title">Edit Device</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="modal-form" onSubmit={submit}>
          <label className="field-label">Device ID</label>
          <input className="field-input" value={device.device_id} disabled />

          <label className="field-label">Name *</label>
          <input className="field-input" value={form.name} onChange={set('name')} />

          <label className="field-label">Location</label>
          <input className="field-input" value={form.location} onChange={set('location')} />

          <label className="field-label">Source</label>
          <select className="field-input" value={form.source} onChange={setSource}>
            <option value="simulator">Simulator</option>
            <option value="hardware">Hardware (ESP32)</option>
          </select>

          <label className="field-label">Status</label>
          <select className="field-input" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <label className="field-label">Asset Type</label>
          <select className="field-input" value={form.asset_type} onChange={set('asset_type')}>
            <option value="">—</option>
            <option value="genset">Genset</option>
            <option value="compressor">Compressor</option>
            <option value="chiller">Chiller</option>
            <option value="cold_storage">Cold Storage</option>
            <option value="storage">Storage</option>
          </select>

          <label className="field-label">Plant</label>
          <select className="field-input" value={form.plant} onChange={set('plant')}>
            <option value="">—</option>
            <option value="SITE Karachi">SITE Karachi</option>
            <option value="Faisalabad">Faisalabad</option>
            <option value="Sharjah">Sharjah</option>
            <option value="Kunri">Kunri</option>
          </select>

          <label className="field-label">Criticality</label>
          <select className="field-input" value={form.criticality} onChange={set('criticality')}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <label className="field-label">Warranty Expiry</label>
          <input className="field-input" type="date" value={form.warranty_expiry} onChange={set('warranty_expiry')} />

          <label className="field-label">Purchase Date</label>
          <input className="field-input" type="date" value={form.purchase_date} onChange={set('purchase_date')} />

          <label className="field-label">Vendor Name</label>
          <input className="field-input" value={form.vendor_name} onChange={set('vendor_name')} />

          <label className="field-label">Vendor WhatsApp</label>
          <input className="field-input" value={form.vendor_whatsapp} onChange={set('vendor_whatsapp')} placeholder="whatsapp:+92..." />

          <label className="field-label">Run Hours Accumulated <span className="field-hint">(read-only)</span></label>
          <input className="field-input" value={`${(device.run_hours ?? 0).toFixed(1)}h`} disabled />

          <label className="field-label">Run Hours Threshold</label>
          <input className="field-input" type="number" value={form.run_hours_threshold} onChange={set('run_hours_threshold')} />

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
                Thresholds <span className="field-hint">(leave blank to remove)</span>
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
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}
