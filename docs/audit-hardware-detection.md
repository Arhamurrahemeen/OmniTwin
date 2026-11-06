# Hardware-detection audit

Date: 2026-11-03. Read-only audit of how OmniTwin detects hardware, over the
bundled firmware (`firmware/twinlab_node_v1/main/main.c`), the Arduino sketch
(`twinlab_arduino_v1.ino`), the browser detection path (`frontend/src/registry/`,
`frontend/src/serial/`), and the source parser (`frontend/src/code/`).

Baseline, before any change:

- `node --test "frontend/tests/*.test.mjs"`: 82 / 82 pass.
- `pytest tests -q`: 14 / 14 pass.
- `firmware/probe_board_test.py` **does not run**: it exits with
  `needs pyserial`, which the repo `.venv` does not have.
- ESP-IDF v6.0.2 exists at `C:\esp\v6.0.2\esp-idf`. No `arduino-cli` exists on
  this machine, so the `.ino` cannot be compiled here.

Each finding is marked **CONFIRMED**, **REFUTED**, **PARTLY CONFIRMED**, or
**NEW** (not in the prior review).

---

## 1. Read this first: Part B conflicts with the proposed spec

Part B extends OmniTwin's own firmware with a `READ` verb and has the browser
poll the board through it. The repo's current direction says the opposite:

- `docs/superpowers/specs/2026-09-26-omnitwin-universal-discovery-and-measurement-design.md`
  - §0: *"Nothing is sold, flashed, or installed. Ever. … no firmware agent."*
  - §0.1: *"'Universal detection' therefore never needed our firmware."*
  - §4.1: *"OmniTwin never writes to a port … no write verbs exist in the serial
    layer"*, enforced by a grep test.
  - §7: *"Dropped entirely … ESP32/AVR firmware port targets … `PROBE` verb."*
- `AGENTS.md`, Repo conventions: *"no board-specific firmware is ever proposed."*

The shipped code still implements the older kit model. `App.jsx:89-95` sends
`SCAN`, `WHOAMI` and `STREAM on`, and `main.c` is the bundled node firmware.
The spec's status is **proposed**, not landed.

A `READ <addr> <reg> <len>` verb is functionally a generic I2C peek, very
close to the `PROBE` verb that §7 drops. Registry-driven polling (B3, B4)
deepens the dependency on OmniTwin's own firmware, which §0.1 says students do
not run.

Also, §4.1 claims a test enforces "no write verbs". **No such test exists.**
A grep of `frontend/tests`, `tests` and `firmware/*.py` finds none.

**This decision belongs to the project owner and is not resolved here.** If the
kit firmware is still a supported product, Part B is coherent, and the spec and
`AGENTS.md` need a note saying so. If the spec is the direction, B2 to B4 build
toward a model the spec has already dropped. B1, B5 and B6 are safety and
correctness fixes that stand either way.

---

## 2. Claim verification

### (a) Streaming is hard-coded to MPU6050 and DHT22: CONFIRMED, with one addition

- `main.c:536-583`: `stream_task` reads only the MPU handle (`mpu_r(0x3B, d, 14)`)
  and the DHT globals. Its three `printf` branches emit exactly
  `ts, temp, hum, ax, ay, az`.
- `adapters/twinlab_esp32_v1.js:46-55`: `toReading` hard-codes the same keys and
  drops any others.
- `registry.mjs`: the registry is used for identity, geometry and pins.
  `reads` is consumed only by `notReporting` (`serialModel.mjs:341-349`).
- **NEW consequence:** a new I2C entry with `reads: ["pressure"]` would not
  merely stream nothing. `notReporting` would badge it **"not reporting"
  permanently**, because `live.pressure` is always `undefined`, and
  `undefined == null` is true. The sprite looks broken even when the chip is
  fine.
- Docs overclaim:
  - `docs/Overview.md:20`: *"adding a sensor is a JSON edit rather than a
    firmware change."* This holds for identity and sprite only.
  - `docs/Overview.md:22`: *"extensible without touching firmware or JS."* This
    is false for data, because `toReading` is JS.
  - `components.json:2` (`$comment`): *"Adding a sensor = an entry here, no
    firmware or JS change."* This has the same overclaim.

### (b) `mpu_try_init` configures the chip without checking WHO_AM_I: CONFIRMED, and worse than claimed

- `main.c:185-187`: the device at 0x68 or 0x69 is accepted on an ACK alone.
- `main.c:197-198`, then `mpu_init_regs()` at `main.c:170-178`: it writes
  0x6B, 0x1A, 0x19, 0x1B and 0x1C, with no read of 0x75 anywhere in init.
- Other chips commonly found at 0x68 would receive these writes, for example a
  DS1307 or DS3231 RTC. Writing `0x00` to 0x19 and similar values to 0x1A to
  0x1C corrupts their registers. [Assumed: those register maps are
  RTC-specific and were not verified per part.]
- **NEW: `stream_task` retries this every ~1 s indefinitely**
  (`main.c:543-545`). A non-MPU chip at 0x68 never passes the readback gate, so
  it is **rewritten up to 10 times every second, forever**.
- **NEW: there is a device-handle leak on that same path.** Each failed retry
  calls `i2c_master_bus_add_device` again (`main.c:194`) and never calls
  `i2c_master_bus_rm_device`, overwriting the `mpu` handle each time. Whether
  ESP-IDF rejects a duplicate address or allocates a new handle each time was
  not verified. Either outcome is wrong.
- **NEW: `DIAG` writes to the same unidentified device.** It is gated on
  `g_mpu_dev_added`, not on `g_mpu_ready` (`main.c:454`). It writes
  `mpu_w(0x6B, …)` (`main.c:460`) even when the readback gate has failed.
- **NEW: the Arduino sketch is worse.** `twinlab_arduino_v1.ino:110-116` writes
  `PWR_MGMT_1 = 0x00` to any device that ACKs at 0x68 or 0x69, **on every
  stream frame (10 Hz)**, with no WHO_AM_I check.

### (c) A failed WHOAMI produces a phantom MPU6050: CONFIRMED, and it is pinned by tests

- `adapters/twinlab_esp32_v1.js:23`: `parseIdentity(-1)` returns `null`.
- `serialModel.mjs:294-295`: a `null` answer is stored as `whoami: null`. A
  thrown answer (timeout) drops the `whoami` key.
- `registry.mjs:391-399` (`resolveScanEntry`): with `whoami` not a number and
  `name` undefined, both paths fall through to
  `REGISTRY.i2c.find(e => e.candidateAddrs.includes(addr))`. Any device at
  0x68 or 0x69 then becomes an MPU6050.
- The behaviour is **deliberately tested as correct**, so Part B5 will invert
  these tests:
  - `frontend/tests/adapters.test.mjs:110-114`: *"still resolves when the
    WHOAMI probe fails … falls back to the address."*
  - `frontend/tests/registry.test.mjs:53-56`: `{ addr: 105 }` resolves to
    mpu6050.
  - `frontend/tests/serialModel.test.mjs:74-79`: the 1.1 shape with no `whoami`
    resolves to MPU6050.
- This contradicts the detection-canvas spec §3.2: *"address alone is not
  identity."*
- It also contradicts `docs/Overview.md:20`: *"no phantom sprite."* That claim
  holds only for addresses that no registry entry claims.

### (d) The scan ranges disagree: CONFIRMED

| Place | Range |
|---|---|
| `main.c:426` (`reply_scan`) | `0x03..0x77` (117 addresses) |
| `main.c:115` (`parse_whoami`) | `0x08..0x77` |
| `twinlab_arduino_v1.ino:72` | `8..119` (`0x08..0x77`) |
| `AGENTS.md:93`, `adapters/…:11`, `verify_node.py:107` | "117 addresses" / `0x03..0x77` |

ESP32 SCAN can therefore report an address in `0x03..0x07` that its own
`WHOAMI` then rejects. Those addresses are reserved in the I2C spec. Changing
to `0x08..0x77` (112 addresses) also means updating the "117" text in
`AGENTS.md`, the adapter comment, and `verify_node.py`.

### (e) Pins are fixed in firmware, and the reference wiring is the firmware's: CONFIRMED, and wrong for Arduino

- `main.c:38-39,45`: SDA=21, SCL=22, DHT=4, compile-time constants.
- `components.json:44-46` hard-codes `gpio: 21/22/4` on the esp32 entry.
- `adapters/…:26-30` defines `referenceWiring`. Its own comment
  (`adapters/…:23-25`) already says this is the firmware's wiring, not the
  student's.
- **NEW: the wiring is wrong for the Arduino sketch.** The `.ino` replies to
  `IDENT` with `board:"arduino-uno"`. `parseIdent` (`adapters/…:32-34`) checks
  only `id` and `board`, so the **ESP32 adapter accepts the Uno**. The canvas
  then labels an `esp32` sprite with GPIO21/22, while the Uno's `Wire.begin()`
  uses A4/A5.

---

## 3. Other findings in the firmware and sketch

- **The `.ino` may not compile on AVR.** `for (byte mpuAddr : {0x68, 0x69})`
  (`.ino:110`) needs `std::initializer_list`, which the AVR core does not ship.
  [Assumed. This is unverified because no `arduino-cli` is installed.]
- **The `.ino` diverges from the protocol:**
  - `STREAM on` and `STREAM off` reply `{"ok":true}`, while ESP32 replies
    `{"stream":"on"}`.
  - The sketch does not answer `DIAG` or unknown commands, so those time out.
  - `ts` is `millis()`, not epoch milliseconds.
  - The accelerometer uses the ±2 g scale (16384 LSB/g), while ESP32 uses ±8 g.
    Both are correct for their own setup.
- **`WHOAMI` parsing in the `.ino` uses `String.toInt()`**, which does not
  accept `0x` hex. The browser sends decimal, so this is fine today.

---

## 4. What `parser.mjs` actually detects

The confidence tiers are `strong`, `weak` and `none` (`parser.mjs:57,63,213`).
Overall confidence is `strong` if **any** single finding is strong.

Each scenario below was run through `parseProject` and `findingsToLayout`, and
the output was checked.

| Protocol | Detected from | Tier | Canvas result |
|---|---|---|---|
| I2C pins | `Wire.begin(a, b)` (`:7,97`); ESP-IDF `.sda_io_num` / `.scl_io_num` (`:12,110`) | strong | ESP32 SDA/SCL pins relabelled |
| I2C pins | `Wire.begin()` (`:9,122`) | weak | `pins: 'default'` |
| I2C addresses | `Wire.beginTransmission` / `requestFrom` (`:11`); `i2c_master_probe` (`:13`) | inherits the **pin** tier | Part chosen by `candidateAddrs` alone (`:323`) |
| DHT | `DHT x(pin, DHT22)`, literal type only (`:15,138`) | strong | `dht22` sprite; `dht11` has no registry entry, so nothing is drawn |
| DHT | `.begin(N)` when a DHT header is included (`:16,149`) | weak | type `'dht'`, **never drawn** (not in the registry) |
| DHT | ESP-IDF: `DHT_IO`/`DHT_PIN` macro + text "DHT22" + `dht_read(`/`dht_decode(` (`:161`) | strong | Tailored to the bundled `main.c` |
| OneWire | `OneWire x(N)` (`:30,181`) | strong | type `'1wire'`, not in the registry, so nothing is drawn |
| Servo | any `.attach(N)` (`:34,190`) | strong | type `'servo'`, not in the registry, so nothing is drawn |
| GPIO | `pinMode(N, MODE)` with a **numeric literal only** (`:18,171`) | strong | Extra ESP32 pin |
| SPI | `#include <SPI.h>` only. `PATTERNS.spiBegin` (`:32`) is **defined but never used** | weak (library) | Nothing |
| UART | the first `Serial.begin(N)` only (`:24,199`) | baud only | Nothing |
| Analog | not detected (no `analogRead` / `analogWrite` / `ledc*`) | none | Nothing |

### Verified blind spots

These are the probe outputs.

1. **The canonical Adafruit DHT idiom misfires.** The input is
   `#define DHTTYPE DHT22` / `DHT dht(DHTPIN, DHTTYPE)` / `Serial.begin(115200)`.
   - Result: a DHT on **pin 115200** at weak, and no DHT sprite.
   - Cause: `dhtConstruct` requires a literal `DHT\d+`, and `dhtBegin` matches
     `Serial.begin(115200)`.
   - The bundled `twinlab_arduino_v1.ino` uses this same idiom.
2. **The Adafruit_MPU6050 library with no literal address produces no MPU
   sprite.** The `LIBRARY_HINTS` `sensor` field is never read by
   `findingsToLayout`.
3. **A DS3231 RTC at 0x68 produces `mpu6050(strong)`.** This is the parser-side
   twin of claim (c). It contradicts spec §2.2 ("declared is never presented as
   fact") and §2.3, because the address match is labelled with the confidence
   of `Wire.begin`.
4. **Macros in a header are not resolved across files.** Defines are collected
   per file (`:72-77`, `:226`), so `Wire.begin(SDA_PIN, SCL_PIN)` with pins in
   `pins.h` gives no I2C pins.
5. **ESP-IDF enum pins are missed.** `.sda_io_num = GPIO_NUM_21` resolves to
   null, and `.device_address = 0x68` is not matched at all. Result:
   confidence `none` and an empty canvas.
6. **Commented-out code counts as strong evidence.** `// Wire.begin(4,5)` and
   `/* pinMode(13, OUTPUT) */` were both taken as strong. Comments are never
   stripped.
7. **Named pins are missed.** `pinMode(LED, OUTPUT)` is ignored, because the
   regex takes `\d+` only even though `resolveValue` exists. `analogRead`,
   `SPI.begin()` and `Serial2.begin(…, 16, 17)` are not detected either.
8. **`DHTesp.setup(4, …)` is not detected.**
9. Other gaps:
   - Constants are recognised only as `#define NAME <number>` and
     `const int`. `const uint8_t`, `constexpr`, `#define X (21)` and
     `static const gpio_num_t` are all missed.
   - The MCU is always drawn as an ESP32 (`:304`), even for Uno code.

### Contradictions to surface (not resolved here)

- **Overview.md vs spec:** `docs/Overview.md` §2 describes only the kit flow
  (bundled firmware, SCAN, WHOAMI). It does not mention source-derived hardware
  or the Code tab. The proposed spec says that source derivation *is* the
  product.
- **Spec §2.3 vs `parser.mjs`:** the spec rates "explicit numeric literals" as
  strong. The parser also gives strong to resolved `#define`s, to commented-out
  code, and to address-to-part guesses.
- **Spec §4.1 vs the code:** the spec says "no write verbs" and cites an
  enforcing test. The serial layer sends `IDENT`, `SCAN`, `WHOAMI` and
  `STREAM`, and no such test exists.
- **"Vault":** the task mentions an Obsidian vault. **None was found** in the
  repo, at depth 3 under `C:\Users\Arham`, or in `D:\` at the top level. Its
  location is needed before anything can be compared against it.

### `codeFlags.mjs` and `CodeTab.jsx`

- `codeFlags.mjs` is lint only, not detection. Several of its checks fire on
  almost every line, such as `array-bounds` `/\[\s*\w+\s*\]/` and `div-by-var`
  `/\/\s*\w+/`. The latter also matches every `//` comment. This is noise, not
  a safety issue.
- `CodeTab.jsx` opens the folder with `showDirectoryPicker({ mode: 'read' })`
  (`:22`) and never writes. That is consistent with the on-demand, no-write
  rule.
- The "derived from your source" banner from spec §2.2 exists
  (`App.jsx:231-233`).

---

## 5. Suggested Part B adjustments

These are for the project owner to decide.

- **B1:** add the same WHOAMI gate to `DIAG`'s write (`main.c:460`). Fix the
  handle leak (call `rm_device` on a failed gate). Make the same fix in the
  `.ino`, which writes `0x6B` at 10 Hz with no identification.
- **B5:** this inverts three existing tests (§2c). Parser blind spot 3 is the
  same bug on the code side, so it may belong in B5 as well.
- **B6:** also update `AGENTS.md:93`, the adapter comment, and `verify_node.py`
  ("117").
- **B2 to B4:** hold until §1 is decided.

**Outcome (2026-11-06):** the owner chose to do all of B1 to B7. §1 stays open
as a conflict with the proposed spec; both the spec and `AGENTS.md` note it.
Line numbers above describe the code as audited, before those fixes.
