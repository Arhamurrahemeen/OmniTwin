// ?demo=1 mock session — fake SerialSession for offline demos and deck screenshots.
// Same API surface as SerialSession (open/command/close), no real port.

const rnd = (lo, hi) => lo + Math.random() * (hi - lo)

export class DemoSession {
  constructor({ onData = () => {}, onError = () => {} }) {
    this.onData = onData
    this.onError = onError
    this.timer = null
    this.streaming = false
    this._started = Date.now()
  }

  async open() {}
  async close() { this._stop() }

  async command(cmd) {
    const line = cmd.trim()
    // WHOAMI <addr> <reg> — the 1.1 identity read. Mirrors the firmware: -1
    // when the address does not answer, which the browser maps to null.
    if (line.startsWith('WHOAMI')) {
      const addr = parseInt(line.split(/\s+/)[1], 10)
      return { whoami: (addr === 104 || addr === 105) ? 0x68 : -1 }
    }
    switch (line) {
      case 'IDENT':
        return { id: 'demo-esp32', board: 'ESP32-DevKitC V4', fw: '1.1' }
      case 'PING':
        return { pong: true }
      case 'SCAN':
        // 1.1 shape: raw address only, no firmware-supplied part name.
        return { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true }, bus: { sda_up: true, scl_up: true } }
      case 'STREAM on':
        this.streaming = true
        this.timer = setInterval(() => this._emit(), 250)
        return {}
      case 'STREAM off':
        this._stop()
        return {}
      default:
        return {}
    }
  }

  _stop() {
    this.streaming = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  // Az sits near 1g at rest; a repeating ~1.5s "impact" spike pushes |accel|-1
  // past the vib anomaly threshold so the dashboard badge is capturable.
  _emit() {
    const t = Date.now() - this._started
    const impact = (t % 7000) < 1500
    const ax = rnd(-0.03, 0.03) + (impact ? 1.2 : 0)
    const ay = rnd(-0.03, 0.03) + (impact ? 0.4 : 0)
    const az = rnd(0.97, 1.03) + (impact ? 0.3 : 0)
    this.onData({ ts: Date.now(), temp: rnd(24, 26), hum: rnd(58, 62), ax: +ax.toFixed(3), ay: +ay.toFixed(3), az: +az.toFixed(3) })
  }
}