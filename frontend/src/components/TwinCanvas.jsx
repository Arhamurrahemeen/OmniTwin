/* 2D digital-twin canvas: breadboard backdrop + draggable component sprites +
   pin-anchored wires + live-value overlays with anomaly rings.
   Pure presentational: layout is owned by App via serialModel. */
import { useState } from 'react'
import ComponentSprite from './ComponentSprite'
import { allComponents, componentDef, pinDef, pinPos, wiresFor } from '../serial/serialModel.mjs'

// Pin dot colour by kind — the same convention the wire stroke uses.
const PIN_COLOR = { power: 'var(--ot-power)', ground: 'var(--ot-ground)', signal: 'var(--ot-green)' }

export default function TwinCanvas({ layout, live = {}, flags = [], onMove, onAdd, onWire, onUnwire, scanInfo = null }) {
  const [dragging, setDragging] = useState(null)
  const [addType, setAddType] = useState('breadboard')
  const [armed, setArmed] = useState(null)   // { componentId, pinId } awaiting its partner

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

  // Click a pin to arm it, click a second pin to wire them. Clicking a pin that
  // already has a wire detaches it instead — no modifier keys, no delete mode.
  const onPinDown = (c, p) => (e) => {
    e.stopPropagation()
    const existing = wiresFor(layout, c.id, p.id)
    if (existing.length) { onUnwire?.(existing[0].id); setArmed(null); return }
    if (armed && armed.componentId !== c.id) {
      onWire?.(armed.componentId, armed.pinId, c.id, p.id)
      setArmed(null)
      return
    }
    setArmed({ componentId: c.id, pinId: p.id })
  }
  // Clicking empty canvas cancels a half-drawn wire.
  const onCanvasDown = (e) => { if (e.target === e.currentTarget) setArmed(null) }

  const compById = (id) => layout.components.find(x => x.id === id)

  return (
    <div
      className="twin-canvas"
      style={{ position: 'relative', height: 520, overflow: 'hidden', border: '1px solid var(--ot-green)', borderRadius: 8, background: 'var(--ot-paper)' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onCanvasDown}
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

      {/* Pin dots. These sit outside the draggable sprite divs so a pin press
          never starts a component drag. */}
      {layout.components.flatMap(c => (componentDef(c.type)?.pins ?? []).map(p => {
        const at = pinPos(c, p.id)
        const isArmed = armed?.componentId === c.id && armed?.pinId === p.id
        const wired = wiresFor(layout, c.id, p.id).length > 0
        return (
          <div
            key={`${c.id}.${p.id}`}
            data-pin={`${c.type}.${p.id}`}
            title={`${p.label} (${p.kind})`}
            onPointerDown={onPinDown(c, p)}
            style={{
              position: 'absolute', left: at.x - 5, top: at.y - 5, width: 10, height: 10,
              borderRadius: '50%', cursor: 'crosshair', zIndex: 2,
              background: PIN_COLOR[p.kind] ?? 'var(--ot-green)',
              boxShadow: isArmed ? '0 0 0 3px var(--ot-orange)' : (wired ? '0 0 0 2px var(--ot-paper)' : 'none'),
              outline: '1px solid var(--ot-ink)',
            }}
          />
        )
      }))}

      {layout.wires.map(w => {
        const fc = compById(w.fromComponentId), tc = compById(w.toComponentId)
        if (!fc || !tc || !pinDef(fc.type, w.fromPinId) || !pinDef(tc.type, w.toPinId)) return null
        const from = pinPos(fc, w.fromPinId)
        const to = pinPos(tc, w.toPinId)
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