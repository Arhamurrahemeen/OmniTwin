/* TwinLab hardware node — ESP32 + MPU6050 + DHT22.
 *
 * Reads the two sensors and publishes on the locked TwinLab MQTT contract
 * (CLAUDE.md §4):
 *
 *     twinlab/device/<device_id>/sensor/<sensor>
 *     { "value": 24.6, "unit": "C", "ts": <unix epoch ms> }
 *
 * device_id is derived from the chip's MAC at boot ("TL-<6 hex chars>"), not
 * a compile-time constant — the same binary + secrets.h works unedited on
 * any number of boards.
 *
 * Published sensors: temperature, humidity (every 5 s), accel_x/y/z, vibration
 * (every 1 s). Thresholds and alerting live in the backend, not here.
 *
 * Sensor-reading code (I2C bus setup, MPU register config, the DHT22 bit-bang
 * decoder, the vibration EMA) is carried over verbatim from the bench-tested
 * standalone firmware. The WiFi-station + SNTP + MQTT path replaces that
 * firmware's SoftAP + local web demo.
 *
 * MQTT is a minimal publish-only 3.1.1 client hand-rolled over an lwip TCP
 * socket (~70 lines below) — not esp-mqtt. Rationale: esp-mqtt ships as a
 * git submodule / managed component that isn't populated in every IDF 6.0
 * install, and a QoS-0 publish-only client to a local broker needs nothing
 * more than CONNECT + PUBLISH. No subscribe, no QoS 1/2, no TLS.
 */

#include <assert.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lwip/netdb.h"
#include "lwip/sockets.h"
#include "nvs_flash.h"

#include "secrets.h"

#define SDA_IO   21
#define SCL_IO   22
#define MPU_ADDR 0x68

/* DHT22 data pin. Needs a 4.7k-10k pull-up to 3V3 on the line; the internal
   pull-up is enabled too but is too weak to rely on alone. */
#define DHT_IO        4
#define DHT_PERIOD_MS 2000

#define SAMPLE_HZ 100
#define ACC_LSB   4096.0f   /* +-8 g */

#define DHT_PUBLISH_MS   5000
#define ACCEL_PUBLISH_MS 1000

/* "TL-" + 6 hex chars, always exactly this long. */
#define DEVICE_ID_MAXLEN 9

static const char *TAG = "twinlab";

static i2c_master_dev_handle_t mpu;
static int mqtt_sock = -1;
static char g_device_id[DEVICE_ID_MAXLEN + 1];

static float g_temp = NAN, g_hum = NAN;  /* last good DHT reading; NAN until first */
static float g_vib;                      /* EMA of accel AC magnitude, g */

static esp_err_t mpu_w(uint8_t reg, uint8_t val)
{
    uint8_t b[2] = { reg, val };
    return i2c_master_transmit(mpu, b, 2, 100);
}

static esp_err_t mpu_r(uint8_t reg, uint8_t *buf, size_t n)
{
    return i2c_master_transmit_receive(mpu, &reg, 1, buf, n, 100);
}

/* A cold-boot I2C bus can still be flaky right after i2c_master_probe()
   succeeds (observed: WHO_AM_I read failing on the same boot as a slow
   probe). An unretried failed write here leaves the MPU6050 asleep with
   accel frozen at 0 for the whole session, so retry each init write until
   the device ACKs it — same pattern as the probe retry below. */
static void mpu_w_retry(uint8_t reg, uint8_t val)
{
    while (mpu_w(reg, val) != ESP_OK) {
        ESP_LOGW(TAG, "mpu init write 0x%02X=0x%02X failed, retrying", reg, val);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

/* Boot-time sanity check. A powered breakout holds SDA/SCL up through its
   onboard 4.7k resistors, which beat the internal ~45k pull-down. No pull-up
   means either no power to the module or the wire isn't connected. */
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

/* ---- DHT22 ------------------------------------------------------------- */

/* Single-wire sensor. Pull the line low >1 ms to request a sample, release,
   then the DHT sends 40 bits back-to-back where the HIGH pulse width is the
   bit: ~26 us = 0, ~70 us = 1. The whole exchange is ~5 ms and the DHT22
   won't answer more than once every 2 s, so a short critical section is fine. */

static portMUX_TYPE dht_mux = portMUX_INITIALIZER_UNLOCKED;

/* Pure decode: 5 raw bytes -> temp/hum. Split out so dht_selftest can pin the
   checksum and the signed-temperature bit without any hardware. */
static bool dht_decode(const uint8_t b[5], float *temp, float *hum)
{
    if (((b[0] + b[1] + b[2] + b[3]) & 0xFF) != b[4]) return false;
    *hum = ((b[0] << 8) | b[1]) * 0.1f;
    float t = (((b[2] & 0x7F) << 8) | b[3]) * 0.1f;
    *temp = (b[2] & 0x80) ? -t : t;
    return true;
}

/* Busy-wait for the line to reach `level`; returns us waited, or -1 on timeout. */
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
    esp_rom_delay_us(1200);                       /* start pulse, >1 ms */
    gpio_set_level(DHT_IO, 1);
    esp_rom_delay_us(30);
    gpio_set_direction(DHT_IO, GPIO_MODE_INPUT);  /* pull-up floats it high */

    bool ok = true;
    taskENTER_CRITICAL(&dht_mux);
    /* response: sensor low ~80 us, high ~80 us, then the data stream */
    if (dht_wait(0, 90) < 0 || dht_wait(1, 100) < 0 || dht_wait(0, 100) < 0)
        ok = false;
    for (int i = 0; ok && i < 40; i++) {
        if (dht_wait(1, 100) < 0) { ok = false; break; }  /* ~50 us low gap */
        int hi = dht_wait(0, 100);                        /* HIGH width = bit */
        if (hi < 0) { ok = false; break; }
        b[i >> 3] = (b[i >> 3] << 1) | (hi > 45);
    }
    taskEXIT_CRITICAL(&dht_mux);

    return ok && dht_decode(b, temp, hum);
}

static void dht_selftest(void)
{
    float t, h;

    /* 25.1 C, 60.2 %RH */
    uint8_t good[5] = { 0x02, 0x5A, 0x00, 0xFB, 0 };
    good[4] = (good[0] + good[1] + good[2] + good[3]) & 0xFF;
    assert(dht_decode(good, &t, &h) &&
           fabsf(t - 25.1f) < 0.05f && fabsf(h - 60.2f) < 0.05f);

    /* sign bit in byte 2 -> -10.0 C */
    uint8_t neg[5] = { 0x02, 0x5A, 0x80, 0x64, 0 };
    neg[4] = (neg[0] + neg[1] + neg[2] + neg[3]) & 0xFF;
    assert(dht_decode(neg, &t, &h) && fabsf(t + 10.0f) < 0.05f);

    /* wrong checksum must be rejected */
    uint8_t bad[5] = { 0x02, 0x5A, 0x00, 0xFB, 0xFF };
    assert(!dht_decode(bad, &t, &h));
}

static void dht_task(void *arg)
{
    gpio_set_pull_mode(DHT_IO, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(2000));   /* sensor power-on settle */
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

/* ---- wifi station --------------------------------------------------------- */

#define WIFI_CONNECTED_BIT BIT0
static EventGroupHandle_t net_evt;

static void wifi_evt(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(net_evt, WIFI_CONNECTED_BIT);
        ESP_LOGW(TAG, "wifi disconnected, retrying");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = data;
        ESP_LOGI(TAG, "got IP " IPSTR, IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(net_evt, WIFI_CONNECTED_BIT);
    }
}

static void wifi_start(void)
{
    net_evt = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_evt, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_evt, NULL, NULL));

    wifi_config_t wc = {
        .sta = {
            .ssid     = WIFI_SSID,
            .password = WIFI_PASSWORD,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "joining wifi \"%s\"", WIFI_SSID);
    xEventGroupWaitBits(net_evt, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
}

/* MQTT payload `ts` is unix epoch ms (topic contract §4). The ESP32 has no RTC,
   so pull wall-clock time from NTP once WiFi is up. */
static void sntp_sync(void)
{
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    ESP_ERROR_CHECK(esp_netif_sntp_init(&cfg));

    ESP_LOGI(TAG, "waiting for NTP");
    if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(15000)) != ESP_OK) {
        ESP_LOGW(TAG, "NTP sync timed out — ts values will be wrong until it catches up");
    }
    time_t now = time(NULL);
    ESP_LOGI(TAG, "wall clock: %s", ctime(&now));
}

/* ---- mqtt (minimal publish-only 3.1.1 over a raw TCP socket) ------------ */

/* Encode an MQTT "remaining length" varint into out (1-4 bytes). */
static int mqtt_encode_len(uint8_t *out, size_t len)
{
    int i = 0;
    do {
        uint8_t b = len & 0x7F;
        len >>= 7;
        if (len) b |= 0x80;
        out[i++] = b;
    } while (len && i < 4);
    return i;
}

static void mqtt_close(void)
{
    if (mqtt_sock >= 0) { close(mqtt_sock); mqtt_sock = -1; }
}

/* TCP connect + send CONNECT + wait for CONNACK. Sets mqtt_sock on success. */
static bool mqtt_connect_broker(void)
{
    struct addrinfo hints = { .ai_family = AF_INET, .ai_socktype = SOCK_STREAM };
    struct addrinfo *res = NULL;
    char port[8];
    snprintf(port, sizeof port, "%d", MQTT_PORT);
    if (getaddrinfo(MQTT_HOST, port, &hints, &res) != 0 || !res) {
        ESP_LOGW(TAG, "mqtt: cannot resolve %s", MQTT_HOST);
        return false;
    }

    int s = socket(res->ai_family, res->ai_socktype, 0);
    if (s < 0) { freeaddrinfo(res); return false; }

    struct timeval to = { .tv_sec = 5 };
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &to, sizeof to);
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &to, sizeof to);

    bool tcp_ok = connect(s, res->ai_addr, res->ai_addrlen) == 0;
    freeaddrinfo(res);
    if (!tcp_ok) {
        ESP_LOGW(TAG, "mqtt: TCP connect to %s:%d failed (errno %d)",
                 MQTT_HOST, MQTT_PORT, errno);
        close(s);
        return false;
    }

    /* CONNECT: var header (proto "MQTT", level 4, flags 0x02 clean-session,
       keepalive 0 → broker's inactivity timeout disabled) + payload (client id).
       A dropped connection is caught on the next publish and reconnected. */
    const char *cid = g_device_id;
    uint16_t cid_len = strlen(cid);
    uint8_t vh[] = { 0, 4, 'M', 'Q', 'T', 'T', 4, 0x02, 0, 0 };
    size_t rem = sizeof vh + 2 + cid_len;

    uint8_t pkt[64];
    int p = 0;
    pkt[p++] = 0x10;                            /* CONNECT */
    p += mqtt_encode_len(pkt + p, rem);
    memcpy(pkt + p, vh, sizeof vh); p += sizeof vh;
    pkt[p++] = cid_len >> 8; pkt[p++] = cid_len & 0xFF;
    memcpy(pkt + p, cid, cid_len); p += cid_len;

    if (send(s, pkt, p, 0) != p) { close(s); return false; }

    uint8_t ack[4];
    if (recv(s, ack, 4, 0) != 4 || ack[0] != 0x20 || ack[3] != 0x00) {
        ESP_LOGW(TAG, "mqtt: no/!CONNACK from broker");
        close(s);
        return false;
    }

    mqtt_sock = s;
    ESP_LOGI(TAG, "mqtt connected to %s:%d", MQTT_HOST, MQTT_PORT);
    return true;
}

/* ponytail: reconnect runs inline in the sensor loop, so a dead broker stalls
   MPU reads for up to the 5 s socket timeout. Fine at 1 Hz publish; move to its
   own task if the loop ever needs tighter timing. */
static void mqtt_ensure(void)
{
    static int64_t next_try_ms = 0;
    if (mqtt_sock >= 0) return;
    int64_t now = esp_timer_get_time() / 1000;
    if (now < next_try_ms) return;
    if (!mqtt_connect_broker()) next_try_ms = now + 3000;
}

static void mqtt_publish(const char *topic, const char *payload)
{
    if (mqtt_sock < 0) return;

    uint16_t tlen = strlen(topic);
    uint16_t plen = strlen(payload);
    size_t rem = 2 + tlen + plen;

    uint8_t pkt[192];
    int p = 0;
    pkt[p++] = 0x30;                            /* PUBLISH, QoS 0, no retain */
    p += mqtt_encode_len(pkt + p, rem);
    pkt[p++] = tlen >> 8; pkt[p++] = tlen & 0xFF;
    memcpy(pkt + p, topic, tlen);   p += tlen;
    memcpy(pkt + p, payload, plen); p += plen;

    if (send(mqtt_sock, pkt, p, 0) != p) {
        ESP_LOGW(TAG, "mqtt: publish failed (errno %d) — dropping socket", errno);
        mqtt_close();
    }
}

static long long epoch_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static void pub_reading(const char *sensor, float value, const char *unit)
{
    char topic[96];
    snprintf(topic, sizeof topic, "twinlab/device/%s/sensor/%s", g_device_id, sensor);

    char payload[128];
    snprintf(payload, sizeof payload,
             "{\"value\":%.2f,\"unit\":\"%s\",\"ts\":%lld}", value, unit, epoch_ms());

    ESP_LOGD(TAG, "%s -> %s", topic, payload);
    mqtt_publish(topic, payload);
}

/* Boot self-check: the MQTT length varint, the JSON wire format the ingestion
   service parses (CLAUDE.md §4), and the publish buffer headroom. A stray change
   to any of these aborts at boot instead of failing silently in the field. */
static void mqtt_selftest(void)
{
    uint8_t b[4];
    assert(mqtt_encode_len(b, 0)   == 1 && b[0] == 0x00);
    assert(mqtt_encode_len(b, 127) == 1 && b[0] == 0x7F);
    assert(mqtt_encode_len(b, 128) == 2 && b[0] == 0x80 && b[1] == 0x01);

    char buf[128];
    int n = snprintf(buf, sizeof buf,
                     "{\"value\":%.2f,\"unit\":\"%s\",\"ts\":%lld}",
                     24.6f, "C", 1734000000000LL);
    assert(n > 0 && n < (int)sizeof buf);
    assert(strcmp(buf, "{\"value\":24.60,\"unit\":\"C\",\"ts\":1734000000000}") == 0);

    size_t worst_topic_len = strlen("twinlab/device/") + DEVICE_ID_MAXLEN + strlen("/sensor/temperature");
    assert(5 + worst_topic_len + sizeof buf < 192);   /* worst-case PUBLISH fits pkt[192] */
}

/* ---- main -------------------------------------------------------------- */

void app_main(void)
{
    mqtt_selftest();
    dht_selftest();

    if (nvs_flash_init() != ESP_OK) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_efuse_mac_get_default(mac));
    snprintf(g_device_id, sizeof g_device_id, "TL-%02X%02X%02X", mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "device id: %s", g_device_id);

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
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus));

    /* Wait for the sensor rather than aborting: a missing/miswired device is a
       bus condition, not a programming error, and abort() here reboot-loops. */
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

    uint8_t who = 0;
    if (mpu_r(0x75, &who, 1) == ESP_OK) {
        ESP_LOGI(TAG, "WHO_AM_I = 0x%02X", who);
    }

    mpu_w_retry(0x6B, 0x01);   /* wake, gyro PLL clock */
    mpu_w_retry(0x1A, 0x03);   /* DLPF 44 Hz           */
    mpu_w_retry(0x19, 0x00);   /* 1 kHz sample rate    */
    mpu_w_retry(0x1B, 0x08);   /* gyro range +-500 dps */
    mpu_w_retry(0x1C, 0x10);   /* accel range +-8 g    */

    wifi_start();
    sntp_sync();

    /* Pin to APP_CPU: dht_read holds a ~5 ms critical section, keep it off the
       PRO_CPU where the WiFi/MQTT stack runs. */
    xTaskCreatePinnedToCore(dht_task, "dht", 3072, NULL, 5, NULL, 1);

    int64_t last_dht_pub = 0, last_accel_pub = 0;

    while (1) {
        mqtt_ensure();

        uint8_t d[14];
        if (mpu_r(0x3B, d, 14) == ESP_OK) {   /* accel+temp+gyro burst; only accel used */
            float ax = (int16_t)((d[0] << 8) | d[1]) / ACC_LSB;
            float ay = (int16_t)((d[2] << 8) | d[3]) / ACC_LSB;
            float az = (int16_t)((d[4] << 8) | d[5]) / ACC_LSB;

            /* Vibration proxy: how far the accel magnitude strays from 1 g,
               low-passed. ~1 s time constant at SAMPLE_HZ. */
            float amag = sqrtf(ax * ax + ay * ay + az * az);
            g_vib += (1.0f / SAMPLE_HZ) * (fabsf(amag - 1.0f) - g_vib);

            int64_t now = esp_timer_get_time() / 1000;   /* ms, monotonic */

            if (now - last_accel_pub >= ACCEL_PUBLISH_MS) {
                last_accel_pub = now;
                pub_reading("accel_x", ax, "g");
                pub_reading("accel_y", ay, "g");
                pub_reading("accel_z", az, "g");
                pub_reading("vibration", g_vib, "g");
            }

            if (now - last_dht_pub >= DHT_PUBLISH_MS) {
                last_dht_pub = now;
                if (!isnan(g_temp)) pub_reading("temperature", g_temp, "C");
                if (!isnan(g_hum))  pub_reading("humidity", g_hum, "%");
            }
        } else {
            ESP_LOGW(TAG, "mpu read failed");
        }
        vTaskDelay(pdMS_TO_TICKS(1000 / SAMPLE_HZ));
    }
}
