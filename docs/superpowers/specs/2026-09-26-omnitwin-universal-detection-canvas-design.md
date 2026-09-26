# OmniTwin Universal Detection + Canvas — Design Spec

Date: 2026-09-26 (rev 3)
Status: **§3.1–§3.4 IMPLEMENTED on `main`.** Plan:
`docs/superpowers/plans/2026-09-26-omnitwin-universal-detection-canvas.md`; commits
`d8e50c6`..`3a74fd4`. **§3.5 is deliberately deferred** to a later plan — see
"What landed" below. The design text below is otherwise unchanged from rev 3.
Supersedes: nothing in `2026-09-23-omnitwin-usb-twin-design.md` — extends it. That spec's firmware
protocol, canvas mechanics, and "no proactive LLM calls" decision are unchanged and inherited here.

## 0. What landed (added after implementation)

Read this before re-implementing anything here. Four places where the build
departed from the design below, each with its reason.

1. **Sprite art stayed in JSX, not in `components.json`** (§3.3). The spec says each
   component carries `{ svg, ... }`. SVG markup as JSON strings would need
   `dangerouslySetInnerHTML` to render — a real cost for author-created art that is
   never user data. The registry holds geometry and pins; `ComponentSprite.jsx` became a
   keyed lookup. Still "a lookup, not a `switch` case per part", which was the goal.
2. **A new firmware verb `WHOAMI <addr> <reg>`, not a readback inside `reply_scan`**
   (§3.2). The spec calls this "optionally a one-line firmware addition". It is not:
   `reply_scan` reads registers only through `mpu_r()`, bound to the configured MPU's
   handle, so an arbitrary address needs a temporary device handle. Worse, if firmware
   hardcoded *which* register to read, that knowledge would be duplicated between
   `main.c` and `components.json` — breaking §3.2's own promise that adding a sensor is
   a JSON edit. With the browser supplying the register, firmware holds zero per-sensor
   knowledge. `SCAN` now emits `{"addr":N}` with no `name` field (fw 1.1); a 1.0 board is
   still detected via the legacy `name` field, and an explicit `"name":null` still means
   "scanned and could not identify" so it never becomes a phantom sprite.
3. **The adapter probe opens the port once** (§3.1). The spec says "open the port at each
   adapter's baud rate in turn". Web Serial bakes `baudRate` into `open()` and the stable
   API has no `setBaudRate`, so per-adapter baud means a close/reopen cycle. Every serial
   board is 115200, so the loop runs over one already-open session.
4. **The wiring check is narrower than §3.3 implies.** What shipped is one comparison:
   differing pin `kind` is an error. Comparing voltage *labels* (3V3 vs 5V) was built and
   then cut — `3V3` is the only rail-form label in the registry, so the branch was
   unreachable. Add a `VIN`/5V pin to the esp32 entry and it becomes meaningful.

Also worth recording: `addWire` had **zero callers** when this work started, so §3.3 had no
UI to attach to. Wire *drawing* is a gesture, not just a model change, and it had to land
first. The breadboard carries two rail pins only — a real pin-grid is a v2, since nothing
in the kit can detect which breadboard hole a jumper is in.

One limit the design already states and the build confirmed: the kind check cannot catch
signal-to-signal miswiring (MPU `SDA` into the DHT's `DATA`). Expressing pin *function*
rather than pin *kind* would need a new dimension on the pin data.

## 1. Why this exists

The MVP hardcodes one board (ESP32 + `twinlab_node_v1` firmware) and one component table
(0x68/0x69 → mpu6050, DHT22 on a fixed GPIO). That's fine for the pilot kit but doesn't generalize:
adding a new sensor or supporting a different dev board currently means editing firmware and a JS
`switch` statement. This spec pulls board identity and component identity out of code and into data,
so "universal" means *extensible via registry*, not *every board pre-supported on day one*.

## 2. Scope

### In scope
- Board adapter abstraction: try multiple protocol dialects against a connected port instead of
  assuming one.
- Component registry: data-driven address/signature → part-name resolution, replacing the hardcoded
  `I2C_MAP` and `COMPONENTS` tables in `serialModel.mjs`.
- Pin-based canvas model: wires attach to named pins, not component centers; sprites come from a
  registry entry, not a hardcoded `switch`.
- Manual add/remove/correct stays first-class (already exists — `+ Add component` — keep it, it's
  the correctness backstop for anything auto-detection gets wrong).
- Platform decision: stay web (Chrome/Edge, Web Serial), keep the serial layer swappable.

### Out of scope (this doc)
- A community-contributed/public registry marketplace — the registry design below supports it later,
  but shipping it is a separate effort.
- Delegating code access to a locally-running opencode server — considered and rejected for the
  student-facing tutor (§3.5); opencode remains your own build tool for this repo only.
- Real electrical current/voltage simulation or measurement — the kit has no current sensor; §3.3's
  current-flow visualization is a labeling convention (power/ground/signal color coding), not a
  physics simulation.

## 3. Design

### 3.1 Board adapter abstraction (universal MCU detection)

Replace the single assumed protocol with a small ordered list of adapters. Each adapter is plain
data + parser functions, not a new codebase:

```ts
interface BoardAdapter {
  id: string                 // "twinlab_esp32_v1"
  label: string               // "OmniTwin ESP32 Node"
  baudRate: number
  usbHints?: { vendorId: number, productId?: number }[]  // ranking hint only, never a hard gate
  identCommand: string
  parseIdent(reply: unknown): { ok: true, info: DeviceInfo } | { ok: false }
  scanCommand: string
  parseScan(reply: unknown): RawSignal[]     // see 3.2
  streamOnCommand: string
  streamOffCommand: string
  parseStreamLine(line: unknown): Reading | null
}
```

Detection flow (browser side, extends `App.jsx`'s `connect()`):
1. Open the port at each adapter's baud rate in turn (or the hinted one first if `port.getInfo()`
   matches a `usbHints` entry — confirmed available via `SerialPort.getInfo()` returning
   `usbVendorId`/`usbProductId` when set).
2. Send that adapter's `identCommand`, wait with existing `withTimeout`.
3. First adapter whose `parseIdent` returns `ok: true` wins — proceed with its `scan`/`stream`
   commands for the rest of the session.
4. No adapter matches → manual board-profile picker (baud rate + "static canvas only, no live
   telemetry") rather than heuristic protocol-sniffing. Sniffing arbitrary third-party firmware is
   low-payoff effort for a classroom tool — don't build it.

**The actual path to "universal" is an OmniTwin firmware agent**, not sniffing: ship a small
Arduino/ESP-IDF/CircuitPython library students include in their own sketch that implements one of
these adapters' protocol. That's how you support "a student's own Arduino project," not by guessing
at whatever protocol they happened to write.

`[Assumed]` One firmware protocol dialect ships at launch (today's `twinlab_esp32_v1`); the adapter
list starts at length 1 and grows as you add agent libraries for other boards. Flag if you want more
than one dialect at launch.

### 3.2 Component registry (universal component detection)

Move `I2C_MAP`/`COMPONENTS` in `serialModel.mjs` into a data file, and make firmware's `SCAN` more
generic so new sensors don't require a firmware change:

```json
// frontend/src/registry/components.json — versioned independently of firmware
{
  "i2c": [
    { "candidateAddrs": [104, 105], "whoamiReg": "0x75", "whoamiVal": "0x68", "id": "mpu6050" },
    { "candidateAddrs": [118, 119], "whoamiReg": "0xD0", "whoamiVal": "0x58", "id": "bmp280" }
  ],
  "singleWire": [ { "id": "dht22" } ],
  "always": [ { "id": "esp32" }, { "id": "breadboard" } ]
}
```

Firmware side change: `SCAN` should return the raw ACK'd address **plus a WHOAMI-register readback
where one is known**, not decide the part name itself. Your firmware already does this pattern for
diagnostics (`reply_diag`'s `whoami` read) — extend it into `reply_scan` so two chips sharing the
same default address (common in I2C — address alone is not identity) can be told apart. The browser
resolves `{addr, whoami}` → part name via the registry above. This means adding a new sensor is a
JSON edit + optionally a one-line firmware addition (which register to read), not a new `case`.

Non-bus-scannable parts (analog sensors, plain GPIO switches) are **not auto-detectable** — that's a
hardware fact, not a gap to engineer around. Manual `+ Add` is the correct answer there, not a
workaround.

### 3.3 Canvas: pin-based placement + wiring correctness

Current model (`TwinCanvas.jsx`, `ComponentSprite.jsx`) draws wires between component centers and
hardcodes sprites in a `switch`. Changes:

- **Sprite + pin data moves into the same registry** as 3.2: each component id carries
  `{ svg, width, height, pins: [{ id, dx, dy, label, kind }] }`, where `kind` is
  `power | ground | signal`. Rendering becomes a lookup, not a `switch` case per part.
- **Wires store pin references, not coordinates**: `{ id, fromComponentId, fromPinId,
  toComponentId, toPinId }`. Screen position is computed at render time from the component's `x,y`
  plus its pin's `dx,dy`.
- **Rendering by kind**: power wires solid red, ground solid gray/black, signal/data wires keep the
  existing animated dashed stroke. This is a labeling convention for teaching, not a circuit
  simulation — no voltage/current magnitude is computed or measured (nothing in the kit can measure
  actual current draw). `[Assumed]` — flag if you want it to read as more than illustrative.
- **Free wiring-correctness check, zero LLM cost**: a wire connecting two pins of mismatched `kind`
  (e.g. `signal`→`ground`) is a wiring error you can catch client-side, same pattern as
  `anomalyFlags()` for sensor data. Feed this into the same anomaly-flag list the tutor already sees
  (§3.5) — this is the concrete "flag hardware/wiring problems" behavior from your requirements.
- **Reference wiring overlay**: the board adapter (§3.1) already knows its own real GPIO assignments
  (`SDA_IO`, `SCL_IO`, `DHT_IO` today). Expose those as a `referenceWiring` field on the adapter and
  render a togglable ghost overlay of "how this board is actually wired" for the student to compare
  against what they placed. Important limitation: this is the *firmware's* fixed pin config, not a
  read of the *physical* jumper wires — nothing in this kit can detect which literal wire is plugged
  into which breadboard hole, only that a device answered on a given bus/pin. The reference overlay
  and the mismatch check above are the practical substitute for that.

`[Assumed]` Scale stays in the "tens of components per rig" range, so no canvas library swap
(react-flow, Konva) — revisit only if you add zoom/pan/rotation or 50+ components on one canvas.

Layout persistence: keep `localStorage` for the in-session draft; if you want a saved rig template
per student across sessions, write it through the backend to the existing Mongo device roster
(`backend/routers/roster.py` already exists for device identity — extend it, don't build a parallel
store).

### 3.4 Platform: stay web

No change from the prior decision — restating because it's now load-bearing for the adapter design
above: `serialBridge.js`'s three-function surface (`supportsSerial`, `requestPort`, `SerialSession`)
stays the seam. If a school's policy blocks Web Serial later, wrap the same React app in Tauri with a
Rust serial backend implementing that identical surface — swap one file, not the app. Not building
this now; just don't couple `App.jsx` any tighter to `navigator.serial` than it already is.

### 3.5 Tutor — now includes code, still on-demand only

Confirmed scope: hardware/wiring **and** code problems, flagged for the student, with two explicit
modes — the student fixes it themselves, or asks the tutor to fix it (tutor then explains the diff).
Not autonomous: the tutor never writes a file without an explicit per-change approval click. Still
no proactive/background LLM calls — unchanged from the original spec.

**Code access: File System Access API, not a duplicate of opencode.** opencode is your build tool for
this repo, not something the pilot's students will have installed — don't build the tutor's code
access as a client of an opencode server; that adds a required background process and a config step
students won't have. Use `window.showDirectoryPicker()` (Chrome/Edge, consistent with the existing
Web Serial platform choice — no new install): student grants access to their project folder once,
same UX pattern as picking a COM port. OmniTwin reads a `FileSystemDirectoryHandle` from then on.

- Build a simple file tree from the handle, filtered to known firmware extensions (`.c .h .ino .py`);
  student (or a default heuristic — most-recently-modified matching file) picks which file(s) the
  tutor considers. Don't dump an entire unrelated folder into LLM context.
- Zero-LLM-cost pass first, same philosophy as `anomalyFlags()` for sensor data: a small
  `codeFlags()` heuristic (blocking calls in a task loop, mismatched `printf` format specifiers,
  missing bounds checks on array/register indices) runs client-side before any LLM call. The browser
  cannot invoke a compiler (`idf.py build`) — if the student has build/compiler output, give them a
  paste box for it as extra free context; don't attempt to execute their code.
- `/tutor` context payload grows to include: rig state (existing) + selected file content(s) + any
  static flags or pasted build output + chat history. Cap total file content sent (e.g. a few hundred
  lines) and tell the student when something was truncated — don't silently drop content.

**Two modes, both explicit:**
1. **Explain/flag** (default) — tutor responds with what's wrong, where (file:line), why, and a
   nudge toward the fix. No write, ever, in this mode.
2. **"Fix this for me"** — separate, explicit action. LLM returns a patch for one file
   (`{filePath, diff, explanation}`). Frontend renders the diff and explanation **before** writing
   anything. Write only happens on an explicit "Apply" click, and only after re-reading the file at
   apply-time to confirm it hasn't changed since the diff was generated (reject and refresh if it
   has — protects against clobbering an edit made in the meantime in the student's own editor).

`[Assumed]` If the project folder is a git repo, remind the student to commit before applying a fix
(cheap safety net, doesn't block non-git projects). Flag if you'd rather block Apply entirely without
a clean git tree.

`[Assumed]` Sending student source code to a third-party LLM (Groq) is acceptable for this pilot the
same way sensor readings already are — worth a one-line disclosure in the tutor UI ("your code is
sent to an AI provider to answer this"), not a legal opinion, just a UX honesty note. Flag if your
pilot needs a formal data-handling statement instead.

## 4. Migration from current code (concrete, file-by-file)

1. `firmware/twinlab_node_v1/main/main.c` — `reply_scan()`: add optional WHOAMI-register readback
   per candidate address (pattern already exists in `reply_diag()`), include raw byte in JSON.
2. `frontend/src/registry/components.json` — new file, seed with today's two sensors (mpu6050,
   dht22) plus esp32/breadboard as `always`-present entries.
3. `frontend/src/serial/serialModel.mjs` — replace `I2C_MAP`/`COMPONENTS`/`DEFAULT_POS` literals with
   registry lookups; `scanToComponents()` resolves via WHOAMI+registry instead of address-only.
4. `frontend/src/components/ComponentSprite.jsx` — replace `switch` with registry-driven SVG lookup.
5. `frontend/src/components/TwinCanvas.jsx` — wire model changes from `{from, to}` (component ids) to
   `{fromComponentId, fromPinId, toComponentId, toPinId}`; `pos()` helper reads pin `dx,dy` from
   registry.
6. New `frontend/src/serial/adapters/` — one file per `BoardAdapter`; today's protocol becomes
   `twinlab_esp32_v1.js`; `App.jsx`'s `connect()` loops adapters instead of assuming one.

## 5. Testing

- `tests/serialModel.test.mjs` (exists) — extend for registry-based resolution incl. WHOAMI
  collision cases (two candidate parts, same address, different WHOAMI).
- New: adapter-selection test with a mocked port replying to two different `IDENT` dialects — assert
  correct adapter wins and the other is never sent further commands.
- Firmware: existing `proto_selftest()` pattern — add a selftest asserting `reply_scan()`'s WHOAMI
  byte is included when a candidate address ACKs.
- Manual: connect real MPU6050, confirm registry resolves it via WHOAMI not address-guessing; unplug
  it, confirm scan still completes and `+ Add` still works.

## 6. Open questions

None blocking. Two defaults assumed, flag if wrong:
1. "Apply fix" (§3.5) warns on a dirty git tree but doesn't block — flip to hard-block if preferred.
2. Current-flow visualization (§3.3) is illustrative (color-coded by pin kind), not a real
   voltage/current simulation — flag if you expected actual measured values (would need a current
   sensor in the kit, which doesn't exist today).

## 7. Carried-over constraints

- LLM key never in browser/client code — unchanged, still server-side in `/tutor`.
- Everything else from the prior spec's "Hard constraints" (dev-machine specifics like
  `D:\TwinLab_v2`, PowerShell-only) — not re-asserted here since they're unrelated to this doc's
  scope; confirm separately if opencode's environment differs from the original dev setup.
