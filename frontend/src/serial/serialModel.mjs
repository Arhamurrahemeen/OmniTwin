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

// Resolve a SCAN reply into components, asking the board to read each
// identifiable address's WHOAMI register first. `askWhoami` is injected so this
// stays free of Web Serial and testable with a stub. A probe that fails leaves
// `whoami` absent, which falls back to address resolution — so an unreflashed
// 1.0 board still detects.
export async function detectComponents(scan, askWhoami) {
  const regs = new Map(whoamiRequests(scan).map(r => [r.addr, r.reg]))
  const entries = await Promise.all((scan.i2c ?? []).map(async (e) => {
    if (!regs.has(e.addr)) return e
    try { return { ...e, whoami: await askWhoami(e.addr, regs.get(e.addr)) } }
    catch { return e }
  }))
  return scanToComponents({ ...scan, i2c: entries })
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
