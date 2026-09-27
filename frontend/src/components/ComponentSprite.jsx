// Author-created simple schematic shapes (no external asset download/licenses):
// ESP32 devkit, breadboard rails, MPU6050 chip, DHT22 module. Keyed by the
// registry's component id — geometry and pin offsets live in
// src/registry/components.json; the art itself stays here as JSX.
const leadStroke = (kind) => kind === 'power'
  ? 'var(--ot-power)'
  : kind === 'ground' ? 'var(--ot-ground)' : 'var(--ot-green)'

const SPRITES = {
  esp32: (pins) => (
    <svg viewBox="0 0 120 90" width={120} height={90}>
      <rect x="4" y="4" width="112" height="82" rx="4" fill="#0F6E56" />
      <text x="18" y="50" fill="#F1EFE8" fontSize="9" fontFamily="JetBrains Mono">ESP32</text>
      {pins.map(pin => <line
        key={pin.id}
        x1={pin.dx} y1={pin.dy < 45 ? 0 : 90}
        x2={pin.dx} y2={pin.dy}
        stroke={leadStroke(pin.kind)} strokeWidth="2"
      />)}
    </svg>
  ),
  breadboard: (pins) => (
    <svg viewBox="0 0 200 90" width={200} height={90}>
      <rect x="2" y="2" width="196" height="86" rx="6" fill="#E8DCC0" stroke="#0F6E56" />
      <text x="20" y="45" fill="#04342C" fontSize="9">Breadboard</text>
      <rect x="60" y="16" width="120" height="12" fill="#0F6E56" opacity="0.3" />
      <rect x="60" y="62" width="120" height="12" fill="#0F6E56" opacity="0.3" />
      {pins.map(pin => <circle key={pin.id} cx={pin.dx} cy={pin.dy} r="3" fill={leadStroke(pin.kind)} />)}
    </svg>
  ),
  mpu6050: (pins) => (
    <svg viewBox="0 0 70 70 " width={70} height={70}>
      <rect x="8" y="8" width="54" height="54" rx="3" fill="#2c3e50" />
      <circle cx="35" cy="35" r="10" fill="#4FD8AE" />
      <text x="14" y="16" fill="#fff" fontSize="6">MPU6050</text>
      {pins.map(pin => <line
        key={pin.id}
        x1={pin.dx < 35 ? 8 : 62} y1={pin.dy}
        x2={pin.dx} y2={pin.dy}
        stroke={leadStroke(pin.kind)} strokeWidth="2"
      />)}
    </svg>
  ),
  dht22: (pins) => (
    <svg viewBox="0 0 70 70" width={70} height={70}>
      <rect x="8" y="14" width="54" height="42" rx="4" fill="#34495e" />
      <circle cx="20" cy="35" r="6" fill="#4FD8AE" />
      <circle cx="50" cy="35" r="6" fill="#4FD8AE" />
      <text x="14" y="62" fill="#04342C" fontSize="6">DHT22</text>
      {pins.map(pin => <line
        key={pin.id}
        x1={pin.dx < 35 ? 8 : 62} y1={pin.dy}
        x2={pin.dx} y2={pin.dy}
        stroke={leadStroke(pin.kind)} strokeWidth="2"
      />)}
    </svg>
  ),
}

export default function ComponentSprite({ type, pins = [] }) {
  const sprite = SPRITES[type]
  return sprite ? sprite(pins) : <span>?</span>
}
