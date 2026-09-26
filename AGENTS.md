# AGENTS.md

Working notes for AI agents (and humans) on the OmniTwin repo. Read this before
touching anything — several footguns here are not visible from the code alone.

## What this is

A digital-twin learning platform. A student plugs an ESP32 + sensor kit into
USB; the browser talks to the board over **Web Serial**, scans it, and renders a
2D twin of the physical rig, with an on-demand AI tutor (Groq) for coaching.

MVP pilot for engineering students in Pakistan, starting at DUET.

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + uvicorn, Motor (async MongoDB), pydantic-settings, httpx → Groq |
| DB | MongoDB 7.0 on `:27017`, db `twinlab` |
| Frontend | React 19 + Vite 8, recharts, oxlint, `node --test` |
| Firmware | ESP32 + MPU6050 (I2C) + DHT22, ESP-IDF v6.0.2, C |
| Transport | Web Serial, line-delimited JSON over UART0 @ 115200 |

There is **no MQTT, no InfluxDB, no simulator** — that stack was deliberately
removed (commit `cbfe196`). Don't reintroduce it.

## Commands

```powershell
# Run backend + dashboard (hardcodes D:\OmniTwin — see Gotchas)
powershell -File .\run.ps1
powershell -File .\run.ps1 -Stop        # kill both

# Tests — run from repo ROOT
.\.venv\Scripts\python -m pytest tests\test_roster.py tests\test_llm.py -q
node --test "frontend/tests/*.test.mjs"     # glob is required on Node 24; a bare
                                            # directory arg fails with MODULE_NOT_FOUND

# Lint
.\.venv\Scripts\ruff.exe check .                 # Python
cd frontend; npm run lint                       # JS (oxlint)

# Frontend build
cd frontend; npm run build

# Firmware (needs ESP-IDF v6.0.2 active)
cd firmware\twinlab_node_v1; idf.py build
idf.py -p COM3 flash

# Verify the node's protocol over serial (no browser, no dashboard)
& "C:\Users\Arham\.espressif\python_env\idf6.0_py3.13_env\Scripts\python.exe" `
    firmware\verify_node.py COM3
```

## Gotchas

**ESP-IDF lives at `C:\esp\v6.0.2\esp-idf` but is not on `PATH`.** Activate it
per shell before `idf.py`:
`$env:IDF_PATH="C:\esp\v6.0.2\esp-idf"; & "$env:IDF_PATH\export.ps1"`.
If the project was last configured against a different Python env, `idf.py build`
refuses until you run `idf.py fullclean` (removes only regenerable build output).

**`proto_selftest()`'s asserts only run on flashed hardware.** A green
`idf.py build` proves the C compiles, nothing more — and this box has no board and
no host C compiler, only ESP cross-compilers. Because ESP-IDF's `assert` aborts on
failure, a board that boots and then answers `IDENT` has already passed every
self-test; a failing assert shows up as a reboot loop. Use
`firmware/verify_node.py` to check the wire protocol end to end after a flash.

**`run.ps1` hardcodes `D:\OmniTwin\.venv\Scripts\python` and both working
directories.** It will not work if the repo moves, and the venv must exist
first. If you relocate the repo, this script breaks silently-ish.

**The backend uses flat imports and MUST run with `backend/` as the working
directory.** `backend/main.py` does `from config import settings`, not
`from backend.config import settings`. So:

- `uvicorn main:app` works only from inside `backend/`
- `tests/` import the opposite way (`import backend.llm`), which is why
  `conftest.py` exists — it puts `backend/` on `sys.path`
- Do **not** "fix" this by converting to package-relative imports casually; it
  breaks the launcher and the tests together.

**`src = ["backend"]` in `pyproject.toml` is load-bearing for ruff.** Without it
isort misclassifies `config`, `db`, `llm`, `models`, `routers` as third-party.

**UART0 carries JSON only.** In `firmware/.../main.c`, `esp_log_level_set("*",
ESP_LOG_NONE)` disables all logging because a single `ESP_LOGI` interleaving
mid-`printf` corrupts a JSON line and desyncs the browser's parser. State is
conveyed through the JSON itself (`temp: null`, `ax: null`, `ok: false`). Do not
re-enable logs on UART0.

**`SCAN` needs a 20 s timeout.** The board sweeps I2C `0x03..0x77` (117
addresses); on an empty bus that takes ~12 s. That budget now lives on the
adapter as `scanTimeoutMs: 20000` — do not fall back to `command()`'s 5 s
default for a scan.

**The board degrades gracefully — that's intentional, not a bug.** With no
sensors it still answers IDENT/PING/SCAN and streams DHT-only rows with
`ax/ay/az: null`. `stream_task` retries the MPU probe at ~1 Hz, so hot-plugging
a sensor mid-session works. `vib` is suppressed when accel is absent so a bare
board doesn't false-flag "vibration above 0.2".

**The tutor is strictly on-demand.** `TutorPanel` never auto-fires. Keep it that
way — it's a product decision (coaching, never autonomous control). This now
extends to code: once file read/patch support lands (see the spec below), the
tutor may propose a diff but **must never write a file without an explicit
per-change "Apply" click.** Same rule, same weight — don't relax it because
the change looks small or obviously correct.

**`GROQ_API_KEY` is server-side only** (`backend/.env`, gitignored). It must
never reach the browser. `tests/test_llm.py` asserts the prompt can't leak it —
keep that test passing, and extend it to cover code content once the tutor
starts sending file contents in the `/tutor` payload (same rule, bigger
payload).

**The hardcoded `I2C_MAP`/`COMPONENTS`/`DEFAULT_POS` tables and the
`ComponentSprite` `switch` are GONE** — replaced by the data-driven registry in
`frontend/src/registry/` (landed on `feat/universal-detection-canvas`). Adding a
sensor is a `components.json` entry: label, geometry, pin kinds, and which
readings belong to it. Do not reintroduce a per-type table anywhere; the canvas
reads pins and `reads` from the registry.

**`frontend/src/serial/adapters/twinlab_esp32_v1.js` is the one board adapter
today**, and `detectAdapter()` in `serialModel.mjs` probes each adapter's IDENT
dialect in turn over a single already-open port (Web Serial bakes `baudRate` in
at `open()` and has no `setBaudRate`). Don't write new code that assumes one
protocol. `TwinCanvas` currently imports the adapter directly for
`referenceWiring` — pass it down from `App.jsx` when adapter #2 lands.

**Canvas current-flow visualization is illustrative, not a simulation.** It
color-codes wires by pin `kind` (power/ground/signal) using each board's known
GPIO assignments — it does not measure or compute actual voltage/current.
There's no current sensor in the kit; don't build toward one.

## Serial protocol (UART0, 115200)

| Command | Reply |
|---|---|
| `IDENT` | `{"device","fw","board","id"}` — id is `TL-` + 6 hex from MAC |
| `SCAN` | `{"i2c":[{"addr"}],"dht22":{"gpio","ok"},"bus":{...}}` — raw ACK'd addresses only, **no part name**: identity is the browser's job (fw 1.1) |
| `WHOAMI <addr> <reg>` | `{"whoami":<int>}`, or `-1` if the address did not answer. The browser supplies the register from `components.json`, so firmware holds no per-sensor knowledge |
| `STREAM on` / `off` | ack, then ~10 Hz `{"ts","temp","hum","ax","ay","az"}` |
| `PING` | `{"pong":true}` |
| `DIAG` | pull-up state, per-address probe, MPU register readbacks |

Board pins: SDA=21, SCL=22, MPU6050 at `0x68`/`0x69`, DHT22 on GPIO4.
An MPU6050 ignores register writes for ~100 ms after power-on, so `mpu_try_init()`
retries 10× and gates on a *readback*, not just an ACK.

## Testing without hardware

The dashboard has offline modes in `App.jsx` — use them, don't ask for a board:

- `?demo=1` — swaps `SerialSession` for `DemoSession`, auto-connects, and the
  tutor replies locally **without calling the backend**
- `?tutor=1` — pre-seeds a tutor thread for the screenshot

So `http://localhost:5173/?demo=1` is a fully deterministic smoke test. The
Playwright MCP server is configured with `--browser msedge` and
`--output-dir docs/PPTx/screenshots` for exactly this.

## Tooling in this repo

- **ponytail** (minimal-code discipline) is active. The `// ponytail: ...`
  comments in `App.jsx` (e.g. above the `?demo=1` handling) are that
  convention, not clutter — they mark a spot where the simplest possible
  solution was deliberately chosen over a heavier one. Don't "clean them up,"
  and follow the same discipline in new code: prefer the platform feature
  already at hand over adding a library or abstraction.
- **Superpowers** (brainstorm → plan → execute, systematic-debugging, TDD) is
  the dev workflow. `docs/superpowers/plans/` and `docs/superpowers/specs/`
  are its output — check both before starting work, they're often more current
  than this file.

## Repo conventions

- Backend routers are thin; business logic lives in `backend/llm.py` etc.
- `frontend/src/serial/serialModel.mjs` is **pure** (no DOM, no Web Serial) so it
  is testable under `node --test`. Keep new logic there, not in
  `serialBridge.js`, which is the thin un-testable wrapper.
- `docs/tasks/task-N.md` and `docs/superpowers/{plans,specs}/` hold the
  spec-driven task briefs and design docs — **all of them are tracked in git**.
  Check them before re-litigating a past decision. The current spec for the
  universal-detection/canvas work is
  `docs/superpowers/specs/2026-09-26-omnitwin-universal-detection-canvas-design.md`.
  Its successor — **proposed, not yet implemented** — is
  `docs/superpowers/specs/2026-09-26-omnitwin-universal-discovery-and-measurement-design.md`.
  **OmniTwin is a platform for debugging students' own semester projects, not a
  sensor kit** — do not plan work from the parts list in `Cost-Structure.md`. That
  spec makes OmniTwin a portable C library the student links into their own
  program (they keep their firmware; ours cannot occupy the board too), targets
  ESP32 + ATmega328P as two silicon ports behind one JSON dialect, and specifies a
  channel-keyed stream as the core change. Read its §0, §2 and §10 before
  starting discovery or firmware work.
  (`.superpowers/sdd/` is git-ignored scratch — `*` in its own `.gitignore` —
  and holds only per-plan SDD artifacts: `plan-path`, `progress.md`, task briefs,
  review diffs. Never put a spec there; it will not be committed.)
- Frontend assets are author-created SVG (`ComponentSprite.jsx`) — no icon library.
- **Read `docs/superpowers/specs/2026-09-26-omnitwin-universal-detection-canvas-design.md`
  before touching `serialModel.mjs`, `ComponentSprite.jsx`, `TwinCanvas.jsx`, or
  `backend/routers/tutor.py`.** It replaces the hardcoded `I2C_MAP`/`COMPONENTS`
  tables with a data-driven registry, adds pin-`kind` metadata (power/ground/
  signal) for wiring-correctness checks, and extends the tutor to read (and,
  on explicit approval, patch) student source files. Its §0 "What landed" records
  where the build departed from the design and why; its implementation plan is
  `docs/superpowers/plans/2026-09-26-omnitwin-universal-detection-canvas.md`
  (covers §3.1–§3.3; §3.5 tutor-code access is deferred to a later plan).

## Known open issues

- `backend/config.py` hardcodes the Mongo URI with credentials, and
  `main.py` sets CORS `allow_origins=["*"]` while `run.ps1` binds `--host
  0.0.0.0`. Fine on loopback, unsafe on a LAN. Fix before the DUET pilot.
- `sim-control/` is dead — `git rm`'d in `5fa29bb`, but `dist/` and
  `node_modules/` may still linger untracked. Safe to delete.
- Wire *drawing* now exists: click a pin, then a pin on another part, to wire
  them; click a wired pin to detach. Wires are pin-referenced, not centre-to-
  centre, and `wiringFlags()` catches kind mismatches. Still no zoom/pan/rotate.
- The pin gesture arms and detaches on `pointerdown`, so a wire is destroyed on
  mouse-*down* — press-and-drag off a wired pin silently deletes it, and a
  half-armed wire can't be cancelled by re-clicking the same pin. Fix by moving
  the state machine in `TwinCanvas.jsx` to `onClick`.
- `scanNotice` prints `MPU6050, MPU6050` when both `0x68` and `0x69` ACK. The
  canvas is fine (`mergeLayout` dedupes by type); only the status text is wrong.
- `ruff check .` currently reports ~57 findings (mostly `Optional[X]` →
  `X | None` in `backend/models/device.py`). None are bugs; they are unfixed
  because they were never in scope.