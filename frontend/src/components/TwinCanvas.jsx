/* 2D digital-twin canvas: breadboard backdrop + draggable component sprites +
   animated wire flows + live-value overlays with anomaly rings.
   Pure presentational: layout is owned by App via serialModel. */
import { useState } from 'react'
import ComponentSprite from './ComponentSprite'
import { allComponents, componentDef } from '../serial/serialModel.mjs'

export default function TwinCanvas({ layout, live = {}, flags = [], onMove, onAdd, scanInfo = null }) {
  const [dragging, setDragging] = useState(null)
  const [addType, setAddType] = useState('breadboard')

  // Which readings belong to which component — a sensor's values render only on
  // its own sprite, not on every ESP/breadboard duplicate.
  const READING_OWNER = { dht22: ['temp', 'hum'], mpu6050: ['ax', 'ay', 'az'] }

  const onPointerDown = (c) => (e) => {
    e.stopPropagation()
    setDragging({ id: c.id, dx: e.clientX - c.x, dy: e.clientY - c.y })
  }
  const onPointerMove = (e) => {
    if (!dragging) return
    onMove?.(dragging.id, e.clientX - dragging.dx, e.clientY - dragging.dy)
  }
  const onPointerUp = () => setDragging(null)

  const pos = (id) => {
    const c = layout.components.find(x => x.id === id)
    return c ? { x: c.x + 35, y: c.y + 35 } : { x: 0, y: 0 }
  }

  return (
    <div
      className="twin-canvas"
      style={{ position: 'relative', height: 520, overflow: 'hidden', border: '1px solid var(--ot-green)', borderRadius: 8, background: 'var(--ot-paper)' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {layout.components.map(c => (
        <div
          key={c.id}
          data-component={c.type}
          onPointerDown={onPointerDown(c)}
          style={{ position: 'absolute', left: c.x, top: c.y, cursor: 'move', userSelect: 'none' }}
        >
          <ComponentSprite type={c.type} />
          <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--ot-ink)', textAlign: 'center' }}>
            {componentDef(c.type)?.label ?? c.type}
          </div>
          {READING_OWNER[c.type]?.map(k => live[k] != null && (
              <div key={k} style={{ fontSize: 9, color: 'var(--ot-green)' }}>
                {k}: {typeof live[k] === 'number' ? live[k].toFixed(1) : '--'}
              </div>
            ))}
          {flags.length > 0 && <div style={{ color: 'var(--ot-orange)', fontSize: 9 }}>⚠ anomaly</div>}
        </div>
      ))}

      {layout.wires.map(w => {
        const from = pos(w.from)
        const to = pos(w.to)
        return (
          <svg key={w.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
            <line
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="var(--ot-green)" strokeWidth="3" strokeDasharray="6 4"
            />
          </svg>
        )
      })}

      <select
        value={addType}
        onChange={e => setAddType(e.target.value)}
        className="btn-secondary"
        style={{ position: 'absolute', right: 132, top: 12 }}
        aria-label="Add component type"
      >
        {allComponents().map(c => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <button onClick={() => onAdd?.(addType)} className="btn-secondary" style={{ position: 'absolute', right: 12, top: 12 }}>
        + Add component
      </button>
      {scanInfo && (
        <p className="scan-status" style={{ position: 'absolute', left: 12, bottom: 12, fontSize: 11 }}>{scanInfo}</p>
      )}
      {layout.components.length === 0 && (
        <p className="empty-state" style={{ marginTop: 40 }}>Auto-detected components will appear here. Add them manually if the scan missed any.</p>
      )}
    </div>
  )
}