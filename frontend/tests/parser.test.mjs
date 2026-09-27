import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProject, findingsToLayout } from '../src/code/parser.mjs'
import { allComponents, componentDef, isKnown } from '../src/registry/registry.mjs'

test('parses ESP-IDF bus pins, hex I2C addresses, and custom DHT22 GPIO', () => {
  const source = `
#define SDA_IO 21
#define SCL_IO 22
#define MPU_ADDR 0x68
#define MPU_ADDR_ALT 0x69
#define DHT_IO 4
static const i2c_master_bus_config_t bus_cfg = {
  .sda_io_num = SDA_IO,
  .scl_io_num = SCL_IO,
};
void scan(void) {
  i2c_master_probe(bus, MPU_ADDR, 100);
  i2c_master_probe(bus, MPU_ADDR_ALT, 100);
}
/* DHT22 data pin */
static bool dht_read(float *temp, float *hum) { return true; }
static bool dht_decode(const uint8_t data[5]) { return true; }
`
  const findings = parseProject([{ name: 'main.c', content: source }])

  assert.deepEqual(findings.i2c.pins, { sda: 21, scl: 22 })
  assert.deepEqual(findings.i2c.addresses, [0x68, 0x69])
  assert.ok(findings.sensors.some(s => s.type === 'dht22' && s.pin === 4))

  const layout = findingsToLayout(findings, { allComponents, componentDef, isKnown })
  assert.ok(layout.components.some(c => c.type === 'esp32'))
  assert.ok(layout.components.some(c => c.type === 'mpu6050'))
  assert.ok(layout.components.some(c => c.type === 'dht22'))
  assert.ok(layout.components.some(c => c.type === 'breadboard'))
})

test('projects source-derived sensor connections onto declared GPIO pins', () => {
  const source = `
#define SDA_IO 13
#define SCL_IO 14
#define MPU_ADDR 0x68
#define DHT_IO 17
static const i2c_master_bus_config_t bus_cfg = {
  .sda_io_num = SDA_IO,
  .scl_io_num = SCL_IO,
};
void scan(void) { i2c_master_probe(bus, MPU_ADDR, 100); }
/* DHT22 */
static bool dht_read(void) { return true; }
`
  const findings = parseProject([{ name: 'main.c', content: source }])
  const layout = findingsToLayout(findings, { allComponents, componentDef, isKnown })
  const esp = layout.components.find(c => c.type === 'esp32')

  assert.equal(esp.pins.find(p => p.id === 'SDA').gpio, 13)
  assert.equal(esp.pins.find(p => p.id === 'SCL').gpio, 14)
  assert.equal(esp.pins.find(p => p.id === 'DHT').gpio, 17)
  assert.equal(esp.pins.find(p => p.id === 'SDA').label, 'SDA (GPIO13)')

  const byId = new Map(layout.components.map(c => [c.id, c]))
  const connections = layout.wires.map(w => ({
    from: `${byId.get(w.fromComponentId).type}.${w.fromPinId}`,
    to: `${byId.get(w.toComponentId).type}.${w.toPinId}`,
  }))
  assert.deepEqual(connections, [
    { from: 'esp32.SDA', to: 'mpu6050.SDA' },
    { from: 'esp32.SCL', to: 'mpu6050.SCL' },
    { from: 'esp32.DHT', to: 'dht22.DATA' },
  ])
})