// Pure twin/scan model — no browser APIs, node-testable.
// Component identity, geometry, and pins come from the data-driven registry
// (src/registry/components.json), not from tables in this file.

import { REGISTRY, allComponents, componentDef, componentPins, decodeRead, isKnown, pinDef, readPlan, resolveScanEntry, unidentifiedAddrs, whoamiRequests } from '../registry/registry.mjs'

// Re-exported so UI modules have one import site for registry data.
export { allComponents, componentDef, componentPins, isKnown, pinDef, readPlan, whoamiRequests }

// Ranges key on the WIRE key the adapter emits — `hum`, not `humidity`. The old
// `humidity` key never matched a reading, so the 20-90% check was dead code
// shaped like a working feature.
const SENSOR_RANGES = { temp: { max: 40 }, hum: { min: 20, max: 90 }, vib: { max: 0.2 } }
// Display labels for anomaly messages (readings keys are short wire names).
const LABELS = { temp: 'temperature', hum: 'humidity' }

let _seq = 0
const nid = () => `c${++_seq}${Date.now().toString(36)}`

// Reassemble raw UART bytes (chars) into full lines. Returns {lines, rest}.
export function readLine(state, chunk) {
  const buf = (state.rest + chunk).replace(/\r/g, '')
  const lines = buf.split('\n')
  const rest = lines.pop()
  const good = []
  for (const line of lines) {
    if (!line) continue
    try { JSON.parse(line); good.push(line) } catch { /* noise */ }
  }
  return { lines: good, rest }
}

// Race a promise against a timeout — surfaces a dead board as an error
// instead of hanging the UI. (Used by SerialSession.command.)
export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms — board not responding (check cable)`)), ms)
    promise.then(v => { clearTimeout(t); resolve(v) },
                 e => { clearTimeout(t); reject(e) })
  })
}

// Sessions resolve a command with an already-parsed object, but a raw UART line
// is also a valid input. Normalise both — JSON.parse on an object stringifies
// it to "[object Object]" and throws.
export function parseScan(line) {
  return typeof line === 'string' ? JSON.parse(line) : line
}

export function scanToComponents(scan) {
  // The board answered IDENT, so the `always` parts (board + breadboard) are present.
  const comps = REGISTRY.always.map(c => ({ type: c.id }))
  for (const entry of scan.i2c ?? []) {
    const def = resolveScanEntry(entry)
    if (def) comps.push({ type: def.id })
  }
  for (const def of REGISTRY.singleWire) {
    if (scan[def.id]?.ok) comps.push({ type: def.id })
  }
  return comps
}

const ALWAYS_IDS = new Set(REGISTRY.always.map(c => c.id))

export function scanNotice(scan) {
  // Dedupe by TYPE: one MPU6050 answers at both 0x68 and 0x69 when AD0 floats,
  // and both addresses ACK. Without this the status read "MPU6050, MPU6050"
  // even though the canvas (mergeLayout) had correctly placed a single sprite.
  const seen = new Set()
  const sensors = []
  for (const c of scanToComponents(scan)) {
    if (ALWAYS_IDS.has(c.type) || seen.has(c.type)) continue
    seen.add(c.type)
    sensors.push(componentDef(c.type).label)
  }
  // An address that ACKed but could not be identified is reported, not drawn:
  // the student learns something is on the bus without a guessed sprite.
  const unknown = unidentifiedAddrs(scan).map(a => `0x${a.toString(16).padStart(2, '0')}`)
  const extra = unknown.length ? `; unidentified I2C at ${unknown.join(', ')} (add it by hand)` : ''
  const board = componentDef('esp32').label
  if (sensors.length) return `SCAN: ${board} + ${sensors.join(', ')}${extra}`
  if (unknown.length) return `SCAN: ${board}${extra}`
  return 'SCAN: ESP32 only — no sensors found (check 3V3/GND to each sensor)'
}

const fallbackPos = (i) => ({ x: 100 + i * 40, y: 100 + i * 40 })

export function defaultLayout(components) {
  const comps = components.map((c, i) => {
    const p = componentDef(c.type)?.defaultPos ?? fallbackPos(i)
    return { id: nid(), type: c.type, x: p.x, y: p.y }
  })
  return { components: comps, wires: [] }
}

export function addComponent(layout, type) {
  if (!isKnown(type)) throw new Error(`Unknown component: ${type}`)
  const p = componentDef(type).defaultPos
  return { ...layout, components: [...layout.components, { id: nid(), type, x: p.x, y: p.y }] }
}

export function moveComponent(layout, id, x, y) {
  return {
    ...layout,
    components: layout.components.map(c => (c.id === id ? { ...c, x, y } : c)),
  }
}

// Wires attach to named pins, not component centres, so a wire can be checked
// for correctness and rendered from the pin's offset in the registry.
export function addWire(layout, fromComponentId, fromPinId, toComponentId, toPinId) {
  for (const [cid, pid] of [[fromComponentId, fromPinId], [toComponentId, toPinId]]) {
    if (!pinDef(layout.components.find(c => c.id === cid), pid))
      throw new Error(`Unknown pin: ${cid}.${pid}`)
  }
  if (fromComponentId === toComponentId)
    throw new Error('Wire ends on the same component')
  return {
    ...layout,
    wires: [...layout.wires, { id: nid(), fromComponentId, fromPinId, toComponentId, toPinId }],
  }
}

export function removeWire(layout, wireId) {
  return { ...layout, wires: layout.wires.filter(w => w.id !== wireId) }
}

// Take a part off the canvas. Its wires MUST go with it: a wire references a
// component id, and pinPos() returns {0,0} for an id it cannot resolve — so a
// dangling wire does not crash, it silently collapses into the canvas corner.
// Pruning here is the only place that knows both sides.
export function removeComponent(layout, componentId) {
  return {
    components: layout.components.filter(c => c.id !== componentId),
    wires: layout.wires.filter(w =>
      w.fromComponentId !== componentId && w.toComponentId !== componentId),
  }
}

// Merge auto-detected/declared components into an existing layout, preserving
// manual positions. Adds only components not already present (by type for
// always/auto, by id for declared).
export function mergeLayout(prev, comps) {
  const existingTypes = new Set(prev.components.map(c => c.type))
  const missing = comps.filter(c => !existingTypes.has(c.type))
  let out = { ...prev }
  for (const c of missing) out = addComponent(out, c.type)
  return out
}

// Merge the code-derived projection without losing hand-placed positions or
// manual wires. Declared wires are regenerated when the source is re-parsed.
export function mergeDeclaredLayout(prev, declaredLayout) {
  const components = [...prev.components]
  const wires = prev.wires.filter(w => !w.declared)
  const componentIds = new Map()

  for (const declared of declaredLayout.components) {
    const existingIndex = components.findIndex(c => c.type === declared.type)
    let target
    if (existingIndex >= 0) {
      const existing = components[existingIndex]
      target = {
        ...existing,
        declared: declared.declared || existing.declared,
        confidence: declared.declared ? declared.confidence : existing.confidence,
        pins: declared.pins ?? existing.pins,
        i2cAddress: declared.i2cAddress ?? existing.i2cAddress,
        pin: declared.pin ?? existing.pin,
      }
      components[existingIndex] = target
    } else {
      const position = componentDef(declared.type)?.defaultPos ?? fallbackPos(components.length)
      target = { ...declared, id: nid(), x: position.x, y: position.y }
      components.push(target)
    }
    componentIds.set(declared.id, target.id)
  }

  for (const wire of declaredLayout.wires) {
    const fromComponentId = componentIds.get(wire.fromComponentId)
    const toComponentId = componentIds.get(wire.toComponentId)
    if (!fromComponentId || !toComponentId) continue
    const alreadyPresent = wires.some(w =>
      w.fromComponentId === fromComponentId && w.fromPinId === wire.fromPinId &&
      w.toComponentId === toComponentId && w.toPinId === wire.toPinId)
    if (alreadyPresent) continue
    const from = components.find(c => c.id === fromComponentId)
    const to = components.find(c => c.id === toComponentId)
    if (!pinDef(from, wire.fromPinId) || !pinDef(to, wire.toPinId)) continue
    wires.push({ ...wire, id: nid(), fromComponentId, toComponentId, declared: true })
  }

  return { ...prev, components, wires }
}

// Screen position of a pin: the component's x/y plus the pin's registry offset.
// Falls back to {0,0} when the component or pin is unknown, which is also the
// signal callers use to skip an unresolvable wire.
export function pinPos(component, pinId) {
  const pin = pinDef(component, pinId)
  return pin ? { x: component.x + pin.dx, y: component.y + pin.dy } : { x: 0, y: 0 }
}

export function wiresFor(layout, componentId, pinId) {
  return layout.wires.filter(w =>
    (w.fromComponentId === componentId && w.fromPinId === pinId) ||
    (w.toComponentId === componentId && w.toPinId === pinId))
}

// Wire colour is a TEACHING LABEL, not a measurement: power / ground / signal.
// Nothing in the kit can measure voltage or current.
const STROKES = {
  power:  { stroke: 'var(--ot-power)', dash: null },
  ground: { stroke: 'var(--ot-ground)', dash: null },
  signal: { stroke: 'var(--ot-green)', dash: '6 4' },
}
export function wireStroke(kind) {
  return STROKES[kind] ?? STROKES.signal
}

// Cheap local wiring check — zero LLM cost, same spirit as anomalyFlags().
// The rule is one comparison: differing pin kinds is a wiring error. A signal
// pin in a ground pin is the commonest mistake this catches, and it is the
// only kind mismatch the current registry can express.
//
// Structured form: unlike a sensor anomaly, a wiring fault belongs to specific
// parts, so the canvas can badge those two sprites instead of the whole board.
export function wiringFaults(wires, components) {
  const byId = new Map(components.map(c => [c.id, c]))
  const end = (cid, pid) => {
    const comp = byId.get(cid)
    const pin = pinDef(comp, pid)
    return pin ? { id: cid, label: componentDef(comp.type).label, pin } : null
  }
  const faults = []
  for (const w of wires) {
    const a = end(w.fromComponentId, w.fromPinId)
    const b = end(w.toComponentId, w.toPinId)
    if (!a || !b) continue   // a wire to something no longer on the canvas
    if (a.pin.kind !== b.pin.kind)
      faults.push({
        message: `${a.pin.label} (${a.label}) wired to ${b.pin.label} (${b.label})`,
        componentIds: [a.id, b.id],
      })
  }
  return faults
}

export function wiringFlags(wires, components) {
  return wiringFaults(wires, components).map(f => f.message)
}

// The adapter's authored reference wiring, resolved to screen points for the
// ghost overlay. The pairs name component TYPES (there is one of each in a kit)
// while the layout holds instances, so resolve by type. Ends whose part is not
// on the canvas are dropped.
export function referenceGhosts(layout, referenceWiring) {
  const byType = new Map(layout.components.map(c => [c.type, c]))
  const ghosts = []
  for (const w of referenceWiring ?? []) {
    const [ft, fp] = w.from, [tt, tp] = w.to
    const f = byType.get(ft), t = byType.get(tt)
    if (!f || !t || !pinDef(f.type, fp) || !pinDef(t.type, tp)) continue
    ghosts.push({ from: pinPos(f, fp), to: pinPos(t, tp) })
  }
  return ghosts
}

// Try each board adapter's IDENT dialect in turn and take the first that
// answers. A losing adapter never receives a SCAN or STREAM — only IDENT.
export async function detectAdapter(session, adapters) {
  for (const adapter of adapters) {
    try {
      const reply = await session.command(adapter.identCommand, adapter.identTimeoutMs ?? 2000)
      const r = adapter.parseIdent(reply)
      if (r.ok) return { adapter, info: r.info }
    } catch {
      // Wrong dialect, or nothing on this port — try the next adapter.
    }
  }
  return null
}

// Annotate a SCAN reply with each identifiable address's WHOAMI byte, read off
// the board. `askWhoami` is injected so this stays free of Web Serial and
// testable with a stub. A probe that fails leaves `whoami` null/absent, which
// resolves only through a 1.0 board's legacy `name` — never through the
// address — so a failed read shows the chip as unidentified, not as a guess.
//
// Probes are SEQUENTIAL on purpose: SerialSession allows one outstanding
// command, so firing them concurrently makes every probe after the first throw
// "Command already in flight" and get silently swallowed.
export async function identifyScan(scan, askWhoami) {
  const regs = new Map(whoamiRequests(scan).map(r => [r.addr, r.reg]))
  const entries = []
  for (const e of scan.i2c ?? []) {
    if (!regs.has(e.addr)) { entries.push(e); continue }
    try { entries.push({ ...e, whoami: await askWhoami(e.addr, regs.get(e.addr)) }) }
    catch { entries.push(e) }
  }
  return { ...scan, i2c: entries }
}

export async function detectComponents(scan, askWhoami) {
  return scanToComponents(await identifyScan(scan, askWhoami))
}

// Poll a readPlan until stopped, handing each pass's decoded values to onValues.
// A failed read decodes to nulls, so a part that drops off shows as not reporting.
// The returned stop() resolves only once any in-flight command has finished:
// SerialSession allows one at a time, so a Rescan must await it before its SCAN.
// ponytail: fixed period, one shared loop. Add per-part rates if a sensor needs one.
export function startReadPolling(plan, askRead, onValues, periodMs = 200) {
  if (!plan.length) return async () => {}
  let running = true
  let wake = () => {}
  const done = (async () => {
    while (running) {
      const values = {}
      for (const { addr, reg, spec } of plan) {
        const bytes = await askRead(addr, reg, spec.len).catch(() => null)
        Object.assign(values, decodeRead(spec, bytes))
      }
      onValues(values)
      if (running) await new Promise(r => { wake = r; setTimeout(r, periodMs) })
    }
  })()
  return async () => { running = false; wake(); await done }
}

// Cheap local anomaly flags — zero LLM cost. Returns array of short strings.
const NO_DATA = 'no data yet'
export function anomalyFlags(readings) {
  if (!readings || Object.keys(readings).length === 0) return [NO_DATA]
  const flags = []
  for (const [sensor, value] of Object.entries(readings)) {
    const name = LABELS[sensor] ?? sensor
    // null means the sensor is not reporting, not that it returned a bad
    // number. Absence is notReporting()'s job and it is per-sprite; calling it
    // an anomaly here badged every part on the board with a false '⚠ anomaly'.
    if (value === null) continue
    if (Number.isNaN(value)) { flags.push(`${name} reading is NaN`); continue }
    const range = SENSOR_RANGES[sensor]
    if (range && value > range.max) flags.push(`${name} above ${range.max}`)
    if (range && range.min != null && value < range.min) flags.push(`${name} below ${range.min}`)
  }
  return flags
}

// Strip the connection-level flag so the canvas can badge parts only.
// 'no data yet' means the BOARD is silent, not that a part misbehaves — badging
// it onto every sprite turned one connection fault into N phantom part faults.
// The tutor still receives the full list, where "I cannot see your board" is
// useful information.
export function partFaults(flags) {
  return flags.filter((f) => f !== NO_DATA)
}

// Which components have gone quiet. A part is "not reporting" when the registry
// gives it reads and every one of them is null. The sprite is KEPT, not removed:
// a glitchy bus or a scan that timed out mid-sweep must not delete a rig the
// student built by hand.
//
// Deliberately not called "disconnected" — the board streams identical nulls
// for an unplugged sensor and for an I2C error, so it cannot tell them apart
// and neither can we. Parts with no registered reads (the esp32, the
// breadboard) are never flagged: "all reads null" is vacuously true for them.
//
// ponytail: no debounce across frames. The firmware's null is stable rather than
// flickery and the MPU probe retries at ~1 Hz, so a re-plug self-heals in about
// a second. Add a consecutive-frame counter if a dropped frame ever flashes it.
export function notReporting(components, live) {
  if (!live || Object.keys(live).length === 0) return []   // nothing measured yet: unknown, not absent
  return components
    .filter((c) => {
      const reads = componentDef(c.type)?.reads
      return reads?.length > 0 && reads.every((k) => live[k] == null)
    })
    .map((c) => c.id)
}
