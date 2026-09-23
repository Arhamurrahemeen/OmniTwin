import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getReadings } from '../api'

const SENSOR_COLORS = {
  temperature: '#4ECDC4',
  humidity:    '#56C596',
  accel_x:     '#A78BFA',
  accel_y:     '#F59E0B',
  accel_z:     '#60A5FA',
  gyro_x:      '#F472B6',
  gyro_y:      '#34D399',
  gyro_z:      '#FB923C',
  vibration:   '#A78BFA',
  current:     '#F59E0B',
}

const fmt = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
}

function getBreachState(value, threshold) {
  if (threshold == null) return null
  const { min, max } = threshold
  if (max != null && value > max) return 'critical'
  if (min != null && value < min) return 'critical'
  // caution zone: within ~12% of max, or within 50% above min
  if (max != null && value > max * 0.88) return 'caution'
  if (min != null && min > 0 && value < min * 1.5) return 'caution'
  return null
}

export default function SensorChart({ deviceId, sensor, liveMessages, threshold }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!deviceId) return
    setHistory([])
    getReadings(deviceId, sensor, 50, 24)
      .then(data => setHistory(
        data.map(r => ({ ts: new Date(r.ts).getTime(), value: r.value, unit: r.unit }))
      ))
      .catch(() => {})
  }, [deviceId, sensor])

  const chartData = useMemo(() => {
    const live = liveMessages
      .filter(m => m.sensor === sensor)
      .map(m => ({ ts: m.ts, value: m.value, unit: m.unit }))

    const seen = new Set()
    return [...history, ...live]
      .filter(r => { const k = r.ts; if (seen.has(k)) return false; seen.add(k); return true })
      .slice(-100)
  }, [history, liveMessages, sensor])

  const color  = SENSOR_COLORS[sensor] ?? '#4ECDC4'
  const latest = chartData.at(-1)

  const breachState = useMemo(
    () => latest ? getBreachState(latest.value, threshold) : null,
    [latest, threshold],
  )

  const valueColor = breachState === 'critical' ? '#E05252'
                   : breachState === 'caution'  ? '#F5C842'
                   : null

  return (
    <div className={`chart-card${breachState ? ` chart-card--${breachState}` : ''}`}>
      <div className="chart-header">
        <span className="chart-title">{sensor.replace(/_/g, ' ')}</span>
        {latest && (
          <span className="chart-latest" style={valueColor ? { color: valueColor } : {}}>
            {latest.value.toFixed(3)} <span className="chart-unit">{latest.unit}</span>
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2E3542" vertical={false} />
          <XAxis
            dataKey="ts"
            tickFormatter={fmt}
            tick={{ fill: '#8A96A8', fontSize: 10 }}
            minTickGap={50}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8A96A8', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{ background: '#252B35', border: '1px solid #2E3542', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#8A96A8' }}
            itemStyle={{ color }}
            labelFormatter={fmt}
            formatter={(v) => [`${v.toFixed(4)} ${latest?.unit ?? ''}`, sensor]}
          />
          {threshold?.min != null && (
            <ReferenceLine
              y={threshold.min}
              stroke="#F5C842"
              strokeDasharray="4 3"
              strokeWidth={1.2}
              label={{ value: `min ${threshold.min}`, fill: '#F5C842', fontSize: 9, position: 'insideTopLeft' }}
            />
          )}
          {threshold?.max != null && (
            <ReferenceLine
              y={threshold.max}
              stroke="#E05252"
              strokeDasharray="4 3"
              strokeWidth={1.2}
              label={{ value: `max ${threshold.max}`, fill: '#E05252', fontSize: 9, position: 'insideTopRight' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
