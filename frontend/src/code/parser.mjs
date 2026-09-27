// parser.mjs — C/Arduino source parser for hardware declarations
// Pure, no DOM, testable under `node --test`

// Regex patterns for common Arduino/C constructs
const PATTERNS = {
  // Wire.begin(sda, scl) — I2C pins
  i2cBegin: /Wire\.begin\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g,
  // Wire.begin() — default pins (board-specific)
  i2cBeginDefault: /Wire\.begin\s*\(\s*\)/g,
  // I2C address usage: Wire.beginTransmission(0x68), Wire.requestFrom(0x68, ...)
  i2cAddr: /Wire\.(?:beginTransmission|requestFrom)\s*\(\s*(0x[0-9a-fA-F]+|\d+)/g,
  // DHT dht(pin, type) or dht.begin(pin)
  dhtConstruct: /DHT\s+\w+\s*\(\s*(\d+)\s*,\s*(DHT\d+)\s*\)/g,
  dhtBegin: /\.begin\s*\(\s*(\d+)\s*\)/g,
  // pinMode(pin, MODE)
  pinMode: /pinMode\s*\(\s*(\d+)\s*,\s*(INPUT|OUTPUT|INPUT_PULLUP|OUTPUT_OPEN_DRAIN)\s*\)/g,
  // #define NAME value
  define: /#define\s+(\w+)\s+(\d+)/g,
  // const int NAME = value;
  constInt: /const\s+int\s+(\w+)\s*=\s*(\d+)/g,
  // Serial.begin(baud)
  serialBegin: /Serial\.begin\s*\(\s*(\d+)\s*\)/g,
  // Serial.print/println with sensor readings
  serialPrint: /Serial\.(?:print|println|printf)\s*\(/g,
  // Library includes
  include: /#include\s*[<"]([^>"]+)[>"]/g,
  // OneWire / DallasTemperature
  oneWire: /OneWire\s+\w+\s*\(\s*(\d+)\s*\)/g,
  // SPI
  spiBegin: /SPI\.begin\s*\(\s*\)/g,
  // Servo attach
  servoAttach: /\.attach\s*\(\s*(\d+)\s*\)/g,
}

const LIBRARY_HINTS = {
  'Wire.h': { bus: 'i2c', note: 'I2C library included' },
  'DHT.h': { sensor: 'dht', note: 'DHT library included' },
  'DHTesp.h': { sensor: 'dht', note: 'DHTesp library included' },
  'Adafruit_Sensor.h': { note: 'Adafruit unified sensor' },
  'Adafruit_MPU6050.h': { sensor: 'mpu6050', note: 'MPU6050 library included' },
  'MPU6050.h': { sensor: 'mpu6050', note: 'MPU6050 library included' },
  'OneWire.h': { bus: '1wire', note: 'OneWire library included' },
  'DallasTemperature.h': { sensor: 'ds18b20', note: 'DallasTemperature library included' },
  'SPI.h': { bus: 'spi', note: 'SPI library included' },
  'Servo.h': { actuator: 'servo', note: 'Servo library included' },
  'WiFi.h': { note: 'WiFi library included' },
  'WiFiNINA.h': { note: 'WiFiNINA library included' },
  'Ethernet.h': { note: 'Ethernet library included' },
  'PubSubClient.h': { note: 'MQTT client library included' },
  'ArduinoJson.h': { note: 'ArduinoJson library included' },
}

function parseSource(source, filename = '') {
  const findings = {
    i2c: { pins: null, addresses: [], confidence: 'weak' },
    sensors: [],
    pins: new Map(), // pin -> { mode, label, confidence }
    libraries: [],
    serial: { baud: null, prints: [] },
    defines: new Map(),
    confidence: 'weak', // overall: 'strong' | 'weak' | 'none'
    sourceFile: filename,
  }

  // Reset regex lastIndex for global patterns
  for (const re of Object.values(PATTERNS)) re.lastIndex = 0

  // #define and const int — resolve symbolic names
  let match
  while ((match = PATTERNS.define.exec(source))) {
    findings.defines.set(match[1], parseInt(match[2], 10))
  }
  while ((match = PATTERNS.constInt.exec(source))) {
    findings.defines.set(match[1], parseInt(match[2], 10))
  }

  function resolveValue(val) {
    if (typeof val === 'number') return val
    const num = parseInt(val, 10)
    if (!isNaN(num)) return num
    return findings.defines.get(val) ?? null
  }

  // Wire.begin(sda, scl) — STRONG evidence
  while ((match = PATTERNS.i2cBegin.exec(source))) {
    const sda = resolveValue(match[1])
    const scl = resolveValue(match[2])
    if (sda !== null && scl !== null) {
      findings.i2c.pins = { sda, scl }
      findings.i2c.confidence = 'strong'
      findings.pins.set(sda, { mode: 'signal', label: 'SDA', confidence: 'strong' })
      findings.pins.set(scl, { mode: 'signal', label: 'SCL', confidence: 'strong' })
    }
  }

  // Wire.begin() — default pins, WEAK
  if (PATTERNS.i2cBeginDefault.test(source) && !findings.i2c.pins) {
    findings.i2c.confidence = 'weak'
    findings.i2c.pins = { sda: 'default', scl: 'default' }
  }

  // I2C addresses used
  while ((match = PATTERNS.i2cAddr.exec(source))) {
    const addr = parseInt(match[1], match[1].startsWith('0x') ? 16 : 10)
    if (!findings.i2c.addresses.includes(addr)) {
      findings.i2c.addresses.push(addr)
    }
  }

  // DHT construction — STRONG
  while ((match = PATTERNS.dhtConstruct.exec(source))) {
    const pin = resolveValue(match[1])
    const type = match[2].toLowerCase()
    if (pin !== null) {
      findings.sensors.push({ type: 'dht', variant: type, pin, confidence: 'strong' })
      findings.pins.set(pin, { mode: 'signal', label: 'DATA', confidence: 'strong' })
    }
  }

  // DHT .begin(pin) — STRONG if we can associate with a DHT object
  // Simplified: any .begin(pin) near DHT include
  if (findings.libraries.some(l => l.sensor === 'dht')) {
    while ((match = PATTERNS.dhtBegin.exec(source))) {
      const pin = resolveValue(match[1])
      if (pin !== null && !findings.sensors.some(s => s.type === 'dht' && s.pin === pin)) {
        findings.sensors.push({ type: 'dht', pin, confidence: 'weak' })
        findings.pins.set(pin, { mode: 'signal', label: 'DATA', confidence: 'weak' })
      }
    }
  }

  // pinMode — STRONG for explicit pins
  while ((match = PATTERNS.pinMode.exec(source))) {
    const pin = resolveValue(match[1])
    const mode = match[2]
    if (pin !== null) {
      const kind = mode === 'OUTPUT' ? 'signal' : mode.includes('INPUT') ? 'signal' : 'signal'
      findings.pins.set(pin, { mode: kind, label: `GPIO${pin}`, confidence: 'strong' })
    }
  }

  // Library includes
  while ((match = PATTERNS.include.exec(source))) {
    const lib = match[1]
    if (LIBRARY_HINTS[lib]) {
      findings.libraries.push({ name: lib, ...LIBRARY_HINTS[lib] })
    } else {
      findings.libraries.push({ name: lib, note: 'Library included' })
    }
  }

  // OneWire
  while ((match = PATTERNS.oneWire.exec(source))) {
    const pin = resolveValue(match[1])
    if (pin !== null) {
      findings.sensors.push({ type: '1wire', pin, confidence: 'strong' })
      findings.pins.set(pin, { mode: 'signal', label: '1-Wire', confidence: 'strong' })
    }
  }

  // Servo attach
  while ((match = PATTERNS.servoAttach.exec(source))) {
    const pin = resolveValue(match[1])
    if (pin !== null) {
      findings.sensors.push({ type: 'servo', pin, confidence: 'strong' })
      findings.pins.set(pin, { mode: 'signal', label: 'Servo', confidence: 'strong' })
    }
  }

  // Serial.begin
  const serialMatch = PATTERNS.serialBegin.exec(source)
  if (serialMatch) {
    findings.serial.baud = parseInt(serialMatch[1], 10)
  }

  // Serial.print presence — indicates telemetry
  if (PATTERNS.serialPrint.test(source)) {
    findings.serial.prints.push('Serial.print/println detected')
  }

  // Determine overall confidence
  const hasStrong = findings.i2c.confidence === 'strong' ||
    findings.sensors.some(s => s.confidence === 'strong') ||
    findings.pins.size > 0 && [...findings.pins.values()].some(p => p.confidence === 'strong')
  findings.confidence = hasStrong ? 'strong' : findings.libraries.length > 0 ? 'weak' : 'none'

  // Convert pins Map to array
  findings.pins = [...findings.pins.entries()].map(([pin, info]) => ({
    pin, ...info
  }))

  return findings
}

// Parse multiple files, merge findings
export function parseProject(files) {
  // files: [{ name, content }]
  const allFindings = files.map(f => parseSource(f.content, f.name))

  // Merge
  const merged = {
    i2c: { pins: null, addresses: [], confidence: 'none' },
    sensors: [],
    pins: [],
    libraries: [],
    serial: { baud: null, prints: [] },
    confidence: 'none',
    files: allFindings,
  }

  let hasStrong = false

  for (const f of allFindings) {
    // I2C: prefer strong pins
    if (f.i2c.confidence === 'strong' && !merged.i2c.pins) {
      merged.i2c.pins = f.i2c.pins
      merged.i2c.confidence = 'strong'
      hasStrong = true
    } else if (f.i2c.confidence === 'weak' && merged.i2c.confidence === 'none') {
      merged.i2c.pins = f.i2c.pins
      merged.i2c.confidence = 'weak'
    }
    // Addresses: union
    for (const addr of f.i2c.addresses) {
      if (!merged.i2c.addresses.includes(addr)) merged.i2c.addresses.push(addr)
    }

    // Sensors: merge, prefer strong
    for (const s of f.sensors) {
      const existing = merged.sensors.find(m => m.type === s.type && m.pin === s.pin)
      if (!existing || (s.confidence === 'strong' && existing.confidence === 'weak')) {
        if (existing) Object.assign(existing, s)
        else merged.sensors.push(s)
      }
      if (s.confidence === 'strong') hasStrong = true
    }

    // Pins: merge
    for (const p of f.pins) {
      const existing = merged.pins.find(m => m.pin === p.pin)
      if (!existing || (p.confidence === 'strong' && existing.confidence === 'weak')) {
        if (existing) Object.assign(existing, p)
        else merged.pins.push(p)
      }
      if (p.confidence === 'strong') hasStrong = true
    }

    // Libraries: union by name
    for (const l of f.libraries) {
      if (!merged.libraries.some(m => m.name === l.name)) merged.libraries.push(l)
    }

    // Serial
    if (f.serial.baud && !merged.serial.baud) merged.serial.baud = f.serial.baud
    merged.serial.prints.push(...f.serial.prints)
  }

  merged.confidence = hasStrong ? 'strong' : merged.libraries.length > 0 ? 'weak' : 'none'
  merged.pins.sort((a, b) => a.pin - b.pin)
  merged.i2c.addresses.sort((a, b) => a - b)

  return merged
}

// Convert parsed findings to canvas component layout
export function findingsToLayout(findings, registry) {
  // registry: from components.json via registry.mjs
  const components = []
  let x = 90, y = 90
  const spacing = 120

  // Always include MCU if we have any pin info
  if (findings.pins.length > 0 || findings.i2c.pins || findings.libraries.length > 0) {
    const mcuDef = registry.componentDef('esp32') // default to ESP32 shape
    if (mcuDef) {
      components.push({
        id: `mcu-${Date.now()}`,
        type: 'esp32',
        label: mcuDef.label,
        x: 120, y: 300,
        declared: true,
        confidence: findings.confidence,
      })
    }
  }

  // I2C sensors from addresses + libraries
  const i2cSensorMap = {
    0x68: { type: 'mpu6050', label: 'MPU6050' },
    0x69: { type: 'mpu6050', label: 'MPU6050 (alt)' },
    0x76: { type: 'bmp280', label: 'BMP280' },
    0x77: { type: 'bmp280', label: 'BMP280 (alt)' },
    0x3C: { type: 'ssd1306', label: 'SSD1306 OLED' },
    0x3D: { type: 'ssd1306', label: 'SSD1306 OLED (alt)' },
  }

  for (const addr of findings.i2c.addresses) {
    const sensor = i2cSensorMap[addr]
    if (sensor && registry.isKnown(sensor.type)) {
      components.push({
        id: `i2c-${addr}-${Date.now()}`,
        type: sensor.type,
        label: sensor.label,
        x, y,
        declared: true,
        confidence: findings.i2c.confidence,
        i2cAddress: addr,
      })
      x += spacing
    }
  }

  // Explicit sensors from code (DHT, 1Wire, Servo)
  for (const s of findings.sensors) {
    if (registry.isKnown(s.type)) {
      components.push({
        id: `${s.type}-${s.pin}-${Date.now()}`,
        type: s.type,
        label: registry.componentDef(s.type).label,
        x, y,
        declared: true,
        confidence: s.confidence,
        pin: s.pin,
      })
      x += spacing
    }
  }

  // Breadboard always available for wiring
  if (components.length > 0 && registry.isKnown('breadboard')) {
    components.push({
      id: `breadboard-${Date.now()}`,
      type: 'breadboard',
      label: 'Breadboard',
      x: 260, y: 180,
      declared: false,
      confidence: 'none',
    })
  }

  return { components, wires: [] }
}