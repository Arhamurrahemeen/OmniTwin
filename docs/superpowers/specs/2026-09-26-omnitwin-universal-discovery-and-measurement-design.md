# OmniTwin Platform Architecture — Design Spec

Status: proposed. Supersedes nothing; supersedes the *framing* of
`2026-09-26-omnitwin-universal-detection-and-measurement-design.md`, which was
written against a hardware-kit assumption and is corrected here. The
universal-detection/canvas work in
`2026-09-26-omnitwin-universal-detection-canvas-design.md` stands.

## 0. What this platform is

OmniTwin is an **engine for students to debug their semester hardware projects**.
It is not a kit with a fixed sensor list. Two consequences shape everything below.

1. **The artifact is the student's code, not the hardware.** The twin exists to
   explain *why their code misbehaves*: SDA wired into GND is why a register read
   returns 0; a silent sensor is why their `ax` is `null`. Wiring faults, anomaly
   flags and disconnect badges are the tutor's evidence for a code-level answer,
   not decoration.
2. **Boards are heterogeneous and student-supplied.** "Any board" is the goal; a
   *supported list* is how we ship toward it. Sensor coverage is genuinely open on
   any supported board, because `SCAN` sweeps the whole I2C bus. Board coverage is
   N, and adding board N+1 is an adapter exercise, not a redesign.

**Correction to the previous draft of this doc:** it justified work by a parts list
in `docs/Cost-Structure.md:26`. That is a budget line, and building a sensor roadmap
from it was a mistake — there is no kit, so no sensor is "in the kit". A protocol
capability exists when a student's project needs it.

## 1. The constraint that shapes everything

Web Serial is a byte pipe. The browser cannot do I2C and cannot touch a GPIO, so
**100% of hardware discovery is delegated to the student's board.** The registry can
only parameterise interpretation of what the board reported.

Stated so it is not re-litigated: *"works with any microcontroller that has no
OmniTwin code on it"* is not achievable. A bare MCU is not self-describing. The
achievable goal is a **portable OmniTwin C library that any supported board links.**

## 2. Core decision: OmniTwin ships as a library, not as firmware

A student flashes **their own** semester project. OmniTwin cannot also occupy the
board — the two cannot coexist. So OmniTwin is a small C library the student links
into their own program:

```c
#include "omnitwin.h"
int main(void) {
    omnitwin_begin(&OMNITWIN_DEFAULT);   /* detection + telemetry on the same UART */
    setup();                              /* the student's own project code */
    for (;;) { loop(); }
}
```

The student keeps their program, their `setup()`/`loop()`, their sensor code and
their build. We supply telemetry and diagnostics *around* it.

**Rejected alternatives:**

| Option | Why not |
|---|---|
| Our firmware replaces theirs | They are not running their own program, so we are not debugging their code. Contradicts the product. |
| Sniff their existing serial output | No guaranteed schema, so detection and streaming are best-effort. Acceptable as a *fallback* read-only mode; not the primary path. |
| Our firmware + their code as a task | Only expressible on ESP32 (FreeRTOS). Breaks the AVR target for no gain. |

**Pin ownership, settled.** Pin numbers live in the **library port's config** — a
compile-time constant the silicon already knows. The registry owns *identity and
geometry* (label, `whoamiReg`, sprite size, pin `dx`/`dy`). Two different things,
two owners, no duplication.

This is also why a wire-level board manifest (`IDENT`/`CAPS` self-reporting a
pinout) is **rejected**: it would put pin numbers on the wire *and* keep geometry
in JSON — two sources of truth for one pin, plus version skew between board fw and
a cached browser. The library makes the manifest unnecessary.

### 2.1 Targets

| Board | Silicon | Library port | Adapter |
|---|---|---|---|
| ESP32 DevKitC | ESP32 | ESP-IDF / FreeRTOS | `twinlab_esp32_v1` (exists) |
| Arduino R3 | ATmega328P | AVR | shared AVR dialect |
| Arduino Nano | ATmega328P | AVR | shared AVR dialect |

R3 and Nano are the **same chip**, so three boards are **two silicon targets** and
one JSON dialect. Board identity and pin differences are library config, not
protocol variants.

### 2.2 Constraints to design around (verify, do not assume)

- **AVR float printing.** `printf("%f")` does not link on ATmega328P without
  `-Wl,-u,vfprintf -lprintf_flt`. Omit it and every accel value in the JSON is
  garbage. Confirm against the actual toolchain in the first AVR task.
- **AVR RAM is 2 KB.** A JSON line buffer plus float formatting is tight. This
  drives the AVR port's buffer strategy and probably forces a shorter line format
  than the ESP32 emits — which the golden-vector suite (§2.3) will surface.
- **ESP32/AVR parity.** Two implementations of one JSON format will drift. The
  format is specified once, here, and both ports are tested against it.

### 2.3 Off-target firmware testing — unlocked by the library

`proto_selftest` asserts only run on flashed hardware. That is why the MPU init
bug (§9) survived to the bench: no host C compiler, no way to catch it.

A library port changes this. Compile the same `.c` against a mock serial backend on
the host, feed it recorded frames, and assert the emitted bytes. Both ports run
the **same golden vectors**, so ESP32/AVR drift becomes a test failure rather than
a field bug. This is the first off-target test path the project has had, and it is
a prerequisite for trusting the AVR port before a student ever runs it.

## 3. Three axes, not one

Conflating these produced the current special cases. They are orthogonal.

| Axis | Question | Values |
|---|---|---|
| **Presence** | Why is this part here? | `always` (board answered) · detected · **declared by the student** |
| **Transport** | How is it reached? | `i2c` · `gpio-protocol` · `analog` |
| **Capability** | What does it do? | `channels` (measure) · `commands` (actuate) |

`singleWire` is a *transport* and `always` is a *presence* reason. Keep `always`;
orthogonalise `kind`.

## 4. Detection categories, honestly

| Category | Example | How detection works | Identity |
|---|---|---|---|
| **Auto-identifying bus** | I2C, 1-Wire ROM | generic sweep + identity read + registry lookup | read off the chip |
| **Declared GPIO protocol** | DHT22, ultrasonic, IR digital | the student *declares* "pin X runs protocol Y"; the library has one decoder per protocol | **declared, never discovered** |
| **Non-identifying analog** | soil moisture | no identity signal exists, ever | **declared, permanently** |
| **Actuator** | motor driver | not a detection problem — see §7 | n/a |

A protocol decoder is protocol-specific C and cannot be generic; timing decode *is*
the protocol. What becomes generic is the plumbing, so adding a protocol is "one
decoder + one registry entry", not a new special case in `serialModel.mjs`.

`scan[def.id]?.ok` in `scanToComponents` is a bare DHT22 special case and becomes a
loop over declared channels.

**The UI must never imply an analog channel was "detected."** It is *declared* —
the same honesty rule as `temp: null` / `ok: false` / `ax: null`.

### 4.1 Ultrasonic is not a DHT22

DHT22 is a self-timed single-wire **read**. HCSR04 is a **transaction**: pulse
trigger, then time the echo. `gpio-protocol` therefore declares request/response
pins and the decoder returns a *measurement*, not a level. IR digital-out is a
plain read and fits unchanged.

## 5. Channel-keyed stream

Today firmware emits `{"ts":…,"temp":…,"hum":…,"ax":…,"ay":…,"az":…}` and
`toReading` maps exactly those six keys. A student with a BMP280 would get it
detected, identified, drawn and labelled — and never measured, because no read path
exists. **This fixed frame is the reason every new sensor is a special case in both
C and JS.** It is specified first, before any decoder.

```json
{ "ts": 45146, "ch": { "dht.temperature": 25.1, "dht.humidity": 55.0,
                       "mpu.ax": 0.012, "mpu.vibration": 0.021 } }
```

Channel names are `<componentId>.<key>`, so **one key namespace** covers the wire,
the registry, the display and the tutor context.

This structurally kills a live bug: `SENSOR_RANGES` keys on `humidity` while the
wire key is `hum`, so `SENSOR_RANGES['hum']` is `undefined` and **the 20–90 %
humidity check has never once fired** — dead code shaped like a working feature.
With one declared namespace, a name that cannot match its channel is impossible
rather than a silent no-op.

`vibration` becomes a *derived* channel declared beside its inputs, instead of
arithmetic hidden in the adapter's `toReading`.

**Compatibility:** a 1.x board keeps working during rollout via the legacy parser
selected by the `fw` field already returned by `IDENT`. Dropped when no supported
board runs 1.x.

## 6. Registry schema

`reads` stops being `string[]` and becomes channel objects — which is also where
the precision fix lives, since the canvas hardcoded `DECIMALS = {temp:1, hum:1}` and
rendered accel at 1 dp while the wire carries 3 (a resting MPU displayed a
permanent `ax: 0.0`).

```json
{
  "id": "mpu6050", "label": "MPU6050",
  "kind": "i2c", "transport": { "candidateAddrs": [104, 105] },
  "identity": { "whoamiReg": "0x75", "whoamiVal": "0x68" },
  "channels": [
    { "key": "ax", "label": "accel X", "unit": "g", "decimals": 3 },
    { "key": "ay", "label": "accel Y", "unit": "g", "decimals": 3 },
    { "key": "az", "label": "accel Z", "unit": "g", "decimals": 3 },
    { "key": "vibration", "derivedFrom": ["ax","ay","az"], "transform": "deviationFrom1g",
      "label": "vibration", "unit": "g", "decimals": 3, "max": 0.2 }
  ]
}
```

A GPIO protocol is declared against a library-configured pin:

```json
{ "id": "dht22", "kind": "gpio-protocol",
  "protocol": "dht22",
  "channels": [ { "key": "temperature", "unit": "°C", "decimals": 1, "min": -40, "max": 80 },
                { "key": "humidity",    "unit": "%",  "decimals": 1, "min": 20,  "max": 90 } ] }
```

`SENSOR_RANGES`, `LABELS` and `DECIMALS` are deleted. Ranges move into channels,
which is what makes a bound enforceable — `humidity` gets a real check for the
first time.

### 6.1 Sprite art is still a hardcoded table

`ComponentSprite.jsx:42` is `SPRITES[type] ?? <span>?</span>`. Art stays in JSX
(deliberate — SVG-as-JSON would need `dangerouslySetInnerHTML`), so "adding a
sensor is a JSON edit" only holds if a literal `?` is acceptable. A **generic
fallback renderer** (plain box + pin dots from `size`/`pins`) is in scope so a new
entry is never a question mark.

## 7. Actuators — a product decision, not an engineering one

A motor driver has `commands`, not `channels`, and it is the one place "universal
hardware" collides with *"coaching, never autonomous control."*

**Recommended guardrail, for the team to confirm:**

- Commands are a **typed verb plus typed params in the adapter**, bounds in the
  registry. Explicitly **rejected:** a `"wireCommand": "DRIVE %d %d"` template in
  the registry — that puts wire-format strings and `%d` templating into the
  presentation registry, regressing the adapter seam, and untyped string params
  cannot carry a `-100..100` bound, so they cannot express the limit the guardrail
  depends on.
- One explicit human click per action. Never a free-running slider.
- **Structurally unreachable from `/tutor`**, mirroring the rule that the tutor
  never writes a file without a per-change Apply. The tutor may *discuss* a motor
  fault; it cannot move a motor.
- Warns on a dirty git tree, does not block.

**Recommendation: after the pilot, not in this slice.** A motor driver expands the
safety surface, the library surface and the product scope in one step.

## 8. Scope

**Plan A — the platform core:**

1. `omnitwin.h` / `omnitwin.c`, portable core: detection, channel-keyed streaming,
   JSON encode. Mock-serial backend so it compiles and runs on the host.
2. ESP32 port (extracted from today's `main.c`) and AVR port, both against the
   **same golden vectors** (§2.3).
3. Registry: `channels` objects, `kind`/`presence` orthogonalised, ranges and
   precision in data. Delete `SENSOR_RANGES`, `LABELS`, `DECIMALS`.
4. `PROBE <gpio> <protocol>` verb; `reply_scan` reports a `gpio-protocol` array.
   GPIO4 moves out of `#define` into library config — **the same pin, one owner.**
5. Adapter keeps a 1.x legacy stream parser for rollout.
6. Generic sprite fallback.

**Plan B — the next plan, and it is the product's core:** `codeFlags()`, a
zero-LLM-cost static checker over the student's own source, feeding the tutor the
same way wiring faults do today. Blocking calls in a task loop, `printf` format
mismatches, missing bounds checks on register/array indices, I2C address errors.
No patching, no file writes — the per-change Apply work in §3.5 of the prior spec
stays deferred until flags are proven useful.

**On demand, not scheduled:** ultrasonic (needs request/response), IR digital,
analog. Each is "one decoder + one registry entry", triggered by a real student
project, not by a parts list.

**Deferred, explicitly:** board manifest (unnecessary given §2) ·
external/community registry · multi-board adapters beyond the two silicon targets ·
`usbHints` (nothing to rank with one dialect) · actuators (§7) · tutor patching.

**Unchanged:** the kit cannot measure current or voltage, so wire colouring stays a
teaching label. Per-adapter baud is impossible — Web Serial has no `setBaudRate`.

## 9. Open questions

1. **AVR float printf and RAM (§2.2) — verify before designing around them.** If
   the AVR port cannot emit the same JSON cheaply, does the line format shrink for
   AVR, or does AVR ship a reduced channel set? This is the first thing Plan A
   should measure.
2. **`always` semantics for a declared channel.** If the DHT22 is declared rather
   than discovered, is it "present because the student declared it" or "present
   because the probe answered"? Different claims; the canvas should not conflate
   them.
3. **Student adoption.** A library requires a `#include`. In a lab that is a README
   problem, not a technical one — but is there a lab demonstrator, or does each
   student do it unaided?
4. **Actuators: after the pilot, or never?** A motor driver changes the safety story
   the project is built on.
5. **`docs/Cost-Structure.md`** frames spend around a hardware batch. With no kit,
   does that doc need rewriting, or is it historical record?

## 10. Carried-over open items (not this spec's job)

- **Component removal was missing entirely** and was assumed present by the prior
  spec. **Fixed** — `removeComponent` plus a per-sprite delete that prunes wires.
- **M9** — the pin gesture arms and detaches on `pointerdown`, so a wire is
  destroyed on mouse-*down* and a half-armed wire cannot be cancelled. Worse now
  that rigs have more sensors.
- **M6** — `TwinCanvas` imports the concrete adapter for `referenceWiring`, so the
  board is still hardcoded in the view. §2 removes the *other* half of that
  duplication; this half remains.
- **M13** — `reply_scan`'s `list[512]` truncates silently on a full bus.
- **Firmware has no off-target test path.** §2.3 is the first attempt at one.
- **Open hardware question:** the fitted MPU6050 ACKs at `0x68` and answers
  `WHO_AM_I 0x68`, but ignores its own configuration writes — `0x1A`/`0x1C` read
  back 0 after being written, and the sample registers read 0. No firmware change
  can make a part ignore its own configuration; swapping the module is the next
  test. The board now reports this honestly (`mpu.ready:false`, nulls) rather than
  streaming a fake `0.000 g`.
- **§3.5** of the prior spec (tutor reads/patches student source) remains
  deferred. Plan B ships its read-only half — `codeFlags()` — first; the
  per-change-Apply half stays deferred and is the precedent §7 borrows.
