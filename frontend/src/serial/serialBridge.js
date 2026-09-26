// Thin wrapper over the Web Serial API (Chrome/Edge desktop).
import { readLine, withTimeout } from './serialModel.mjs'

export function supportsSerial() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function requestPort() {
  return navigator.serial.requestPort()
}

export class SerialSession {
  // `isData` tells a reading apart from a command reply. The bridge stays
  // protocol-agnostic: the caller passes the active adapter's own predicate
  // (adapter.isReading), so no dialect knowledge leaks in here. Defaults to
  // "nothing is a reading", which is the pre-streaming behaviour.
  constructor({ port, baudRate = 115200, onData = () => {}, onError = () => {}, isData = () => false }) {
    this.port = port
    this.baudRate = baudRate
    this.reader = null
    this.writer = null
    this.onData = onData
    this.onError = onError
    this.isData = isData
    this._state = { rest: '' }
    this._resolver = null // single outstanding command awaiting its reply
  }

  async open() {
    await this.port.open({ baudRate: this.baudRate })
    this.reader = this.port.readable.getReader()
    this.writer = this.port.writable.getWriter()
    this._pump()
  }

  async _pump() {
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await this.reader.read()
        if (done) break
        const { lines, rest } = readLine(this._state, decoder.decode(value))
        this._state.rest = rest
        for (const line of lines) this._dispatch(line)
      }
    } catch (err) {
      this.onError(err)
    }
  }

  _dispatch(line) {
    let obj
    try { obj = JSON.parse(line) } catch { return }   // ignore noise
    // A reading is data, never a command reply. With STREAM on the board pushes
    // ~10 Hz, so without this a SCAN resolves with a stream frame: parseScan
    // finds no i2c/dht22 and the UI reports "no sensors found", overwriting a
    // correct status line with a confident lie. Checked BEFORE the stale-reply
    // drop, so a command that timed out mid-stream cannot eat a live reading.
    if (this.isData(obj)) { this.onData(obj); return }
    // A reply to a command that already timed out is stale. Drop exactly one
    // such line, otherwise a slow board's late IDENT would be handed to the
    // NEXT command as its result (identifying it as the wrong dialect, or
    // handing a SCAN an IDENT reply).
    if (this._discardOne) { this._discardOne = false; return }
    if (obj && this._resolver) {
      const resolver = this._resolver
      this._resolver = null
      resolver(obj)
    } else {
      this.onData(obj)
    }
  }

  // Send a command line, resolve with the next JSON reply or reject on timeout.
  async command(cmd, timeoutMs = 5000) {
    if (!this.writer) throw new Error('Serial session not open')
    if (this._resolver) throw new Error('Command already in flight')
    const reply = new Promise((resolve) => { this._resolver = resolve })
    let settled = false
    reply.then(() => { settled = true }, () => { settled = true })
    try {
      await this.writer.write(new TextEncoder().encode(cmd + '\n'))
      return await withTimeout(reply, timeoutMs)
    } finally {
      // Release the slot on BOTH paths. Without this a timed-out command
      // poisons the session and every later command throws 'Command already in
      // flight' — which is exactly what adapter probing does on a dead port.
      // If it timed out, the board may still answer: discard that one line.
      this._discardOne = !settled
      this._resolver = null
    }
  }

  async close() {
    try { await this.writer?.close() } catch {}
    try { await this.reader?.cancel() } catch {}
    try { await this.port.close() } catch {}
  }
}