import test from 'node:test'
import assert from 'node:assert'
import {
  readLine, parseScan, scanToComponents, defaultLayout,
  addComponent, moveComponent, addWire, removeWire, pinPos, wiresFor,
  wiringFlags, wiringFaults, wireStroke, referenceGhosts,
  anomalyFlags, withTimeout, scanNotice,
} from '../src/serial/serialModel.mjs'

test('readLine reassembles a line split across chunks', () => {
  let st = { rest: '' }
  const a = readLine(st, '{"i2c":[{"add')
  assert.equal(a.lines.length, 0)
  st = { rest: a.rest }
  const b = readLine(st, 'r":104,"name":"mpu6050"}]}\n')
  assert.equal(b.lines.length, 1)
  assert.equal(b.rest, '')
  assert.deepEqual(JSON.parse(b.lines[0]), { i2c: [{ addr: 104, name: 'mpu6050' }] })
})

test('readLine ignores noise lines and strips CR', () => {
  const st = { rest: '' }
  const out = readLine(st, 'IDF monitor on COM3\r\nnot-json\r\n')
  assert.deepEqual(out.lines, [])
  assert.equal(out.rest, '')
})

test('parseScan extracts i2c list and dht probe', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"},{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  assert.deepEqual(s.i2c.map(x => x.addr), [104, 72])
  assert.ok(s.dht22.ok)
})

test('parseScan accepts an already-parsed reply as well as a raw line', () => {
  // Both session types resolve a command with a parsed object, not a string.
  // Feeding that object to JSON.parse yields "[object Object]" and throws.
  const obj = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  assert.deepEqual(parseScan(obj), obj)
})

test('scanToComponents maps known addresses + ok dht + always ESP/breadboard', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"},{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  const comps = scanToComponents(s)
  const types = comps.map(c => c.type)
  assert.ok(types.includes('esp32'))
  assert.ok(types.includes('breadboard'))
  assert.ok(types.includes('mpu6050'))
  assert.ok(types.includes('dht22'))
})

test('scanToComponents on an empty bus still yields ESP + breadboard', () => {
  const s = parseScan('{"i2c":[],"dht22":{"gpio":4,"ok":false}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.deepEqual([...types].sort(), ['breadboard', 'esp32'])
})

test('scanToComponents maps an MPU at 0x69 (105) too', () => {
  const s = parseScan('{"i2c":[{"addr":105,"name":"mpu6050"}],"dht22":{"gpio":4,"ok":false}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.ok(types.includes('mpu6050'))
})

test('scanToComponents tolerates the bus{} block in the SCAN reply', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"}],"dht22":{"gpio":4,"ok":true},"bus":{"sda_up":true,"scl_up":true}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.ok(types.includes('mpu6050'))
  assert.ok(types.includes('dht22'))
})

// --- registry-backed resolution (Task 2) ---
// These pin the refactor's contract: same behaviour as before for every case
// the old I2C_MAP handled, plus WHOAMI identity where the two disagree.

test('scanToComponents resolves the 1.1 SCAN shape (raw address, no name field)', () => {
  const s = parseScan('{"i2c":[{"addr":104}],"dht22":{"gpio":4,"ok":true}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.ok(types.includes('mpu6050'))
  assert.equal(scanNotice(s), 'SCAN: ESP32 + MPU6050, DHT22')
})

test('scanToComponents ignores an address no registry entry claims', () => {
  const s = parseScan('{"i2c":[{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.deepEqual(types.sort(), ['breadboard', 'dht22', 'esp32'])
})

test('scanToComponents uses WHOAMI when the board supplies it', () => {
  // The MPU6050's WHO_AM_I answers 0x68 — the same number as its address.
  const s = parseScan('{"i2c":[{"addr":104,"whoami":104}],"dht22":{"gpio":4,"ok":false}}')
  assert.ok(scanToComponents(s).map(c => c.type).includes('mpu6050'))
})

test('scanToComponents drops an MPU whose WHOAMI byte is wrong', () => {
  // 0x68 is in mpu6050.candidateAddrs, but 0x58 on register 0x75 is a BMP280.
  // A read-off-the-chip identity must beat the address.
  const s = parseScan('{"i2c":[{"addr":104,"whoami":88}],"dht22":{"gpio":4,"ok":false}}')
  assert.ok(!scanToComponents(s).map(c => c.type).includes('mpu6050'))
})

test('defaultLayout positions come from the registry, not a hardcoded table', () => {
  const l = defaultLayout([{ type: 'dht22' }])
  assert.deepEqual({ x: l.components[0].x, y: l.components[0].y }, { x: 90, y: 90 })
})

test('addComponent rejects an id the registry does not define', () => {
  assert.throws(() => addComponent(defaultLayout([]), 'bmp280'), /Unknown component/)
})

test('scanNotice reports found components', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"},{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  assert.equal(scanNotice(s), 'SCAN: ESP32 + MPU6050, DHT22')
})

test('scanNotice flags an empty bus for wiring/power check', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":null}],"dht22":{"gpio":4,"ok":false}}')
  assert.equal(scanNotice(s), 'SCAN: ESP32 only — no sensors found (check 3V3/GND to each sensor)')
})

test('defaultLayout places each component uniquely and stores x/y', () => {
  const layout = defaultLayout([{ type: 'esp32' }, { type: 'breadboard' }, { type: 'mpu6050' }, { type: 'dht22' }])
  assert.equal(layout.components.length, 4)
  const ids = new Set(layout.components.map(c => c.id))
  assert.equal(ids.size, 4)
  assert.ok(layout.components.every(c => typeof c.x === 'number' && typeof c.y === 'number'))
})

test('addComponent / moveComponent mutate layout functionally', () => {
  const l0 = defaultLayout([])
  const l1 = addComponent(l0, 'esp32')
  assert.equal(l1.components.length, 1)
  const moved = moveComponent(l1, l1.components[0].id, 10, 20)
  assert.equal(moved.components[0].x, 10)
  assert.equal(l0.components.length, 0)   // original untouched
})

// --- pin-based wires (Task 5) ---

test('addWire stores pin references, not component ids', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(w.wires.length, 1)
  assert.deepEqual(
    { f: w.wires[0].fromComponentId, fp: w.wires[0].fromPinId, t: w.wires[0].toComponentId, tp: w.wires[0].toPinId },
    { f: esp.id, fp: 'SDA', t: mpu.id, tp: 'SDA' }
  )
  assert.equal(l.wires.length, 0)   // original untouched
})

test('addWire rejects an unknown pin and a self-wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  assert.throws(() => addWire(l, esp.id, 'NOPE', mpu.id, 'SDA'), /Unknown pin/)
  assert.throws(() => addWire(l, esp.id, 'SDA', esp.id, 'GND'), /same component/)
})

test('pinPos offsets by the registry pin dx/dy, and is 0,0 when the pin is unknown', () => {
  const l = defaultLayout([{ type: 'mpu6050' }])
  const mpu = l.components[0]
  assert.deepEqual(pinPos(mpu, 'SDA'), { x: mpu.x + 58, y: mpu.y + 10 })
  assert.deepEqual(pinPos(mpu, 'NOPE'), { x: 0, y: 0 })
  // A component whose type the registry does not define has no pins to offset by.
  assert.deepEqual(pinPos({ id: 'x1', type: 'nonexistent', x: 5, y: 5 }, 'SDA'), { x: 0, y: 0 })
})

test('wiresFor finds every wire touching a pin', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const wired = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(wiresFor(wired, esp.id, 'SDA').length, 1)
  assert.equal(wiresFor(wired, esp.id, 'GND').length, 0)
  assert.equal(wiresFor(wired, mpu.id, 'SDA').length, 1)
})

test('removeWire drops only the named wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const wired = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(removeWire(wired, wired.wires[0].id).wires.length, 0)
  assert.equal(wired.wires.length, 1)   // original untouched
})

// --- wiring correctness (Task 6) ---

test('wiringFlags is empty for a correctly wired rig', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(
    addWire(addWire(l, esp.id, 'SDA', mpu.id, 'SDA'),
                esp.id, 'SCL', mpu.id, 'SCL'),
                esp.id, '3V3', mpu.id, 'VCC')
  assert.deepEqual(wiringFlags(w.wires, w.components), [])
})

test('wiringFlags names both ends of a signal-to-ground wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'GND')
  const flags = wiringFlags(w.wires, w.components)
  assert.equal(flags.length, 1)
  assert.match(flags[0], /SDA \(GPIO21\)/)
  assert.match(flags[0], /GND/)
  assert.match(flags[0], /MPU6050/)
})

test('wiringFaults attributes each fault to the parts actually involved', () => {
  // A wiring fault IS attributable to specific parts, so the canvas can badge
  // the MPU and the ESP32 rather than every sprite on the board.
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }, { type: 'breadboard' }])
  const [esp, mpu, bb] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'GND')
  const faults = wiringFaults(w.wires, w.components)
  assert.equal(faults.length, 1)
  assert.deepEqual(faults[0].componentIds.sort(), [esp.id, mpu.id].sort())
  assert.ok(!faults[0].componentIds.includes(bb.id), 'the uninvolved breadboard must not be badged')
  assert.equal(faults[0].message, wiringFlags(w.wires, w.components)[0])
})

test('wiringFlags catches a power-to-ground short', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, '3V3', mpu.id, 'GND')
  assert.equal(wiringFlags(w.wires, w.components).length, 1)
})

test('wiringFlags flags power-to-power as correct', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'breadboard' }])
  const [esp, bb] = l.components
  const w = addWire(l, esp.id, '3V3', bb.id, 'VCC')
  assert.deepEqual(wiringFlags(w.wires, w.components), [])
})

test('wiringFlags skips a wire whose component is not on the canvas', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'GND')
  assert.deepEqual(wiringFlags(w.wires, [{ ...esp, type: 'esp32' }]), [])   // mpu absent
})

test('wireStroke colors power red-solid, ground gray-solid, signal green-dashed', () => {
  assert.equal(wireStroke('power').dash, null)
  assert.equal(wireStroke('ground').dash, null)
  assert.equal(wireStroke('signal').dash, '6 4')
  assert.notEqual(wireStroke('power').stroke, wireStroke('signal').stroke)
  assert.notEqual(wireStroke('ground').stroke, wireStroke('signal').stroke)
  // An unknown kind falls back to the signal style rather than disappearing.
  assert.deepEqual(wireStroke('bogus'), wireStroke('signal'))
})

test('referenceGhosts resolves the adapter wiring and skips parts that are not placed', async () => {
  const { default: ADAPTER } = await import('../src/serial/adapters/twinlab_esp32_v1.js')
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const ghosts = referenceGhosts(l, ADAPTER.referenceWiring)
  // SDA and SCL both resolve; the DHT->DATA pair is skipped because dht22 is not placed.
  assert.equal(ghosts.length, 2)
  assert.deepEqual(ghosts[0].from, { x: esp.x + 60, y: esp.y + 6 })
  assert.deepEqual(ghosts[0].to, { x: mpu.x + 58, y: mpu.y + 10 })
})

test('anomalyFlags flags NaN, out-of-range, frozen stream', () => {
  assert.deepEqual(anomalyFlags({ temp: NaN }), ['temperature reading is NaN'])
  assert.deepEqual(anomalyFlags({ temp: 41.2, vib: 0.3 }), ['temperature above 40', 'vib above 0.2'])
  assert.deepEqual(anomalyFlags({}), ['no data yet'])
})

test('withTimeout rejects when the promise never settles', async () => {
  const slow = new Promise(() => {})
  await assert.rejects(withTimeout(slow, 30), /timeout/i)
})

test('withTimeout resolves fast promises', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 100), 'ok')
})