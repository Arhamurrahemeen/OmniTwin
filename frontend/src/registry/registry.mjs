// Data-driven component registry — the single source of truth for part
// identity, sprite geometry, default placement, and pin kinds.
// Pure: no DOM, no Web Serial. Node-testable.
import REGISTRY_JSON from './components.json' with { type: 'json' }

export const REGISTRY = REGISTRY_JSON

export function allComponents() {
  return [...REGISTRY.i2c, ...REGISTRY.singleWire, ...REGISTRY.always]
}

export function componentDef(id) {
  return allComponents().find(c => c.id === id) ?? null
}

export function isKnown(id) {
  return componentDef(id) !== null
}

export function componentPins(component) {
  if (component && typeof component === 'object' && Array.isArray(component.pins)) return component.pins
  return componentDef(typeof component === 'string' ? component : component?.type)?.pins ?? []
}

export function pinDef(component, pinId) {
  return componentPins(component).find(p => p.id === pinId) ?? null
}

const hex = (s) => parseInt(s, 16)

const byWhoami = (addr, whoami) =>
  REGISTRY.i2c.find(e => e.candidateAddrs.includes(addr) && hex(e.whoamiVal) === whoami) ?? null

// Two tiers, and they are NOT interchangeable. A whoami byte read off the chip
// is authoritative: if the board reports one, nothing else can override it —
// though it must still agree on the address, so a chip answering 0x68 that is
// NOT on an MPU's address is not claimed as one. Otherwise 1.0 firmware's
// `name` is honoured — and an explicit `null` there is meaningful: the board
// scanned that address and could not identify it.
//
// There is NO address fallback. An address is not identity: a DS3231 RTC also
// ACKs at 0x68, and claiming it as an MPU6050 drew a phantom sprite whenever
// the WHOAMI read failed or timed out. Unresolved entries are reported as
// unidentified by unidentifiedAddrs(), never drawn.
export function resolveScanEntry(entry) {
  const { addr, whoami, name } = entry ?? {}
  if (typeof whoami === 'number') return byWhoami(addr, whoami)
  // A legacy name names an I2C part, so resolve it against the I2C table only —
  // a firmware that said "esp32" must not conjure a board sprite out of a scan.
  if (typeof name === 'string') return REGISTRY.i2c.find(e => e.id === name) ?? null
  return null
}

// Distinct ACK'd addresses that resolved to no part, in scan order.
export function unidentifiedAddrs(scan) {
  const out = []
  for (const e of scan?.i2c ?? []) {
    if (!resolveScanEntry(e) && !out.includes(e.addr)) out.push(e.addr)
  }
  return out
}

// Which READ polls to run: the readRegs of each part whose WHOAMI matched, minus
// any field the board's own stream already delivers. Only a chip that identified
// itself is polled — never a legacy `name`, which nothing read off the chip.
// A part ACKing at two addresses (AD0 floating) is polled once. `resolve` is
// injectable so a test can exercise a part the registry does not ship yet.
export function readPlan(scan, streamKeys = [], resolve = resolveScanEntry) {
  const plan = []
  const seen = new Set()
  for (const e of scan?.i2c ?? []) {
    if (typeof e.whoami !== 'number') continue
    const def = resolve(e)
    if (!def?.readRegs || seen.has(def.id)) continue
    seen.add(def.id)
    for (const spec of def.readRegs) {
      if (spec.fields.some(f => streamKeys.includes(f))) continue
      plan.push({ addr: e.addr, reg: hex(spec.reg), spec })
    }
  }
  return plan
}

// Decode a READ reply through its readRegs spec into { field: value }. Every field
// is null when the read failed: absent, never a fake 0 (see notReporting).
export function decodeRead(spec, bytes) {
  const ok = Array.isArray(bytes) && bytes.length === spec.len
  const width = spec.len / spec.fields.length
  const out = {}
  spec.fields.forEach((field, i) => {
    if (!ok) { out[field] = null; return }
    let raw = 0
    for (const b of bytes.slice(i * width, (i + 1) * width)) raw = raw * 256 + b
    if (spec.signed && raw >= 2 ** (8 * width - 1)) raw -= 2 ** (8 * width)
    out[field] = raw * (spec.scale ?? 1)
  })
  return out
}

// Which WHOAMI reads the browser should ask the board for: one per distinct
// scanned address that some registry entry claims and can identify.
export function whoamiRequests(scan) {
  const seen = new Map()
  for (const { addr } of scan?.i2c ?? []) {
    if (seen.has(addr)) continue
    const def = REGISTRY.i2c.find(e => e.candidateAddrs.includes(addr) && e.whoamiReg)
    if (def) seen.set(addr, { addr, reg: hex(def.whoamiReg) })
  }
  return [...seen.values()]
}
