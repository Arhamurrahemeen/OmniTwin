// twinlab_arduino_v1.ino — OmniTwin Arduino Uno/Nano sketch
// Same JSON-over-serial protocol as ESP32 firmware (fw 1.1)
// Flash with Arduino IDE, then plug in → auto-detected by dashboard

#include <Wire.h>
#include <DHT.h>

#define DHT_PIN 4
#define DHT_TYPE DHT22
#define BAUD 115200

DHT dht(DHT_PIN, DHT_TYPE);

bool streaming = false;
unsigned long lastStream = 0;
const unsigned long STREAM_INTERVAL = 100; // 10 Hz

void setup() {
  Serial.begin(BAUD);
  Wire.begin();
  dht.begin();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    handleCommand(line);
  }

  if (streaming && millis() - lastStream >= STREAM_INTERVAL) {
    sendStream();
    lastStream = millis();
  }
}

void handleCommand(String cmd) {
  if (cmd == "IDENT") {
    Serial.println("{\"device\":\"omnitwin-arduino\",\"fw\":\"1.1\",\"board\":\"arduino-uno\",\"id\":\"TL-ARDUINO\"}");
  }
  else if (cmd == "PING") {
    Serial.println("{\"pong\":true}");
  }
  else if (cmd == "SCAN") {
    sendScan();
  }
  else if (cmd == "STREAM on") {
    streaming = true;
    Serial.println("{\"ok\":true}");
  }
  else if (cmd == "STREAM off") {
    streaming = false;
    Serial.println("{\"ok\":true}");
  }
  else if (cmd.startsWith("WHOAMI ")) {
    // WHOAMI <addr> <reg>
    int firstSpace = cmd.indexOf(' ', 7);
    if (firstSpace > 7) {
      int addr = cmd.substring(7, firstSpace).toInt();
      int reg = cmd.substring(firstSpace + 1).toInt();
      sendWhoami(addr, reg);
    } else {
      Serial.println("{\"whoami\":-1}");
    }
  }
}

void sendScan() {
  // I2C sweep
  String i2c = "[]";
  String i2cEntries = "";
  // 0x08..0x77: the same range as the ESP32 firmware and its WHOAMI. 0x00..0x07
  // and 0x78..0x7F are reserved by the I2C spec.
  for (byte addr = 0x08; addr <= 0x77; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      if (i2cEntries.length() > 0) i2cEntries += ",";
      i2cEntries += "{\"addr\":" + String(addr) + "}";
    }
  }
  i2c = "[" + i2cEntries + "]";

  // DHT probe
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  bool dhtOk = !isnan(t) && !isnan(h);

  String scan = "{\"i2c\":" + i2c + ",\"dht22\":{\"gpio\":" + String(DHT_PIN) + ",\"ok\":" + (dhtOk ? "true" : "false") + "}}";
  Serial.println(scan);
}

// One register byte, or -1 when the address does not answer.
int readReg(byte addr, byte reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  Wire.requestFrom(addr, (byte)1);
  return Wire.available() ? Wire.read() : -1;
}

void sendWhoami(int addr, int reg) {
  // Same bounds as the ESP32 firmware's parse_whoami.
  int val = (addr >= 0x08 && addr <= 0x77 && reg >= 0 && reg <= 0xFF) ? readReg(addr, reg) : -1;
  Serial.println("{\"whoami\":" + String(val) + "}");
}

void sendStream() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Read MPU6050 if present (0x68 or 0x69)
  float ax = NAN, ay = NAN, az = NAN;
  // A plain array, not `for (x : {..})`: that form needs std::initializer_list,
  // which the AVR core does not ship.
  const byte MPU_ADDRS[] = { 0x68, 0x69 };
  for (byte i = 0; i < 2; i++) {
    byte mpuAddr = MPU_ADDRS[i];
    // An ACK is not identity: a DS1307/DS3231 RTC also sits at 0x68. Write
    // only to a chip whose WHO_AM_I (0x75) reads 0x68.
    if (readReg(mpuAddr, 0x75) == 0x68) {
      // Wake up MPU
      Wire.beginTransmission(mpuAddr);
      Wire.write(0x6B); Wire.write(0x00); // PWR_MGMT_1
      Wire.endTransmission();

      // Read accel
      Wire.beginTransmission(mpuAddr);
      Wire.write(0x3B); // ACCEL_XOUT_H
      Wire.endTransmission(false);
      Wire.requestFrom(mpuAddr, (byte)6);
      if (Wire.available() >= 6) {
        int16_t rawAx = (Wire.read() << 8) | Wire.read();
        int16_t rawAy = (Wire.read() << 8) | Wire.read();
        int16_t rawAz = (Wire.read() << 8) | Wire.read();
        ax = rawAx / 16384.0; // ±2g scale
        ay = rawAy / 16384.0;
        az = rawAz / 16384.0;
      }
      break;
    }
  }

  // Build JSON
  String json = "{\"ts\":" + String(millis()) + ",";
  json += "\"temp\":" + (isnan(t) ? "null" : String(t, 1)) + ",";
  json += "\"hum\":" + (isnan(h) ? "null" : String(h, 1)) + ",";

  if (isnan(ax)) {
    json += "\"ax\":null,\"ay\":null,\"az\":null";
  } else {
    json += "\"ax\":" + String(ax, 3) + ",\"ay\":" + String(ay, 3) + ",\"az\":" + String(az, 3);
  }
  json += "}";

  Serial.println(json);
}