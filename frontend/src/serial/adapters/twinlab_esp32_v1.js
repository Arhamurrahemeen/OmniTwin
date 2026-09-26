// Board adapter: every protocol string and parser for one firmware dialect.
// The dashboard holds no protocol knowledge of its own — App.jsx loops this
// object (via detectAdapter) instead of assuming a single board.
//
// No `usbHints` field: it is only a ranking hint for reordering adapters, and
// with one dialect there is nothing to rank. Add it when adapter #2 lands.

export default {
  id: 'twinlab_esp32_v1',
  label: 'OmniTwin ESP32 Node',
  baudRate: 115200,

  identCommand: 'IDENT',
  identTimeoutMs: 2000,
  pingCommand: 'PING',
  // The bus sweep is 117 addresses; ~12s on an empty bus. Never the 5s default.
  scanCommand: 'SCAN',
  scanTimeoutMs: 20000,
  streamOnCommand: 'STREAM on',
  streamOffCommand: 'STREAM off',
  identityTimeoutMs: 1000,

  // This board's fixed pin configuration, as [componentId, pinId] pairs. Note
  // this is the FIRMWARE's wiring, not a read of the student's jumper wires —
  // nothing in the kit can detect which breadboard hole a wire sits in.
  referenceWiring: [
    { from: ['esp32', 'SDA'], to: ['mpu6050', 'SDA'] },
    { from: ['esp32', 'SCL'], to: ['mpu6050', 'SCL'] },
    { from: ['esp32', 'DHT'], to: ['dht22', 'DATA'] },
  ],

  parseIdent: (o) => (o && o.id && o.board
    ? { ok: true, info: { id: o.id, board: o.board, fw: o.fw } }
    : { ok: false }),

  identityCommand: (addr, reg) => `WHOAMI ${addr} ${reg}`,

  // -1 (or a missing field, e.g. a 1.0 board replying "unknown command") means
  // no answer, which leaves the address fallback in play.
  parseIdentity: (o) => (typeof o?.whoami === 'number' && o.whoami >= 0 ? o.whoami : null),

  isReading: (o) => typeof o?.ts === 'number',

  // The board degrades gracefully: with no MPU it still streams DHT-only rows
  // with null accel. vib is suppressed rather than computed from nulls.
  toReading: (o) => {
    const hasAccel = typeof o.ax === 'number'
    return {
      temp: o.temp ?? null,
      hum: o.hum ?? null,
      vib: hasAccel ? Math.abs(Math.hypot(o.ax, o.ay, o.az) - 1) : null,
      ax: hasAccel ? o.ax : null,
      ay: hasAccel ? o.ay : null,
      az: hasAccel ? o.az : null,
    }
  },
}
