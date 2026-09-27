import test from 'node:test'
import assert from 'node:assert'
import {
  REGISTRY, allComponents, componentDef, isKnown,
  resolveScanEntry, pinDef, whoamiRequests,
} from '../src/registry/registry.mjs'

test("registry seeds exactly today's four parts", () => {
  assert.deepEqual(allComponents().map(c => c.id).sort(), ['breadboard', 'dht22', 'esp32', 'mpu6050'])
})

test('every component has a label, size, defaultPos, and at least one pin', () => {
  for (const c of allComponents()) {
    assert.ok(c.label, `${c.id} label`)
    assert.ok(c.size.w > 0 && c.size.h > 0, `${c.id} size`)
    assert.equal(typeof c.defaultPos.x, 'number', `${c.id} defaultPos.x`)
    assert.ok(c.pins.length > 0, `${c.id} pins`)
  }
})

test('canvas pin choices match the authored ESP32, breadboard, and MPU terminals', () => {
  assert.equal(componentDef('esp32').pins.length, 5)
  assert.equal(componentDef('breadboard').pins.length, 2)
  assert.equal(componentDef('mpu6050').pins.length, 4)
})

test('pin ids are unique within a component and kinds are legal', () => {
  for (const c of allComponents()) {
    const ids = c.pins.map(p => p.id)
    assert.equal(new Set(ids).size, ids.length, `${c.id} duplicate pin id`)
    for (const p of c.pins) assert.ok(['power', 'ground', 'signal'].includes(p.kind), `${c.id}.${p.id} kind`)
  }
})

test('pinDef finds a pin and returns null for an unknown one', () => {
  assert.equal(pinDef('mpu6050', 'SDA').kind, 'signal')
  assert.equal(pinDef('mpu6050', 'NOPE'), null)
  assert.equal(pinDef('nonexistent', 'SDA'), null)
})

test('a WHOAMI byte is authoritative — it overrides the name and the address', () => {
  // 104 is in mpu6050.candidateAddrs and a 1.0 board would call it "mpu6050",
  // but 0x58 on register 0x75 is a BMP280. WHOAMI wins; no fall-through.
  assert.equal(resolveScanEntry({ addr: 104, whoami: 0x58, name: 'mpu6050' }), null)
  assert.equal(resolveScanEntry({ addr: 104, whoami: 0x68 })?.id, 'mpu6050')
})

test('an explicit name:null means the board could not identify it — no component', () => {
  assert.equal(resolveScanEntry({ addr: 104, name: null }), null)
  assert.equal(resolveScanEntry({ addr: 72, name: null }), null)
})

test('resolveScanEntry falls back to the legacy firmware name, then the address', () => {
  assert.equal(resolveScanEntry({ addr: 104, name: 'mpu6050' })?.id, 'mpu6050')
  assert.equal(resolveScanEntry({ addr: 105 })?.id, 'mpu6050')
})

test('resolveScanEntry returns null for an unknown address — no phantom component', () => {
  assert.equal(resolveScanEntry({ addr: 72, name: null }), null)
  assert.equal(resolveScanEntry({ addr: 72, whoami: 0x11 }), null)
})

test('whoamiRequests asks only for addresses the registry has a register for', () => {
  assert.deepEqual(whoamiRequests({ i2c: [{ addr: 104 }, { addr: 72 }] }), [{ addr: 104, reg: 0x75 }])
})

test('whoamiRequests is empty when the bus is empty', () => {
  assert.deepEqual(whoamiRequests({ i2c: [] }), [])
})

test('a legacy name resolves against the I2C table only', () => {
  // A firmware claiming "esp32" on a bus scan must not conjure a board sprite.
  assert.equal(resolveScanEntry({ addr: 104, name: 'esp32' }), null)
  assert.equal(resolveScanEntry({ addr: 104, name: 'dht22' }), null)
})

test('whoamiReg and whoamiVal must be 0x-prefixed hex', () => {
  // parseInt(s, 16) silently reinterprets a decimal literal: "75" would become
  // 117 (0x75) and probe the wrong register, dropping the part from the canvas.
  for (const e of REGISTRY.i2c) {
    for (const f of ['whoamiReg', 'whoamiVal']) {
      if (e[f] !== undefined) assert.match(e[f], /^0x[0-9a-f]+$/i, `${e.id}.${f} = ${e[f]}`)
    }
  }
})

test('componentDef and isKnown agree on the four seeded parts', () => {
  for (const c of allComponents()) assert.equal(isKnown(c.id), true)
  assert.equal(componentDef('bmp280'), null)
  assert.equal(isKnown('bmp280'), false)
  assert.equal(REGISTRY.i2c.length, 1)
})
