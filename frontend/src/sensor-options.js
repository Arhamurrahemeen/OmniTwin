// Hardware sensors match what the ESP32 + DHT22 + MPU6050 firmware actually
// publishes (firmware/twinlab_node_v1/main/main.c). Simulator devices can
// additionally fake generator-style sensors.
export const HARDWARE_SENSORS = ['temperature', 'humidity', 'accel_x', 'accel_y', 'accel_z', 'vibration']
export const SIMULATOR_SENSORS = [...HARDWARE_SENSORS, 'fuel_level', 'load_current']

export const sensorOptionsFor = (source) => (source === 'hardware' ? HARDWARE_SENSORS : SIMULATOR_SENSORS)
