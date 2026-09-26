import test from 'node:test'
import assert from 'node:assert'
import { detectAdapter, detectComponents, pinDef } from '../src/serial/serialModel.mjs'
import { SerialSession } from '../src/serial/serialBridge.js'
import ADAPTER from '../src/serial/adapters/twinlab_esp32_v1.js'

test('the adapter carries the protocol contract, including the long SCAN timeout', () => {
  assert.equal(ADAPTER.scanTimeoutMs, 20000)
  assert.ok(ADAPTER.scanTimeoutMs > 12000, 'bus sweep takes ~12s on an empty bus')
  assert.equal(ADAPTER.identCommand, 'IDENT')
  assert.equal(ADAPTER.streamOnCommand, 'STREAM on')
})

test('parseIdent accepts a well-formed IDENT and rejects anything else', () => {
  const ok = ADAPTER.parseIdent({ id: 'TL-A1B2C3', board: 'twinlab-node', fw: '1.1' })
  assert.equal(ok.ok, true)
  assert.equal(ok.info.id, 'TL-A1B2C3')
  for (const junk of [{}, { id: 'x' }, { board: 'b' }, null, undefined, { error: 'unknown command' }])
    assert.equal(ADAPTER.parseIdent(junk).ok, false, JSON.stringify(junk))
})

test('parseIdentity maps -1 and a missing field to null, and a byte to itself', () => {
  assert.equal(ADAPTER.parseIdentity({ whoami: 0x68 }), 0x68)
  assert.equal(ADAPTER.parseIdentity({ whoami: -1 }), null)
  assert.equal(ADAPTER.parseIdentity({}), null)
  assert.equal(ADAPTER.parseIdentity({ error: 'unknown command' }), null)
})

test('isReading only accepts timestamped stream rows', () => {
  assert.equal(ADAPTER.isReading({ ts: 1, temp: 20 }), true)
  for (const other of [{ stream: 'on' }, { pong: true }, { error: 'x' }, {}, null])
    assert.equal(ADAPTER.isReading(other), false, JSON.stringify(other))
})

test('toReading computes vib from a full accel triple', () => {
  const r = ADAPTER.toReading({ ts: 1, temp: 24.3, hum: 55.1, ax: 0, ay: 0, az: 1 })
  assert.deepEqual(r, { temp: 24.3, hum: 55.1, vib: 0, ax: 0, ay: 0, az: 1 })
})

test('toReading suppresses vib when the MPU is absent (DHT-only row)', () => {
  // A bare board streams null accel. vib must be null, not NaN — otherwise the
  // anomaly flag fires on a rig with no accelerometer at all.
  const r = ADAPTER.toReading({ ts: 1, temp: 24.3, hum: 55.1, ax: null, ay: null, az: null })
  assert.equal(r.vib, null)
  assert.equal(r.ax, null)
  assert.equal(r.temp, 24.3)
})

test('the reference wiring names pins that exist in the registry', () => {
  for (const w of ADAPTER.referenceWiring) {
    for (const [componentId, pinId] of [w.from, w.to]) {
      assert.ok(pinDef(componentId, pinId), `${componentId}.${pinId} missing from registry`)
    }
  }
})

// Two dialects. Only the second answers its own IDENT verb.
const alpha = {
  id: 'alpha', baudRate: 9600, identCommand: 'ID', identTimeoutMs: 50,
  parseIdent: () => ({ ok: false }),
}
const beta = {
  id: 'beta', baudRate: 115200, identCommand: 'IDENT', identTimeoutMs: 50,
  parseIdent: (o) => (o?.id ? { ok: true, info: { id: o.id, board: o.board, fw: o.fw } } : { ok: false }),
  scanCommand: 'SCAN',
}

// A session that records every command it was asked to send.
const fakeSession = (replyFor) => {
  const sent = []
  return {
    sent,
    command: async (cmd) => { sent.push(cmd); return replyFor(cmd) },
  }
}

test('detectAdapter picks the adapter whose parseIdent succeeds', async () => {
  const s = fakeSession((c) => (c === 'IDENT' ? { id: 'TL-A1B2C3', board: 'twinlab-node', fw: '1.1' } : {}))
  const found = await detectAdapter(s, [alpha, beta])
  assert.equal(found.adapter.id, 'beta')
  assert.equal(found.info.id, 'TL-A1B2C3')
})

test('detectAdapter sends IDENT to a failing dialect and nothing else', async () => {
  const s = fakeSession((c) => (c === 'IDENT' ? { id: 'x', board: 'b', fw: '1.1' } : {}))
  await detectAdapter(s, [alpha, beta])
  assert.deepEqual(s.sent, ['ID', 'IDENT'])   // no SCAN, no STREAM
})

test('detectAdapter moves on when a dialect throws (timeout, no board)', async () => {
  const s = fakeSession((c) => {
    if (c === 'ID') throw new Error('timeout after 50ms')
    return { id: 'x', board: 'b', fw: '1.1' }
  })
  const found = await detectAdapter(s, [alpha, beta])
  assert.equal(found.adapter.id, 'beta')
})

test('detectAdapter returns null when nothing answers', async () => {
  const s = fakeSession(() => { throw new Error('timeout after 50ms') })
  assert.equal(await detectAdapter(s, [alpha, beta]), null)
})

test('detectComponents merges WHOAMI answers into the scan', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  const types = (await detectComponents(scan, async () => 0x68)).map(c => c.type)
  assert.ok(types.includes('mpu6050'))
})

test('detectComponents still resolves when the WHOAMI probe fails', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  const types = (await detectComponents(scan, async () => { throw new Error('nack') })).map(c => c.type)
  assert.ok(types.includes('mpu6050'))   // falls back to the address
})

test('detectComponents does not create a component for an unknown address', async () => {
  const scan = { i2c: [{ addr: 72 }], dht22: { gpio: 4, ok: false } }
  const types = (await detectComponents(scan, async () => -1)).map(c => c.type)
  assert.deepEqual(types.sort(), ['breadboard', 'esp32'])
})

test('detectComponents asks only for addresses the registry can identify', async () => {
  const asked = []
  const scan = { i2c: [{ addr: 104 }, { addr: 72 }], dht22: { gpio: 4, ok: false } }
  await detectComponents(scan, async (addr, reg) => { asked.push([addr, reg]); return -1 })
  assert.deepEqual(asked, [[104, 0x75]])
})

// A port that opens but never speaks: the reader never yields, so every command
// times out. Enough of a fake to exercise SerialSession's own plumbing.
const silentPort = () => ({
  open: async () => {},
  close: async () => {},
  readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
  writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) },
})

test('a timed-out command does not poison the next one', async () => {
  const s = new SerialSession({ port: silentPort(), onData: () => {} })
  await s.open()
  await assert.rejects(s.command('IDENT', 20), /timeout/i)
  // The second command must reach the wire, not throw 'Command already in flight'.
  await assert.rejects(s.command('IDENT', 20), /timeout/i)
  await s.close()
})

test('detectAdapter survives a real SerialSession where every probe times out', async () => {
  const s = new SerialSession({ port: silentPort(), onData: () => {} })
  await s.open()
  // Two dialects, both silent: without the resolver fix the second probe would
  // throw 'Command already in flight' instead of timing out, and the error
  // would name the wrong thing entirely.
  assert.equal(await detectAdapter(s, [alpha, beta]), null)
  await s.close()
})
