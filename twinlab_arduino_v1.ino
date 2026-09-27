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
  for (byte addr = 8; addr <= 119; addr++) {
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

void sendWhoami(int addr, int reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) == 0) {
    Wire.requestFrom(addr, (byte)1);
    if (Wire.available()) {
      byte val = Wire.read();
      Serial.println("{\"whoami\":" + String(val) + "}");
      return;
    }
  }
  Serial.println("{\"whoami\":-1}");
}

void sendStream() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Read MPU6050 if present (0x68 or 0x69)
  float ax = NAN, ay = NAN, az = NAN;
  for (byte mpuAddr : {0x68, 0x69}) {
    Wire.beginTransmission(mpuAddr);
    if (Wire.endTransmission() == 0) {
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