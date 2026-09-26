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

export function pinDef(componentId, pinId) {
  return componentDef(componentId)?.pins.find(p => p.id === pinId) ?? null
}

const hex = (s) => parseInt(s, 16)

const byWhoami = (addr, whoami) =>
  REGISTRY.i2c.find(e => e.candidateAddrs.includes(addr) && hex(e.whoamiVal) === whoami) ?? null

// Two tiers, and they are NOT interchangeable. A whoami byte read off the chip
// is authoritative: if the board reports one, it decides the answer outright.
// Otherwise 1.0 firmware's `name` is honoured — and an explicit `null` there is
// meaningful: the board scanned that address and could not identify it, so it
// must NOT become a phantom component. Only when the field is absent altogether
// (1.1 firmware omits it) do we fall back to the address.
export function resolveScanEntry(entry) {
  const { addr, whoami, name } = entry ?? {}
  if (typeof whoami === 'number') return byWhoami(addr, whoami)
  if (name === null) return null
  if (name !== undefined) return allComponents().find(c => c.id === name) ?? null
  return REGISTRY.i2c.find(e => e.candidateAddrs.includes(addr)) ?? null
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
