import test from 'node:test'
import assert from 'node:assert'
import {
  readLine, parseScan, scanToComponents, defaultLayout,
  addComponent, moveComponent, addWire, anomalyFlags, withTimeout, scanNotice,
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

test('addComponent / moveComponent / addWire mutate layout functionally', () => {
  const l0 = defaultLayout([])
  const l1 = addComponent(l0, 'esp32')
  assert.equal(l1.components.length, 1)
  const moved = moveComponent(l1, l1.components[0].id, 10, 20)
  assert.equal(moved.components[0].x, 10)
  const wired = addWire(moved, l1.components[0].id, 'dht22')
  assert.equal(wired.wires.length, 1)
  assert.deepEqual(wired.wires[0].from, l1.components[0].id)
  assert.equal(l0.components.length, 0)   // original untouched
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