/* 2D digital-twin canvas: breadboard backdrop + draggable component sprites +
   pin-anchored wires + live-value overlays with anomaly rings.
   Pure presentational: layout is owned by App via serialModel. */
import { useState } from 'react'
import ComponentSprite from './ComponentSprite'
import { allComponents, componentDef, pinDef, pinPos, wiresFor, wireStroke, referenceGhosts, wiringFaults, notReporting } from '../serial/serialModel.mjs'
import ADAPTER from '../serial/adapters/twinlab_esp32_v1'

// Pin dot colour by kind — the same convention the wire stroke uses.
const PIN_COLOR = { power: 'var(--ot-power)', ground: 'var(--ot-ground)', signal: 'var(--ot-green)' }

export default function TwinCanvas({ layout, live = {}, sensorFlags = [], onMove, onAdd, onWire, onUnwire, onRemove = () => {}, scanInfo = null }) {
  const [dragging, setDragging] = useState(null)
  const [addType, setAddType] = useState('breadboard')
  const [armed, setArmed] = useState(null)   // { componentId, pinId } awaiting its partner
  const [showReference, setShowReference] = useState(false)

  // A sensor's values render only on its own sprite, not on every ESP/breadboard
  // duplicate. Driven by the registry's `reads` field, so adding a sensor stays
  // a one-file JSON edit.
  const readsFor = (type) => componentDef(type)?.reads ?? []

  // The firmware streams accel as %.3f, so 1 dp threw away two decimals: a
  // resting MPU reads ±0.03 g and rendered as a permanent "ax: 0.0", which
  // looked exactly like a frozen stream. Temperature is the only reading coarse
  // enough for 1 dp.
  const DECIMALS = { temp: 1, hum: 1 }

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

  // A wiring fault belongs to the two parts it connects, so badge only those.
  // A part that has gone quiet is attributable too — it is the part whose
  // registered reads are all null — so that one is badged per sprite as well.
  // Sensor anomalies stay global: a threshold excursion on "temp" is not
  // attributable to one sprite from the flag string alone.
  const wiringBad = new Set(
    wiringFaults(layout.wires, layout.components).flatMap(f => f.componentIds))
  const quiet = new Set(notReporting(layout.components, live))

  // Most specific first: a wiring fault is a confirmed student error and the
  // most actionable thing on the sprite; absence is a hardware fact; a
  // threshold anomaly is often just downstream of one of the other two.
  const badgeFor = (id) =>
    wiringBad.has(id) ? '⚠ wiring'
      : quiet.has(id) ? '⚠ not reporting'
        : sensorFlags.length > 0 ? '⚠ anomaly' : null

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
          <button
            className="canvas-remove"
            aria-label={`Remove ${componentDef(c.type)?.label ?? c.type}`}
            title="Remove this part and any wires to it"
            // stopPropagation on BOTH: without the pointerdown stop this starts
            // a drag, and without the click stop the canvas handler sees a click
            // on empty space and cancels an armed wire.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemove(c.id) }}
          >
            ×
          </button>
          {c.declared && (
            <span className="sprite-declared-badge" title={`Declared in code (${c.confidence})${c.i2cAddress ? `, I2C 0x${c.i2cAddress.toString(16)}` : ''}${c.pin ? `, GPIO${c.pin}` : ''}`}>
              D
            </span>
          )}
          <ComponentSprite type={c.type} />
          <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--ot-ink)', textAlign: 'center' }}>
            {componentDef(c.type)?.label ?? c.type}
          </div>
          {readsFor(c.type).map(k => live[k] != null && (
              <div key={k} style={{ fontSize: 9, color: 'var(--ot-green)' }}>
                {k}: {typeof live[k] === 'number' ? live[k].toFixed(DECIMALS[k] ?? 3) : '--'}
              </div>
            ))}
          {badgeFor(c.id) && (
            <div style={{ color: 'var(--ot-orange)', fontSize: 9, maxWidth: 160 }}>
              {badgeFor(c.id)}
            </div>
          )}
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

      {showReference && referenceGhosts(layout, ADAPTER.referenceWiring).map((g, i) => (
        <svg key={`ghost${i}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
          <line
            x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y}
            stroke="var(--ot-ink)" strokeWidth="1" strokeDasharray="2 4" opacity="0.5"
          />
        </svg>
      ))}

      {layout.wires.map(w => {
        const fc = compById(w.fromComponentId), tc = compById(w.toComponentId)
        const fromPin = pinDef(fc?.type, w.fromPinId), toPin = pinDef(tc?.type, w.toPinId)
        // A wire whose part or pin is gone is skipped, not drawn to (0,0). The
        // wire itself is still real, so an unknown kind falls back to signal.
        if (!fc || !tc || !fromPin || !toPin) return null
        const from = pinPos(fc, w.fromPinId)
        const to = pinPos(tc, w.toPinId)
        const s = wireStroke(fromPin.kind)
        return (
          <svg key={w.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
            <line
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={s.stroke} strokeWidth="3" strokeDasharray={s.dash ?? undefined}
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
      <button onClick={() => setShowReference(v => !v)} className="btn-secondary"
        title="This board's fixed pin configuration as the firmware defines it — not a read of the physical jumper wires. Nothing in the kit can detect which breadboard hole a wire sits in."
        style={{ position: 'absolute', right: 152, top: 12 }}>
        {showReference ? 'Hide' : 'Show'} reference wiring
      </button>
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