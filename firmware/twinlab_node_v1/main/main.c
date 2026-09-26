/* OmniTwin USB node — ESP32 + MPU6050 + DHT22.
 *
 * Line-driven JSON protocol over UART0 (the USB bridge's console line), so a
 * browser using the Web Serial API opens the same COM port the flasher uses.
 *
 *   IDENT      -> {"device":"ESP32","fw":"1.1","board":"twinlab-node","id":"TL-XXXXXX"}
 *   SCAN       -> {"i2c":[{"addr":104}],"dht22":{"gpio":4,"ok":true}}   (raw addrs; the
 *                  browser resolves part identity via WHOAMI + its registry)
 *   WHOAMI a r -> {"whoami":<int>} or -1. The browser supplies the register, so
 *                  firmware holds no per-sensor knowledge.
 *   STREAM on  -> {"stream":"on"}  then ~10 Hz  {"ts","temp","hum","ax","ay","az"}
 *   STREAM off -> {"stream":"off"} (stops the stream)
 *   PING       -> {"pong":true}
 *   DIAG       -> {"bus":{...},"probe":{...},"mpu":{"ready",addr,"read_ok"}}
 *
 * Sensor-reading code (I2C bus setup, MPU register config, the DHT22 bit-bang
 * decoder) is carried over verbatim from the bench-tested standalone firmware.
 */

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>

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
#define MPU_ADDR     0x68   /* AD0 low */
#define MPU_ADDR_ALT 0x69   /* AD0 high (some modules float it up) */

/* DHT22 data pin. Needs a 4.7k-10k pull-up to 3V3 on the line; the internal
   pull-up is enabled too but is too weak to rely on alone. */
#define DHT_IO        4
#define DHT_PERIOD_MS 2000

#define SAMPLE_HZ 100
#define ACC_LSB   4096.0f   /* +-8 g */
#define STREAM_HZ 10

#define UART_BUF 256
#define LINE_MAXLEN 128

static const char *TAG = "omnitwin";

static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t mpu;
#define DEVICE_ID_MAXLEN 9   /* "TL-" + 6 hex chars */
static char g_device_id[DEVICE_ID_MAXLEN + 1];

static float g_temp = NAN, g_hum = NAN;  /* last good DHT reading; NAN until first */
static volatile bool g_stream_on = false;
static volatile bool g_mpu_ready = false;   /* set once MPU found+configured */
static volatile bool g_mpu_r_ok = false;    /* last stream read result (DIAG visibility) */
static uint8_t g_mpu_addr = 0;              /* 0x68 or 0x69 once found */
static bool g_sda_up = false, g_scl_up = false;  /* pull-up snapshot at boot */

/* ---- protocol types + helpers (Task 1 selftests reference these) ---------- */

typedef enum { CMD_IDENT, CMD_SCAN, CMD_STREAM_ON, CMD_STREAM_OFF, CMD_PING, CMD_DIAG, CMD_WHOAMI, CMD_NONE } cmd_t;

/* Parsed "WHOAMI <addr> <reg>". ok is false for a missing, malformed, or
   out-of-range argument — the 7-bit I2C range is 0x08..0x77. */
typedef struct { int addr; int reg; bool ok; } whoami_arg_t;

static cmd_t parse_cmd(const char *line)   /* see proto_selftest */
{
    if      (strcmp(line, "IDENT") == 0)     return CMD_IDENT;
    else if (strcmp(line, "SCAN") == 0)      return CMD_SCAN;
    else if (strcmp(line, "STREAM on") == 0) return CMD_STREAM_ON;
    else if (strcmp(line, "STREAM off") == 0)return CMD_STREAM_OFF;
    else if (strcmp(line, "PING") == 0)      return CMD_PING;
    else if (strcmp(line, "DIAG") == 0)      return CMD_DIAG;
    /* Accept the bare verb and the verb+args forms, but not "WHOAMIT ...". */
    else if (strncmp(line, "WHOAMI", 6) == 0 && (line[6] == '\0' || line[6] == ' ')) return CMD_WHOAMI;
    return CMD_NONE;
}

static whoami_arg_t parse_whoami(const char *line)
{
    whoami_arg_t a = { 0, 0, false };
    char tail;
    /* "%i" takes decimal or 0x-hex; the "%c" catch rejects trailing junk.
       "WHOAMI" alone fails the %i match, so it is rejected too. */
    if (sscanf(line, "WHOAMI %i %i %c", &a.addr, &a.reg, &tail) != 2) return a;
    if (a.addr < 0x08 || a.addr > 0x77) return a;
    if (a.reg < 0 || a.reg > 0xFF) return a;
    a.ok = true;
    return a;
}

static void proto_selftest(void)
{
    assert(parse_cmd("IDENT") == CMD_IDENT);
    assert(parse_cmd("STREAM on") == CMD_STREAM_ON);
    assert(parse_cmd("STREAM off") == CMD_STREAM_OFF);
    assert(parse_cmd("PING") == CMD_PING);
    assert(parse_cmd("DIAG") == CMD_DIAG);
    assert(parse_cmd("bogus\ntrailing") == CMD_NONE);
    assert(parse_cmd("") == CMD_NONE);
    assert(parse_cmd(" STREAM on") == CMD_NONE);

    char buf[96];
    snprintf(buf, sizeof buf, "{\"pong\":true}");
    assert(strcmp(buf, "{\"pong\":true}") == 0);
    snprintf(buf, sizeof buf, "{\"stream\":\"%s\"}", "on");
    assert(strcmp(buf, "{\"stream\":\"on\"}") == 0);

    /* WHOAMI argument parsing: the browser supplies the register from the
       component registry, so firmware holds no per-sensor knowledge. */
    assert(parse_cmd("WHOAMI 104 117") == CMD_WHOAMI);
    assert(parse_cmd("WHOAMI") == CMD_WHOAMI);          /* bare verb: bad args -> whoami:-1 */
    assert(parse_cmd("WHOAMIT 104 117") == CMD_NONE);   /* not our verb */
    assert(parse_whoami("WHOAMI 104 117").ok);
    assert(parse_whoami("WHOAMI 104 117").addr == 104);
    assert(parse_whoami("WHOAMI 104 117").reg == 117);
    assert(parse_whoami("WHOAMI 104 0x75").reg == 0x75);   /* hex accepted */
    assert(!parse_whoami("WHOAMI").ok);
    assert(!parse_whoami("WHOAMI 104").ok);
    assert(!parse_whoami("WHOAMI 999 117").ok);             /* out of 7-bit range */
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

/* Find + configure the MPU6050. Returns true once it's streaming. Safe to call
   repeatedly (no-op once ready): the sensor ACKs a probe before its register
   writes are accepted — an MPU6050 ignores writes for ~100ms after power-on
   (boot, or a rail brown-out), so init may miss at boot and succeed later.
   A readback gate (not just ACK) is what makes "configured" honest. */
static void mpu_init_regs(void)
{
    mpu_w(0x6B, 0x01);   /* wake, PLL with X gyro reference */
    mpu_w(0x1A, 0x03);   /* CONFIG: DLPF 44Hz */
    mpu_w(0x19, 0x00);   /* SMPLRT_DIV: 1kHz */
    mpu_w(0x1B, 0x08);   /* GYRO_CONFIG: +-500 dps */
    mpu_w(0x1C, 0x10);   /* ACCEL_CONFIG: +-8g  (ACC_LSB=4096 assumes this) */
}

static bool mpu_try_init(void)
{
    if (g_mpu_ready) return true;

    uint8_t addr = 0;
    if (i2c_master_probe(bus, MPU_ADDR, 100) == ESP_OK)      addr = MPU_ADDR;
    else if (i2c_master_probe(bus, MPU_ADDR_ALT, 100) == ESP_OK) addr = MPU_ADDR_ALT;
    if (!addr) return false;

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = addr,
        .scl_speed_hz    = 100000,   /* 100kHz tolerates marginal breadboard wiring far better than 400kHz */
    };
    if (i2c_master_bus_add_device(bus, &dev_cfg, &mpu) != ESP_OK) return false;

    for (int i = 0; i < 10; i++) {
        mpu_init_regs();
        uint8_t pwr = 0, acc = 0;
        if (mpu_r(0x6B, &pwr, 1) == ESP_OK && pwr == 0x01 &&
            mpu_r(0x1C, &acc, 1) == ESP_OK && acc == 0x10) {
            g_mpu_addr = addr;
            g_mpu_ready = true;
            ESP_LOGI(TAG, "MPU6050 found + configured at 0x%02X", addr);
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(200));   /* wait out the chip's power-on write-lockout */
    }

    ESP_LOGE(TAG, "MPU at 0x%02X found but config never took (chip in startup lockout?)", addr);
    return false;
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
    printf("{\"device\":\"ESP32\",\"fw\":\"1.1\",\"board\":\"twinlab-node\",\"id\":\"%s\"}\n", g_device_id);
}

/* Read one WHOAMI register from an arbitrary address. The browser supplies the
   register number from its component registry, so firmware holds no per-sensor
   knowledge and adding a part needs no firmware change. -1 means "no answer",
   which the browser maps to null. */
/* ponytail: add/remove the device handle on every call instead of caching it.
   WHOAMI fires a handful of times per SCAN, never per stream row. Cache handles
   by address only if this ever shows up in a hot path. */
static void reply_whoami(int addr, int reg)
{
    i2c_device_config_t cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = (uint16_t)addr,
        .scl_speed_hz    = 100000,   /* 100kHz tolerates marginal breadboard wiring */
    };
    i2c_master_dev_handle_t dev = NULL;
    uint8_t val = 0;
    int out = -1;

    if (i2c_master_bus_add_device(bus, &cfg, &dev) == ESP_OK) {
        if (i2c_master_transmit_receive(dev, (const uint8_t[]){ (uint8_t)reg }, 1, &val, 1, 100) == ESP_OK)
            out = val;
        i2c_master_bus_rm_device(dev);
    }
    printf("{\"whoami\":%d}\n", out);
}

static void reply_scan(void)
{
    /* I2C 7-bit sweep 0x03..0x77. This reports the raw ACK'd address only —
       part identity is the browser's job, via the WHOAMI command and its
       component registry. Short probe timeout so a dead/clamped bus returns
       in ~1s instead of 12s. */
    char list[512] = "";
    int n = 0;
    for (int addr = 0x03; addr <= 0x77; addr++) {
        /* 100ms probe on the MPU addresses (a flaky MPU ACKs slowly), 25ms elsewhere. */
        int timeout = (addr == MPU_ADDR || addr == MPU_ADDR_ALT) ? 100 : 25;
        if (i2c_master_probe(bus, addr, timeout) == ESP_OK) {
            n += snprintf(list + n, sizeof list - n, "%s{\"addr\":%d}",
                          (n > 0) ? "," : "", addr);
            if (n >= (int)sizeof list - 32) break;
        }
    }
    bool dht_ok = !isnan(g_temp);   /* last-known-good sample from dht_task; don't bit-bang here */
    printf("{\"i2c\":[%s],\"dht22\":{\"gpio\":%d,\"ok\":%s},\"bus\":{\"sda_up\":%s,\"scl_up\":%s}}\n",
           list, DHT_IO, dht_ok ? "true" : "false",
           g_sda_up ? "true" : "false", g_scl_up ? "true" : "false");
}

/* Hardware visibility without printing logs on the wire (which would corrupt the
   JSON protocol). Answers "why is the MPU not streaming": pull-up state, whether
   it ACKs at each address, the last stream read result, and register readbacks
   (WHO_AM_I = chip identity, PWR_MGMT_1 = 0x00 would mean still asleep —
   I2C ACK does not mean the chip is actually converting data). */
static void reply_diag(void)
{
    bool p68 = i2c_master_probe(bus, MPU_ADDR, 100) == ESP_OK;
    bool p69 = i2c_master_probe(bus, MPU_ADDR_ALT, 100) == ESP_OK;
    int whoami = -1, pwr = -1, pwr_after = -1, cfg = -1, accel_cfg = -1, ax_raw = 0;
    if (g_mpu_ready) {
        uint8_t v;
        if (mpu_r(0x75, &v, 1) == ESP_OK) whoami = v;
        if (mpu_r(0x6B, &v, 1) == ESP_OK) pwr = v;
        mpu_w(0x6B, 0x01);                       /* force fresh wake write */
        if (mpu_r(0x6B, &v, 1) == ESP_OK) pwr_after = v;
        if (mpu_r(0x1A, &v, 1) == ESP_OK) cfg = v;
        if (mpu_r(0x1C, &v, 1) == ESP_OK) accel_cfg = v;
        uint8_t d[2];
        if (mpu_r(0x3B, d, 2) == ESP_OK) ax_raw = (int16_t)((d[0] << 8) | d[1]);
    }
    printf("{\"bus\":{\"sda_up\":%s,\"scl_up\":%s},\"probe\":{\"0x68\":%s,\"0x69\":%s},\"mpu\":{\"ready\":%s,\"addr\":%d,\"read_ok\":%s,\"whoami\":%d,\"pwr_mgmt1\":%d,\"pwr_after_wake\":%d,\"cfg\":%d,\"accel_cfg\":%d,\"ax_raw\":%d}}\n",
           g_sda_up ? "true" : "false", g_scl_up ? "true" : "false",
           p68 ? "true" : "false", p69 ? "true" : "false",
           g_mpu_ready ? "true" : "false", g_mpu_addr,
           g_mpu_r_ok ? "true" : "false",
           whoami, pwr, pwr_after, cfg, accel_cfg, ax_raw);
}

static void handle_cmd(cmd_t cmd, const char *line)
{
    switch (cmd) {
        case CMD_IDENT:      reply_ident();   break;
        case CMD_SCAN:       reply_scan();    break;
        case CMD_STREAM_ON:  g_stream_on = true;  printf("{\"stream\":\"on\"}\n");  break;
        case CMD_STREAM_OFF: g_stream_on = false; printf("{\"stream\":\"off\"}\n"); break;
        case CMD_PING:       printf("{\"pong\":true}\n"); break;
        case CMD_DIAG:       reply_diag();    break;
        case CMD_WHOAMI: {
            whoami_arg_t a = parse_whoami(line);
            if (a.ok) reply_whoami(a.addr, a.reg);
            else printf("{\"whoami\":-1}\n");
            break;
        }
        default:             printf("{\"error\":\"unknown command\"}\n"); break;
    }
}

/* Read raw bytes from UART0, assemble full lines, dispatch each. */
static void uart_task(void *arg)
{
    static char line[LINE_MAXLEN];
    static size_t len = 0;
    uint8_t buf[UART_BUF];

    while (1) {
        int got = uart_read_bytes(UART_NUM_0, buf, sizeof buf, 100);
        for (int i = 0; i < got; i++) {
            if (buf[i] == '\n' || buf[i] == '\r') {
                if (len > 0) {
                    line[len] = '\0';
                    handle_cmd(parse_cmd(line), line);
                    len = 0;
                }
            } else if (len < LINE_MAXLEN - 1) {
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
    int64_t last_mpu_try = 0;
    while (1) {
        uint8_t d[14];
        bool mpu_ok = g_mpu_ready && mpu_r(0x3B, d, 14) == ESP_OK;
        g_mpu_r_ok = mpu_ok;
        if (!mpu_ok && esp_timer_get_time() - last_mpu_try > 1000000) {
            last_mpu_try = esp_timer_get_time();
            mpu_try_init();   /* boot retry AND self-heal on flaky-wire drops */
        }
        if (g_stream_on) {
            if (mpu_ok) {
                float ax = (int16_t)((d[0] << 8) | d[1]) / ACC_LSB;
                float ay = (int16_t)((d[2] << 8) | d[3]) / ACC_LSB;
                float az = (int16_t)((d[4] << 8) | d[5]) / ACC_LSB;
                if (isnan(g_temp)) /* temp==0 placeholder means DHT not sampled yet */
                    printf("{\"ts\":%lld,\"temp\":null,\"hum\":null,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f}\n",
                           epoch_ms(), ax, ay, az);
                else
                    printf("{\"ts\":%lld,\"temp\":%.1f,\"hum\":%.1f,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f}\n",
                           epoch_ms(), g_temp, g_hum, ax, ay, az);
            } else if (!isnan(g_temp)) {
                /* MPU absent/unresponsive: still stream DHT readings. */
                printf("{\"ts\":%lld,\"temp\":%.1f,\"hum\":%.1f,\"ax\":null,\"ay\":null,\"az\":null}\n",
                       epoch_ms(), g_temp, g_hum);
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
    g_sda_up = sda_up;   /* snapshot for SCAN/DIAG replies (logs get silenced below) */
    g_scl_up = scl_up;
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

    /* This UART0 is the Web Serial protocol channel — it must carry only JSON.
       Any ESP log (DHT failures, I2C timeouts, MPU retries) can interleave
       mid-printf and corrupt the line the browser parses. Silence everything;
       state is conveyed via the JSON itself (temp:null, ok:false, ax:null). */
    esp_log_level_set("*", ESP_LOG_NONE);

    xTaskCreatePinnedToCore(uart_task,   "uart"  , 4096, NULL, 8, NULL, 0);
    xTaskCreatePinnedToCore(dht_task,    "dht"   , 3072, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(stream_task, "stream", 3072, NULL, 5, NULL, 1);

    /* MPU init is non-blocking: with no device at 0x68 the board still serves
       IDENT/SCAN/PING and streams DHT readings (spec §4 graceful degradation).
       The stream task keeps retrying (rate-limited) until the sensor appears. */
    mpu_try_init();

    ESP_LOGI(TAG, "OmniTwin USB node ready — IDENT/SCAN/STREAM/PING on UART0");
}