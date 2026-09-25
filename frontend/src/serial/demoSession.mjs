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
    switch (cmd.trim()) {
      case 'IDENT':
        return { id: 'demo-esp32', board: 'ESP32-DevKitC V4', fw: '1.0' }
      case 'PING':
        return { pong: true }
      case 'SCAN':
        return { i2c: [{ addr: 104, name: 'mpu6050' }], dht22: { gpio: 4, ok: true }, bus: { sda_up: true, scl_up: true } }
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