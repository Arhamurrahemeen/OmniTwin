# OmniTwin Universal Detection + Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded board/component tables with a data-driven registry and a pluggable board-adapter seam, then add pin-based wire drawing with a free client-side wiring-correctness check.

**Architecture:** Two data/parse layers replace hardcoded tables. `components.json` becomes the single source of truth for part identity, sprite geometry, and pin metadata (`kind`: power/ground/signal); the browser resolves `{addr, whoami}` to a part through it, so adding a sensor is a JSON edit. A `BoardAdapter` object (one file, one dialect today) owns every protocol string and parser, and `detectAdapter()` probes dialects over a single already-open port. The canvas then attaches wires to named pins rather than component centers, which makes a kind-mismatch check possible with no LLM cost.

**Tech Stack:** ESP-IDF 6.0.2 C (firmware, UART0 line-delimited JSON); React 19 + Vite 8 + Web Serial (browser); `node --test` (frontend pure logic); no new npm or pip dependencies.

**Spec:** `.superpowers/sdd/2026-09-26-omnitwin-universal-detection-canvas-design.md`

**Scope note:** This plan covers spec §3.1, §3.2, §3.3 only. Spec §3.5 (tutor reads/patches student source files via the File System Access API) is **deferred to a later plan** — it is roughly half the spec's effort, the lowest-confidence part, and nothing in §3.1–§3.3 depends on it. §3.4 (stay web) needs no code: `serialBridge.js`'s three-function surface is already the seam, and this plan does not couple `App.jsx` to `navigator.serial` any further.

## Global Constraints

- Never `git push`. PowerShell only (PS 5.1); chain with `;`, never `&&`.
- `GROQ_API_KEY` never appears in `frontend/` code or commits. It stays server-side in `backend/.env`.
- UART0 carries JSON only. `esp_log_level_set("*", ESP_LOG_NONE)` stays — a single interleaved `ESP_LOGI` corrupts a JSON line and desyncs the browser parser. Do not add logging on UART0.
- `SCAN` needs a **20000 ms** timeout. The board sweeps I2C `0x03..0x77` (117 addresses); ~12 s on an empty bus. The 5 s default in `SerialSession.command()` is wrong for `SCAN`. This is now carried on the adapter as `scanTimeoutMs`.
- The board degrades gracefully and that is intentional: no sensors still answers IDENT/PING/SCAN and streams DHT-only rows with `ax/ay/az: null`. `vib` is suppressed when accel is absent. Do not make any of these a hard error.
- `frontend/src/serial/serialModel.mjs` stays **pure** — no DOM, no `navigator.serial`. All new logic goes there (or a new pure module), never into `serialBridge.js`.
- No new npm or pip dependencies. No MQTT, no InfluxDB, no simulator.
- Frontend tests: `node --test "frontend/tests/*.test.mjs"` **from the repo root**. The previously documented forms (`node --test frontend\tests`, `node --test tests/` from `frontend/`) both fail on Node 24 with `MODULE_NOT_FOUND`.
- Firmware: `cd firmware\twinlab_node_v1; idf.py build`. Verify against installed ESP-IDF v6 headers before using any i2c_master symbol; ESP-IDF may not be on `PATH` in the implementing shell.
- Canvas scale stays "tens of components per rig". No canvas library (react-flow, Konva). Revisit only at 50+ components or if zoom/pan/rotation is added.
- The current-flow visualization is a **labeling convention** (color by pin `kind`), not a voltage/current simulation. Nothing in the kit can measure actual current. Do not present it as measured data.
- The tutor remains strictly on-demand. `TutorPanel` never auto-fires. No change to that in this plan.

## Deliberate deviations from the spec

Three places where this plan departs from the spec's literal wording, each for a stated reason. Do not "correct" these back.

1. **Sprite art stays in JSX, not in `components.json`.** The spec says each component carries `{ svg, width, height, pins }`. SVG markup as JSON strings would require `dangerouslySetInnerHTML` to render, which is a real XSS-shaped cost for zero benefit (the art is author-created, not user data). The registry holds geometry (`size`) and pins; `ComponentSprite.jsx` becomes a keyed lookup of JSX elements. This still achieves the spec's stated goal — "rendering becomes a lookup, not a `switch` case per part."
2. **New firmware command `WHOAMI <addr> <reg>`, not a WHOAMI readback inside `reply_scan`.** The spec calls this "optionally a one-line firmware addition." It is not: `reply_scan` can only read registers through `mpu_r()`, which is bound to the configured MPU's device handle, so a read on an arbitrary ACK'd address needs a temporary device handle. Worse, if firmware hardcodes *which* register to read, that knowledge is duplicated between `main.c` and `components.json` — breaking the spec's own promise that adding a sensor is a JSON edit. With the browser supplying the register from the registry, firmware gains one generic command and zero per-sensor knowledge.
3. **The adapter probe opens the port once.** The spec says "open the port at each adapter's baud rate in turn." Web Serial bakes `baudRate` into `open()` and the stable API has no `setBaudRate`, so changing baud requires a close/reopen cycle. Every serial board is 115200; the plan opens once and loops IDENT dialects over the same open session. Reopen only if a future adapter declares a different `baudRate` than the one already open.

**One spec item is a no-op, noted so it is not "fixed" later:** §3.3 says "keep `localStorage` for the in-session draft." There is no `localStorage` anywhere in the current frontend — `App.jsx` holds layout in `useState` only. There is nothing to keep, so this plan does not add any. Saved rig templates across sessions remain out of scope; the spec's suggestion to write them through `backend/routers/roster.py` is a separate piece of work.

## Review Focus

Inputs the spec implies but no task's happy path exercises; each line is pinned to a test in the owning task.

1. **Old 1.0 firmware still connected** (browser updated, board not reflashed) → `SCAN` replies have no `whoami` and carry the legacy `name` field. Detection must still resolve the MPU6050 and the DHT22; a silent "no sensors found" is the failure. (Tasks 2 + 3)
2. **Adapter probe times out** (wrong COM port, board not running) → `SerialSession.command()` sets `this._resolver` and `withTimeout` rejects, but **nothing ever clears `_resolver`**. The next `command()` throws `Command already in flight` instead of probing the next adapter, so the connect dies with a misleading error and no manual-mode fallback. Pre-existing latent bug; the adapter loop hits it on its very first failure. (Task 4)
3. **Nothing on the port answers any dialect** → must surface a clear message and drop into manual canvas mode (`+ Add component`), not hang and not hard-error. This is spec §3.1 step 4. (Task 4)
4. **Unrecognized I2C address** (`name: null`, no registry entry) → must produce **no** component. A phantom sprite for an unknown chip is worse than nothing, because the student will try to wire it. (Task 2)
5. **A wire references a component or pin that is not on the canvas** (component removed, or a registry edit dropped a pin) → both the renderer and `wiringFlags` must skip that wire, not draw it to (0,0) and not flag it as a fault. (Tasks 5 + 6)
6. **A student wires 3V3 → GND, or a signal pin into a ground pin** → must be flagged by name ("SDA (GPIO21) wired to GND (MPU6050)"), not silently rendered in the same green as a correct wire. (Task 6)

---

### Task 1: Correct the documentation that misdirects agents

No test cycle. Four one-line corrections; each was verified broken or wrong against the running repo.

**Files:**
- Modify: `AGENTS.md` (spec path claim; two test commands)
- Modify: `README.md` (test command)
- Modify: `frontend/package.json` (`test` script)

- [ ] **Step 1: Fix the AGENTS.md spec pointer**

AGENTS.md currently claims `.superpowers/sdd/` "doesn't exist in this repo; if you see it referenced elsewhere, it's stale," and points at `docs/superpowers/specs/2026-09-26-omnitwin-universal-detection-canvas-design.md`, which does not exist. The only copy of the spec is `.superpowers/sdd/2026-09-26-omnitwin-universal-detection-canvas-design.md`. Correct both the path and the "that path doesn't exist" claim. Also correct the frontend test command in the same file's Commands block.

- [ ] **Step 2: Fix the frontend test command in AGENTS.md and README.md**

Both currently document a form that fails. Replace with:

```powershell
node --test "frontend/tests/*.test.mjs"    # from repo ROOT
```

- [ ] **Step 3: Fix the `test` script in `frontend/package.json`**

Change `"test": "node --test tests/"` to `"test": "node --test \"tests/*.test.mjs\""` so `npm test` works from `frontend/`.

- [ ] **Step 4: Verify all three are consistent**

Run: `Select-String -Path AGENTS.md,README.md,frontend\package.json -Pattern "node --test"`

Expected: every hit uses a `*.test.mjs` glob. No `node --test tests/` and no `node --test frontend\tests` remains anywhere in those three files.

- [ ] **Step 5: Confirm the suite is green before and after**

Run: `node --test "frontend/tests/*.test.mjs"` from repo root

Expected: `pass 14`, `fail 0`.

- [ ] **Step 6: Commit**

```powershell
git add AGENTS.md README.md frontend/package.json
git commit -m "docs: correct spec path and frontend test command (all 3 documented forms failed on Node 24)"
```

---

### Task 2: Component registry — one data source for identity, geometry, and pins

The foundation. Kills `I2C_MAP`, `COMPONENTS`, and `DEFAULT_POS` from `serialModel.mjs`, and turns `ComponentSprite`'s `switch` into a lookup. No firmware change, no visible UI change — same canvas, new source of truth.

**Files:**
- Create: `frontend/src/registry/components.json`
- Create: `frontend/src/registry/registry.mjs`
- Modify: `frontend/src/serial/serialModel.mjs:1-95` (delete `COMPONENTS`, `I2C_MAP`, `DEFAULT_POS`; rewrite `scanToComponents`, `addComponent`, `defaultLayout`, `scanNotice`)
- Modify: `frontend/src/components/ComponentSprite.jsx:1-46` (switch → keyed lookup)
- Modify: `frontend/src/components/TwinCanvas.jsx:6,47,78` (import `componentDef` instead of `COMPONENTS` for labels and the Add-component picker)
- Modify: `frontend/tests/serialModel.test.mjs` (update existing tests; add registry tests)

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces — `frontend/src/registry/registry.mjs` exports:
  - `REGISTRY` — the parsed JSON, verbatim.
  - `allComponents() -> CompDef[]` — every entry, in registry order: `i2c`, then `singleWire`, then `always`.
  - `componentDef(id: string) -> CompDef | null`
  - `isKnown(id: string) -> boolean`
  - `resolveScanEntry(entry: { addr: number, whoami?: number | null, name?: string | null }) -> CompDef | null`
  - `pinDef(componentId: string, pinId: string) -> PinDef | null`
  - `whoamiRequests(scan: object) -> { addr: number, reg: number }[]`
  - `CompDef` = `{ id, label, size: {w, h}, defaultPos: {x, y}, reads?: string[], pins: PinDef[] }`
  - `PinDef` = `{ id, label, kind: 'power' | 'ground' | 'signal', dx, dy, gpio?: number }`
  - `serialModel.mjs` re-exports `componentDef`, `allComponents`, `pinDef` so UI modules import from one place.

- [ ] **Step 1: Write `components.json`**

Exact content — these values are decisions, not placeholders. `dx`/`dy` are pixel offsets from the sprite's top-left corner and must sit on the sprite's visible edge.

```json
{
  "$comment": "Single source of truth for component identity, sprite geometry, and pin kinds. Adding a sensor = an entry here, no firmware or JS change. whoamiReg/whoamiVal are hex strings matching the WHOAMI <addr> <reg> reply. kind drives wire color and the wiring-correctness check.",
  "i2c": [
    {
      "id": "mpu6050", "label": "MPU6050",
      "candidateAddrs": [104, 105],
      "whoamiReg": "0x75", "whoamiVal": "0x68",
      "reads": ["ax", "ay", "az"],
      "size": { "w": 70, "h": 70 },
      "defaultPos": { "x": 320, "y": 90 },
      "pins": [
        { "id": "VCC",  "label": "VCC",  "kind": "power",  "dx": 12, "dy": 10 },
        { "id": "GND",  "label": "GND",  "kind": "ground", "dx": 12, "dy": 60 },
        { "id": "SDA",  "label": "SDA",  "kind": "signal", "dx": 58, "dy": 10 },
        { "id": "SCL",  "label": "SCL",  "kind": "signal", "dx": 58, "dy": 60 }
      ]
    }
  ],
  "singleWire": [
    {
      "id": "dht22", "label": "DHT22",
      "reads": ["temp", "hum"],
      "size": { "w": 70, "h": 70 },
      "defaultPos": { "x": 90, "y": 90 },
      "pins": [
        { "id": "VCC",  "label": "VCC",  "kind": "power",  "dx": 20, "dy": 18 },
        { "id": "GND",  "label": "GND",  "kind": "ground", "dx": 20, "dy": 52 },
        { "id": "DATA", "label": "DATA", "kind": "signal", "dx": 52, "dy": 35 }
      ]
    }
  ],
  "always": [
    {
      "id": "esp32", "label": "ESP32",
      "size": { "w": 120, "h": 90 },
      "defaultPos": { "x": 120, "y": 300 },
      "pins": [
        { "id": "3V3", "label": "3V3",       "kind": "power",  "dx": 20,  "dy": 6 },
        { "id": "GND", "label": "GND",       "kind": "ground", "dx": 20,  "dy": 84 },
        { "id": "SDA", "label": "SDA (GPIO21)", "kind": "signal", "dx": 60,  "dy": 6,  "gpio": 21 },
        { "id": "SCL", "label": "SCL (GPIO22)", "kind": "signal", "dx": 60,  "dy": 84, "gpio": 22 },
        { "id": "DHT", "label": "GPIO4",        "kind": "signal", "dx": 100, "dy": 6,  "gpio": 4 }
      ]
    },
    {
      "id": "breadboard", "label": "Breadboard",
      "size": { "w": 200, "h": 90 },
      "defaultPos": { "x": 260, "y": 180 },
      "//": "ponytail: two rail pins only. A real pin-grid (rows x columns) is a v2 — nothing in this kit can detect which breadboard hole a jumper is in, so finer granularity would be modelled fiction.",
      "pins": [
        { "id": "VCC", "label": "+ rail", "kind": "power",  "dx": 100, "dy": 20 },
        { "id": "GND", "label": "- rail", "kind": "ground", "dx": 100, "dy": 70 }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing registry tests**

Add to `frontend/tests/registry.test.mjs` (new file):

```js
import test from 'node:test'
import assert from 'node:assert'
import {
  REGISTRY, allComponents, componentDef, isKnown,
  resolveScanEntry, pinDef, whoamiRequests,
} from '../src/registry/registry.mjs'

test('registry seeds exactly today\'s four parts', () => {
  assert.deepEqual(allComponents().map(c => c.id).sort(), ['breadboard', 'dht22', 'esp32', 'mpu6050'])
})

test('every component has a label, size, defaultPos, and at least one pin', () => {
  for (const c of allComponents()) {
    assert.ok(c.label, `${c.id} label`)
    assert.ok(c.size.w > 0 && c.size.h > 0, `${c.id} size`)
    assert.equal(typeof c.defaultPos.x, 'number', `${c.id} defaultPos.x`)
    assert.ok(c.pins.length > 0, `${c.id} pins`)
  }
})

test('pin ids are unique within a component and kinds are legal', () => {
  for (const c of allComponents()) {
    const ids = c.pins.map(p => p.id)
    assert.equal(new Set(ids).size, ids.length, `${c.id} duplicate pin id`)
    for (const p of c.pins) assert.ok(['power', 'ground', 'signal'].includes(p.kind), `${c.id}.${p.id} kind`)
  }
})

test('pinDef finds a pin and returns null for an unknown one', () => {
  assert.equal(pinDef('mpu6050', 'SDA').kind, 'signal')
  assert.equal(pinDef('mpu6050', 'NOPE'), null)
  assert.equal(pinDef('nonexistent', 'SDA'), null)
})

test('resolveScanEntry prefers a WHOAMI match over the address', () => {
  // 104 is in mpu6050.candidateAddrs, but the WHOAMI byte says it is not one.
  assert.equal(resolveScanEntry({ addr: 104, whoami: 0x58, name: 'mpu6050' })?.id, null)
  assert.equal(resolveScanEntry({ addr: 104, whoami: 0x68 })?.id, 'mpu6050')
})

test('resolveScanEntry falls back to the legacy firmware name, then the address', () => {
  assert.equal(resolveScanEntry({ addr: 104, name: 'mpu6050' })?.id, 'mpu6050')
  assert.equal(resolveScanEntry({ addr: 105 })?.id, 'mpu6050')
})

test('resolveScanEntry returns null for an unknown address — no phantom component', () => {
  assert.equal(resolveScanEntry({ addr: 72, name: null }), null)
  assert.equal(resolveScanEntry({ addr: 72, whoami: 0x11 }), null)
})

test('whoamiRequests asks only for addresses the registry has a register for', () => {
  const scan = { i2c: [{ addr: 104 }, { addr: 72 }] }
  assert.deepEqual(whoamiRequests(scan), [{ addr: 104, reg: 0x75 }])
})

test('whoamiRequests is empty when the bus is empty', () => {
  assert.deepEqual(whoamiRequests({ i2c: [] }), [])
})
```

- [ ] **Step 3: Run the registry tests to verify they fail**

Run: `node --test "frontend/tests/registry.test.mjs"` from repo root

Expected: FAIL — `Cannot find module .../src/registry/registry.mjs`.

- [ ] **Step 4: Implement `registry.mjs`**

Import the JSON with an import attribute — Node 24 and Vite 8 both support this with no flag (verified):

```js
// registry.mjs
// Data-driven component registry. Pure — no DOM, no Web Serial.
import REGISTRY_JSON from './components.json' with { type: 'json' }

export const REGISTRY = REGISTRY_JSON
```

Then implement the seven exports. Decisions they encode:
- `allComponents()` concatenates `[...i2c, ...singleWire, ...always]`.
- `resolveScanEntry` resolves in two tiers, and the tiers are **not** interchangeable:
  - **If `entry.whoami` is a number** (not null, not undefined) it is **authoritative and final** — return the `i2c` entry whose `whoamiVal` parses to that byte *and* whose `candidateAddrs` includes `entry.addr`, or return `null` if none matches. Do **not** fall through to the name or the address. A chip that answers 0x58 on register 0x75 is not an MPU6050 no matter what a 1.0 firmware called it or what address it sits at.
  - **If `entry.whoami` is absent or null** (1.0 firmware, or a probe that got no answer) fall back to: an entry whose `id === entry.name`, then an `i2c` entry whose `candidateAddrs` includes `entry.addr`, then `null`.
  - Parse hex with `parseInt(s, 16)`.
- `whoamiRequests(scan)` returns one `{ addr, reg: parseInt(def.whoamiReg, 16) }` per distinct address in `scan.i2c` that appears in some `i2c` entry's `candidateAddrs` and has a `whoamiReg`. Dedupe by address.
- `pinDef(componentId, pinId)` returns the pin or `null`.

- [ ] **Step 5: Run the registry tests to verify they pass**

Run: `node --test "frontend/tests/registry.test.mjs"` from repo root

Expected: `pass 9`, `fail 0`.

- [ ] **Step 6: Write the failing `serialModel` tests for registry-backed resolution**

In `frontend/tests/serialModel.test.mjs`, the existing `scanToComponents` tests already assert the right behavior and should pass unchanged — that is the point. Add:

```js
test('scanToComponents ignores an address no registry entry claims', () => {
  const s = parseScan('{"i2c":[{"addr":72,"name":null}],"dht22":{"gpio":4,"ok":true}}')
  const types = scanToComponents(s).map(c => c.type)
  assert.deepEqual(types.sort(), ['breadboard', 'dht22', 'esp32'])
})

test('scanToComponents uses WHOAMI when the board supplies it', () => {
  const s = parseScan('{"i2c":[{"addr":104,"whoami":112}],"dht22":{"gpio":4,"ok":false}}')
  assert.ok(scanToComponents(s).map(c => c.type).includes('mpu6050'))
})

test('scanToComponents drops an MPU whose WHOAMI byte is wrong', () => {
  const s = parseScan('{"i2c":[{"addr":104,"whoami":88}],"dht22":{"gpio":4,"ok":false}}')
  assert.ok(!scanToComponents(s).map(c => c.type).includes('mpu6050'))
})

test('defaultLayout positions come from the registry, not a hardcoded table', () => {
  const l = defaultLayout([{ type: 'dht22' }])
  assert.deepEqual({ x: l.components[0].x, y: l.components[0].y }, { x: 90, y: 90 })
})

test('addComponent rejects an id the registry does not define', () => {
  assert.throws(() => addComponent(defaultLayout([]), 'bmp280'), /Unknown component/)
})
```

- [ ] **Step 7: Run `serialModel` tests to verify the new ones fail**

Run: `node --test "frontend/tests/serialModel.test.mjs"` from repo root

Expected: the WHOAMI and unknown-address tests FAIL; the four pre-existing `scanToComponents`/`scanNotice`/`defaultLayout`/`addComponent` tests still PASS.

- [ ] **Step 8: Rewrite `serialModel.mjs` to use the registry**

Delete `COMPONENTS`, `I2C_MAP`, and `DEFAULT_POS` outright — do not leave them as aliases. Then:
- `scanToComponents(scan)` starts from the `always` entries, pushes `resolveScanEntry(e)?.id` for each `scan.i2c` entry that resolves, and pushes each `singleWire` entry whose `id` is present in `scan` with `ok: true` (today: `scan.dht22?.ok`).
- `scanNotice(scan)` and `defaultLayout(components)` read `label` and `defaultPos` via `componentDef`. `defaultLayout`'s fallback for an id with no `defaultPos` stays a diagonal offset.
- `addComponent` throws `Unknown component: ${type}` when `componentDef(type)` is null.
- Re-export `componentDef`, `allComponents`, `pinDef` for UI consumers.

- [ ] **Step 9: Convert `ComponentSprite.jsx` to a lookup**

Replace the `switch` with a module-level `const SPRITES = { esp32: (<svg .../>), breadboard: (...), mpu6050: (...), dht22: (...) }` holding the four existing SVG bodies verbatim, and `export default function ComponentSprite({ type }) { return SPRITES[type] ?? <span>?</span> }`. No SVG geometry changes in this task — the `dx`/`dy` values in Step 1 were chosen against the *existing* art.

- [ ] **Step 10: Point `TwinCanvas.jsx` at the registry**

Three references to `COMPONENTS`: the label lookup at line 47, the `+ Add component` `<option>` list at line 78, and the import at line 6. Replace all three with `componentDef(...)` / `allComponents()`. Behavior must be identical — the picker lists the same four parts in the same order.

- [ ] **Step 11: Run the full frontend suite, then lint and build**

```powershell
node --test "frontend/tests/*.test.mjs"
cd frontend; npm run lint; npm run build
```

Expected: all tests pass (14 pre-existing + 9 registry + 5 new), oxlint clean, Vite build succeeds. The JSON import must resolve in the Vite build — if it does not, add `resolveJsonModule` handling rather than converting the registry to a `.mjs`.

- [ ] **Step 12: Commit**

```powershell
git add frontend/src/registry frontend/src/serial/serialModel.mjs frontend/src/components frontend/tests
git commit -m "feat(frontend): data-driven component registry replaces I2C_MAP/COMPONENTS/DEFAULT_POS and the sprite switch"
```

---

### Task 3: Firmware `WHOAMI` command + `SCAN` stops naming parts

Makes part identity come from the bus rather than from firmware. Backward compatible: the browser still resolves a 1.0 board via the legacy `name` field.

**Files:**
- Modify: `firmware/twinlab_node_v1/main/main.c:67-96` (`parse_cmd`, `proto_selftest`), `:255-280` (`reply_ident`, `reply_scan`), `:311-320` (`handle_cmd`)
- Modify: `frontend/src/serial/demoSession.mjs:18-36` (match the 1.1 contract)

**Interfaces:**
- Consumes: Task 2's `components.json` — nothing imports it, but the `whoamiReg` values there (`0x75`) are what the browser will send to this command.
- Produces — wire contract, additive except where noted:
  - request `WHOAMI <addr> <reg>` → `{"whoami":<int>}`, or `{"whoami":-1}` when the address does not ACK or the read fails. `-1` means "no answer"; the browser maps any negative value to `null`.
  - `SCAN` reply: the `name` field is **removed** from each entry. Entries become `{"addr":104}`. `dht22` and `bus` blocks are unchanged.
  - `IDENT` reply: `fw` bumps from `"1.0"` to `"1.1"`.
  - `parse_cmd` gains `CMD_WHOAMI`; a new `static whoami_arg_t parse_whoami(const char *line)` returns `{ addr, reg, ok }` where `ok` is false for a missing, malformed, or out-of-range (`< 0x08` or `> 0x77`) argument.

- [ ] **Step 1: Write the failing firmware self-tests**

Add to `proto_selftest()` in `main.c`:

```c
    assert(parse_cmd("WHOAMI 104 117") == CMD_WHOAMI);
    assert(parse_whoami("WHOAMI 104 117").ok);
    assert(parse_whoami("WHOAMI 104 117").addr == 104);
    assert(parse_whoami("WHOAMI 104 117").reg == 117);
    assert(parse_whoami("WHOAMI 104 0x75").reg == 0x75);   /* hex accepted */
    assert(!parse_whoami("WHOAMI").ok);
    assert(!parse_whoami("WHOAMI 104").ok);
    assert(!parse_whoami("WHOAMI 999 117").ok);             /* out of 7-bit range */
    assert(!parse_whoami("WHOAMI 104 117 junk").ok);
```

- [ ] **Step 2: Build to verify the self-tests fail to compile**

Run: `cd firmware\twinlab_node_v1; idf.py build`

Expected: compile error — `parse_whoami` and `CMD_WHOAMI` are undefined.

- [ ] **Step 3: Implement `CMD_WHOAMI` and `parse_whoami`**

Add `CMD_WHOAMI` to the `cmd_t` enum, recognize the `WHOAMI` prefix in `parse_cmd`, and add `parse_whoami`. Parse with `sscanf(line, "WHOAMI %i %i", &addr, &reg) == 2` (`%i` accepts decimal and `0x` hex) and reject trailing junk by checking the format consumed the whole argument — if rejecting trailing junk proves fiddly, drop only the `junk` assertion above rather than adding a parser. `ok` requires both parses, `0x08 <= addr <= 0x77`, and `0x00 <= reg <= 0xFF`.

- [ ] **Step 4: Implement `reply_whoami`**

`static void reply_whoami(int addr, int reg)`. Create a temporary `i2c_device_config_t` (`.dev_addr_length = I2C_ADDR_BIT_LEN_7`, `.device_address = addr`, `.scl_speed_hz = 100000`), `i2c_master_bus_add_device`, `i2c_master_transmit_receive` one byte from `reg`, then `i2c_master_bus_rm_device`. Print `{"whoami":<val>}` with `val = -1` on any failure.

Confirm the exact ESP-IDF v6 symbol names against the installed headers before writing this — `grep -n "bus_rm_device\|bus_add_device" $IDF_PATH/components/esp_driver_i2c/include/driver/i2c_master.h`. If IDF is not on `PATH` in your shell, say so and stop rather than guessing the API.

Add this comment above the function:

```c
/* ponytail: add/remove the device handle on every call instead of caching it.
   WHOAMI fires a handful of times per SCAN, not per stream row. Cache handles
   by address only if this ever shows up in a hot path. */
```

- [ ] **Step 5: Wire it into `handle_cmd`**

`case CMD_WHOAMI:` — re-parse the line with `parse_whoami` and call `reply_whoami(addr, reg)`. This means `handle_cmd` needs the raw line, not just the `cmd_t`; check how the line reaches it (the UART task at `main.c` reads the line then calls `parse_cmd`) and pass the line through. If threading the line is awkward, add `static char g_last_line[...]` set in the UART task before dispatch — but prefer the parameter.

- [ ] **Step 6: Strip the part name out of `reply_scan`**

Delete the `const char *name = ...` ternary and emit `{"addr":%d}`. Keep the 100 ms probe timeout for `MPU_ADDR`/`MPU_ADDR_ALT` — that is a latency accommodation for a flaky MPU, unrelated to naming. Update the function's comment to say the browser resolves identity via WHOAMI.

- [ ] **Step 7: Bump `fw` in `reply_ident` to `"1.1"`**

- [ ] **Step 8: Build and confirm the self-tests pass**

Run: `cd firmware\twinlab_node_v1; idf.py build`

Expected: build succeeds. `proto_selftest()` runs at boot and calls `assert`; ESP-IDF's `assert` aborts on failure, so a green build with a booting board is the signal.

- [ ] **Step 9: Update `DemoSession` to the 1.1 contract**

In `demoSession.mjs`: change the `SCAN` reply's i2c entry from `{ addr: 104, name: 'mpu6050' }` to `{ addr: 104 }`, bump `fw` to `'1.1'`, and add a `WHOAMI` case that returns `{ whoami: 0x68 }` when the line starts with `WHOAMI` and the address is 104 or 105, else `{ whoami: -1 }`. Match with `cmd.startsWith('WHOAMI')` before the existing `switch` (or add a `default` branch that inspects the prefix). This keeps `?demo=1` exercising the WHOAMI path in screenshots.

- [ ] **Step 10: Verify the browser still detects against the 1.1 contract**

Run the backend and dashboard (`powershell -File .\run.ps1`), open `http://localhost:5173/?demo=1`.

Expected: the scan notice reads `SCAN: ESP32 + MPU6050, DHT22` — identical to before. If it reads "no sensors found", the browser is not yet sending `WHOAMI`; that is Task 4's job, so instead assert that the **legacy** path still works by confirming `scanToComponents({i2c:[{addr:104}], dht22:{ok:true}})` returns `mpu6050` in the test suite. Do not add the `WHOAMI` round trip to `App.jsx` in this task.

- [ ] **Step 11: Commit**

```powershell
git add firmware/twinlab_node_v1/main/main.c frontend/src/serial/demoSession.mjs
git commit -m "feat(firmware): WHOAMI <addr> <reg> command; SCAN no longer names parts (fw 1.1)"
```

---

### Task 4: Board adapter seam + adapter probing

`App.jsx` stops hardcoding `IDENT`/`SCAN`/`STREAM on`/`PING` and stops computing readings inline. Every protocol string and parser moves into one adapter file. Includes the fix for the `_resolver` leak that would otherwise make the probe loop unusable on its first failure.

**Files:**
- Create: `frontend/src/serial/adapters/twinlab_esp32_v1.js`
- Modify: `frontend/src/serial/serialBridge.js:59-65` (clear `_resolver` on timeout)
- Modify: `frontend/src/serial/serialModel.mjs` (add `detectAdapter`, `detectComponents`)
- Modify: `frontend/src/App.jsx:7-10,47-98` (`connect()` and the stream `onData` handler)
- Modify: `frontend/tests/serialModel.test.mjs` (adapter tests)
- Create: `frontend/tests/adapters.test.mjs`

**Interfaces:**
- Consumes: Task 2's `whoamiRequests` and `scanToComponents`; Task 3's `WHOAMI` wire contract.
- Produces:
  - `frontend/src/serial/adapters/twinlab_esp32_v1.js` default-exports one `BoardAdapter`:
    - `id: 'twinlab_esp32_v1'`, `label: 'OmniTwin ESP32 Node'`, `baudRate: 115200`
    - `identCommand: 'IDENT'`, `identTimeoutMs: 2000`
    - `pingCommand: 'PING'`
    - `scanCommand: 'SCAN'`, `scanTimeoutMs: 20000`
    - `streamOnCommand: 'STREAM on'`, `streamOffCommand: 'STREAM off'`
    - `referenceWiring: [{ from: ['esp32','SDA'], to: ['mpu6050','SDA'] }, { from: ['esp32','SCL'], to: ['mpu6050','SCL'] }, { from: ['esp32','DHT'], to: ['dht22','DATA'] }]`
    - `parseIdent(reply) -> { ok: true, info: { id, board, fw } } | { ok: false }`
    - `identityCommand(addr, reg) -> string`
    - `parseIdentity(reply) -> number | null` — null when `reply.whoami` is missing or negative
    - `isReading(obj) -> boolean` — `typeof obj?.ts === 'number'`
    - `toReading(obj) -> { temp, hum, vib, ax, ay, az }` — the exact mapping currently inlined in `App.jsx:62-64`
    - **No `usbHints` field.** It is a ranking hint for reordering adapters, and with one adapter there is nothing to rank. Guessing a VID/PID for a board nobody has measured would be a fabrication. The field stays optional in the interface for when adapter #2 lands.
  - `serialModel.mjs` exports:
    - `detectAdapter(session, adapters) -> Promise<{ adapter, info } | null>` — loops adapters, sends `adapter.identCommand` with `adapter.identTimeoutMs`, returns the first whose `parseIdent` yields `ok: true`. Swallows per-adapter errors and moves on. Returns `null` if none match. Must never send a non-IDENT command to a losing adapter.
    - `detectComponents(scan, askWhoami) -> Promise<{ type }[]>` — calls `askWhoami(addr, reg)` once per `whoamiRequests(scan)` entry, tolerating a rejected/throwing probe (treat as `null`), then resolves through `scanToComponents` with the merged entries. `askWhoami` is injected so this stays pure of Web Serial and testable with a stub.

- [ ] **Step 1: Write the failing adapter-selection tests**

Create `frontend/tests/adapters.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { detectAdapter, detectComponents } from '../src/serial/serialModel.mjs'

// Two dialects. Only the second answers its own IDENT verb.
const alpha = {
  id: 'alpha', baudRate: 9600, identCommand: 'ID', identTimeoutMs: 50,
  parseIdent: () => ({ ok: false }),
}
const beta = {
  id: 'beta', baudRate: 115200, identCommand: 'IDENT', identTimeoutMs: 50,
  parseIdent: (o) => (o?.id ? { ok: true, info: { id: o.id, board: o.board, fw: o.fw } } : { ok: false }),
  scanCommand: 'SCAN',
}

// A session that records every command it was asked to send.
const fakeSession = (replyFor) => {
  const sent = []
  return {
    sent,
    command: async (cmd) => { sent.push(cmd); return replyFor(cmd) },
  }
}

test('detectAdapter picks the adapter whose parseIdent succeeds', async () => {
  const s = fakeSession((c) => (c === 'IDENT' ? { id: 'TL-A1B2C3', board: 'twinlab-node', fw: '1.1' } : {}))
  const found = await detectAdapter(s, [alpha, beta])
  assert.equal(found.adapter.id, 'beta')
  assert.equal(found.info.id, 'TL-A1B2C3')
})

test('detectAdapter sends IDENT to a failing dialect and nothing else', async () => {
  const s = fakeSession((c) => (c === 'IDENT' ? { id: 'x', board: 'b', fw: '1.1' } : {}))
  await detectAdapter(s, [alpha, beta])
  assert.deepEqual(s.sent, ['ID', 'IDENT'])   // no SCAN, no STREAM
})

test('detectAdapter moves on when a dialect throws (timeout, no board)', async () => {
  const s = fakeSession((c) => {
    if (c === 'ID') throw new Error('timeout after 50ms')
    return { id: 'x', board: 'b', fw: '1.1' }
  })
  const found = await detectAdapter(s, [alpha, beta])
  assert.equal(found.adapter.id, 'beta')
})

test('detectAdapter returns null when nothing answers', async () => {
  const s = fakeSession(() => { throw new Error('timeout after 50ms') })
  assert.equal(await detectAdapter(s, [alpha, beta]), null)
})

test('detectComponents merges WHOAMI answers into the scan', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  const types = (await detectComponents(scan, async () => 0x68)).map(c => c.type)
  assert.ok(types.includes('mpu6050'))
})

test('detectComponents still resolves when the WHOAMI probe fails', async () => {
  const scan = { i2c: [{ addr: 104 }], dht22: { gpio: 4, ok: true } }
  const types = (await detectComponents(scan, async () => { throw new Error('nack') })).map(c => c.type)
  assert.ok(types.includes('mpu6050'))   // falls back to the address
})

test('detectComponents does not create a component for an unknown address', async () => {
  const scan = { i2c: [{ addr: 72 }], dht22: { gpio: 4, ok: false } }
  const types = (await detectComponents(scan, async () => -1)).map(c => c.type)
  assert.deepEqual(types.sort(), ['breadboard', 'esp32'])
})
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `node --test "frontend/tests/adapters.test.mjs"` from repo root

Expected: FAIL — `detectAdapter` is not exported.

- [ ] **Step 3: Implement `detectAdapter` and `detectComponents` in `serialModel.mjs`**

```js
export async function detectAdapter(session, adapters) {
  for (const adapter of adapters) {
    try {
      const reply = await session.command(adapter.identCommand, adapter.identTimeoutMs ?? 2000)
      const r = adapter.parseIdent(reply)
      if (r.ok) return { adapter, info: r.info }
    } catch { /* wrong dialect or no board on this port — try the next */ }
  }
  return null
}

export async function detectComponents(scan, askWhoami) {
  const byAddr = new Map(whoamiRequests(scan).map(r => [r.addr, r.reg]))
  const entries = await Promise.all((scan.i2c ?? []).map(async (e) => {
    if (!byAddr.has(e.addr)) return e
    try { return { ...e, whoami: await askWhoami(e.addr, byAddr.get(e.addr)) } }
    catch { return e }          // no answer -> whoami stays absent -> address fallback
  }))
  return scanToComponents({ ...scan, i2c: entries })
}
```

`detectComponents` is `async` and stays in `serialModel.mjs` — it touches no browser API, only the injected `askWhoami`, so it remains node-testable.

- [ ] **Step 5: Run the adapter tests to verify they pass**

Run: `node --test "frontend/tests/adapters.test.mjs"` from repo root

Expected: `pass 7`, `fail 0`.

- [ ] **Step 6: Write the failing `SerialSession` timeout test**

`SerialSession` needs a fake port implementing `open`, `readable.getReader`, `writable.getWriter`, and `close`, where the reader never yields and the writer discards writes. Add to `frontend/tests/adapters.test.mjs` (import `SerialSession` from `../src/serial/serialBridge.js`):

```js
test('a timed-out command does not poison the next one', async () => {
  const s = new SerialSession({ port: fakePort(), onData: () => {} })
  await s.open()
  await assert.rejects(s.command('IDENT', 20), /timeout/i)
  // The second command must reach the wire, not throw 'Command already in flight'.
  await assert.rejects(s.command('IDENT', 20), /timeout/i)
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test "frontend/tests/adapters.test.mjs"` from repo root

Expected: FAIL. The second call throws `Command already in flight` instead of timing out, so the assertion message is the tell.

- [ ] **Step 8: Fix the `_resolver` leak in `serialBridge.js`**

`SerialSession.command()` assigns `this._resolver` and `withTimeout` rejects on timeout, but `_resolver` is never cleared. A timed-out command poisons the session: every later `command()` throws `Command already in flight`. Clear it in a `finally` so the resolver is released on both the resolve and the reject path. This is a pre-existing bug that the adapter probe loop hits on its first failure, which is why it is fixed here rather than deferred.

- [ ] **Step 9: Create `adapters/twinlab_esp32_v1.js`**

Move the reading mapping verbatim out of `App.jsx:60-68` into `toReading`, including the `vib` suppression when accel is absent. All other fields are the literal values listed in this task's Interfaces block.

- [ ] **Step 10: Rewrite `App.jsx`'s `connect()`**

Replace the hardcoded command strings with the adapter. The shape:

```js
import ADAPTER from './serial/adapters/twinlab_esp32_v1'
import { detectAdapter, detectComponents } from './serial/serialModel.mjs'

const session = new (isDemo() ? DemoSession : SerialSession)({
  port, baudRate: ADAPTER.baudRate, onData, onError,
})
await session.open()
const found = await detectAdapter(session, [ADAPTER])
if (!found) { /* manual mode — see below */ }
setDevice(found.info)
const scanRes = await session.command(found.adapter.scanCommand, found.adapter.scanTimeoutMs)
const detected = await detectComponents(parseScan(scanRes),
  (addr, reg) => session.command(found.adapter.identityCommand(addr, reg), 1000)
    .then(found.adapter.parseIdentity))
setLayout(prev => mergeLayout(prev, detected))
await session.command(found.adapter.streamOnCommand)
```

- [ ] **Step 11: Handle "no adapter matched" as manual mode, not a hard error**

Spec §3.1 step 4. On `found === null`, do **not** `setStatus('error')`. Set a `noFirmware` flag, show one line explaining no OmniTwin firmware answered on this port, and render the canvas with `layout = defaultLayout([])` so `+ Add component` works. That reuses existing UI — there is no board-profile picker to build. The Connect button stays available for a retry.

- [ ] **Step 12: Route the stream `onData` through the adapter**

Replace the inline reading computation with `if (ADAPTER.isReading(obj)) { const clean = ADAPTER.toReading(obj); setLive(clean); setFlags(anomalyFlags(clean)) }`. `ADAPTER` here should be the *found* adapter; if `noFirmware` is set there is no stream, so a module-level `activeAdapter` variable set in `connect()` is sufficient — no React state needed.

- [ ] **Step 13: Run the full suite, lint, and build**

```powershell
node --test "frontend/tests/*.test.mjs"
cd frontend; npm run lint; npm run build
```

Expected: all tests pass, oxlint clean, build succeeds.

- [ ] **Step 14: Verify in the browser**

`powershell -File .\run.ps1`, then `http://localhost:5173/?demo=1`.

Expected: the header shows `demo-esp32 · fw 1.1`, the scan notice reads `SCAN: ESP32 + MPU6050, DHT22`, and live values stream. Identical to the pre-change demo except `fw 1.1`.

- [ ] **Step 15: Commit**

```powershell
git add frontend/src/serial frontend/src/App.jsx frontend/tests
git commit -m "feat(frontend): board adapter seam + detectAdapter probing; fix _resolver leak on command timeout"
```

---

### Task 5: Pin-based wire drawing

The gesture that does not exist yet. Today `addWire` has zero callers and `defaultLayout` always returns `wires: []` — there is no way for a student to wire anything, which is why the spec's wiring-correctness check has nothing to attach to. This task adds the gesture and switches the wire model from component ids to pin references.

**Files:**
- Modify: `frontend/src/serial/serialModel.mjs:95-97` (`addWire` signature change; add `removeWire`, `pinPos`, `wiresFor`)
- Modify: `frontend/src/components/TwinCanvas.jsx:58-69` (render from pin refs; add pin hit targets and the two-click gesture)
- Modify: `frontend/src/App.jsx` (pass `onWire`/`onUnwire`; keep `+ Add component`)
- Modify: `frontend/tests/serialModel.test.mjs` (replace the `addWire` assertion)

**Interfaces:**
- Consumes: Task 2's `pinDef(componentId, pinId)`, `componentDef(id).size`, and `CompDef.pins[].dx/dy`.
- Produces:
  - `addWire(layout, fromComponentId, fromPinId, toComponentId, toPinId) -> layout` — throws on an unknown component or pin, and throws on a wire whose two ends are the same component. Wire shape: `{ id, fromComponentId, fromPinId, toComponentId, toPinId }`. The old `{ from, to }` shape is gone; there are no persisted layouts to migrate.
  - `removeWire(layout, wireId) -> layout`
  - `pinPos(component, pinId) -> { x, y }` — `{ x: component.x + pin.dx, y: component.y + pin.dy }`; `{ x: 0, y: 0 }` when the component or pin is unknown, matching today's `pos()` fallback.
  - `wiresFor(componentId, pinId) -> wire[]` — every wire touching that pin. Used to dim already-wired pins and to support detach-on-click.
  - `TwinCanvas` props gain `onWire(fromComponentId, fromPinId, toComponentId, toPinId)` and `onUnwire(wireId)`.

- [ ] **Step 1: Write the failing pin-wire model tests**

Replace the existing `addWire` test in `serialModel.test.mjs` with:

```js
test('addWire stores pin references, not component ids', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(w.wires.length, 1)
  assert.deepEqual(
    { f: w.wires[0].fromComponentId, fp: w.wires[0].fromPinId, t: w.wires[0].toComponentId, tp: w.wires[0].toPinId },
    { f: esp.id, fp: 'SDA', t: mpu.id, tp: 'SDA' }
  )
  assert.equal(l.wires.length, 0)   // original untouched
})

test('addWire rejects an unknown pin and a self-wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  assert.throws(() => addWire(l, esp.id, 'NOPE', mpu.id, 'SDA'), /Unknown pin/)
  assert.throws(() => addWire(l, esp.id, 'SDA', esp.id, 'GND'), /same component/)
})

test('pinPos offsets by the registry pin dx/dy, and is 0,0 when the pin is unknown', () => {
  const l = defaultLayout([{ type: 'mpu6050' }])
  const mpu = l.components[0]
  assert.deepEqual(pinPos(mpu, 'SDA'), { x: mpu.x + 58, y: mpu.y + 10 })
  assert.deepEqual(pinPos(mpu, 'NOPE'), { x: 0, y: 0 })
  // A component whose type the registry does not define has no pins to offset by.
  assert.deepEqual(pinPos({ id: 'x1', type: 'nonexistent', x: 5, y: 5 }, 'SDA'), { x: 0, y: 0 })
})

test('wiresFor finds every wire touching a pin', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const wired = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(wiresFor(wired, esp.id, 'SDA').length, 1)
  assert.equal(wiresFor(wired, esp.id, 'GND').length, 0)
})

test('removeWire drops only the named wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const wired = addWire(l, esp.id, 'SDA', mpu.id, 'SDA')
  assert.equal(removeWire(wired, wired.wires[0].id).wires.length, 0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "frontend/tests/serialModel.test.mjs"` from repo root

Expected: FAIL — `pinPos`, `wiresFor`, `removeWire` are not exported, and `addWire` still takes 3 args.

- [ ] **Step 3: Implement the model functions**

`addWire` validates both pins via `pinDef` and throws `Unknown pin: ${componentId}.${pinId}` when either is missing. It rejects a wire whose two ends are the same component, throwing `Wire ends on the same component` — the exact wording matters, because the test matches `/same component/`. The rest is the existing one-line spread with the new five-field wire body. `pinPos(component, pinId)` reads `pinDef(component.type, pinId)`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test "frontend/tests/serialModel.test.mjs"` from repo root

Expected: all pass.

- [ ] **Step 5: Render wires from pin references in `TwinCanvas.jsx`**

Replace the `pos(w.from)` / `pos(w.to)` lookups with `pinPos` on the resolved component and pin. Delete the now-unused `pos()` helper.

**Add the skip guard (Review Focus #5):** a wire whose component or pin is not on the canvas must be skipped, not drawn to `(0,0)`. Resolve each end through `pinPos`; if either end resolves to `{x:0, y:0}` because the pin is unknown, `continue`. Guard on the *pin* being unknown, not on the coordinate being zero — a component legitimately placed at `(0,0)` is legal.

- [ ] **Step 6: Render pin hit targets**

For each placed component, map `componentDef(c.type).pins` to a small `<circle>` (r=5) at `pinPos(c, p.id)`, colored by `p.kind`. Each needs `onPointerDown` that calls `e.stopPropagation()` — otherwise it starts a component drag instead of a wire, which is the single most likely way this gesture gets built wrong.

- [ ] **Step 7: Implement the two-click gesture**

Local `useState` for `armed: { componentId, pinId } | null`. First pin click sets `armed`; a second click on a *different* component's pin calls `onWire(...)` and clears `armed`; a click on empty canvas (`onPointerDown` on the container with no target) clears `armed` without adding. Visual state: the armed pin gets a ring. Do not implement a rubber-band drag-to-wire — the two-click form is enough for a classroom and reuses the existing pointer handling.

- [ ] **Step 8: Add pin detach**

Clicking a pin that already has a wire removes that wire (calls `onUnwire`) instead of arming. One click, no modifier keys. If this makes the two-click gesture feel ambiguous in the browser, gate detach on the pin having exactly one wire and make the armed ring clearly distinct — but do not add a delete-mode toggle.

- [ ] **Step 9: Wire the callbacks in `App.jsx`**

`onWire={(fc, fp, tc, tp) => setLayout(l => addWire(l, fc, fp, tc, tp))}` and `onUnwire={wid => setLayout(l => removeWire(l, wid))}`.

- [ ] **Step 10: Verify in the browser**

`powershell -File .\run.ps1`, then `http://localhost:5173/?demo=1`.

Expected: four sprites, five pin dots each on the ESP32 and three on each sensor, two rail dots on the breadboard. Clicking ESP32 `SDA` then MPU6050 `SDA` draws a line between those two dots — and it should visibly attach to the *dots*, not the sprite centers, which is the whole point of this task. Clicking the same pin again removes the line. Dragging a sprite moves its pins and the wire ends with it.

- [ ] **Step 11: Run the full suite, lint, and build**

```powershell
node --test "frontend/tests/*.test.mjs"
cd frontend; npm run lint; npm run build
```

- [ ] **Step 12: Commit**

```powershell
git add frontend/src frontend/tests
git commit -m "feat(frontend): pin-based wire drawing gesture; wires reference pins, not component centers"
```

---

### Task 6: Wiring-correctness flags and kind-colored wires

The payoff of Tasks 2 and 5, and the concrete "flag hardware/wiring problems" behavior from the requirements. Zero LLM cost, same pattern as `anomalyFlags()`.

**Files:**
- Modify: `frontend/src/serial/serialModel.mjs` (add `wiringFlags`, `wireStroke`)
- Modify: `frontend/src/components/TwinCanvas.jsx` (stroke color by kind, flag badges per component)
- Modify: `frontend/src/App.jsx` (merge wiring flags into the tutor context, memoized)
- Modify: `frontend/src/App.css` (add `--ot-power` / `--ot-ground`)
- Modify: `frontend/tests/serialModel.test.mjs`

**Interfaces:**
- Consumes: Task 5's wire shape and `pinDef`; Task 4's `ADAPTER.referenceWiring`.
- Produces:
  - `wiringFlags(wires, components) -> string[]` — one short string per problem, in the same voice as `anomalyFlags()`.
  - `wireStroke(kind) -> { stroke, dash }` — `dash` is `null` for solid strokes.
  - `referenceGhosts(layout, referenceWiring) -> { from: {x,y}, to: {x,y} }[]` — resolves the adapter's authored wiring into screen points, silently skipping any end whose component or pin is not on the canvas.
  - `App.css` adds `--ot-power: #C62828;` (red, power) and `--ot-ground: #37474F;` (dark gray, ground). `--ot-green` stays the signal color.

- [ ] **Step 1: Write the failing `wiringFlags` tests**

```js
test('wiringFlags is empty for a correctly wired rig', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(
    addWire(addWire(l, esp.id, 'SDA', mpu.id, 'SDA'),
                esp.id, 'SCL', mpu.id, 'SCL'),
                esp.id, '3V3', mpu.id, 'VCC')
  assert.deepEqual(wiringFlags(w.wires, w.components), [])
})

test('wiringFlags names both ends of a signal-to-ground wire', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'GND')
  const flags = wiringFlags(w.wires, w.components)
  assert.equal(flags.length, 1)
  assert.match(flags[0], /SDA \(GPIO21\)/)
  assert.match(flags[0], /GND/)
  assert.match(flags[0], /MPU6050/)
})

test('wiringFlags catches a power-to-ground short', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, '3V3', mpu.id, 'GND')
  assert.equal(wiringFlags(w.wires, w.components).length, 1)
})

test('wiringFlags catches mismatched voltage rails by label', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'breadboard' }])
  const [esp, bb] = l.components
  const w = addWire(l, esp.id, '3V3', bb.id, 'GND')
  const flags = wiringFlags(w.wires, w.components)
  assert.equal(flags.length, 1)
})

test('wiringFlags skips a wire whose component is not on the canvas', () => {
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const w = addWire(l, esp.id, 'SDA', mpu.id, 'GND')
  assert.deepEqual(wiringFlags(w.wires, [{ ...esp, type: 'esp32' }]), [])   // mpu absent
})

test('wireStroke colors power red-solid, ground gray-solid, signal green-dashed', () => {
  assert.equal(wireStroke('power').dash, null)
  assert.equal(wireStroke('ground').dash, null)
  assert.equal(wireStroke('signal').dash, '6 4')
  assert.notEqual(wireStroke('power').stroke, wireStroke('signal').stroke)
})

test('referenceGhosts resolves the adapter wiring and skips parts that are not placed', async () => {
  const { default: ADAPTER } = await import('../src/serial/adapters/twinlab_esp32_v1.js')
  const l = defaultLayout([{ type: 'esp32' }, { type: 'mpu6050' }])
  const [esp, mpu] = l.components
  const ghosts = referenceGhosts(l, ADAPTER.referenceWiring)
  // SDA and SCL both resolve; the DHT->DATA pair is skipped because dht22 is not placed.
  assert.equal(ghosts.length, 2)
  assert.deepEqual(ghosts[0].from, { x: esp.x + 60, y: esp.y + 6 })
  assert.deepEqual(ghosts[0].to, { x: mpu.x + 58, y: mpu.y + 10 })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "frontend/tests/serialModel.test.mjs"` from repo root

Expected: FAIL — `wiringFlags`, `wireStroke`, `referenceGhosts` are not exported.

- [ ] **Step 3: Implement `wiringFlags`**

The rule is one comparison: **differing `kind` on the two ends is an error.** Same kind is fine. On top of that, when both ends are `power` **and** both pin labels look like voltage rails, differing labels are an error — this is the free catch for the most common real student mistake (5V into a 3V3 pin). A label "looks like a rail" when it matches `/^\d+(\.\d+)?V$/i`; a non-rail power label (e.g. `+ rail` on the breadboard) is exempt rather than flagged, so this check cannot false-positive on the breadboard.

Message format, matching `anomalyFlags()`'s terse voice: `` `${fromLabel} (${fromComp}) wired to ${toLabel} (${toComp})` ``. Skip any wire whose component or pin is not in `components` (Review Focus #5, model side).

- [ ] **Step 4: Implement `wireStroke` and `referenceGhosts`**

`wireStroke('power')` → `{ stroke: 'var(--ot-power)', dash: null }`; `'ground'` → `{ stroke: 'var(--ot-ground)', dash: null }`; `'signal'` → `{ stroke: 'var(--ot-green)', dash: '6 4' }` (preserving today's animated dashed signal wire). Default to the signal style for an unknown kind.

`referenceGhosts(layout, referenceWiring)` maps each `{ from: [componentId, pinId], to: [componentId, pinId] }` to `pinPos` lookups, dropping any entry whose end does not resolve.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test "frontend/tests/serialModel.test.mjs"` from repo root

Expected: all pass.

- [ ] **Step 6: Color the wires by kind in `TwinCanvas.jsx`**

For each wire, resolve the `from` component to get its `type`, then call `pinDef(type, w.fromPinId)` to read the pin's `kind`, and pass that to `wireStroke`. Preserve the existing animated dash on signal wires. When `pinDef` returns `null` (a registry edit removed that pin), fall back to `wireStroke('signal')` rather than skipping the wire — the wire is real, only its kind is unknown.

- [ ] **Step 7: Add the reference-wiring overlay with a toggle**

A `showReference` `useState` in `TwinCanvas`, defaulting to `false`, with a small toggle button next to `+ Add component` reading "Show reference wiring". When on, render `referenceGhosts(layout, ADAPTER.referenceWiring)` as dashed 1px lines in `--ot-ink` at 50% opacity, behind the real wires and with `pointerEvents: 'none'` so they cannot be mistaken for editable wires. Label the toggle with the honest caveat in its `title` attribute: the overlay shows *this board's fixed pin configuration*, not a read of the physical jumper wires — nothing in the kit can detect which hole a wire is in.

- [ ] **Step 8: Add the CSS variables**

In `frontend/src/App.css`, next to the existing `--ot-*` block: `--ot-power: #C62828;` with a comment that this is a labeling convention, not a measured value, and `--ot-ground: #37474F;`.

- [ ] **Step 9: Merge wiring flags into the tutor context, memoized**

In `App.jsx`, `flags` is currently recomputed on every ~10 Hz stream tick and sent to the tutor as `anomalies`. Wiring flags are static per layout, so computing them inline in `context()` would re-send the whole flag list on every drag and on every stream frame. Split the two:

```js
const sensorFlags = useMemo(() => anomalyFlags(live), [live])
const wiring = useMemo(() => wiringFlags(layout.wires, layout.components), [layout.wires, layout.components])
const flags = useMemo(() => [...sensorFlags, ...wiring], [sensorFlags, wiring])
```

`context()` then sends the combined `flags` unchanged, so `llm.build_prompt` needs no change and the tutor sees wiring problems in the same "Anomaly flags" line it already reads.

- [ ] **Step 10: Label wiring flags distinctly in the tutor prompt**

In `backend/llm.py`'s `build_prompt`, the context block prints `- Anomaly flags: ...`. The tutor cannot currently tell a sensor anomaly from a wiring error, and a flag reading `SDA (GPIO21) wired to GND (MPU6050)` needs a sentence of framing to be useful. Add one line above it distinguishing the two sources, and add the wiring list under its own label. Keep `_TUTOR_SYSTEM` otherwise unchanged.

- [ ] **Step 11: Extend `tests/test_llm.py` to cover the new line**

Assert `build_prompt` renders both a wiring flag and a sensor flag, and that neither is dropped. Keep the existing key-leak assertion passing — it is the reason `GROQ_API_KEY` is safe.

- [ ] **Step 12: Run everything**

```powershell
node --test "frontend/tests/*.test.mjs"
.\.venv\Scripts\python -m pytest tests\test_roster.py tests\test_llm.py -q
cd frontend; npm run lint; npm run build
```

Expected: all green. `ruff check .` has ~57 pre-existing findings unrelated to this work — do not fix them here, and do not let this task add new ones.

- [ ] **Step 13: Verify in the browser**

`powershell -File .\run.ps1`, then `http://localhost:5173/?demo=1`.

Expected: draw ESP32 `3V3` → MPU6050 `GND`. A red flag line appears naming both ends, and the tutor's context line lists it under wiring rather than sensor anomalies. Toggle "Show reference wiring" and the two ghost SDA/SCL lines appear behind the real wires.

- [ ] **Step 14: Commit**

```powershell
git add frontend/src backend/llm.py tests/test_llm.py
git commit -m "feat: wiring-correctness flags and kind-colored wires; tutor sees wiring faults separately from sensor anomalies"
```
