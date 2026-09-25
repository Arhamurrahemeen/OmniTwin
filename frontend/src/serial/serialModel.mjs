// Pure twin/scan model — no browser APIs, node-testable.
// Component registry: known I2C address -> component, plus DHT22, ESP32, breadboard.

export const COMPONENTS = {
  esp32:      { label: 'ESP32' },
  breadboard: { label: 'Breadboard' },
  mpu6050:    { label: 'MPU6050' },
  dht22:      { label: 'DHT22' },
}

const I2C_MAP = { 104: 'mpu6050', 105: 'mpu6050' }   // 0x68 / 0x69 (AD0 high)
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
  return raw // {i2c:[{addr,name}], dht22:{gpio,ok}}
}

export function scanToComponents(scan) {
  const comps = [{ type: 'esp32' }, { type: 'breadboard' }]  // board answered IDENT, so these are always present
  for (const { addr, name } of scan.i2c ?? []) {
    const type = name === null ? null : I2C_MAP[addr] ?? name
    if (type && COMPONENTS[type]) comps.push({ type })
  }
  if (scan.dht22?.ok) comps.push({ type: 'dht22' })
  return comps
}

const SENSOR_LABELS = { esp32: 'ESP32', breadboard: 'Breadboard' }

export function scanNotice(scan) {
  const sensors = scanToComponents(scan)
    .filter(c => !(c.type in SENSOR_LABELS))
    .map(c => COMPONENTS[c.type].label)
  if (sensors.length) return `SCAN: ESP32 + ${sensors.join(', ')}`
  return 'SCAN: ESP32 only — no sensors found (check 3V3/GND to each sensor)'
}

const DEFAULT_POS = {
  esp32:      { x: 120, y: 300 },
  breadboard: { x: 260, y: 180 },
  mpu6050:    { x: 320, y: 90 },
  dht22:      { x: 90,  y: 90 },
}

export function defaultLayout(components) {
  const comps = components.map((c, i) => {
    const p = DEFAULT_POS[c.type] ?? { x: 100 + i * 40, y: 100 + i * 40 }
    return { id: nid(), type: c.type, x: p.x, y: p.y }
  })
  return { components: comps, wires: [] }
}

export function addComponent(layout, type) {
  if (!COMPONENTS[type]) throw new Error(`Unknown component: ${type}`)
  const p = DEFAULT_POS[type] ?? { x: 100, y: 100 }
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