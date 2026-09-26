# OmniTwin Multi-Board Platform — Design Spec

Status: proposed. Architecture complete and verified against a **real SP Racing
F3 running Cleanflight 2.5.0** (§5.2). One item remains open: byte-level
verification of the MSP frame against a live capture.

## 0. What this is

OmniTwin is an engine for students to debug their own semester hardware
projects. It is not a kit. There is no parts list and no sensor is ever "in the
kit" — a protocol capability exists when a student's project needs it.

**The artifact is the student's code.** The twin exists to explain *why their
code misbehaves*: SDA in GND is why a register read returns 0; a silent sensor
is why their `ax` is `null`. This makes every board type below a *debugging*
surface, not a compatibility claim.

**One board at a time.** No port enumeration UI, no multi-session, no merged
canvas. Transport detection is a property of the single connected board, which
removes a whole category of work.

**One dashboard, two board classes**, and the UI names the mode rather than
hiding it. A student plugging in a flight controller sees *"reading telemetry,
sensors untouched"* — which is both the safety story and a demoable feature.

## 1. The constraint that shapes everything

Web Serial is a byte pipe. The browser cannot do I2C and cannot touch a GPIO, so
**all hardware discovery is delegated to the board.** The registry only
parameterises interpretation of what the board reported.

Two consequences, both settled:

- **We never flash by default.** Flashing is always an explicit, labelled action.
- **A student flashes their own project.** So OmniTwin cannot also occupy the
  board — the two cannot coexist. OmniTwin ships as a **portable C library the
  student links into their own program**, or as a prebuilt image flashed by a
  dashboard button. It is never firmware that *replaces* their work.

## 2. Two board classes, one safety rule

| | Configurable | Non-configurable |
|---|---|---|
| Examples | ESP32, Arduino | flight controllers, GPS, ELRS radio, closed modules |
| Flash ours | yes | **never** |
| Bus access | ours, after we own it | **never** |
| OmniTwin is | the **server** | a **client** |
| Reads | anything we probe | only what the device volunteers |

### 2.1 The safety rule, verbatim

> **A client adapter is inert by omission. It contains zero write commands —
> no `SET_`, no `DO_`, no `SEND`, no flash path — because a wrong write on a
> flight controller spins a motor, not just logs a bad reading.**

This is deliberately **not** a `busAccess: 'none'` metadata field. A flag is a
note; nothing stops someone adding an `MSP_SET_RAW_RC` handler in six months and
the flag stays `none` while the code arms a motor. The guarantee comes from what
the code does not contain, which survives refactoring.

**Enforcement:** a test greps every client adapter for write verbs and fails.
That is the whole mechanism — cheap, and it makes the rule permanent rather than
aspirational.

### 2.2 Inertness of `identCommand`, stated as a rule

Every adapter's identification command must be **provably inert** on a board that
does not speak it — not incidentally so. Probing order is asserted by test
(`adapters.test.mjs:84`: a losing dialect gets `IDENT` and nothing else), but
that test only proves *we* send nothing further. It does not prove the bytes are
harmless to the other side. On this hardware, that is the difference between a
log line and a spinning prop.

Also worth stating because it is easy to get wrong: connecting to a flight
controller is **not** what risks it. We never write, so a client session cannot
arm or spin anything. The risk lives entirely in the *flash* path, which client
transports do not have.

## 3. Channels are vocabulary; components are optional identity

**Splitting these is the core modelling decision.** A channel is a physical
quantity; a component is a part that may provide some channels. Collapsing them
means every chip that measures acceleration needs its own bespoke entry, and
adding an IMU to a drone becomes a data change rather than a non-event.

```json
"channels": [
  { "key": "accel",   "label": "acceleration",   "unit": "m/s^2", "decimals": 2 },
  { "key": "gyro",    "label": "angular rate",   "unit": "deg/s",  "decimals": 1 },
  { "key": "baro",    "label": "pressure",       "unit": "hPa",    "decimals": 1 },
  { "key": "temperature", "label": "temperature", "unit": "°C", "decimals": 1,
    "min": -40, "max": 80 }
]
```

A component declares what it provides, and provides an optional identity:

```json
{ "id": "mpu6050", "label": "MPU6050", "kind": "i2c",
  "provides": ["accel", "gyro", "temperature"],
  "identity": { "whoamiReg": "0x75", "whoamiVal": "0x68" } }
```

Consequences that matter:

- The FC's own IMU, an MPU6050, and anything else all deliver `accel`. **No
  per-chip, per-transport data.** A flight controller needs no component entry
  at all.
- Under this split we make **no identity claim about a flight controller's
  sensors.** We receive `accel`; if nothing is identified, nothing is drawn.
  That is the honest position, and the previous draft got it wrong by implying
  "the FC's own IMU".
- A DHT22 on a flight controller is a **declared channel no transport
  delivers** — which is exactly `notReporting`, already built. No new mechanism.

### 3.1 What each transport can actually deliver

| Channel | `omnitwin-own` (ESP32/AVR) | `msp` (measured, §5.2) | `mavlink` | `nmea` |
|---|---|---|---|---|
| accel / gyro | from our own bus probe | **✅** | ✅ | — |
| baro | if wired | ❌ (no baro on an F3) | ✅ | — |
| temperature / humidity | if wired | ❌ | — | — |
| magnetometer | if wired | ❌ (absent on F3) | ✅ | — |
| GPS | — | ✅ if a module is fitted | ✅ | ✅ |
| battery / RPM | — | ✅ | ✅ | — |
| **DHT22** | ✅ if wired | ❌ | ❌ | ❌ |

The `msp` column is **measured on the user's own SP Racing F3**, not assumed. It
delivers `accel` and `gyro` and nothing else — which is precisely why a twin
built on it is mostly `notReporting` badges, and why that is the correct outcome
rather than a disappointing one. The student learns what their board actually
has.

A flight controller also needs **no component entry at all** under the §3 split.
It delivers channels; the student names the parts, or nothing is drawn.

## 4. The channel-keyed stream

Firmware currently emits `{"ts":…,"temp":…,"hum":…,"ax":…,"ay":…,"az":…}` and
`toReading` maps exactly those six keys. This fixed frame is why every new sensor
is a special case in both C and JS, and it is specified first for that reason.

```json
{ "ts": 45146, "ch": { "accel": 0.01, "gyro": 0.02, "baro": 1013.2,
                       "temperature": 25.1, "humidity": 55.0 } }
```

One key namespace across wire, registry, display and tutor context. This
structurally kills a live bug: `SENSOR_RANGES` keys on `humidity` while the wire
key is `hum`, so `SENSOR_RANGES['hum']` is `undefined` and **the 20–90 % humidity
check has never once fired** — dead code shaped like a working feature.

A 1.x board keeps working during rollout via the legacy parser selected by the
`fw` field already returned by `IDENT`.

## 5. Identification, verified read-only

`firmware/probe_board.py` answers "what is this board?" without writing a byte in
its first pass, and `firmware/probe_board_test.py` tests the classifier against
synthetic frames of every supported protocol with no hardware attached.

MSP detection requires its 3-byte header to **repeat** — a lone `0xAA` is what
boot banners emit, and a false positive there means parsing noise as flight
commands. The self-test caught a real bug in the CRSF detector (the `0xEE`
terminator is the last byte at `i + length - 1`, since `length` excludes the sync
byte).

### 5.1 A silent port is not a fault

The probe's second pass sends a read-only MSP greeting, because **MSP is
request/response: a healthy flight controller says nothing until asked.** An
earlier assumption that a flight controller "actively streams telemetry
unprompted" was wrong, and it inverted the meaning of the most useful signal the
tool produces.

This is why the greeting is part of pass 2 rather than the whole design: a
documented read command is safe, but it is not the same as sending nothing. The
rule in §2.1 is therefore **"read commands allowed, write commands forbidden"**,
not "send nothing" — the latter is unsatisfiable for any request/response
protocol, and a board that never answers is indistinguishable from a dead one.

### 5.2 The reference board, measured

Verified against the user's own hardware, read-only:

| | |
|---|---|
| Board | SP Racing F3, STM32F3 (72 MHz) |
| Firmware | **Cleanflight 2.5.0**, Oct 2018, `08348b705` |
| Protocol | **MSP API 1.40 — MSPv1 only** |
| Variant code | **`SRF3`** (long form `SPRACINGF3`) |
| Channels | `accel`, `gyro` only — no baro, no mag (normal for an F3) |
| Arming disabled | `RXLOSS`, `CLI`, `MSP` — expected on a bench with no radio |

Three corrections this produced, all of which had been assumptions in the wrong
direction:

1. **MSPv2 does not exist on this firmware.** MSPv2 arrived in Betaflight 3.x.
   A 2018 Cleanflight build is v1-only, so the adapter targets v1 and v2 support
   is a separate, additive concern for modern boards.
2. **The board returned zero bytes because no battery was connected.** The
   CP2102 enumerates off USB power alone, so a bridge that appears says nothing
   about whether the MCU is running. A "connected" USB device on a flight
   controller is not evidence of a working board. This is worth stating in the
   product: OmniTwin must distinguish *bridge present* from *target responding*,
   or it will confidently report a dead board as a healthy one.
3. **`I2C Errors: 7`** on the reference board — a real accumulated fault,
   independent of OmniTwin, and a reminder that a twin surfaces hardware health
   the student had not noticed.

The 12-byte MSPv1 frame is fixed-width:

```
$AA 'M' '<' size_lo size_hi cmd payload[5] checksum
```

The size field states the **real** length (cmd + payload); the payload slot is
zero-padded, but the padding is not protocol. The checksum is XOR over
`size_lo, size_hi, cmd` and exactly `size - 1` payload bytes — derived from
Betaflight's receive state machine (`msp_serial.c`, `MSP_HEADER_V1` →
`MSP_PAYLOAD_V1`), where `dataSize = hdr->size` and only that many payload bytes
are consumed and XORed.

**Byte-level verification is still outstanding.** The framing is derived from
Betaflight's implementation and is very likely correct, but three separate
assumptions about MSP were wrong today (variable-length frames, checksum span
over padding, and MSPv2 support). The parser must be confirmed against a live
capture — `firmware/capture_fc.py` logs the raw replies read-only — before the
MSP adapter is trusted. **Design is complete; byte verification is not.**

## 6. Onboarding, and the honest limit

| Path | Buys | Writes | Friction |
|---|---|---|---|
| **C library** (`#include <omnitwin.h>`) | nothing | 2 lines | Arduino IDE, familiar to students |
| **Flash button** (dashboard, prebuilt image) | nothing | nothing | none — but **overwrites their project** |

Both consume the same core, so the library is the substance and the button is the
front door. The button is also the recovery path if a student erases the library
setup — which removes the "stranded with no OmniTwin" failure mode.

**There is no third option.** A browser cannot recompile C, so "add our library
without the student touching their code" is not achievable; and patching an
already-compiled binary is not possible either. The Flash button works because it
ships a *complete* prebuilt image, which necessarily replaces their program.

**Targets:** ESP32 DevKitC and ATmega328P (Arduino R3 / Nano — the same chip, so
three boards are two silicon targets). Constraints to verify first: AVR does not
link `printf("%f")` without `-Wl,-u,vfprintf -lprintf_flt`, and has 2 KB of RAM.
A flight controller is **not** a port target — it is a client transport.

## 7. Scope

**Plan A — the core:** `omnitwin.h`/`.c` portable core · channel-keyed streaming ·
channels/components split in the registry · `PROBE <gpio> <protocol>` ·
ESP32 + AVR ports against **shared golden vectors** · `notReporting` extended to
"declared but undeliverable".

**Plan B — the product's core:** `codeFlags()`, a zero-LLM static checker over the
student's own source, feeding the tutor exactly as wiring faults do today. No
patching, no file writes.

**Blocked on one thing:** `msp` byte verification (§5.2). The design is done —
protocol, variant, channel set all known — and only a live capture is outstanding.
`mavlink` remains entirely unstarted; no MAVLink hardware exists on the bench, and
ArduPilot/PX4 boards are also normally flashable, so whether they are a *client*
transport at all is unconfirmed.

**On demand:** ultrasonic (needs request/response), IR digital, analog.

**Deferred:** multi-board sessions · external registry · actuators (after the
pilot, team decision) · tutor patching · MSPv2 (additive, for Betaflight 3.x+).

## 8. Open questions

1. **AVR float printf and RAM (§6)** — verify before designing around them. This
   is now the only Plan A question that gates design.
2. **`docs/Cost-Structure.md`** still frames spend around a hardware batch. With
   no kit, does it need rewriting or is it historical record?
3. **Is a 2018 Cleanflight build a realistic reference for students?** The user has
   `2.5.0`; current firmware is Betaflight 4.x. If a student's project runs
   modern firmware, the MSP adapter must handle v2 as well as v1, and the channel
   set may differ. Worth confirming what a typical student's board carries before
   committing to v1-only.
4. **Should a board with accumulated I2C errors be badged as faulty?** The
   reference FC reports `I2C Errors: 7`. A transport-level health channel would
   let the twin say "your bus has errors" instead of only reporting missing
   channels. Not required for a first adapter; noted because it is exactly the
   kind of fault this product exists to surface.

## 9. Carried-over open items

- **Component removal was missing** and was assumed present by the prior spec.
  **Fixed** — `removeComponent` plus a per-sprite delete that prunes wires.
- **M9** — the pin gesture arms and detaches on `pointerdown`, so a wire is
  destroyed on mouse-*down*. Worse now that rigs have more sensors.
- **M6** — `TwinCanvas` imports the concrete adapter for `referenceWiring`, so the
  board is still hardcoded in the view.
- **M13** — `reply_scan`'s `list[512]` truncates silently on a full bus.
- **Firmware has no off-target test path.** A library port is the first route to
  one, and `probe_board_test.py` is the precedent: test the protocol layer on the
  host, with no hardware.
- **Open hardware question:** the fitted MPU6050 ACKs at `0x68` and answers
  `WHO_AM_I 0x68`, but ignores its own configuration writes. No firmware change
  can make a part ignore its own configuration; swapping the module is the next
  test. The board reports this honestly (`mpu.ready:false`, nulls) rather than
  streaming a fake `0.000 g`.
- **§3.5** of the prior spec (tutor patching student source) stays deferred.
  `codeFlags()` ships its read-only half first.
