// Pure twin/scan model — no browser APIs, node-testable.
// Component identity, geometry, and pins come from the data-driven registry
// (src/registry/components.json), not from tables in this file.

import { REGISTRY, allComponents, componentDef, isKnown, pinDef, resolveScanEntry, whoamiRequests } from '../registry/registry.mjs'

// Re-exported so UI modules have one import site for registry data.
export { allComponents, componentDef, isKnown, pinDef, whoamiRequests }

const SENSOR_RANGES = { temp: { max: 40 }, humidity: { min: 20, max: 90 }, vib: { max: 0.2 } }
// Display labels for anomaly messages (readings keys are short wire names).
const LABELS = { temp: 'temperature' }

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

export function parseScan(line) {
  const raw = JSON.parse(line)
  return raw // {i2c:[{addr,whoami?}], dht22:{gpio,ok}}
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
  const sensors = scanToComponents(scan)
    .filter(c => !ALWAYS_IDS.has(c.type))
    .map(c => componentDef(c.type).label)
  if (sensors.length) return `SCAN: ${componentDef('esp32').label} + ${sensors.join(', ')}`
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

export function addWire(layout, from, to) {
  return { ...layout, wires: [...layout.wires, { id: nid(), from, to }] }
}

// Cheap local anomaly flags — zero LLM cost. Returns array of short strings.
export function anomalyFlags(readings) {
  if (!readings || Object.keys(readings).length === 0) return ['no data yet']
  const flags = []
  for (const [sensor, value] of Object.entries(readings)) {
    const name = LABELS[sensor] ?? sensor
    if (value === null || Number.isNaN(value)) { flags.push(`${name} reading is NaN`); continue }
    const range = SENSOR_RANGES[sensor]
    if (range && value > range.max) flags.push(`${name} above ${range.max}`)
    if (range && range.min != null && value < range.min) flags.push(`${name} below ${range.min}`)
  }
  return flags
}
