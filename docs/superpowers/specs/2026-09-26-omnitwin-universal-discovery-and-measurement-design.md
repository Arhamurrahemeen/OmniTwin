# OmniTwin Universal Discovery & Measurement — Design Spec

Status: proposed. Supersedes nothing; extends
`2026-09-26-omnitwin-universal-detection-canvas-design.md` (§3.1–§3.3 landed there).

The prior spec made **detection** universal in *interpretation*: given a discovery
report, the browser can identify and draw any registered sensor with no code change.
It did not make discovery or measurement universal, and this doc closes that.

## 0. Why this exists

Three facts, established by reading the code and by running the board on COM3:

1. **`SCAN` sweeps I2C only.** Any I2C device is found and identified with no
   firmware change — that was the prior spec's real win, and it holds.
2. **A single-wire sensor is found only on the pin the firmware hardcodes.**
   `#define DHT_IO 4` (`main.c:44`) and `reply_scan` *reports* that constant rather
   than discovering a pin. GPIO4 is additionally baked into `components.json`
   (`{"id":"DHT","label":"GPIO4","gpio":4}`) and into the adapter's
   `referenceWiring`. DHT22 on GPIO5 is invisible.
3. **The stream frame is fixed-shape.** Firmware emits
   `{"ts","temp","hum","ax","ay","az"}` and the adapter's `toReading` maps exactly
   those six keys. So a BMP280 would be detected, identified, drawn and labelled —
   and never measured, because no read path exists for it.

Point 3 is the blocker. Until the stream is channel-keyed, every new sensor is a
special case in firmware *and* in `toReading`, which is the bespoke-wiring-through-
the-stack problem this doc exists to remove. **It is designed first, before any
decoder.**

### 1. The browser cannot help

Web Serial is a byte pipe. It cannot do I2C and cannot touch a GPIO. **100% of
hardware discovery is delegated to whatever firmware is on the board.** The
registry can only parameterise interpretation of what firmware reported.

Consequence, stated plainly so it is not re-litigated: *"works with any
microcontroller"* is not an achievable goal. A bare MCU is not self-describing.
The achievable goal is **one generic node firmware that probes broadly.**

## 1. Three axes, not one

Conflating these is what produced the current special cases. They are orthogonal.

| Axis | Question | Values today |
|---|---|---|
| **Presence** | Why is this part here? | `always` (board answered IDENT) · detected · declared by hand |
| **Transport** | How is it reached? | `i2c` · `gpio-protocol` · `analog` |
| **Capability** | What does it do? | `reads` (measure) · `commands` (actuate) |

The prior spec's `i2c` / `singleWire` / `always` split mixes presence into
transport. `singleWire` is a *transport* (`gpio-protocol`) and `always` is a
*presence* reason. Keep `always`; orthogonalise `kind`.

## 2. Detection categories, honestly

| Category | Example | How detection works | Identity |
|---|---|---|---|
| **Auto-identifying bus** | I2C (today), 1-Wire ROM (later) | generic sweep + identity read + registry lookup | read off the chip |
| **Declared GPIO protocol** | DHT22, ultrasonic, IR digital | manifest *declares* "pin X runs protocol Y"; firmware has one decoder per protocol | **declared, never discovered** |
| **Non-identifying analog** | moisture | no identity signal exists, ever | **declared by a human, permanently** |
| **Actuator** | motor driver | not a detection problem at all — see §6 | n/a |

A GPIO protocol decoder is protocol-specific C and cannot be generic — timing
decode *is* the protocol. What becomes generic is the plumbing around it, so
adding ultrasonic is "one decoder + one registry entry", not a new special case
in `serialModel.mjs`.

**Two things the current code gets wrong that this fixes:**

- `scan[def.id]?.ok` in `scanToComponents` is a bare DHT22 special case. It becomes
  a loop over declared channels.
- The UI must never imply an analog channel was "detected". It is *declared*.
  This is the same honesty rule as `temp: null` / `ok: false` / `ax: null`.

### 2.1 Ultrasonic is not a DHT22

DHT22 is a self-timed single-wire **read**. HCSR04 is a **transaction**: pulse
trigger, then time the echo. It needs a request/response concept in the
abstraction, not just "read this pin and decode". A `gpio-protocol` entry
therefore declares `request`/`response` pins, and the firmware returns a
*measurement*, not a level. IR digital-out is a plain read and fits unchanged.

## 3. Core decision: a channel-keyed stream

Today: `{"ts":…,"temp":…,"hum":…,"ax":…,"ay":…,"az":…}`.

Proposed: channels are named, and the frame carries a map.

```json
{ "ts": 45146, "ch": { "dht.temperature": 25.1, "dht.humidity": 55.0,
                       "mpu.ax": 0.012, "mpu.ay": -0.004, "mpu.az": 0.998,
                       "mpu.vibration": 0.021 } }
```

Channel names are `<componentId>.<readingKey>`, so **one key namespace** covers the
wire, the registry, the display and the tutor context.

This structurally kills a live bug: `SENSOR_RANGES` in `serialModel.mjs` keys on
`humidity` while the wire key is `hum`, so `SENSOR_RANGES['hum']` is `undefined`
and **the 20–90 % humidity check has never once fired** — dead code shaped like
a working feature. With one namespace declared in the registry, a name that does
not match its channel is impossible rather than a silent no-op.

`vib` becomes a *derived* channel (`|‖a‖ − 1|`), declared in the registry next to
its inputs, instead of arithmetic hidden in the adapter's `toReading`.

**Compatibility:** a 1.x board's fixed frame must keep working during rollout.
The adapter keeps a legacy parser selected by the `fw` field already returned by
`IDENT`. Removed once no pilot kit runs 1.x.

## 4. Registry schema

`reads` stops being `string[]` and becomes channel objects, which is also where
the precision fix lives (the canvas hardcoded `DECIMALS = {temp:1, hum:1}` and
rendered accel at 1 dp while firmware sends 3 — a resting MPU displayed a
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
    { "key": "temperature", "derived": "hypot(ax,ay,az)", "transform": "minus1abs",
      "label": "vibration", "unit": "g", "decimals": 3, "max": 0.2 }
  ]
}
```

A GPIO-protocol entry declares what to probe and where; the **registry keeps
ownership of the pin map**:

```json
{ "id": "dht22", "kind": "gpio-protocol",
  "transport": { "protocol": "dht22", "pin": 4, "mode": "read" },
  "channels": [ { "key": "temperature", "unit": "°C", "decimals": 1, "min": -40, "max": 80 },
                { "key": "humidity",    "unit": "%",  "decimals": 1, "min": 20,  "max": 90 } ] }
```

An analog channel is declared and never detected:

```json
{ "id": "soil", "kind": "analog", "declared": true,
  "transport": { "pin": 34, "adc": 1 },
  "channels": [ { "key": "moisture", "unit": "%", "decimals": 0, "min": 0, "max": 100 } ] }
```

`SENSOR_RANGES`, `LABELS` and `DECIMALS` are deleted. Ranges move into channels,
which is also what makes a bound enforceable — `humidity` gets a real 20–90 %
check for the first time.

### 4.1 Sprite art is still a hardcoded table

`ComponentSprite.jsx:42` is `SPRITES[type] ?? <span>?</span>`. Art stayed in JSX
(deliberately — see §0 of the prior spec, to avoid `dangerouslySetInnerHTML`), but
the consequence is that "adding a sensor is a JSON edit" is only true if a literal
`?` is acceptable. A **generic fallback renderer** (plain box + pin dots from
`size`/`pins`) is in scope so a new entry is never a question mark.

## 5. Probe mechanism: browser declares, firmware executes

The GPIO4 problem is fixed by splitting policy from mechanism.

- **Browser** owns *which* pins to try and *with what protocol* — the registry
  already holds that.
- **Firmware** gains one generic verb and no new per-sensor knowledge:

```
PROBE <gpio> <protocol>      -> {"ok":true,"value":…} | {"ok":false}
```

`reply_scan` then reports a `gpio-protocol` array instead of the one-off
`"dht22":{"gpio":…,"ok":…}` key, and the browser resolves each result through the
registry like any other transport.

**Deliberately rejected — a board manifest** (`IDENT`/`CAPS` self-reporting the
pinout). It was proposed and is the right answer for *multi-board*, but as a
near-term change it is wrong three ways:

1. It does not remove duplication, it **relocates** it. The registry keeps geometry
   (`dx`/`dy`) while the board supplies pin numbers — two sources of truth for one
   pin, with the second copy moved from JS into C.
2. It **reverses a shipped decision.** `AGENTS.md` and the prior spec both state
   the browser supplies the register "so firmware holds no per-sensor knowledge". A
   manifest moves pin knowledge *into* firmware. That is an architecture reversal
   and needs its own argument, not a bullet in a batch.
3. It adds **version skew**: board fw 2.0's manifest against an older browser's
   bundled registry.

Registry stays authoritative. The manifest is the multi-board migration path, with
an explicit skew contract, in a later spec.

## 6. Actuators — a product decision, not an engineering one

A motor driver has `commands`, not `channels`. It is a new axis and the one place
"universal hardware" collides with *"coaching, never autonomous control"*.

**Recommended guardrail, for the team to confirm:**

- Commands are a **typed verb plus typed params in the adapter**, bounds in the
  registry. Explicitly **rejected:** a `"wireCommand": "DRIVE %d %d"` template in
  the registry — that puts wire-format strings and `%d` templating into the
  presentation registry, regressing the adapter seam, and untyped string params
  cannot carry a `-100..100` bound, so they cannot express the safety limit the
  guardrail depends on.
- One explicit human click per action. Never a free-running slider.
- **Structurally unreachable from `/tutor`**, mirroring the rule that the tutor
  never writes a file without a per-change Apply. The tutor may *discuss* a motor
  fault; it cannot move a motor.
- Warns on a dirty git tree, does not block.

**Recommendation: do not put this in the near-term slice.** A motor driver plus a
4-wheel chassis is a robotics product, not a sensor-reading twin — it expands the
safety surface, the firmware surface and the product scope in one step. Sequence
it after the pilot.

## 7. Scope of this work

**In, as one plan:**

1. Channel-keyed stream in firmware + adapter, with a 1.x legacy parser.
2. Registry: `channels` objects, `kind`/`presence` orthogonalised, ranges and
   precision in data. Delete `SENSOR_RANGES`, `LABELS`, `DECIMALS`.
3. `PROBE` verb; `reply_scan` reports a `gpio-protocol` array. Move GPIO4 out of
   `#define` into the registry — **the same pin, one owner.**
4. Generic sprite fallback.

**In, only if the kit actually ships them** (the driver today is a *budget line*
in `docs/Cost-Structure.md:26`, not a parts manifest — confirm before building):

5. Ultrasonic decoder (needs request/response) and IR digital read.
6. Analog channel for moisture, with the UI stating it is declared, not detected.

**Deferred, explicitly:** board manifest · external/community registry ·
multi-board adapters · `usbHints` (needs adapter #2 to rank) · actuators (§6).

**Unchanged:** the kit cannot measure current or voltage, so §3.3's wire colouring
stays a teaching label. Per-adapter baud stays impossible — Web Serial has no
`setBaudRate`, so 115200 is assumed for every board.

## 8. Open questions for the team

1. **Is the next kit real?** Items 5–6 depend on it, and the only evidence is a
   cost line. Confirm the parts list before either is built.
2. **`always` semantics for a declared GPIO channel.** If the DHT22 is declared
   rather than discovered, is it "present because the manifest says so" or
   "present because the probe answered"? These are different claims and the
   canvas should not conflate them.
3. **Actuators: after the pilot, or never?** A motor driver changes the safety
   story the whole project is built on.
4. **`DECIMALS` for a derived channel** — vibration is currently displayed to 1 dp
   because the adapter's `toFixed` won. Confirm 3 dp is wanted, since a resting
   board then reads `0.021` rather than `0.0`.

## 9. Carried-over open items (not this spec's job)

Recorded so they are not lost; tracked in `AGENTS.md` "Known open issues" where
applicable.

- **Component removal was missing entirely** and was assumed present by the prior
  spec. **Fixed** — `removeComponent` plus a per-sprite delete that prunes wires.
- **M9** — the pin gesture arms and detaches on `pointerdown`, so a wire is
  destroyed on mouse-*down* and a half-armed wire cannot be cancelled. Now worse:
  more sensors means more wires to lose.
- **M6** — `TwinCanvas` imports the concrete adapter for `referenceWiring`, so the
  board is still hardcoded in the view. This doc's §4 removes the *other* half of
  that duplication; this half remains.
- **M13** — `reply_scan`'s `list[512]` truncates silently on a full bus.
- **M16** — no C selftest for `reply_whoami` / `reply_scan` JSON shapes. Relevant
  here: §3 adds a third frame shape with no offline test.
- **Firmware has no off-target test path.** `proto_selftest` asserts only run on
  flashed hardware, which is why the MPU init bug survived to the bench. Every
  firmware change in §7 is untestable without a board until this is fixed.
- **Open hardware question:** the fitted MPU6050 ACKs at `0x68` and answers
  `WHO_AM_I 0x68`, but ignores its own configuration writes — `0x1A`/`0x1C` read
  back 0 after being written, and the sample registers read 0. No firmware change
  can make a part ignore its own configuration; swapping the module is the next
  test. The board now reports this honestly (`mpu.ready:false`, nulls) rather than
  streaming a fake `0.000 g`.
- **§3.5** (tutor reads/patches student source) remains deferred and independent.
  Its per-change-Apply pattern is the precedent §6 borrows for actuators.
