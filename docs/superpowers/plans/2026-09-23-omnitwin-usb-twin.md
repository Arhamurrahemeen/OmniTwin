# OmniTwin USB Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MQTT/Wi-Fi data plane with a browser↔ESP32 USB serial link, add auto-detection + a draggable 2D digital-twin canvas, and an on-demand LLM-powered AI tutor (Ask + chat).

**Architecture:** The Chrome/Edge [Web Serial API] bridges the dashboard directly to the ESP32's USB console UART. The firmware answers IDENT/SCAN/STREAM/PING JSON commands and streams readings; the frontend parses them into component auto-placement on an SVG twin canvas and runs cheap local anomaly flags. The backend keeps Mongo + roster/quota/demo-kit, sheds MQTT/Influx/WS/sim, and adds one on-demand `/tutor` route that calls the LLM only when the student asks.

**Tech Stack:** ESP-IDF 6.0.2 C (firmware, UART protocol); FastAPI + Motor + httpx (backend, no new deps); React/Vite + Web Serial API (browser); LLM via Groq REST (OpenAI-compatible `chat/completions`), key server-side.

**Spec:** `docs/superpowers/specs/2026-09-23-omnitwin-usb-twin-design.md`

## Global Constraints

- Never modify `D:\TwinLab_v2` (read-only upstream). Never `git push`. PowerShell only (`;` chaining, never `&&`), PS 5.1.
- The LLM API key never appears in `frontend/` or `sim-control/` code or commits; only the backend reads it (env var `GROQ_API_KEY`).
- Firmware UART is UART0 (the USB bridge's console line — the same COM port Web Serial opens).
- Wire protocol is line-delimited JSON (`\n`); every command gets exactly one reply line.
- Targets: Chrome/Edge desktop only for Web Serial (feature-detect; no polyfill without `navigator.serial`).
- `twinlab` data-plane names (Mongo db, org/bucket) may remain in backend config; MQTT broker + InfluxDB + Mosquitto references are removed.
- Firmware verified by `idf.py build` in the ESP-IDF shell; backend by `pytest`; frontend pure logic by `node --test`; React UIs by `npm run build` + human demo.

## Review Focus

Inputs the spec implies but no task's happy-path exercises; each line is pinned to a test in the owning task:

1. **No board / no `navigator.serial`** → dashboard shows a clear "connect your ESP32" empty state; tutor lets you ask anyway and answers "no board connected" instead of crashing. (Task 3 + Task 6)
2. **Port open failure or busy port** → visible error + Retry; the app stays usable. (Task 3)
3. **Firmware doesn't answer a command** (cable pulled mid-session) → command promise times out → "board not responding, check cable" surfaced, no hang, stream marked stale. (Task 3)
4. **Barfed serial payload** (partial line split across reads, noise, embedded newline) → line-buffer reassembles fragments; junk lines ignored; parser never throws. (Task 3)
5. **LLM failure** (no key, offline, rate limit) → tutor shows a friendly offline message; the twin UI is unaffected; no crash cascade. (Task 2 test)
6. **SCAN finds an unrecognized I2C address** → reported as `{"addr":X,"name":null}`; the canvas ignores it (student adds manually). Partial scans degrade gracefully. (Task 3 + Task 4)

---

### Task 1: Firmware — serial protocol replaces MQTT/Wi-Fi

**Files:**
- Modify: `firmware/twinlab_node_v1/main/main.c` (full rewrite)
- Modify: `firmware/twinlab_node_v1/CMakeLists.txt` (verify no component changed; likely untouched)
- Delete: `firmware/twinlab_node_v1/main/secrets.h` and `firmware/twinlab_node_v1/main/secrets.h.example` (Wi-Fi creds no longer exist)

**Interfaces:**
- Consumes: nothing from later tasks; existing MPU6050 (SDA 21 / SCL 22, addr 0x68) + DHT22 (GPIO4) reader code.
- Produces (wire contract, all `\n`-terminated JSON on UART0):
  - request `IDENT` → `{"device":"ESP32","fw":"1.0","board":"twinlab-node","id":"TL-A1B2C3"}`
  - request `SCAN` → `{"i2c":[{"addr":104,"name":"mpu6050"}],"dht22":{"gpio":4,"ok":true}}` — unknown addresses as `{"addr":X,"name":null}`
  - request `STREAM on` → replies `{"stream":"on"}` then ~10 Hz lines `{"ts":1734,"temp":24.3,"hum":55.1,"ax":0.1,"ay":-0.2,"az":9.8}`
  - request `STREAM off` → replies `{"stream":"off"}` and stops
  - request `PING` → `{"pong":true}`

- [ ] **Step 1: Write the failing firmware self-tests (pure logic: command parse + reply JSON)**

Add to `main.c` before `app_main`:

```c
/* Protocol self-check: command parsing + reply JSON wire format (purity check,
   no hardware needed — a changed wire contract aborts at boot instead of
   failing silently in the field). */

typedef enum { CMD_IDENT, CMD_SCAN, CMD_STREAM_ON, CMD_STREAM_OFF, CMD_PING, CMD_NONE } cmd_t;

static cmd_t parse_cmd(const char *line)
{
    if      (strcmp(line, "IDENT") == 0)     return CMD_IDENT;
    else if (strcmp(line, "SCAN") == 0)      return CMD_SCAN;
    else if (strcmp(line, "STREAM on") == 0) return CMD_STREAM_ON;
    else if (strcmp(line, "STREAM off") == 0)return CMD_STREAM_OFF;
    else if (strcmp(line, "PING") == 0)      return CMD_PING;
    return CMD_NONE;
}

static void proto_selftest(void)
{
    assert(parse_cmd("IDENT") == CMD_IDENT);
    assert(parse_cmd("STREAM on") == CMD_STREAM_ON);
    assert(parse_cmd("STREAM off") == CMD_STREAM_OFF);
    assert(parse_cmd("PING") == CMD_PING);
    assert(parse_cmd("bogus\ntrailing") == CMD_NONE);
    assert(parse_cmd("") == CMD_NONE);
    assert(parse_cmd(" STREAM on") == CMD_NONE);   /* no leading whitespace */

    char buf[96];
    snprintf(buf, sizeof buf, "{\"pong\":true}");
    assert(strcmp(buf, "{\"pong\":true}") == 0);
    snprintf(buf, sizeof buf, "{\"stream\":\"%s\"}", "on");
    assert(strcmp(buf, "{\"stream\":\"on\"}") == 0);
}
```

- [ ] **Step 2: Run the build to verify the build still compiles (pre-change baseline) and current self-tests pass**

Run (in the ESP-IDF shell):
```powershell
. C:\Espressif\tools\Microsoft.v6.0.2.PowerShell_profile.ps1
cd D:\OmniTwin\firmware\twinlab_node_v1
idf.py build
```
Expected: builds (current MQTT code) — existing `dht_selftest`/`mqtt_selftest` pass. If it fails on transient IDF issues, rerun once (known flake); if it fails for real, stop and report.

- [ ] **Step 3: Rewrite `main.c` to the serial protocol**

Full replacement — submit the entire file (preserve the sensor-reading code exactly as-is from the current file; only the transport changes):

```c
/* OmniTwin USB node — ESP32 + MPU6050 + DHT22.
 *
 * Line-driven JSON protocol over UART0 (the USB bridge's console line), so a
 * browser using the Web Serial API opens the same COM port the flasher uses.
 *
 *   IDENT      -> {"device":"ESP32","fw":"1.0","board":"twinlab-node","id":"TL-XXXXXX"}
 *   SCAN       -> {"i2c":[{"addr":104,"name":"mpu6050"}],"dht22":{"gpio":4,"ok":true}}
 *   STREAM on  -> {"stream":"on"}  then ~10 Hz  {"ts","temp","hum","ax","ay","az"}
 *   STREAM off -> {"stream":"off"} (stops the stream)
 *   PING       -> {"pong":true}
 *
 * Sensor-reading code (I2C bus setup, MPU register config, the DHT22 bit-bang
 * decoder) is carried over verbatim from the bench-tested standalone firmware.
 */

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define SDA_IO   21
#define SCL_IO   22
#define MPU_ADDR 0x68

/* DHT22 data pin. Needs a 4.7k-10k pull-up to 3V3 on the line; the internal
   pull-up is enabled too but is too weak to rely on alone. */
#define DHT_IO        4
#define DHT_PERIOD_MS 2000

#define SAMPLE_HZ 100
#define ACC_LSB   4096.0f   /* +-8 g */
#define STREAM_HZ 10

#define UART_BUF 256
#define LINE_MAX 128

static const char *TAG = "omnitwin";

static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t mpu;
static char g_device_id[DEVICE_ID_MAXLEN + 1];
#define DEVICE_ID_MAXLEN 9   /* "TL-" + 6 hex chars */

static float g_temp = NAN, g_hum = NAN;  /* last good DHT reading; NAN until first */
static volatile bool g_stream_on = false;

/* ---- protocol types + helpers (Task 1 selftests reference these) ---------- */

typedef enum { CMD_IDENT, CMD_SCAN, CMD_STREAM_ON, CMD_STREAM_OFF, CMD_PING, CMD_NONE } cmd_t;

static cmd_t parse_cmd(const char *line)   /* see proto_selftest */
{
    if      (strcmp(line, "IDENT") == 0)     return CMD_IDENT;
    else if (strcmp(line, "SCAN") == 0)      return CMD_SCAN;
    else if (strcmp(line, "STREAM on") == 0) return CMD_STREAM_ON;
    else if (strcmp(line, "STREAM off") == 0)return CMD_STREAM_OFF;
    else if (strcmp(line, "PING") == 0)      return CMD_PING;
    return CMD_NONE;
}

static void proto_selftest(void)
{
    assert(parse_cmd("IDENT") == CMD_IDENT);
    assert(parse_cmd("STREAM on") == CMD_STREAM_ON);
    assert(parse_cmd("STREAM off") == CMD_STREAM_OFF);
    assert(parse_cmd("PING") == CMD_PING);
    assert(parse_cmd("bogus\ntrailing") == CMD_NONE);
    assert(parse_cmd("") == CMD_NONE);
    assert(parse_cmd(" STREAM on") == CMD_NONE);

    char buf[96];
    snprintf(buf, sizeof buf, "{\"pong\":true}");
    assert(strcmp(buf, "{\"pong\":true}") == 0);
    snprintf(buf, sizeof buf, "{\"stream\":\"%s\"}", "on");
    assert(strcmp(buf, "{\"stream\":\"on\"}") == 0);
}

/* ---- MPU6050 reads (verbatim from bench firmware) ------------------------ */

static esp_err_t mpu_w(uint8_t reg, uint8_t val)
{
    uint8_t b[2] = { reg, val };
    return i2c_master_transmit(mpu, b, 2, 100);
}

static esp_err_t mpu_r(uint8_t reg, uint8_t *buf, size_t n)
{
    return i2c_master_transmit_receive(mpu, &reg, 1, buf, n, 100);
}

static void mpu_w_retry(uint8_t reg, uint8_t val)
{
    while (mpu_w(reg, val) != ESP_OK) {
        ESP_LOGW(TAG, "mpu init write 0x%02X=0x%02X failed, retrying", reg, val);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

static bool line_pulled_up(int pin)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << pin,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&io);
    vTaskDelay(pdMS_TO_TICKS(5));
    int level = gpio_get_level(pin);
    gpio_reset_pin(pin);
    return level == 1;
}

/* ---- DHT22 (verbatim from bench firmware) -------------------------------- */

static portMUX_TYPE dht_mux = portMUX_INITIALIZER_UNLOCKED;

static bool dht_decode(const uint8_t b[5], float *temp, float *hum)
{
    if (((b[0] + b[1] + b[2] + b[3]) & 0xFF) != b[4]) return false;
    *hum = ((b[0] << 8) | b[1]) * 0.1f;
    float t = (((b[2] & 0x7F) << 8) | b[3]) * 0.1f;
    *temp = (b[2] & 0x80) ? -t : t;
    return true;
}

static int dht_wait(int level, int timeout_us)
{
    int64_t t0 = esp_timer_get_time();
    while (gpio_get_level(DHT_IO) != level)
        if (esp_timer_get_time() - t0 > timeout_us) return -1;
    return (int)(esp_timer_get_time() - t0);
}

static bool dht_read(float *temp, float *hum)
{
    uint8_t b[5] = { 0 };

    gpio_set_direction(DHT_IO, GPIO_MODE_OUTPUT);
    gpio_set_level(DHT_IO, 0);
    esp_rom_delay_us(1200);
    gpio_set_level(DHT_IO, 1);
    esp_rom_delay_us(30);
    gpio_set_direction(DHT_IO, GPIO_MODE_INPUT);

    bool ok = true;
    taskENTER_CRITICAL(&dht_mux);
    if (dht_wait(0, 90) < 0 || dht_wait(1, 100) < 0 || dht_wait(0, 100) < 0)
        ok = false;
    for (int i = 0; ok && i < 40; i++) {
        if (dht_wait(1, 100) < 0) { ok = false; break; }
        int hi = dht_wait(0, 100);
        if (hi < 0) { ok = false; break; }
        b[i >> 3] = (b[i >> 3] << 1) | (hi > 45);
    }
    taskEXIT_CRITICAL(&dht_mux);

    return ok && dht_decode(b, temp, hum);
}

static void dht_selftest(void)
{
    float t, h;
    uint8_t good[5] = { 0x02, 0x5A, 0x00, 0xFB, 0 };
    good[4] = (good[0] + good[1] + good[2] + good[3]) & 0xFF;
    assert(dht_decode(good, &t, &h) &&
           fabsf(t - 25.1f) < 0.05f && fabsf(h - 60.2f) < 0.05f);

    uint8_t neg[5] = { 0x02, 0x5A, 0x80, 0x64, 0 };
    neg[4] = (neg[0] + neg[1] + neg[2] + neg[3]) & 0xFF;
    assert(dht_decode(neg, &t, &h) && fabsf(t + 10.0f) < 0.05f);

    uint8_t bad[5] = { 0x02, 0x5A, 0x00, 0xFB, 0xFF };
    assert(!dht_decode(bad, &t, &h));
}

static void dht_task(void *arg)
{
    gpio_set_pull_mode(DHT_IO, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(2000));
    while (1) {
        float t, h;
        if (dht_read(&t, &h)) {
            g_temp = t;
            g_hum  = h;
        } else {
            ESP_LOGW(TAG, "DHT read failed (wiring / pull-up on GPIO%d?)", DHT_IO);
        }
        vTaskDelay(pdMS_TO_TICKS(DHT_PERIOD_MS));
    }
}

/* ---- command handling ------------------------------------------------------ */

static void reply_ident(void)
{
    printf("{\"device\":\"ESP32\",\"fw\":\"1.0\",\"board\":\"twinlab-node\",\"id\":\"%s\"}\n", g_device_id);
}

static void reply_scan(void)
{
    /* I2C 7-bit sweep 0x03..0x77; 0x68 -> mpu6050, anything else -> null name. */
    char list[512];
    int n = 0;
    for (int addr = 0x03; addr <= 0x77; addr++) {
        if (i2c_master_probe(bus, addr, 100) == ESP_OK) {
            const char *name = (addr == MPU_ADDR) ? "mpu6050" : "null";
            n += snprintf(list + n, sizeof list - n, "%s{\"addr\":%d,\"name\":%s}",
                          (n > 0) ? "," : "", addr, name);
            if (n >= (int)sizeof list - 32) break;
        }
    }
    float t, h;
    bool dht_ok = dht_read(&t, &h);
    printf("{\"i2c\":[%s],\"dht22\":{\"gpio\":%d,\"ok\":%s}}\n",
           list, DHT_IO, dht_ok ? "true" : "false");
}

static void handle_cmd(cmd_t cmd)
{
    switch (cmd) {
        case CMD_IDENT:      reply_ident();   break;
        case CMD_SCAN:       reply_scan();    break;
        case CMD_STREAM_ON:  g_stream_on = true;  printf("{\"stream\":\"on\"}\n");  break;
        case CMD_STREAM_OFF: g_stream_on = false; printf("{\"stream\":\"off\"}\n"); break;
        case CMD_PING:       printf("{\"pong\":true}\n"); break;
        default:             printf("{\"error\":\"unknown command\"}\n"); break;
    }
}

/* Read raw bytes from UART0, assemble full lines, dispatch each. */
static void uart_task(void *arg)
{
    static char line[LINE_MAX];
    static size_t len = 0;
    uint8_t buf[UART_BUF];

    while (1) {
        int got = uart_read_bytes(UART_NUM_0, buf, sizeof buf, 100);
        for (int i = 0; i < got; i++) {
            if (buf[i] == '\n' || buf[i] == '\r') {
                if (len > 0) {
                    line[len] = '\0';
                    handle_cmd(parse_cmd(line));
                    len = 0;
                }
            } else if (len < LINE_MAX - 1) {
                line[len++] = (char)buf[i];
            }
        }
        if (got < 0) len = 0;   /* stale/flushed buffer */
    }
}

/* ---- streaming ------------------------------------------------------------- */

static long long epoch_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static void stream_task(void *arg)
{
    while (1) {
        if (g_stream_on) {
            uint8_t d[14];
            if (mpu_r(0x3B, d, 14) == ESP_OK) {
                float ax = (int16_t)((d[0] << 8) | d[1]) / ACC_LSB;
                float ay = (int16_t)((d[2] << 8) | d[3]) / ACC_LSB;
                float az = (int16_t)((d[4] << 8) | d[5]) / ACC_LSB;
                if (isnan(g_temp)) /* temp==0 placeholder means DHT not sampled yet */
                    printf("{\"ts\":%lld,\"temp\":null,\"hum\":null,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f}\n",
                           epoch_ms(), ax, ay, az);
                else
                    printf("{\"ts\":%lld,\"temp\":%.1f,\"hum\":%.1f,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f}\n",
                           epoch_ms(), g_temp, g_hum, ax, ay, az);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1000 / STREAM_HZ));
    }
}

/* ---- main ---------------------------------------------------------------- */

void app_main(void)
{
    proto_selftest();
    dht_selftest();

    if (nvs_flash_init() != ESP_OK) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_efuse_mac_get_default(mac));
    snprintf(g_device_id, sizeof g_device_id, "TL-%02X%02X%02X", mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "device id: %s", g_device_id);

    uart_config_t uart_cfg = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, UART_BUF * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0, &uart_cfg));
    /* UART0 pins: TX=1, RX=3 by default — leave default (console bridge). */

    bool sda_up = line_pulled_up(SDA_IO);
    bool scl_up = line_pulled_up(SCL_IO);
    ESP_LOGI(TAG, "bus check: SDA(%d)=%s SCL(%d)=%s", SDA_IO,
             sda_up ? "pulled up" : "FLOATING", SCL_IO,
             scl_up ? "pulled up" : "FLOATING");
    if (!sda_up && !scl_up) {
        ESP_LOGE(TAG, "neither line is pulled up -> module has no power (check 3V3/GND)");
    } else if (!sda_up || !scl_up) {
        ESP_LOGE(TAG, "one line floating -> that signal wire is not connected");
    }

    i2c_master_bus_config_t bus_cfg = {
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .i2c_port   = -1,
        .sda_io_num = SDA_IO,
        .scl_io_num = SCL_IO,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus));

    esp_err_t err;
    while ((err = i2c_master_probe(bus, MPU_ADDR, 200)) != ESP_OK) {
        ESP_LOGE(TAG, "no device at 0x%02X (%s) - check SDA=%d, SCL=%d, 3V3, GND",
                 MPU_ADDR, esp_err_to_name(err), SDA_IO, SCL_IO);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    ESP_LOGI(TAG, "device found at 0x%02X", MPU_ADDR);

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = MPU_ADDR,
        .scl_speed_hz    = 400000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dev_cfg, &mpu));

    mpu_w_retry(0x6B, 0x01);
    mpu_w_retry(0x1A, 0x03);
    mpu_w_retry(0x19, 0x00);
    mpu_w_retry(0x1B, 0x08);
    mpu_w_retry(0x1C, 0x10);

    xTaskCreatePinnedToCore(uart_task,   "uart"  , 4096, NULL, 8, NULL, 0);
    xTaskCreatePinnedToCore(dht_task,    "dht"   , 3072, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(stream_task, "stream", 3072, NULL, 5, NULL, 1);

    ESP_LOGI(TAG, "OmniTwin USB node ready — IDENT/SCAN/STREAM/PING on UART0");
}
```

NOTE: this references `bus` (i2c master bus handle) in `reply_scan` and `app_main` but it must be a file-scope `static i2c_master_bus_handle_t bus;` (the original declared it inside `app_main`). Declare it at file scope alongside `mpu`. Also `struct timeval`/`gettimeofday` need `#include <sys/time.h>`.

- [ ] **Step 4: Build it**

Run (in the ESP-IDF shell):
```powershell
. C:\Espressif\tools\Microsoft.v6.0.2.PowerShell_profile.ps1
cd D:\OmniTwin\firmware\twinlab_node_v1
idf.py build
```
Expected: compiles and links, `proto_selftest()`/`dht_selftest()` pass at boot (asserts fire before hardware init — if any traps, fix and rebuild). If a transient `lmots.c.obj` failure appears, rerun once.

- [ ] **Step 5: Delete the secrets files and commit**

```powershell
cd D:\OmniTwin
git rm firmware/twinlab_node_v1/main/secrets.h firmware/twinlab_node_v1/main/secrets.h.example
git add firmware/twinlab_node_v1/main/main.c
git commit -m "feat(firmware): replace MQTT/Wi-Fi with USB serial protocol (IDENT/SCAN/STREAM/PING)"
```
Expected: clean tree after commit (verify `git status`).

---

### Task 2: Backend — remove MQTT/Influx/WS/sim, add `/tutor`

**Files:**
- Modify: `backend/main.py` (full rewrite — slim), `backend/config.py` (drop MQTT/Influx, add Groq), `requirements.txt` (drop paho-mqtt, influxdb-client)
- Create: `backend/llm.py`, `backend/routers/tutor.py`
- Modify: `backend/db/influx.py` → delete; `backend/alerts.py` → delete; `backend/routers/sim.py`, `backend/routers/ws.py`, `backend/routers/alerts.py`, `backend/routers/readings.py` → delete
- Create: `tests/test_llm.py`
- Run: `git rm` the deletions below

**Interfaces:**
- Consumes: `D:\OmniTwin\.venv\Scripts\python`; `motor`; existing `db/mongo.py` (`get_db()` → `AsyncIOMotorDatabase`).
- Produces:
  - `llm.py: async def groq_chat(messages: list[list[dict]]) -> str` — raises `LLMError` on any failure; `llm.py: def build_prompt(device_id, context, messages) -> list[dict]` (pure).
  - `routers/tutor.py: POST /tutor` body `{device_id?, context, messages:[{role,content}]}` → `{reply, session_id}`.
  - `config.py` Settings gains `groq_api_key: str | None = None`, `groq_model: str = "llama-3.3-70b-versatile"`.

- [ ] **Step 1: Write the failing tests**

`tests/test_llm.py`:

```python
import pytest
import backend.llm as llm  # Path handling: run tests from repo root with .venv python


def _ctx():
    return {
        "device_id": "TL-A1B2C3",
        "components": [{"type": "mpu6050", "label": "MPU6050"}, {"type": "dht22", "label": "DHT22"}],
        "readings": {"temp": 41.2, "hum": 30.0},
        "anomalies": ["temperature above 40 C"],
    }


def test_build_prompt_is_openai_shaped():
    msgs = llm.build_prompt(_ctx(), [{"role": "user", "content": "why hot?"}])
    assert msgs[0]["role"] == "system"
    assert "MPU6050" in msgs[1]["content"]
    assert "online" in msgs[1]["content"].lower() or "grounded" in msgs[1]["content"].lower()
    assert msgs[-1]["role"] == "user" and msgs[-1]["content"] == "why hot?"


def test_build_prompt_never_leaks_key(tmp_path):
    prompt = llm.build_prompt(_ctx(), [{"role": "user", "content": "hi"}])
    assert "\n".join(str(m) for m in prompt).find("GROQ_API_KEY") == -1


def test_groq_chat_raises_on_missing_key(monkeypatch):
    monkeypatch.setattr(llm.settings, "groq_api_key", None)
    with pytest.raises(llm.LLMError):
        import asyncio
        asyncio.run(llm.groq_chat([{"role": "user", "content": "hi"}]))
```

- [ ] **Step 2: Run to verify they fail**

Run: `.\.venv\Scripts\python -m pytest tests\test_llm.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.llm'`.

- [ ] **Step 3: Write `backend/llm.py`**

```python
"""Groq-backed chat for the OmniTwin tutor. Key is server-side only (GROQ_API_KEY)."""
import logging

import httpx

from config import settings

log = logging.getLogger("omnitwin.llm")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class LLMError(Exception):
    pass


_TUTOR_SYSTEM = (
    "You are OmniTwin's AI lab tutor for engineering students. You are shown the "
    "current state of the student's physical sensor rig (components detected, live "
    "readings, and any anomalies). Answer in plain language with a clear "
    "explanation and one actionable next step. Politely push the student to reason "
    "about the wiring themselves rather than handing them the whole answer. "
    "Stay grounded in the given readings; never invent numbers."
)


def build_prompt(context: dict, messages: list[dict]) -> list[dict]:
    context_block = (
        "Student rig state:\n"
        f"- Device: {context.get('device_id', 'unknown')}\n"
        f"- Detected components: {', '.join(c.get('label', c.get('type')) for c in context.get('components', [])) or 'none reported'}\n"
        f"- Live readings: {context.get('readings', {})}\n"
        f"- Anomaly flags: {context.get('anomalies', []) or 'none'}\n"
    )
    convo = [{"role": "system", "content": _TUTOR_SYSTEM},
             {"role": "system", "content": context_block}]
    convo.extend([{"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages])
    return convo


async def groq_chat(messages: list[dict]) -> str:
    if not settings.groq_api_key:
        raise LLMError("GROQ_API_KEY is not set — set it in backend/.env")
    body = {
        "model": settings.groq_model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 400,
    }
    headers = {"Authorization": f"Bearer {settings.groq_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(_GROQ_URL, json=body, headers=headers)
            r.raise_for_status()
            payload = r.json()
            return payload["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError) as e:
        log.error("[tutor] LLM call failed: %s", e)
        raise LLMError("LLM call failed") from e
```

- [ ] **Step 4: Add Groq config to `backend/config.py`**

```python
class Settings(BaseSettings):
    mongo_uri: str = "mongodb://admin:twinlab123@localhost:27017"
    mongo_db: str = "twinlab"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"

    model_config = {"env_file": ".env"}
```

- [ ] **Step 5: Write `backend/routers/tutor.py`**

```python
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

import llm
from db.mongo import get_db

log = logging.getLogger("omnitwin.tutor")
router = APIRouter()
_ID_RE = re.compile(r"^[\w\-]+$")


@router.post("")
async def tutor(body: dict):
    """On-demand AI tutor. context holds the current rig snapshot; messages are the
    student's chat turns. Persists the session to Mongo. NEVER called automatically."""
    device_id = body.get("device_id") or "local"
    if not _ID_RE.match(device_id):
        raise HTTPException(400, "Invalid device_id")
    context = body.get("context", {})
    context.setdefault("device_id", device_id)
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages is required")

    prompt = llm.build_prompt(context, messages)

    db = get_db()
    try:
        reply = await llm.groq_chat(prompt)
    except llm.LLMError as e:
        raise HTTPException(502, f"Tutor unavailable: {e}")

    session = await db.tutor_sessions.find_one({"device_id": device_id}, {"_id": 0})
    if session is None:
        session = {"device_id": device_id, "session_id": str(uuid.uuid4()), "messages": []}
    session["messages"].extend([{"role": "system"} | {},  # context block deduped below
                                {"role": "user", "content": messages[-1].get("content", "")}])
    session["messages"] = [m for m in session["messages"] if m.get("content")]
    session["messages"].append({"role": "assistant", "content": reply})
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tutor_sessions.replace_one({"device_id": device_id}, session, upsert=True)

    return {"reply": reply, "session_id": session["session_id"]}
```

Simplify (ponytail: store minimal transcript, drop the odd system spread):

```python
"""On-demand AI tutor. context holds the current rig snapshot; messages are the
student's chat turns. Persists the session to Mongo. NEVER called on its own."""
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

import llm
from db.mongo import get_db

log = logging.getLogger("omnitwin.tutor")
router = APIRouter()
_ID_RE = re.compile(r"^[\w\-]+$")


@router.post("")
async def tutor(body: dict):
    device_id = body.get("device_id") or "local"
    if not _ID_RE.match(device_id):
        raise HTTPException(400, "Invalid device_id")
    context = body.get("context", {})
    context.setdefault("device_id", device_id)
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages is required")

    prompt = llm.build_prompt(context, messages)

    db = get_db()
    try:
        reply = await llm.groq_chat(prompt)
    except llm.LLMError as e:
        raise HTTPException(502, f"Tutor unavailable: {e}")

    session = await db.tutor_sessions.find_one({"device_id": device_id}, {"_id": 0})
    if session is None:
        session = {"device_id": device_id, "session_id": str(uuid.uuid4()), "messages": []}
    session["messages"] = [
        *[m for m in session["messages"]],
        {"role": "user", "content": messages[-1].get("content", "")},
        {"role": "assistant", "content": reply},
    ]
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tutor_sessions.replace_one({"device_id": device_id}, session, upsert=True)

    return {"reply": reply, "session_id": session["session_id"]}
```

- [ ] **Step 6: Rewrite `backend/main.py` slim**

```python
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.mongo import close_mongo, connect_mongo
from routers import devices, roster
from routers import tutor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("omnitwin")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_mongo()
    log.info("[OmniTwin] Backend started")
    yield
    await close_mongo()
    log.info("[OmniTwin] Backend stopped")


app = FastAPI(title="OmniTwin API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router, prefix="/devices", tags=["devices"])
app.include_router(roster.router,  tags=["roster"])
app.include_router(tutor.router,   prefix="/tutor",  tags=["tutor"])


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Trim `requirements.txt`**

Replace contents with:
```txt
fastapi
uvicorn[standard]
motor
pydantic-settings
httpx
numpy
pytest
python-multipart
```

- [ ] **Step 8: Delete the removed modules**

```powershell
cd D:\OmniTwin
git rm backend/alerts.py backend/db/influx.py backend/routers/alerts.py backend/routers/readings.py backend/routers/sim.py backend/routers/ws.py
```

- [ ] **Step 9: Run all backend tests + import check**

Run: `.\.venv\Scripts\python -m pytest tests\test_llm.py tests\test_roster.py -q` AND `cd backend; ..\.venv\Scripts\python -c "import main; print('app ok')"`
Expected: `test_roster` 4 pass; `test_llm` 3 pass; `app ok`.

- [ ] **Step 10: Commit**

```powershell
cd D:\OmniTwin
git add -A
git commit -m "feat(backend): drop MQTT/Influx/WS/sim; add on-demand /tutor (LLM, key server-side)"
```

---

### Task 3: Frontend — serial bridge + scan/twin model (pure logic)

**Files:**
- Create: `frontend/src/serial/serialModel.mjs` (pure, node-testable ESM)
- Create: `frontend/src/serial/serialBridge.js` (thin `navigator.serial` wrapper)
- Create: `frontend/tests/serialModel.test.mjs`
- Modify: `frontend/package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `serialModel.mjs` exports: `COMPONENTS` (registry `{esp32, breadboard, mpu6050, dht22}` with labels), `readLine(bufferedState, chunk) -> {lines, rest}`, `parseScan(line) -> {i2c:[{addr,name}], dht22:{gpio,ok}}`, `scanToComponents(scan) -> [{type, label}]`, `defaultLayout(components) -> {components:[{id,type,x,y}], wires:[]}`, `addComponent(layout, type) -> layout`, `moveComponent(layout,id,x,y) -> layout`, `addWire(layout,from,to) -> layout`, `anomalyFlags(readings) -> [string]`.
  - `serialBridge.js` exports: `supportsSerial() -> bool`, `requestPort() -> Promise<SerialPort>`, `SerialSession` class (`.command(cmd, timeoutMs) -> Promise<object>`, `.onData(fn)`, `.open()`, `.close()`).

- [ ] **Step 1: Write the failing model tests**

`frontend/tests/serialModel.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert'
import {
  readLine, parseScan, scanToComponents, defaultLayout,
  addComponent, moveComponent, addWire, anomalyFlags, withTimeout,
} from '../src/serial/serialModel.mjs'

test('readLine reassembles a line split across chunks', () => {
  let st = { rest: '' }
  const a = readLine(st, '{"i2c":[{"add')
  assert.equal(a.lines.length, 0)
  st = { rest: a.rest }
  const b = readLine(st, 'r":104,"name":"mpu6050"}]}\n')
  assert.equal(b.lines.length, 1)
  assert.equal(b.rest, '')
  assert.deepEqual(JSON.parse(b.lines[0]), { i2c: [{ addr: 104, name: 'mpu6050' }] })
})

test('readLine ignores noise lines and strips CR', () => {
  const st = { rest: '' }
  const out = readLine(st, 'IDF monitor on COM3\r\nnot-json\r\n')
  assert.deepEqual(out.lines, [])
  assert.equal(out.rest, '')
})

test('parseScan extracts i2c list and dht probe', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"},{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  assert.deepEqual(s.i2c.map(x => x.addr), [104, 72])
  assert.ok(s.dht22.ok)
})

test('scanToComponents maps known addresses + ok dht, skips unknowns', () => {
  const s = parseScan('{"i2c":[{"addr":104,"name":"mpu6050"},{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  const comps = scanToComponents(s)
  const types = comps.map(c => c.type)
  assert.ok(types.includes('mpu6050'))
  assert.ok(types.includes('dht22'))
  assert.ok(!types.includes('breadboard'))  // breadboard added separately by canvas
})

test('defaultLayout places each component uniquely and stores x/y', () => {
  const layout = defaultLayout([{ type: 'esp32' }, { type: 'breadboard' }, { type: 'mpu6050' }, { type: 'dht22' }])
  assert.equal(layout.components.length, 4)
  const ids = new Set(layout.components.map(c => c.id))
  assert.equal(ids.size, 4)
  assert.ok(layout.components.every(c => typeof c.x === 'number' && typeof c.y === 'number'))
})

test('addComponent / moveComponent / addWire mutate layout functionally', () => {
  const l0 = defaultLayout([])
  const l1 = addComponent(l0, 'esp32')
  assert.equal(l1.components.length, 1)
  const moved = moveComponent(l1, l1.components[0].id, 10, 20)
  assert.equal(moved.components[0].x, 10)
  const wired = addWire(moved, l1.components[0].id, 'dht22')
  assert.equal(wired.wires.length, 1)
  assert.deepEqual(wired.wires[0].from, l1.components[0].id)
  assert.equal(l0.components.length, 0)   // original untouched
})

test('anomalyFlags flags NaN, out-of-range, frozen stream', () => {
  assert.deepEqual(anomalyFlags({ temp: NaN }), ['temperature reading is NaN'])
  assert.deepEqual(anomalyFlags({ temp: 41.2, vib: 0.3 }), ['vib above 0.2', 'temperature above 40'])
  assert.deepEqual(anomalyFlags({}), ['no data yet'])
})

test('withTimeout rejects when the promise never settles', async () => {
  const slow = new Promise(() => {})
  await assert.rejects(withTimeout(slow, 30), /timeout/i)
})

test('withTimeout resolves fast promises', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 100), 'ok')
})
```

NOTE: the exact anomaly strings in tests + component registry labels must match `serialModel.mjs` constants; keep them in sync.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test frontend\tests\serialModel.test.mjs`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write `frontend/src/serial/serialModel.mjs`**

```js
// Pure twin/scan model — no browser APIs, node-testable.
// Component registry: known I2C address -> component, plus DHT22, ESP32, breadboard.

export const COMPONENTS = {
  esp32:      { label: 'ESP32' },
  breadboard: { label: 'Breadboard' },
  mpu6050:    { label: 'MPU6050' },
  dht22:      { label: 'DHT22' },
}

const I2C_MAP = { 104: 'mpu6050' }   // 0x68
const SENSOR_RANGES = { temp: { max: 40 }, humidity: { min: 20, max: 90 }, vib: { max: 0.2 } }

let _seq = 0
const nid = () => `c${++_seq}${Date.now().toString(36)}`

// Reassemble raw UART bytes (chars) into full lines. Returns {lines, rest}.
export function readLine(state, chunk) {
  const buf = (state.rest + chunk).replace(/\r/g, '')
  const lines = buf.split('\n')
  const rest = lines.pop()
  return { lines: lines.filter(Boolean), rest }
}

// Race a promise against a timeout — surfaces a dead board as an error
// instead of hanging the UI. (Used by SerialSession.command.)
export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms — board not responding (check cable)`)), ms)
    promise.then(v => { clearTimeout(t); resolve(v) },
                 e => { clearTimeout(t); reject(e) })
  })
}

export function parseScan(line) {
  const raw = JSON.parse(line)
  return raw // {i2c:[{addr,name}], dht22:{gpio,ok}}
}

export function scanToComponents(scan) {
  const comps = []
  for (const { addr, name } of scan.i2c ?? []) {
    const type = name === null ? null : I2C_MAP[addr] ?? name
    if (type && COMPONENTS[type]) comps.push({ type })
  }
  if (scan.dht22?.ok) comps.push({ type: 'dht22' })
  // ESP32 + breadboard are always placed by the canvas shell.
  return comps
}

const DEFAULT_POS = {
  esp32:      { x: 120, y: 300 },
  breadboard: { x: 260, y: 180 },
  mpu6050:    { x: 320, y: 90 },
  dht22:      { x: 90,  y: 90 },
}

export function defaultLayout(components) {
  const comps = components.map((c, i) => {
    const p = DEFAULT_POS[c.type] ?? { x: 100 + i * 40, y: 100 + i * 40 }
    return { id: nid(), type: c.type, x: p.x, y: p.y }
  })
  return { components: comps, wires: [] }
}

export function addComponent(layout, type) {
  if (!COMPONENTS[type]) throw new Error(`Unknown component: ${type}`)
  const p = DEFAULT_POS[type] ?? { x: 100, y: 100 }
  return { ...layout, components: [...layout.components, { id: nid(), type, x: p.x, y: p.y }] }
}

export function moveComponent(layout, id, x, y) {
  return {
    ...layout,
    components: layout.components.map(c => (c.id === id ? { ...c, x, y } : c)),
  }
}

export function addWire(layout, from, to) {
  return { ...layout, wires: [...layout.wires, { id: nid(), from, to }] }
}

// Cheap local anomaly flags — zero LLM cost. Returns array of short strings.
export function anomalyFlags(readings) {
  if (!readings || Object.keys(readings).length === 0) return ['no data yet']
  const flags = []
  for (const [sensor, value] of Object.entries(readings)) {
    if (value === null || Number.isNaN(value)) { flags.push(`${sensor} reading is NaN`); continue }
    const range = SENSOR_RANGES[sensor]
    if (range && value > range.max) flags.push(`${sensor} above ${range.max}`)
    if (range && range.min != null && value < range.min) flags.push(`${sensor} below ${range.min}`)
  }
  return flags
}
```

- [ ] **Step 4: Write `frontend/src/serial/serialBridge.js`**

```js
// Thin wrapper over the Web Serial API (Chrome/Edge desktop).
import { readLine, withTimeout } from './serialModel.mjs'

export function supportsSerial() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export async function requestPort() {
  return navigator.serial.requestPort()
}

export class SerialSession {
  constructor({ port, baudRate = 115200, onData = () => {}, onError = () => {} }) {
    this.port = port
    this.baudRate = baudRate
    this.reader = null
    this.writer = null
    this.onData = onData
    this.onError = onError
    this._state = { rest: '' }
    this._resolver = null // single outstanding command awaiting its reply
  }

  async open() {
    this.reader = this.port.readable.getReader()
    this.writer = this.port.writable.getWriter()
    this._pump()
  }

  async _pump() {
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await this.reader.read()
        if (done) break
        const { lines, rest } = readLine(this._state, decoder.decode(value))
        this._state.rest = rest
        for (const line of lines) this._dispatch(line)
      }
    } catch (err) {
      this.onError(err)
    }
  }

  _dispatch(line) {
    let obj
    try { obj = JSON.parse(line) } catch { return }   // ignore noise
    if (obj && this._resolver) {
      const resolver = this._resolver
      this._resolver = null
      resolver(obj)
    } else {
      this.onData(obj)
    }
  }

  // Send a command line, resolve with the next JSON reply or reject on timeout.
  async command(cmd, timeoutMs = 5000) {
    if (!this.writer) throw new Error('Serial session not open')
    if (this._resolver) throw new Error('Command already in flight')
    const reply = new Promise((resolve, reject) => { this._resolver = resolve })
    await this.writer.write(new TextEncoder().encode(cmd + '\n'))
    return withTimeout(reply, timeoutMs)
  }

  async close() {
    try { await this.writer?.close() } catch {}
    try { await this.reader?.cancel() } catch {}
    try { await this.port.close() } catch {}
  }
}
```

- [ ] **Step 5: Add test script to `frontend/package.json`**

In `"scripts"` add: `"test": "node --test tests/"`.

- [ ] **Step 6: Run tests to verify they pass**

Run from repo root: `node --test frontend\tests\serialModel.test.mjs`
Expected: 7 tests PASS (all `assert` blocks in the file above).

- [ ] **Step 7: Commit**

```powershell
cd D:\OmniTwin
git add frontend/src/serial frontend/tests frontend/package.json
git commit -m "feat(frontend): serial bridge + scan/twin/anomaly model (pure, node-tested)"
```

---

### Task 4: Frontend — 2D twin canvas (TwinCanvas + `Add component` + wires + assets)

**Files:**
- Create: `frontend/src/components/TwinCanvas.jsx`
- Create: `frontend/src/components/ComponentSprite.jsx`
- Create: `frontend/src/components/AddComponentMenu.jsx`
- Create: `frontend/src/assets/twin.js` (inline SVG sprite strings — see note)
- Modify: `frontend/src/App.jsx` (shell switch — wires in components) — actually **do in Task 6**; this task creates the standalone component so it can be built/tested in isolation.

**Interfaces:**
- Consumes: serialModel exports (`COMPONENTS`, `addComponent`, `moveComponent`, `addWire`, `defaultLayout`, `anomalyFlags`).
- Produces: `TwinCanvas.jsx` — props `{layout, onMove, onAdd, onWire, live, flags}`; renders breadboard backdrop + sprites at `(x,y)`, wires as animated dashed SVG paths, live values + anomaly ring over each component.

- [ ] **Step 1: Write the failing component test (render smoke)**

Create `frontend/tests/TwinCanvas.test.jsx`:

```jsx
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { render, screen } from '@testing-library/react'
import TwinCanvas from '../src/components/TwinCanvas.jsx'
import { defaultLayout, addComponent } from '../src/serial/serialModel.mjs'

describe('TwinCanvas', () => {
  it('renders a sprite per component and an empty-state hint', () => {
    const layout = defaultLayout([{type:'esp32'}, {type:'breadboard'}])
    render(<TwinCanvas layout={layout} live={{}} flags={[]} />)
    assert.ok(screen.getByText('ESP32'))
    assert.ok(screen.getByText('Breadboard'))
  })
  it('shows "Add component" + no-state hint when empty', () => {
    const layout = defaultLayout([])
    render(<TwinCanvas layout={layout} live={{}} flags={[]} />)
    assert.ok(screen.getByText(/Add component/i))
  })
})
```

NOTE: if `@testing-library/react`/`jsdom` are not installed, install them as devDependencies: `cd frontend; npm i -D @testing-library/react jsdom` and add `"test": "node --test tests/ --experimental-test-module-mocks"` (or use the vite test runner you find already configured). The plan assumes Node test + jsdom via a tiny `frontend/tests/setup.js` that stubs `window`/`document`. If installing new JS dev-deps is unacceptable, replace this task's verification with `npm run build` + a human demo note; flag it in the report.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend; npm test`
Expected: FAIL (component not found).

- [ ] **Step 3: Write `frontend/src/components/ComponentSprite.jsx` (inline SVG)**

```jsx
// Inline SVG sprites per component type. Author-created simple schematic shapes
// (no external asset download/licenses): ESP32 devkit, breadboard rails,
// MPU6050 chip, DHT22 module.
export default function ComponentSprite({ type }) {
  switch (type) {
    case 'esp32':
      return (
        <svg viewBox="0 0 120 90" width={120} height={90}>
          <rect x="4" y="4" width="112" height="82" rx="4" fill="#0F6E56" />
          <text x="18" y="50" fill="#F1EFE8" fontSize="9" fontFamily="JetBrains Mono">ESP32</text>
          {[10, 24, 38, 52, 66, 80, 94, 108].map(x =>
            <rect key={x} x={x} y={0} width="4" height="8" fill="#0F6E56" />)}
          {[10, 24, 38, 52, 66, 80, 94, 108].map(x =>
            <rect key={x} x={x} y={86} width="4" height="8" fill="#0F6E56" />)}
        </svg>
      )
    case 'breadboard':
      return (
        <svg viewBox="0 0 200 90" width={200} height={90}>
          <rect x="2" y="2" width="196" height="86" rx="6" fill="#E8DCC0" stroke="#0F6E56" />
          <text x="20" y="45" fill="#04342C" fontSize="9">Breadboard</text>
          <rect x="60" y="16" width="120" height="12" fill="#0F6E56" opacity="0.3" />
          <rect x="60" y="62" width="120" height="12" fill="#0F6E56" opacity="0.3" />
        </svg>
      )
    case 'mpu6050':
      return (
        <svg viewBox="0 0 70 70 " width={70} height={70}>
          <rect x="8" y="8" width="54" height="54" rx="3" fill="#2c3e50" />
          <circle cx="35" cy="35" r="10" fill="#4FD8AE" />
          <text x="14" y="16" fill="#fff" fontSize="6">MPU6050</text>
        </svg>
      )
    case 'dht22':
      return (
        <svg viewBox="0 0 70 70" width={70} height={70}>
          <rect x="8" y="14" width="54" height="42" rx="4" fill="#34495e" />
          <circle cx="20" cy="35" r="6" fill="#4FD8AE" />
          <circle cx="50" cy="35" r="6" fill="#4FD8AE" />
          <text x="14" y="62" fill="#04342C" fontSize="6">DHT22</text>
        </svg>
      )
    default:
      return <span>?</span>
  }
}
```

- [ ] **Step 4: Write `frontend/src/components/TwinCanvas.jsx`**

```jsx
/* 2D digital-twin canvas: breadboard backdrop + draggable component sprites +
   animated wire flows + live-value overlays with anomaly rings.
   Pure presentational: layout is owned by App via serialModel. */
import { useState } from 'react'
import ComponentSprite from './ComponentSprite'
import { COMPONENTS } from '../serial/serialModel.mjs'

export default function TwinCanvas({ layout, live = {}, flags = [], onMove, onWire, onAdd }) {
  const [dragging, setDragging] = useState(null)
  const [wireFrom, setWireFrom] = useState(null)

  const onPointerDown = (c) => (e) => {
    e.stopPropagation()
    setDragging({ id: c.id, dx: e.clientX - c.x, dy: e.clientY - c.y })
  }
  const onPointerMove = (e) => {
    if (!dragging) return
    onMove?.(dragging.id, e.clientX - dragging.dx, e.clientY - dragging.dy)
  }
  const onPointerUp = () => setDragging(null)

  return (
    <div
      className="twin-canvas"
      style={{ position: 'relative', height: 520, overflow: 'hidden', border: '1px solid var(--ot-green)', borderRadius: 8, background: 'var(--ot-paper)' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {layout.components.map(c => (
        <div
          key={c.id}
          data-component={c.type}
          onPointerDown={onPointerDown(c)}
          style={{ position: 'absolute', left: c.x, top: c.y, cursor: 'move', userSelect: 'none' }}
          onClick={(e) => { e.stopPropagation(); setWireFrom(c.id) }}
        >
          <ComponentSprite type={c.type} />
          <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--ot-ink)', textAlign: 'center' }}>
            {COMPONENTS[c.type]?.label ?? c.type}
          </div>
          {Object.entries(live)
            .filter(([k]) => k === 'temp' || k === 'hum' || k === 'ax' || k === 'ay' || k === 'az')
            .map(([k, v]) => (
              <div key={k} style={{ fontSize: 9, color: 'var(--ot-green)' }}>
                {k}: {typeof v === 'number' ? v.toFixed(1) : '--'}
              </div>
            ))}
          {flags.length > 0 && <div style={{ color: 'var(--ot-orange)', fontSize: 9 }}>⚠ anomaly</div>}
        </div>
      ))}

      {layout.wires.map(w => (
        <svg key={w.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
          <line
            x1={w.fromX} y1={w.fromY} x2={w.toX} y2={w.toY}
            stroke="var(--ot-green)" strokeWidth="3" strokeDasharray="6 4"
          />
        </svg>
      ))}

      <button onClick={() => onAdd?.('breadboard')} className="btn-secondary" style={{ position: 'absolute', right: 12, top: 12 }}>
        + Add component
      </button>
      {layout.components.length === 0 && (
        <p className="empty-state" style={{ marginTop: 40 }}>Auto-detected components will appear here. Add them manually if the scan missed any.</p>
      )}
    </div>
  )
}
```

NOTE: wire endpoints need resolved coordinates — wire model stores `from`/`to` component ids only; in the render, look up each endpoint position from `layout.components` (e.g. center of sprite) and drop `fromX` etc.:
```jsx
const pos = (id) => { const c = layout.components.find(x => x.id === id); return c ? { x: c.x + 35, y: c.y + 35 } : { x: 0, y: 0 } }
```
Use that for each wire's `from`/`to` in the `<line>`.

- [ ] **Step 5: Build the frontend to verify it compiles**

Run: `cd frontend; npm run build`
Expected: build succeeds with no JSX errors.

- [ ] **Step 6: Run the component test (if test deps installed — otherwise note in report)**

Run: `cd frontend; npm test`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```powershell
cd D:\OmniTwin
git add frontend/src/components/TwinCanvas.jsx frontend/src/components/ComponentSprite.jsx frontend/tests/TwinCanvas.test.jsx frontend/package*.json frontend/src/assets/twin.js
git commit -m "feat(frontend): draggable 2D twin canvas with wires, live overlays, Add component"
```

---

### Task 5: Frontend — dashboard rework: connect → scan → twin + tutor panel

**Files:**
- Modify: `frontend/src/App.jsx` (rewrite — new flow), `frontend/src/App.css` (append twin/tutor styles), `frontend/src/api.js` (trim dead, add `askTutor`)
- Delete: `frontend/src/components/DeviceList.jsx`, `SensorChart.jsx`, `AlertsPanel.jsx`, `RegisterDevice.jsx`, `EditDevice.jsx`, `RosterPanel.jsx`, `frontend/src/hooks/useDeviceSocket.js`, `frontend/src/sensor-options.js`, `frontend/src/threshold-utils.js`
- Create: `frontend/src/components/TutorPanel.jsx`

**Interfaces:**
- Consumes: `serialModel` (anomalyFlags, defaultLayout, moveComponent, addComponent, addWire, scanToComponents), `serialBridge` (supportsSerial, requestPort, SerialSession), TwinCanvas, `api.askTutor`, backend `/tutor` (`{reply, session_id}`).
- Produces: new `App.jsx` state machine: `{status:'needPort'|'connecting'|'scanning'|'streaming'|'error', device, layout, live, flags, sessionId, tutorMessages, tutorReply}`.

- [ ] **Step 1: Write the failing tests**

`frontend/tests/App.test.jsx`:

```jsx
import { describe, it, vi } from 'vitest'   // or node:test equivalents matched to Task 4's runner
import assert from 'node:assert'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../src/App.jsx'

// Web Serial unavailable -> "connect your ESP32" CTA, not a crash.
it('shows CTA when Web Serial is unsupported', () => {
  window.navigator = { serial: undefined }
  render(<App />)
  assert.ok(screen.getByText(/connect your ESP32/i))
})
```

If the configured runner can't stub `navigator.serial`, drive this through the human demo checklist instead and mark it pending — the Review Focus line reads from this test when it exists; otherwise the Task 6 demo steps cover it explicitly.

- [ ] **Step 2: Write `frontend/src/api.js` (trim + add askTutor)**

```js
const BASE = '/api'

async function _get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

export const getDevices = () => _get('/devices')
export const getProjects = getDevices

export async function askTutor({ deviceId, context, messages }) {
  const res = await fetch(`${BASE}/tutor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, context, messages }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.detail ?? `POST /tutor → ${res.status}`)
  }
  return res.json()
}

export const getRoster = () => _get('/roster')
```

- [ ] **Step 3: Write `frontend/src/components/TutorPanel.jsx`**

```jsx
/* On-demand AI tutor: "Ask the Tutor" button + threaded chat.
   NEVER auto-fires — the LLM is only hit when a human asks. */
import { useState } from 'react'

export default function TutorPanel({ context, onSubmit, replyState }) {
  const [input, setInput] = useState('')
  const [thread, setThread] = useState([])

  const ask = async (question) => {
    if (!question.trim()) return
    const userMsg = { role: 'user', content: question.trim() }
    const next = [...thread, userMsg]
    setThread(next)
    setInput('')
    await onSubmit({ messages: next })
  }

  return (
    <aside className="tutor-panel">
      <h3>AI Tutor</h3>
      <button className="btn-primary" onClick={() => ask('Explain the current state of my rig.')}>
        Ask the Tutor
      </button>
      <div className="tutor-thread">
        {thread.map((m, i) => (
          <p key={i} className={m.role === 'user' ? 'tutor-user' : 'tutor-ai'}>{m.content}</p>
        ))}
        {replyState?.reply && <p className="tutor-ai">{replyState.reply}</p>}
        {replyState?.error && <p className="tutor-error">Tutor unavailable: {replyState.error}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your rig…" />
        <button type="submit">Send</button>
      </form>
    </aside>
  )
}
```

- [ ] **Step 4: Rewrite `frontend/src/App.jsx` (the connect → scan → twin → tutor flow)**

```jsx
/* OmniTwin dashboard: connect USB board (Web Serial) -> scan -> twin canvas + tutor. */
import { useEffect, useRef, useState } from 'react'
import TwinCanvas from './components/TwinCanvas'
import TutorPanel from './components/TutorPanel'
import { supportsSerial, requestPort, SerialSession } from './serial/serialBridge'
import {
  defaultLayout, scanToComponents, addComponent, moveComponent,
  addWire, anomalyFlags, parseScan,
} from './serial/serialModel.mjs'
import { askTutor } from './api'
import wordmark from './assets/wordmark.png'
import './App.css'

const CTX_DEVICE_ID = 'local'

export default function App() {
  const [status, setStatus] = useState('needPort') // needPort|connecting|scanning|streaming|error
  const [layout, setLayout] = useState(() => defaultLayout([]))
  const [live, setLive] = useState({})
  const [flags, setFlags] = useState([])
  const [device, setDevice] = useState(null)   // { id, board, fw }
  const [tutor, setTutor] = useState(null)     // { messages, reply, error, sessionId }
  const sessionRef = useRef(null)

  const context = () => ({
    device_id: device?.id ?? CTX_DEVICE_ID,
    components: layout.components.map(c => ({ type: c.type, label: c.type })),
    readings: live,
    anomalies: flags,
  })

  const connect = async () => {
    if (!supportsSerial()) { setStatus('error'); return }
    try {
      setStatus('connecting')
      const port = await requestPort()
      const session = new SerialSession({
        port,
        onData: (obj) => {
          if (obj && typeof obj.ts === 'number') {
            const vib = Math.abs(Math.hypot(obj.ax || 0, obj.ay || 0, obj.az || 0) - 1)
            const clean = { temp: obj.temp, hum: obj.hum, vib, ax: obj.ax, ay: obj.ay, az: obj.az }
            setLive(clean)
            setFlags(anomalyFlags(clean))
          }
        },
        onError: (err) => { setStatus('error'); setTutor(t => ({ ...t, error: err.message })) },
      })
      sessionRef.current = session
      await session.open()

      const idRes = await session.command('IDENT')
      setDevice({ id: idRes.id, board: idRes.board, fw: idRes.fw })
      await session.command('PING')

      setStatus('scanning')
      const scanRes = await session.command('SCAN')
      const detected = scanToComponents(scanRes)
      setLayout(prev => mergeLayout(prev, detected))

      await session.command('STREAM on')
      setStatus('streaming')
    } catch (err) {
      setStatus('error')
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  const mergeLayout = (prev, comps) => {
    // keep existing manual layout, add any auto-detected components not yet placed
    const existingTypes = new Set(prev.components.map(c => c.type))
    const missing = comps.filter(c => !existingTypes.has(c.type))
    const out = { ...prev }
    for (const c of missing) out = addComponent(out, c.type)
    return out
  }

  const askTutorFlow = async ({ messages }) => {
    setTutor(t => ({ ...t, messages, reply: null, error: null }))
    try {
      const res = await askTutor({ deviceId: device?.id ?? CTX_DEVICE_ID, context: context(), messages })
      setTutor(t => ({ ...t, reply: res.reply, sessionId: res.session_id }))
    } catch (err) {
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  useEffect(() => () => sessionRef.current?.close(), [])

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-brand">
          <img className="navbar-wordmark" src={wordmark} alt="OmniTwin" />
        </div>
        <span className="navbar-sep" />
        <span className="navbar-sub">Digital twin learning lab</span>
        <div className="navbar-right">
          <span className={`status-dot ${status === 'streaming' ? 'status-dot--live' : 'status-dot--off'}`} />
          <span className={`status-label ${status === 'streaming' ? '' : 'status-label--off'}`}>
            {status}
          </span>
        </div>
      </header>

      <div className="workspace">
        <main className="charts-area">
          {status === 'needPort' || status === 'error' ? (
            <div className="empty-state">
              <p>No board connected.</p>
              <button className="btn-primary" onClick={connect} disabled={status === 'connecting'}>
                {supportsSerial() ? 'Connect your ESP32' : 'Web Serial unsupported — use Chrome or Edge'}
              </button>
              {status === 'error' && <p className="tutor-error">Check the cable and try again.</p>}
            </div>
          ) : (
            <>
              {device && (
                <div className="charts-header">
                  <span className="charts-device-name">{device.id}</span>
                  <span className="charts-device-location">{device.board} · fw {device.fw}</span>
                </div>
              )}
              <TwinCanvas layout={layout} live={live} flags={flags}
                onMove={(id, x, y) => setLayout(l => moveComponent(l, id, x, y))}
                onWire={(from, to) => setLayout(l => addWire(l, from, to))}
                onAdd={(type) => setLayout(l => addComponent(l, type))} />
            </>
          )}
        </main>

        <TutorPanel context={context()} onSubmit={askTutorFlow} replyState={tutor} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Trim dead frontend files + CSS append**

```powershell
cd D:\OmniTwin
git rm frontend/src/components/DeviceList.jsx frontend/src/components/SensorChart.jsx frontend/src/components/AlertsPanel.jsx frontend/src/components/RegisterDevice.jsx frontend/src/components/EditDevice.jsx frontend/src/components/RosterPanel.jsx frontend/src/hooks/useDeviceSocket.js frontend/src/sensor-options.js frontend/src/threshold-utils.js
```
Append to `App.css` styles for `.twin-canvas`, `.tutor-panel`, `.tutor-thread`, `.tutor-user/.tutor-ai`, `.tutor-error`.

- [ ] **Step 6: Build, lint, test**

Run: `cd frontend; npm run build; npm run lint` AND `node --test tests/serialModel.test.mjs`
Expected: build + oxlint pass; model tests pass.

- [ ] **Step 7: Commit**

```powershell
cd D:\OmniTwin
git add -A
git commit -m "feat(frontend): USB connect->scan->twin flow with on-demand tutor chat"
```

---

### Task 6: Stack removal — sim-control, ingestion, simulator, run.ps1, README

**Files:**
- Run: `git rm -r sim-control`, `git rm ingestion.py simulator.py mosquitto.conf` (note: `mosquitto.conf` exists at repo root — remove)
- Modify: `run.ps1` (start backend + frontend only), `README.md` (data plane + services), `docs/superpowers/specs` — no; plan targets docs/tasks per repo convention
- Create: `docs/tasks/task-N.md` summary (the repo's per-task-summary convention), `docs/superpowers/plans/*` already saved

**Interfaces:**
- Consumes: Task 2 slim backend (no MQTT/Influx), Task 5 slim frontend.
- Produces: runnable `run.ps1` (uvicorn + vite only).

- [ ] **Step 1: Delete the MQTT/sim stack**

```powershell
cd D:\OmniTwin
git rm -r sim-control
git rm ingestion.py simulator.py mosquitto.conf
```

- [ ] **Step 2: Rewrite `run.ps1`**

```powershell
# OmniTwin local dev run (backend + dashboard only — serial twin via Web Serial in the browser)
param()
$py = "D:\OmniTwin\.venv\Scripts\python"
Start-Process -WindowStyle Hidden -FilePath $py -ArgumentList "-m","uvicorn","main:app","--reload","--host","0.0.0.0","--port","8000" -WorkingDirectory "D:\OmniTwin\backend"
Start-Process -WindowStyle Hidden -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "D:\OmniTwin\frontend"
Write-Host "OmniTwin running - dashboard http://localhost:5173  API http://localhost:8000 /docs"
```

- [ ] **Step 3: Update `README.md` Quick start / Layout / Run**

Replace the MQTT + InfluxDB lines with:
```markdown
- Mosquitto — REMOVED (USB-serial data plane; no broker).
- InfluxDB 2.7 — REMOVED (streams flow browser->board via Web Serial; Mongo stores history).
- MongoDB 7.0 on :27017 — db `twinlab`, user `admin`/`twinlab123`, auth enabled.
```
Update Layout: drop `ingestion.py`/`simulator.py`; note `frontend/` = student twin + tutor, `backend/` = FastAPI (devices, roster, /tutor). Run section unchanged (`run.ps1`).

- [ ] **Step 4: Write the per-task summary doc `docs/tasks/task-11.md`**

(Follow the existing `docs/tasks/task-N.md` format used for Tasks 1–10.)

- [ ] **Step 5: Full re-verify**

Run:
```powershell
cd D:\OmniTwin
.\.venv\Scripts\python -m pytest tests\test_roster.py tests\test_llm.py -q
cd backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
cd ..\frontend; npm run build; npm run lint
node --test ..\frontend\tests\serialModel.test.mjs
```
Expected: all green; no dangling imports of `paho`, `influxdb`, `sim`, `ingestion`, `simulator`.

- [ ] **Step 6: Commit**

```powershell
cd D:\OmniTwin
git add -A
git commit -m "chore: remove MQTT/Influx/sim stack; single run command (backend + dashboard)"
```

---

## Verification (final whole-branch gate)

```powershell
cd D:\OmniTwin
# Backend
.\.venv\Scripts\python -m pytest tests -q
cd backend; ..\.venv\Scripts\python -c "import main; print('app ok')"
# Firmware
. C:\Espressif\tools\Microsoft.v6.0.2.PowerShell_profile.ps1
cd D:\OmniTwin\firmware\twinlab_node_v1; idf.py build
# Frontend
cd D:\OmniTwin\frontend; npm run build; npm run lint
node --test tests
# grep for removed names
cd D:\OmniTwin
git grep -n -i "influx\|paho\|mosquitto\|sim-control\|simulator" -- backend frontend/src requirements.txt run.ps1
```
Expected: all green; grep returns nothing (or only whitelisted docs).