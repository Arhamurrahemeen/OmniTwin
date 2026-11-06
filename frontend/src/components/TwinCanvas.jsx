/* 2D digital-twin canvas: the board, a card per part with its live readings, and
   pin-anchored wires. Pure presentational: layout is owned by App via serialModel. */
import { useState } from 'react'
import ComponentSprite from './ComponentSprite'
import { allComponents, componentDef, componentPins, displayFor, limitNote, notReporting, pinDef, pinPos, referenceGhosts, wireRoute, wiresFor, wireStroke, wiringFaults } from '../serial/serialModel.mjs'
import ADAPTER from '../serial/adapters/twinlab_esp32_v1'

// Pin dot colour by kind — the same convention the wire stroke uses.
const pinColor = (kind) => wireStroke(kind).stroke

const RING_R = 34
const RING_C = 2 * Math.PI * RING_R

function Ring({ item, value, warn }) {
  const known = typeof value === 'number'
  const fill = known ? Math.min(Math.max(value / item.ring.max, 0), 1) : 0
  const color = warn ? 'var(--ot-warn)' : `var(--ot-ring-${item.key === 'temp' ? 'a' : 'b'})`
  return (
    <figure className="ring">
      <svg viewBox="0 0 84 84" width="84" height="84">
        <circle cx="42" cy="42" r={RING_R} className="ring-track" />
        <circle cx="42" cy="42" r={RING_R} className="ring-value" stroke={color}
          strokeDasharray={`${RING_C * fill} ${RING_C}`} transform="rotate(-90 42 42)" />
        <text x="42" y="44" textAnchor="middle" className="ring-number">{known ? value.toFixed(item.decimals) : '--'}</text>
        <text x="42" y="58" textAnchor="middle" className="ring-unit">{item.unit}</text>
      </svg>
      <figcaption>{item.label}</figcaption>
    </figure>
  )
}

function Reading({ item, value, warn }) {
  return (
    <div className="reading">
      <span className="reading-label">{item.label}</span>
      <span className={`reading-value ${warn ? 'reading-value--warn' : ''}`}>
        {typeof value === 'number' ? value.toFixed(item.decimals ?? 3) : '--'}
        {item.unit && <small>{item.unit}</small>}
      </span>
    </div>
  )
}

function PartCard({ type, live, badge }) {
  const def = componentDef(type)
  const items = displayFor(def)
  const notes = items.map(i => limitNote(i.key, live[i.key])).filter(Boolean)
  return (
    <div className="part-card" style={{ width: def?.size.w, height: def?.size.h }}>
      <div className="part-title">{def?.label ?? type}</div>
      <div className="part-body">
        <ComponentSprite type={type} />
        {items.map(item => {
          const warn = limitNote(item.key, live[item.key]) !== null
          return item.ring
            ? <Ring key={item.key} item={item} value={live[item.key]} warn={warn} />
            : <Reading key={item.key} item={item} value={live[item.key]} warn={warn} />
        })}
      </div>
      {(badge || notes[0]) && <div className="part-note">{badge ?? notes[0]}</div>}
    </div>
  )
}

export default function TwinCanvas({ layout, live = {}, onMove, onAdd, onWire, onUnwire, onRemove = () => {}, onRescan, scanning = false, scanInfo = null }) {
  const [dragging, setDragging] = useState(null)
  const [armed, setArmed] = useState(null)   // { componentId, pinId } awaiting its partner
  const [wireDragStart, setWireDragStart] = useState(null)
  const [wireCursor, setWireCursor] = useState(null)

  const onPointerDown = (c) => (e) => {
    e.stopPropagation()
    setDragging({ id: c.id, dx: e.clientX - c.x, dy: e.clientY - c.y })
  }
  const onPointerMove = (e) => {
    if (armed || wireDragStart) {
      const rect = e.currentTarget.getBoundingClientRect()
      setWireCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    if (dragging) onMove?.(dragging.id, e.clientX - dragging.dx, e.clientY - dragging.dy)
  }
  const onPinPointerDown = (c, p) => (e) => {
    e.stopPropagation()
    setWireDragStart({ componentId: c.id, pinId: p.id })
    setWireCursor(pinPos(c, p.id))
  }
  const onPointerUp = (e) => {
    setDragging(null)
    if (wireDragStart) {
      const target = e.target.closest?.('[data-component-id][data-pin-id]')
      const toComponentId = target?.dataset.componentId
      const toPinId = target?.dataset.pinId
      if (toComponentId && toPinId && toComponentId !== wireDragStart.componentId)
        onWire?.(wireDragStart.componentId, wireDragStart.pinId, toComponentId, toPinId)
      setWireDragStart(null)
      setWireCursor(null)
    }
  }

  // Click a pin to arm it, click a second pin to wire them. Clicking a pin that
  // already has a wire detaches it instead — no modifier keys, no delete mode.
  const onPinClick = (c, p) => (e) => {
    e.stopPropagation()
    const existing = wiresFor(layout, c.id, p.id)
    if (existing.length) { onUnwire?.(existing[0].id); setArmed(null); setWireCursor(null); return }
    if (armed && armed.componentId !== c.id) {
      onWire?.(armed.componentId, armed.pinId, c.id, p.id)
      setArmed(null)
      setWireCursor(null)
      return
    }
    if (armed?.componentId === c.id && armed?.pinId === p.id) {
      setArmed(null)
      setWireCursor(null)
      return
    }
    setArmed({ componentId: c.id, pinId: p.id })
    setWireCursor(pinPos(c, p.id))
  }
  // Clicking empty canvas cancels a half-drawn wire.
  const onCanvasDown = (e) => { if (e.target === e.currentTarget) setArmed(null) }

  const compById = (id) => layout.components.find(x => x.id === id)

  // A wiring fault belongs to the two parts it connects, and a quiet part is the
  // one whose reads are all null, so each note lands on its own card. A reading
  // past its limit is shown by that reading's own card (see PartCard).
  const wiringBad = new Set(
    wiringFaults(layout.wires, layout.components).flatMap(f => f.componentIds))
  const quiet = new Set(notReporting(layout.components, live))
  const badgeFor = (id) =>
    wiringBad.has(id) ? 'Check this wiring'
      : quiet.has(id) ? 'Not reporting' : null

  // Dashed = what the firmware expects, never a read of the student's jumpers.
  const ghosts = referenceGhosts(layout, ADAPTER.referenceWiring)

  return (
    <div
      className="twin-canvas"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onCanvasDown}
    >
      {layout.components.map(c => (
        <div
          key={c.id}
          className="part"
          data-component={c.type}
          onPointerDown={onPointerDown(c)}
          style={{ left: c.x, top: c.y }}
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
          {componentDef(c.type)?.reads || !componentDef(c.type)
            ? <PartCard type={c.type} live={live} badge={badgeFor(c.id)} />
            : <ComponentSprite type={c.type} />}
        </div>
      ))}

      <svg className="wires" width="100%" height="100%">
        {ghosts.map((g, i) => (
          <path key={i} d={g.d} className="wire wire--expected" stroke={wireStroke(g.kind).stroke} />
        ))}
        {layout.wires.map(w => {
          const fc = compById(w.fromComponentId), tc = compById(w.toComponentId)
          const fromPin = pinDef(fc, w.fromPinId), toPin = pinDef(tc, w.toPinId)
          // A wire whose part or pin is gone is skipped, not drawn to (0,0). The
          // wire itself is still real, so an unknown kind falls back to signal.
          if (!fc || !tc || !fromPin || !toPin) return null
          const stroke = wireStroke(fromPin.kind).stroke
          return <path key={w.id} d={wireRoute(fc, w.fromPinId, tc, w.toPinId)} className="wire"
            stroke={stroke} style={{ filter: `drop-shadow(0 0 3px ${stroke})` }} />
        })}
        {(wireDragStart || armed) && wireCursor && (() => {
          const start = wireDragStart ?? armed
          const from = pinPos(compById(start.componentId), start.pinId)
          const mid = Math.round((from.x + wireCursor.x) / 2)
          return <path d={`M${from.x} ${from.y} C${mid} ${from.y} ${mid} ${wireCursor.y} ${wireCursor.x} ${wireCursor.y}`}
            className="wire wire--expected" stroke="var(--ot-signal)" />
        })()}
      </svg>

      {/* Pin dots. These sit outside the draggable sprite divs so a pin press
          never starts a component drag. */}
      {layout.components.flatMap(c => componentPins(c).map(p => {
        const at = pinPos(c, p.id)
        const isArmed = armed?.componentId === c.id && armed?.pinId === p.id
        const color = pinColor(p.kind)
        return (
          <div
            key={`${c.id}.${p.id}`}
            className="pin"
            data-pin={`${c.type}.${p.id}`}
            data-component-id={c.id}
            data-pin-id={p.id}
            title={`${p.label} (${p.kind})`}
            onPointerDown={onPinPointerDown(c, p)}
            onClick={onPinClick(c, p)}
            style={{ left: at.x - 6, top: at.y - 6, background: color,
              boxShadow: isArmed ? '0 0 0 3px var(--ot-warn)' : `0 0 5px ${color}` }}
          >
            {/* The board's header already prints its own labels. */}
            {!componentDef(c.type)?.header && <span className="canvas-pin-label">{p.label}</span>}
          </div>
        )
      }))}

      <div className="canvas-foot" onPointerDown={(e) => e.stopPropagation()}>
        <span className="canvas-info">
          {scanInfo}
          {ghosts.length > 0 && <em> Dashed wires are what the firmware expects, not a read of your jumpers.</em>}
        </span>
        <button className="btn-quiet" onClick={onRescan} disabled={scanning}
          title="Re-run the I2C bus sweep to pick up a sensor you just clipped on">
          {scanning ? 'Scanning…' : 'Rescan'}
        </button>
        {/* One gesture: choosing a part adds it. */}
        <select className="btn-quiet" value="" aria-label="Add a part"
          onChange={(e) => { if (e.target.value) onAdd?.(e.target.value) }}>
          <option value="">+ Add part</option>
          {allComponents().map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
    </div>
  )
}
