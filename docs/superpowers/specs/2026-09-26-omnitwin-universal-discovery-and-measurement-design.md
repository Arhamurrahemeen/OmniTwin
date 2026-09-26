# OmniTwin — Student Project Debugger — Design Spec

Status: proposed. Supersedes the framing of the two previous drafts of this
document, which were built on a **wrong premise** (see §0.1).

## 0. What this is

OmniTwin is **software** for students to debug their own semester hardware
projects. A student brings:

1. their hardware, with **their own firmware already flashed**, and
2. **their source code**.

OmniTwin scans both, visualises the hardware on a canvas, shows the code on its
own tab, and gives them an AI tutor for debugging, guidance and learning.

**Nothing is sold, flashed, or installed. Ever.** There is no kit, no dongle, no
supported-board list, no firmware agent, and no C library for the student to
link. The student's board stays exactly as it is.

The whole product is three read-only channels, all served from what the student
already has:

| Channel | Source of truth | Requires setup? |
|---|---|---|
| **Code** | the project folder the student hands over | No — it is already theirs |
| **Hardware** | **derived from that source**: MCU, pins, buses, addresses, protocols | No |
| **Live values** | the serial log their firmware already prints | No |

### 0.1 The wrong premise this replaces

Earlier drafts concluded that because a browser cannot do I2C or touch a GPIO,
**OmniTwin had to run on the student's board** — and from that followed a C
library, a dashboard Flash button, ESP32/AVR port targets, a supported board
list, and a telemetry dongle.

All of it was wrong, and wrong in the same way: each piece assumed OmniTwin must
**install itself** onto the student's hardware in order to observe it. It does
not. The student already flashed their own firmware and already has the source,
so the hardware topology can be read out of the source, and the runtime values
come from the log that firmware already prints.

**"Universal detection" therefore never needed our firmware.** It needs the
student's.

## 1. The one real constraint

A browser cannot do I2C and cannot touch a GPIO. So OmniTwin never drives a bus.

That constraint has a much smaller cost than it first appears, because **the
source code states the hardware**: `Wire.begin(21, 22)`, `0x68`, `DHT.begin(4)`,
`pinMode(13, OUTPUT)` are all declarations of fact, written by the student. We
read them instead of guessing them.

The genuine limit, stated plainly rather than hidden:

> **Live values exist only if the student's firmware prints them.** A silent
> project yields its code and its declared hardware, but no numbers.

The UI must say so explicitly — *"this firmware prints nothing; add a
`Serial.print` to see live values"* — rather than showing empty gauges that look
like a fault. This is the same honesty rule as `ax: null` and `ok: false`.

## 2. Channel and component, kept separate

**Channels are vocabulary; components are optional identity.** A channel is a
physical quantity; a component is a part that may provide some channels. This
matters because a student's hardware is described in *their* terms — an MPU6050,
a DHT22, an MPU9250 — and we should not need a bespoke registry entry per chip.

```json
"channels": [
  { "key": "accel",  "unit": "m/s^2", "decimals": 2 },
  { "key": "gyro",   "unit": "deg/s", "decimals": 1 },
  { "key": "baro",   "unit": "hPa",   "decimals": 1, "min": 300, "max": 1100 },
  { "key": "temperature", "unit": "°C", "decimals": 1, "min": -40, "max": 80 },
  { "key": "humidity",    "unit": "%",  "decimals": 1, "min": 0,  "max": 100 }
]
```

A part declares what it provides:

```json
{ "id": "mpu6050", "label": "MPU6050", "kind": "i2c",
  "provides": ["accel", "gyro", "temperature"],
  "identity": { "whoamiReg": "0x75", "whoamiVal": "0x68" },
  "pins": [ { "id": "SDA", "kind": "signal", "label": "SDA" } ] }
```

**Pins are derived from the student's source, not from a fixed board.** `pinMode`
and pin constants in their code populate the pin list. A student wiring an MPU to
GPIO 13/14 instead of 21/22 gets a canvas that shows *their* wiring, which is the
entire value of the product — the old hardcoded `always.esp32` entry described
*our* board, not theirs, and was wrong for every student who used different pins.

### 2.1 Three ways a channel gets its value

| Source | Example | Confidence |
|---|---|---|
| **declared** — in the source only | `0x68` on the I2C bus | the student wired it; we believe them |
| **reported** — printed at runtime | `temp=24.3` on the serial log | measured |
| **absent** — neither | a DHT22 with no code and no output | render `⚠ not reporting` |

`notReporting` already exists in the codebase and covers the third case. A
channel that is declared but never reported is exactly the badge it was built
for — no new mechanism required.

## 3. Code is half the product

A separate tab shows the student's source, and `codeFlags()` runs a **zero-LLM
static pass** over it before any tutor call — the same philosophy as
`anomalyFlags()`: cheap local checks first, LLM only to explain.

Checks, in rough priority order:

- **Blocking calls in a task loop** — `delay()` inside an RTOS task starves
  everything else. The classic embedded killer.
- **`printf` format mismatches** — `%d` with a `float`, wrong argument count.
- **Missing bounds checks** on array/register indices.
- **I2C calls that ignore their return value** — a NAK reads as success. This is
  exactly how a real sensor bug stayed invisible for a session in this repo.
- **Hardcoded magic numbers** that should be named constants.
- **Unchecked `malloc`/buffer writes** on AVR-class targets, where 2 KB of RAM
  makes overflow likely.

Findings feed the tutor as structured context, the same way wiring faults and
anomaly flags do today. **No patching, no file writes** — the per-change Apply
work stays deferred.

## 4. Serial intake

The dashboard opens the port read-only and consumes whatever arrives. Three
recognisable shapes, best-effort:

- **JSON** — `{"ax":0.01,"temp":24.3}` or any subset. Trivial and exact.
- **`key=value` pairs** — `temp=24.3 hum=55.0`. Common in quick student projects.
- **Free text** — `I2C: NACK on 0x68`, `sensor not found`. Not parseable into
  channels, but **valuable evidence** for the tutor, and the raw log is shown
  verbatim in the UI.

There is no format OmniTwin imposes, because imposing one would mean the student
changing their code — which this product will not ask.

### 4.1 Safety

> **OmniTwin never writes to a port, never flashes a device, and never issues a
> command that changes hardware state.**

Ports are opened for reading only. No `MSP_SET_*`, no `DO_*`, no upload path, no
bootloader interaction. This holds for every board including flight controllers,
where a wrong write spins a motor rather than logging a bad reading.

The guarantee is **by omission** — no write verbs exist in the serial layer — and
it is enforced by a test that greps the client for them. A metadata flag is a
note; absent code is a guarantee.

## 5. Canvas

Same canvas as today, with one change: **parts come from the student's source
rather than from a fixed registry scan.** Wires are drawn and checked with the
existing `kind` comparison (power/ground/signal), and faults feed the tutor.

The teaching label stays honest: colour is by pin *kind*, not a simulation of
voltage or current. Nothing in a student project can measure current, and the UI
must not imply otherwise.

## 6. The tutor

Answers from all three channels at once — code, derived hardware, and live log —
which is what makes it worth having. A student asking "why is my accelerometer
reading zero" gets an answer that connects their wiring, their register read, and
the code that performs it.

Constraints, all already established:

- **Strictly on-demand.** No proactive or background LLM calls, ever.
- **No file writes** without a per-change Apply click, and that is deferred.
- **Plain-text replies**, since the panel renders literal text.
- Student source is sent to a third-party provider; the UI discloses this in one
  line, the same way sensor readings already are.

## 7. Scope

**Slice 1 — see a real student project end to end:**

1. Project folder intake via `showDirectoryPicker()`, filtered to `.c .h .ino .cpp`.
2. `codeFlags()` static pass, findings shown in the code tab.
3. Hardware derivation from source: MCU, pins, I2C addresses, protocol libraries.
4. Canvas populated from that derivation, with pin-referenced wires.
5. Serial intake: JSON, `key=value`, and verbatim free text.
6. Tutor answering from code + hardware + log together.

**Deferred:** MSP/MAVLink client adapters · actuator commands · tutor patching ·
external registry · multi-board sessions.

**Dropped entirely, and worth recording so it is not re-proposed:** C library for
the student to link · dashboard Flash button · ESP32/AVR firmware port targets ·
supported board list · telemetry dongle · `PROBE` verb.

### 7.1 The reference flight controller, and what it taught us

The user's SP Racing F3 (Cleanflight 2.5.0, MSP API 1.40) was useful mainly as a
negative result, and three findings from it are permanent:

- **MSPv2 does not exist on 2018-era firmware.** It arrived in Betaflight 3.x. A
  modern board would use v2, so any MSP work must handle both.
- **A USB bridge enumerating proves nothing about the target.** The CP210x
  appears off USB power alone while the STM32 stays unpowered. Any future
  "is it connected?" logic must distinguish *bridge present* from *target
  responding* — the same bug class as reporting a dead sensor as a live `0.000`.
- **Request/response protocols are silent when healthy.** MSP says nothing until
  asked, so a silent port is not a fault. An earlier assumption that flight
  controllers stream telemetry unprompted inverted the most useful signal the
  probe produces.

A flight controller also delivers only `accel` and `gyro` — no baro, no mag. It
needs **no component entry at all** under §2, which is the split working as
intended: a board contributes channels, and the student's source names the parts.

## 8. Open questions

1. **How much of the hardware can be trusted from source alone?** A student who
   writes `Wire.begin(21,22)` has declared intent, not proof. Does the canvas
   present declared wiring as fact, or as "your code says X — confirm it"?
   Leaning towards labelling it as declared, for the same honesty reason as §1.
2. **Silent projects are the main gap.** Is a nudge ("add a `Serial.print` to
   see values") enough, or should the tutor offer to write that one line for
   them?
3. **What is a non-C project?** PlatformIO projects, MicroPython, Arduino
   sketches in `.ino` with auto-generated prototypes — the static pass has to
   tolerate all of them, and `.ino` in particular has no function declarations
   to work from.

## 9. Carried-over open items

- **Component removal was missing** and was assumed present by the prior spec.
  **Fixed** — `removeComponent` plus a per-sprite delete that prunes wires.
- **M9** — the pin gesture arms and detaches on `pointerdown`, so a wire is
  destroyed on mouse-*down*.
- **M6** — `TwinCanvas` imports the concrete adapter for `referenceWiring`, so a
  board is still hardcoded in the view. This doc removes the reason it exists.
- **`SENSOR_RANGES` keys on `humidity` while the wire key is `hum`**, so the
  20–90 % check has never once fired. Dead code shaped like a working feature.
- **`ComponentSprite` is `SPRITES[type] ?? "?"`** — art is still a hardcoded map,
  so a new part renders `?` unless JSX is edited. A generic fallback renderer
  (plain box + pin dots from the derived geometry) belongs in Slice 1.
- **Firmware has no off-target test path.** Unchanged, and still true: our own
  node firmware can only be verified on flashed hardware. That is a fact about
  *our* firmware, which students do not run.
