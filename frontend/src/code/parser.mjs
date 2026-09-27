// parser.mjs — C/Arduino source parser for hardware declarations
// Pure, no DOM, testable under `node --test`

// Regex patterns for common Arduino/C constructs
const PATTERNS = {
  // Wire.begin(sda, scl) — I2C pins
  i2cBegin: /Wire\.begin\s*\(\s*([\w]+)\s*,\s*([\w]+)\s*\)/g,
  // Wire.begin() — default pins (board-specific)
  i2cBeginDefault: /Wire\.begin\s*\(\s*\)/g,
  // I2C address usage: Wire.beginTransmission(0x68), Wire.requestFrom(0x68, ...)
  i2cAddr: /Wire\.(?:beginTransmission|requestFrom)\s*\(\s*(0x[0-9a-fA-F]+|[\w]+)/g,
  idfI2cPin: /\.(sda_io_num|scl_io_num)\s*=\s*([\w]+)/g,
  idfI2cProbe: /i2c_master_probe\s*\(\s*[^,]+,\s*(0x[0-9a-fA-F]+|[\w]+)\s*,/g,
  // DHT dht(pin, type) or dht.begin(pin)
  dhtConstruct: /DHT\s+\w+\s*\(\s*([\w]+)\s*,\s*(DHT\d+)\s*\)/g,
  dhtBegin: /\.begin\s*\(\s*(\d+)\s*\)/g,
  // pinMode(pin, MODE)
  pinMode: /pinMode\s*\(\s*(\d+)\s*,\s*(INPUT|OUTPUT|INPUT_PULLUP|OUTPUT_OPEN_DRAIN)\s*\)/g,
  // #define NAME value
  define: /#define\s+(\w+)\s+(0[xX][\da-fA-F]+|\d+)/g,
  // const int NAME = value;
  constInt: /const\s+int\s+(\w+)\s*=\s*(0[xX][\da-fA-F]+|\d+)/g,
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
    findings.defines.set(match[1], Number(match[2]))
  }
  while ((match = PATTERNS.constInt.exec(source))) {
    findings.defines.set(match[1], Number(match[2]))
  }

  function resolveValue(val) {
    if (typeof val === 'number') return val
    const num = Number(val)
    if (!Number.isNaN(num)) return num
    return findings.defines.get(val) ?? null
  }

  // Library includes are available before sensor-specific call parsing.
  while ((match = PATTERNS.include.exec(source))) {
    const lib = match[1]
    if (LIBRARY_HINTS[lib]) {
      findings.libraries.push({ name: lib, ...LIBRARY_HINTS[lib] })
    } else {
      findings.libraries.push({ name: lib, note: 'Library included' })
    }
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

  // ESP-IDF configures I2C pins in i2c_master_bus_config_t rather than Wire.begin.
  const idfPins = {}
  while ((match = PATTERNS.idfI2cPin.exec(source))) {
    const pin = resolveValue(match[2])
    if (pin !== null) idfPins[match[1] === 'sda_io_num' ? 'sda' : 'scl'] = pin
  }
  if (idfPins.sda !== undefined && idfPins.scl !== undefined && !findings.i2c.pins) {
    findings.i2c.pins = idfPins
    findings.i2c.confidence = 'strong'
    findings.pins.set(idfPins.sda, { mode: 'signal', label: 'SDA', confidence: 'strong' })
    findings.pins.set(idfPins.scl, { mode: 'signal', label: 'SCL', confidence: 'strong' })
  }

  // Wire.begin() — default pins, WEAK
  if (PATTERNS.i2cBeginDefault.test(source) && !findings.i2c.pins) {
    findings.i2c.confidence = 'weak'
    findings.i2c.pins = { sda: 'default', scl: 'default' }
  }

  // I2C addresses used
  while ((match = PATTERNS.i2cAddr.exec(source))) {
    const addr = resolveValue(match[1])
    if (addr !== null && !findings.i2c.addresses.includes(addr)) findings.i2c.addresses.push(addr)
  }
  while ((match = PATTERNS.idfI2cProbe.exec(source))) {
    const addr = resolveValue(match[1])
    if (addr !== null && !findings.i2c.addresses.includes(addr)) findings.i2c.addresses.push(addr)
  }

  // DHT construction — STRONG
  while ((match = PATTERNS.dhtConstruct.exec(source))) {
    const pin = resolveValue(match[1])
    const type = match[2].toLowerCase()
    if (pin !== null) {
      findings.sensors.push({ type, variant: type, pin, confidence: 'strong' })
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

  // The bundled ESP-IDF firmware bit-bangs a DHT22 and exposes its GPIO as a
  // named macro instead of constructing an Arduino DHT object.
  const dhtPinName = [...findings.defines.keys()].find(name => /^DHT_(?:IO|PIN)$/.test(name))
  if (dhtPinName && /\bDHT22\b/i.test(source) && /\bdht_(?:read|decode)\s*\(/.test(source)) {
    const pin = findings.defines.get(dhtPinName)
    if (!findings.sensors.some(s => s.type === 'dht22' && s.pin === pin)) {
      findings.sensors.push({ type: 'dht22', pin, confidence: 'strong' })
      findings.pins.set(pin, { mode: 'signal', label: 'DATA', confidence: 'strong' })
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
  const wires = []
  let x = 90, y = 90
  const spacing = 120
  let mcu = null

  // Always include MCU if we have any pin info
  if (findings.pins.length > 0 || findings.i2c.pins || findings.i2c.addresses.length > 0 || findings.libraries.length > 0) {
    const mcuDef = registry.componentDef('esp32') // default to ESP32 shape
    if (mcuDef) {
      mcu = {
        id: `mcu-${Date.now()}`,
        type: 'esp32',
        label: mcuDef.label,
        x: 120, y: 300,
        declared: true,
        confidence: findings.confidence,
        pins: mcuDef.pins.map(pin => ({ ...pin })),
      }
      components.push(mcu)
    }
  }

  // I2C sensors from addresses + libraries
  const placedI2cTypes = new Set()
  const i2cByAddress = new Map()
  for (const addr of findings.i2c.addresses) {
    const sensor = registry.allComponents().find(c => c.candidateAddrs?.includes(addr))
    if (!sensor || !registry.isKnown(sensor.id)) continue
    let placed = components.find(c => c.type === sensor.id)
    if (!placed && !placedI2cTypes.has(sensor.id)) {
      placedI2cTypes.add(sensor.id)
      placed = {
        id: `i2c-${addr}-${Date.now()}`,
        type: sensor.id,
        label: sensor.label,
        x, y,
        declared: true,
        confidence: findings.i2c.confidence,
        i2cAddress: addr,
      }
      components.push(placed)
      x += spacing
    }
    if (placed) i2cByAddress.set(addr, placed)
  }

  // Explicit sensors from code (DHT, 1Wire, Servo)
  for (const s of findings.sensors) {
    if (registry.isKnown(s.type)) {
      const placed = {
        id: `${s.type}-${s.pin}-${Date.now()}`,
        type: s.type,
        label: registry.componentDef(s.type).label,
        x, y,
        declared: true,
        confidence: s.confidence,
        pin: s.pin,
      }
      components.push(placed)
      x += spacing
    }
  }

  if (mcu) {
    const setRolePin = (id, gpio) => {
      if (!Number.isInteger(gpio)) return
      const pin = mcu.pins.find(p => p.id === id)
      if (pin) {
        pin.gpio = gpio
        pin.label = `${id} (GPIO${gpio})`
      }
    }
    setRolePin('SDA', findings.i2c.pins?.sda)
    setRolePin('SCL', findings.i2c.pins?.scl)

    const dht = components.find(c => c.type === 'dht22')
    if (dht && Number.isInteger(dht.pin)) setRolePin('DHT', dht.pin)

    const rolePins = new Set([
      findings.i2c.pins?.sda,
      findings.i2c.pins?.scl,
      dht?.pin,
    ])
    let extraIndex = 0
    for (const declaredPin of findings.pins) {
      if (!Number.isInteger(declaredPin.pin) || rolePins.has(declaredPin.pin)) continue
      if (mcu.pins.some(pin => pin.gpio === declaredPin.pin)) continue
      const side = Math.floor(extraIndex / 8)
      const slot = extraIndex % 8
      mcu.pins.push({
        id: `GPIO${declaredPin.pin}`,
        label: `GPIO${declaredPin.pin}`,
        kind: 'signal',
        dx: 10 + slot * 14,
        dy: side % 2 === 0 ? 6 : 84,
        gpio: declaredPin.pin,
      })
      extraIndex += 1
    }

    let wireIndex = 0
    const connect = (fromComponent, fromPinId, toComponent, toPinId) => {
      if (!fromComponent || !toComponent) return
      wires.push({
        id: `declared-wire-${wireIndex++}`,
        fromComponentId: fromComponent.id,
        fromPinId,
        toComponentId: toComponent.id,
        toPinId,
        declared: true,
      })
    }
    const mpu = [...i2cByAddress.values()].find(c => c.type === 'mpu6050')
    if (mpu && Number.isInteger(findings.i2c.pins?.sda) && Number.isInteger(findings.i2c.pins?.scl)) {
      connect(mcu, 'SDA', mpu, 'SDA')
      connect(mcu, 'SCL', mpu, 'SCL')
    }
    if (dht && Number.isInteger(dht.pin)) connect(mcu, 'DHT', dht, 'DATA')
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

  return { components, wires }
}