// Thin wrapper over the Web Serial API (Chrome/Edge desktop).
import { readLine, withTimeout } from './serialModel.mjs'

export function supportsSerial() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function requestPort() {
  return navigator.serial.requestPort()
}

export class SerialSession {
  constructor({ port, baudRate = 115200, onData = () => {}, onError = () => {} }) {
    this.port = port
    this.baudRate = baudRate
    this.reader = null
    this.writer = null
    this.onData = onData
    this.onError = onError
    this._state = { rest: '' }
    this._resolver = null // single outstanding command awaiting its reply
  }

  async open() {
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
    await this.writer.write(new TextEncoder().encode(cmd + '\n'))
    return withTimeout(reply, timeoutMs)
  }

  async close() {
    try { await this.writer?.close() } catch {}
    try { await this.reader?.cancel() } catch {}
    try { await this.port.close() } catch {}
  }
}