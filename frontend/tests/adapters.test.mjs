import test from 'node:test'
import assert from 'node:assert'
import { detectAdapter, detectComponents, identifyScan, pinDef, scanNotice, startReadPolling } from '../src/serial/serialModel.mjs'
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

test('a failed or unanswered WHOAMI draws no part: the address is not identity', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  for (const ask of [async () => { throw new Error('nack') }, async () => null]) {
    const types = (await detectComponents(scan, ask)).map(c => c.type)
    assert.deepEqual(types.sort(), ['dht22', 'esp32'])
    assert.match(scanNotice(await identifyScan(scan, ask)), /unidentified I2C at 0x68/)
  }
})

test('identifyScan carries the WHOAMI byte, so the notice names the chip', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: false } }
  assert.equal(scanNotice(await identifyScan(scan, async () => 0x68)), 'SCAN: ESP32 + MPU6050')
})

test('READ reply parsing and the fw gate', () => {
  assert.deepEqual(ADAPTER.parseRead({ read: [1, 2] }), [1, 2])
  for (const bad of [{ read: null }, {}, { error: 'unknown command' }, null])
    assert.equal(ADAPTER.parseRead(bad), null, JSON.stringify(bad))
  assert.equal(ADAPTER.readCommand(118, 0xF7, 2), 'READ 118 247 2')
  assert.equal(ADAPTER.supportsRead({ fw: '1.3' }), true)
  for (const info of [{ fw: '1.2' }, { fw: '1.1' }, {}, null])
    assert.equal(ADAPTER.supportsRead(info), false, JSON.stringify(info))
})

test('toReading output covers exactly streamKeys, so polling can never shadow the stream', () => {
  assert.deepEqual(Object.keys(ADAPTER.toReading({ ts: 1 })).sort(), [...ADAPTER.streamKeys].sort())
})

const BARO = { reg: 0xF7, addr: 118, spec: { len: 2, signed: false, scale: 1, fields: ['pressure'] } }

test('polling decodes each pass, and a failed read becomes null', async () => {
  const seen = []
  let n = 0
  const stop = startReadPolling([BARO], async () => { if (n++) throw new Error('timeout'); return [1, 0] },
    (v) => seen.push(v), 1)
  while (seen.length < 2) await new Promise(r => setTimeout(r, 1))
  await stop()
  assert.deepEqual(seen[0], { pressure: 256 })
  assert.deepEqual(seen[1], { pressure: null })
})

test('stop() waits for the in-flight READ, so a SCAN never meets "already in flight"', async () => {
  let inFlight = false
  let release
  const stop = startReadPolling([BARO], () => {
    inFlight = true
    return new Promise(r => { release = () => { inFlight = false; r([0, 0]) } })
  }, () => {}, 1)
  await new Promise(r => setTimeout(r, 1))
  let stopped = false
  const stopping = stop().then(() => { stopped = true })
  await new Promise(r => setTimeout(r, 1))
  assert.equal(stopped, false)
  assert.equal(inFlight, true)
  release()
  await stopping
  assert.equal(inFlight, false)
})

test('an empty plan sends nothing', async () => {
  let asked = 0
  const stop = startReadPolling([], async () => { asked++ }, () => {})
  await stop()
  assert.equal(asked, 0)
})

test('detectComponents does not create a component for an unknown address', async () => {
  const scan = { i2c: [{ addr: 72 }], dht22: { gpio: 4, ok: false } }
  const types = (await detectComponents(scan, async () => -1)).map(c => c.type)
  assert.deepEqual(types, ['esp32'])
})

test('detectComponents asks only for addresses the registry can identify', async () => {
  const asked = []
  const scan = { i2c: [{ addr: 104 }, { addr: 72 }], dht22: { gpio: 4, ok: false } }
  await detectComponents(scan, async (addr, reg) => { asked.push([addr, reg]); return -1 })
  assert.deepEqual(asked, [[104, 0x75]])
})

// SerialSession allows exactly one outstanding command and throws otherwise.
// Probing two addresses concurrently therefore drops every probe after the
// first, silently — the address fallback then masks it and a wrong chip at
// address 2+ still renders. Probes must be sequential.
test('detectComponents probes sequentially when several addresses are identifiable', async () => {
  const inFlight = new Set()
  let thrown = 0
  const strictSession = {
    command: async (cmd) => {
      if (inFlight.size) { thrown++; throw new Error('Command already in flight') }
      inFlight.add(cmd)
      try { await new Promise(r => setTimeout(r, 1)); return { whoami: 0x68 } }
      finally { inFlight.delete(cmd) }
    },
  }
  // Two addresses the registry can identify: 0x68 and 0x69 are both mpu6050.
  const scan = { i2c: [{ addr: 104 }, { addr: 105 }], dht22: { gpio: 4, ok: false } }
  const asked = []
  await detectComponents(scan, async (addr, reg) => {
    asked.push([addr, reg])
    return strictSession.command(`WHOAMI ${addr} ${reg}`)
  })
  assert.deepEqual(asked, [[104, 0x75], [105, 0x75]])
  assert.equal(thrown, 0, 'a probe was dropped by the one-command-in-flight guard')
})

test('detectComponents composes the 1.0 path: a probe that answers null keeps the legacy name', async () => {
  // The real 1.0 composition is a `whoami` key that is PRESENT and NULL, not
  // an absent key. Nothing pinned that, and a future edit to the tier order
  // would silently break every unreflashed board.
  const scan = { i2c: [{ addr: 104, name: 'mpu6050' }, { addr: 72, name: null }], dht22: { gpio: 4, ok: true } }
  const types = (await detectComponents(scan, async () => null)).map(c => c.type)
  assert.deepEqual(types.sort(), ['dht22', 'esp32', 'mpu6050'])
})

// A port that opens but never speaks: the reader never yields, so every command
// times out. Enough of a fake to exercise SerialSession's own plumbing.
const silentPort = () => ({
  open: async () => {},
  close: async () => {},
  readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
  writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) },
})

test('an IDENT lost to the reset that opening the port causes is retried', async () => {
  // Seen on a real kit: the board reboots on open and ignores the first IDENT. It
  // must take the retry through a real SerialSession, whose stale-reply guard
  // would otherwise swallow every later answer.
  let writes = 0
  const inbox = []
  let wake = null
  const port = {
    open: async () => {}, close: async () => {},
    readable: { getReader: () => ({
      read: () => new Promise(r => { if (inbox.length) r({ value: inbox.shift(), done: false }); else wake = r }),
      cancel: async () => {},
    }) },
    writable: { getWriter: () => ({
      close: async () => {},
      write: async () => {
        if (++writes < 2) return   // the first command lands during boot
        const bytes = new TextEncoder().encode('{"id":"TL-1","board":"b","fw":"1.3"}\n')
        if (wake) { const r = wake; wake = null; r({ value: bytes, done: false }) } else inbox.push(bytes)
      },
    }) },
  }
  const session = new SerialSession({ port })
  await session.open()
  const found = await detectAdapter(session, [{ ...ADAPTER, identTimeoutMs: 15 }])
  assert.equal(found?.info.id, 'TL-1')
  assert.equal(writes, 2)
})

test('a dialect that answers wrongly is not retried; only silence is', async () => {
  const sent = []
  const s = fakeSession((cmd) => { sent.push(cmd); return { error: 'unknown command' } })
  assert.equal(await detectAdapter(s, [{ ...ADAPTER, identTimeoutMs: 15 }]), null)
  assert.deepEqual(sent, ['IDENT'])
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

// A board that answers LATE (slow IDENT, still enumerating) must not have its
// stale reply handed to the next command: adapter 1's late IDENT would resolve
// adapter 2's probe, identifying a board as the wrong dialect.
test('a reply arriving after its command timed out is discarded, not given to the next command', async () => {
  const enc = new TextEncoder()
  let pushLine = null
  const latePort = {
    open: async () => {},
    close: async () => {},
    readable: { getReader: () => ({ read: () => new Promise(r => { pushLine = (v) => r({ value: enc.encode(v), done: false }) }), cancel: async () => {} }) },
    writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) },
  }
  const s = new SerialSession({ port: latePort, onData: () => {} })
  await s.open()
  await assert.rejects(s.command('IDENT', 30), /timeout/i)
  // The next command starts waiting FIRST, then the board finally answers the
  // already-abandoned IDENT. That stale reply must be dropped, not handed to
  // the waiting command as its result.
  const next = s.command('SCAN', 60).then(() => 'resolved', (e) => `rejected: ${e.message}`)
  await new Promise(r => setTimeout(r, 10))
  pushLine('{"id":"TL-LATE","board":"twinlab-node","fw":"1.1"}\n')
  assert.match(await next, /^rejected: /, 'the stale IDENT reply was delivered as the SCAN result')
  await s.close()
})

// With STREAM on the board pushes ~10 Hz of readings, and a command's resolver
// used to take whatever JSON line arrived first. So a SCAN issued mid-stream
// resolved with a READING: parseScan saw no i2c/dht22 and the UI reported
// "no sensors found" while overwriting a correct status line with the lie.
test('a stream frame never satisfies a waiting command, and still reaches onData', async () => {
  const enc = new TextEncoder()
  let pushLine = null
  const streamingPort = {
    open: async () => {},
    close: async () => {},
    readable: { getReader: () => ({ read: () => new Promise(r => { pushLine = (v) => r({ value: enc.encode(v), done: false }) }), cancel: async () => {} }) },
    writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) },
  }
  const seen = []
  const s = new SerialSession({
    port: streamingPort,
    isData: ADAPTER.isReading,
    onData: (o) => seen.push(o),
  })
  await s.open()
  const sc = s.command('SCAN', 300).then((r) => r, (e) => `rejected: ${e.message}`)
  await new Promise(r => setTimeout(r, 10))
  pushLine('{"ts":1,"temp":25.1,"hum":55.0,"ax":null,"ay":null,"az":null}\n')
  await new Promise(r => setTimeout(r, 10))
  pushLine('{"i2c":[{"addr":104}],"dht22":{"gpio":4,"ok":true}}\n')
  const r = await sc
  assert.ok(!String(r).startsWith('rejected'), `SCAN failed: ${r}`)
  assert.ok(Array.isArray(r.i2c), 'SCAN resolved with a stream frame instead of the scan reply')
  assert.ok(seen.some((o) => typeof o.ts === 'number'), 'the reading must still reach onData, not be swallowed')
  await s.close()
})
