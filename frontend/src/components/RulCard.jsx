import { useEffect, useState } from 'react'
import { getRul } from '../api'

export default function RulCard({ deviceId }) {
  const [data, setData] = useState([])

  useEffect(() => {
    if (!deviceId) return
    const load = () => getRul(deviceId).then(setData).catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [deviceId])

  const warnings = data.filter(d => d.status === 'warning')
  const visible = data.filter(d => d.status !== 'stable' && d.hours_remaining != null)

  if (visible.length === 0) return null

  return (
    <div className="rul-strip">
      <span className="rul-label">RUL Forecast</span>
      <div className="rul-items">
        {visible.map(item => (
          <div key={item.sensor} className={`rul-item ${item.status === 'warning' ? 'rul-item--warn' : ''}`}>
            <span className="rul-sensor">{item.sensor.replace('_', ' ')}</span>
            <span className="rul-hours">{item.hours_remaining}h</span>
            <span className="rul-trend">{item.trend === 'rising' ? '↑' : '↓'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
