import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAlerts } from '../api'

export default function AlertsPanel({ device, liveMessages = [] }) {
  const [alerts, setAlerts]   = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    try {
      const data = await getAlerts(device.device_id)
      setAlerts(data)
    } catch {
      // keep existing list on transient error
    } finally {
      setLoading(false)
    }
  }, [device])

  // Poll every 5 s as fallback
  useEffect(() => {
    setAlerts([])
    load()
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [load])

  // React immediately when a new alert arrives via WebSocket
  const wsAlertCount = useMemo(
    () => liveMessages.filter(m => m.type === 'alert').length,
    [liveMessages],
  )
  useEffect(() => {
    if (wsAlertCount > 0) load()
  }, [wsAlertCount, load])

  return (
    <aside className="panel alerts-panel">
      <div className="panel-title-row">
        <p className="panel-title">Alerts</p>
        {alerts.length > 0 && (
          <span className="alert-badge">{alerts.length}</span>
        )}
      </div>

      {!device && <p className="muted">Select a project.</p>}

      {device && loading && alerts.length === 0 && (
        <p className="muted">Loading…</p>
      )}

      {device && !loading && alerts.length === 0 && (
        <p className="muted ok-text">No alerts.</p>
      )}

      {alerts.map((a, i) => (
        <div key={i} className={`alert-item alert-item--${a.severity ?? 'warning'}`}>
          <div className="alert-top-row">
            <span className="alert-sensor">
              {(a.sensor ?? '').replace(/_/g, ' ')}
            </span>
            <span className="alert-type-tag alert-type-tag--threshold">threshold</span>
          </div>
          <span className="alert-value">
            {typeof a.value === 'number' ? a.value.toFixed(2) : a.value}
            {' '}<span className="alert-unit">{a.unit}</span>
          </span>
          {a.detail && <span className="alert-detail">{a.detail}</span>}
          {a.hint_en && <span className="alert-hint">{a.hint_en}</span>}
          <span className="alert-ts">{new Date(a.ts).toLocaleTimeString()}</span>
        </div>
      ))}
    </aside>
  )
}