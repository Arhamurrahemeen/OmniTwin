<p align="center"><img src="docs/assets/hero.svg" width="100%" alt="OmniTwin: wire up a sensor, watch it come alive on screen. Break it, fix it, learn how it actually works."/></p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-MVP-02D0B1?style=flat-square&labelColor=16191E"/>
  <img alt="ESP32" src="https://img.shields.io/badge/ESP32-ESP--IDF%206-1762FC?style=flat-square&logo=espressif&logoColor=white&labelColor=16191E"/>
  <img alt="React" src="https://img.shields.io/badge/React-19-0477AD?style=flat-square&logo=react&logoColor=white&labelColor=16191E"/>
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-MongoDB-0477AD?style=flat-square&logo=fastapi&logoColor=white&labelColor=16191E"/>
  <img alt="Groq" src="https://img.shields.io/badge/AI%20tutor-Groq-00AFCE?style=flat-square&labelColor=16191E"/>
  <img alt="OmniteX" src="https://img.shields.io/badge/by-OmniteX-F1F1EE?style=flat-square&labelColor=16191E"/>
</p>

<p align="center">
  <strong>A hands-on digital twin lab for engineering students.</strong><br/>
  Plug an ESP32 kit into USB, and the browser finds your parts and mirrors your rig live.
</p>

<p align="center"><img src="docs/assets/divider-01-problem.svg" width="100%" alt="Section 01: problem"/></p>

Most engineering students in Pakistan learn embedded systems from slides. Real labs are expensive, so few students ever build a system, break it and debug it before they graduate.

OmniTwin puts that lab on a student's own desk: a low-cost kit, a USB cable and a browser.

<p align="center"><img src="docs/assets/divider-02-solution.svg" width="100%" alt="Section 02: solution"/></p>

<p align="center"><img src="docs/assets/learning-cycle.svg" width="100%" alt="The learning cycle: connect, see, break it, ask, then fix it and go again"/></p>

- **One click to live.** Connect, pick your port, and scanning and streaming start on their own.
- **It identifies chips, it doesn't guess.** A part appears only when the chip answers with its own ID.
- **It reads your code.** Open your project folder to see the hardware your source declares, plus static checks.
- **It stays honest.** Dashed wires are expected wiring, never a read of your jumpers. A dead sensor shows as `Not reporting`, never a fake `0.000`.
- **A tutor, not an autopilot.** The AI coaches only when you ask, and it never controls your hardware.

<p align="center"><img src="docs/assets/divider-03-screenshots.svg" width="100%" alt="Section 03: screenshots"/></p>

<p align="center"><img src="docs/screenshots/02-live-twin.png" width="100%" alt="The live twin: an ESP32 board connected to MPU6050 and DHT22 cards with live readings"/></p>
<p align="center"><sub><b>The live twin.</b> Your board, your parts and their readings on one screen.</sub></p>

| | |
|:---:|:---:|
| <img src="docs/screenshots/03-limit-and-tutor.png" width="100%" alt="A vibration reading above its limit, with the tutor explaining"/> | <img src="docs/screenshots/04-wiring-check.png" width="100%" alt="A wrong wire flagged with Check this wiring"/> |
| **A reading crosses its limit.** One click asks the tutor why. | **A wrong wire.** Flagged on the card, with no AI cost. |
| <img src="docs/screenshots/05-code-drawer.png" width="100%" alt="The code drawer showing firmware source and static checks"/> | <img src="docs/screenshots/01-connect.png" width="100%" alt="The start screen with one Connect your board button"/> |
| **The code drawer.** Your source, with static checks. | **The start.** One button. |

<p align="center"><sub>Captured from the dashboard's <code>?demo=1</code> mode, which uses simulated readings and canned tutor replies.</sub></p>

<p align="center"><img src="docs/assets/divider-04-architecture.svg" width="100%" alt="Section 04: architecture"/></p>

<p align="center"><img src="docs/assets/architecture.svg" width="100%" alt="Architecture: an ESP32 node talks over USB to the browser, which holds the serial bridge, registry, model, live twin and code drawer. Only the on-demand tutor uses the backend."/></p>

Sensor data goes straight from the USB port to your browser. It doesn't pass through the backend, which only stores the roster and runs the tutor. The Groq key stays on the server.

<p align="center"><img src="docs/assets/divider-05-how.svg" width="100%" alt="Section 05: how chips are identified"/></p>

<p align="center"><img src="docs/assets/identification.svg" width="100%" alt="A scan finds an address, the browser reads the chip's ID, and a part is drawn only if it matches the registry. Otherwise the address is reported as unidentified."/></p>

**Adding an I2C sensor** starts with an entry in [`components.json`](frontend/src/registry/components.json):

| You add | You get |
|---|---|
| `whoamiReg` and `whoamiVal` | The chip is identified and gets a card |
| `readRegs` | Live data, polled over `READ` |
| `display` | Its own gauges and labels |

Polling only reads, so a chip that must be configured before it measures still needs firmware support.

<p align="center"><img src="docs/assets/divider-06-stack.svg" width="100%" alt="Section 06: stack"/></p>

<p align="center"><img src="docs/assets/stack.svg" width="100%" alt="Stack: ESP32 with MPU6050 and DHT22, ESP-IDF firmware, Web Serial, React and Vite, FastAPI and MongoDB, Groq"/></p>

<p align="center"><img src="docs/assets/divider-07-run.svg" width="100%" alt="Section 07: run it"/></p>

**See it with no hardware.** You need Node.js:

```powershell
cd frontend
npm install
npm run dev
```

Then open <http://localhost:5173/?demo=1>.

**Run the full stack.** You also need Windows, Python 3.13, MongoDB 7 on `:27017`, and Chrome or Edge for Web Serial:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
cd frontend; npm install; cd ..

# For the AI tutor, add GROQ_API_KEY=... to backend/.env

powershell -File .\run.ps1         # dashboard :5173, API docs :8000/docs
powershell -File .\run.ps1 -Stop   # stop both
```

`run.ps1` hardcodes `D:\OmniTwin`, so edit it if your clone lives elsewhere.

**Flash the board** with ESP-IDF v6.0.2 active, then check it over serial:

```powershell
cd firmware\twinlab_node_v1
idf.py build
idf.py -p COM3 flash

# from the repo root, using the ESP-IDF Python
python firmware\verify_node.py COM3
```

**Wire the kit:**

| Part | Part pin | ESP32 pin | Note |
|---|---|---|---|
| **MPU6050** | VCC / GND | 3V3 / GND | |
| | SDA / SCL | GPIO 21 / GPIO 22 | |
| **DHT22** | VCC / GND | 3V3 / GND | |
| | DATA | GPIO 4 | 4.7k to 10k pull-up to 3V3 |

The board keeps working with sensors unplugged. Plug one in and click **Rescan**.

**Run the tests** from the repo root:

```powershell
node --test "frontend/tests/*.test.mjs"
.\.venv\Scripts\python -m pytest tests -q
```

<p align="center"><img src="docs/assets/divider-08-where.svg" width="100%" alt="Section 08: where it stands"/></p>

| Working today | Not built yet |
|---|---|
| ESP32 node firmware, checked on real hardware | Billing and accounts |
| Live twin, wiring checks and local flags | LMS integration |
| On-demand AI tutor | Urdu interface |
| Source-derived hardware and code checks | Boards other than the ESP32 node |
| Device roster and demo-kit quota | |

Known limits:

- Source parsing is pattern-based and misses some common idioms. See the [audit](docs/audit-hardware-detection.md).
- The Arduino sketch hasn't been compiled or tested.
- Chrome or Edge on desktop only, because Web Serial requires it.

<p align="center"><img src="docs/assets/divider-09-omnitex.svg" width="100%" alt="Section 09: OmniteX"/></p>

OmniTwin is a product of [**OmniteX**](https://omnitex.netlify.app). We're based at NASTP Silicon Valley, Karachi, as part of Cohort 2 of the DUET ORIC Research Products Development Unit (RPDU).

<p align="center"><img src="docs/assets/partners.svg" width="100%" alt="OmniteX, NASTP Silicon Valley, Dawood University of Engineering and Technology, ORIC DUET, and DUET RPDU"/></p>

<p align="center"><sub>Built in Karachi by <a href="https://github.com/Arhamurrahemeen">Arham</a>, founder of OmniteX.</sub></p>
