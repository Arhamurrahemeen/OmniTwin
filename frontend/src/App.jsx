/* OmniTwin dashboard: connect USB board (Web Serial) -> scan -> twin canvas + tutor. */
import { useEffect, useMemo, useRef, useState } from 'react'
import TwinCanvas from './components/TwinCanvas'
import TutorPanel from './components/TutorPanel'
import { supportsSerial, requestPort, SerialSession } from './serial/serialBridge'
import { DemoSession } from './serial/demoSession.mjs'
import ADAPTER from './serial/adapters/twinlab_esp32_v1'
import {
  defaultLayout, parseScan, detectAdapter, detectComponents, scanNotice,
  addComponent, moveComponent, addWire, removeWire, anomalyFlags, wiringFlags, componentDef,
} from './serial/serialModel.mjs'
import { askTutor } from './api'
import wordmark from './assets/wordmark.png'
import './App.css'

const CTX_DEVICE_ID = 'local'

// The adapter whose IDENT answered. Module-level rather than state: onData fires
// ~10x/sec and must not re-render the tree to reach it.
let activeAdapter = ADAPTER

// ponytail: ?demo=1 replaces the board with a fake session — offline demo + deck screenshots. ?tutor=1 pre-seeds a Q&A for the tutor shot.
const isDemo = () => new URLSearchParams(window.location.search).has('demo')
const isTutorDemo = () => new URLSearchParams(window.location.search).has('tutor')

const mergeLayout = (prev, comps) => {
  // keep existing manual layout, add any auto-detected components not yet placed
  const existingTypes = new Set(prev.components.map(c => c.type))
  const missing = comps.filter(c => !existingTypes.has(c.type))
  let out = { ...prev }
  for (const c of missing) out = addComponent(out, c.type)
  return out
}

export default function App() {
  const [status, setStatus] = useState('needPort') // needPort|connecting|scanning|streaming|manual|error
  const [layout, setLayout] = useState(() => defaultLayout([]))
  const [live, setLive] = useState({})
  const [sensorFlags, setSensorFlags] = useState([])
  const [device, setDevice] = useState(null)   // { id, board, fw }
  const [tutor, setTutor] = useState(null)     // { messages, reply, error, sessionId }
  const [scanInfo, setScanInfo] = useState(null) // result of the last SCAN, shown on the canvas
  const [noFirmware, setNoFirmware] = useState(false)
  const sessionRef = useRef(null)

  // Sensor flags change ~10x/sec; wiring faults change only when the layout
  // does. Keeping them apart stops the tutor context being rebuilt — and
  // re-sent — on every stream frame or every drag of a component.
  const wiring = useMemo(
    () => wiringFlags(layout.wires, layout.components),
    [layout.wires, layout.components])

  const context = () => ({
    device_id: device?.id ?? CTX_DEVICE_ID,
    components: layout.components.map(c => ({ type: c.type, label: componentDef(c.type)?.label ?? c.type })),
    readings: live,
    anomalies: sensorFlags,
    wiring,
  })

  const connect = async () => {
    if (!supportsSerial()) { setStatus('error'); return }
    const closeSession = async () => {
      const s = sessionRef.current
      sessionRef.current = null
      await s?.close()
    }
    try {
      await closeSession()
      setStatus('connecting')
      setNoFirmware(false)
      const port = isDemo() ? null : await requestPort()
      const session = new (isDemo() ? DemoSession : SerialSession)({
        port,
        baudRate: ADAPTER.baudRate,
        onData: (obj) => {
          if (activeAdapter.isReading(obj)) {
            const clean = activeAdapter.toReading(obj)
            setLive(clean)
            setSensorFlags(anomalyFlags(clean))
          }
        },
        onError: (err) => { setStatus('error'); setTutor(t => ({ ...t, error: err.message })) },
      })
      sessionRef.current = session
      await session.open()

      // Probe each adapter's IDENT dialect over the one open port. The port is
      // opened once at the first adapter's baud — Web Serial bakes baudRate in
      // at open() and has no setBaudRate, so per-adapter baud would mean a
      // close/reopen cycle. Every serial board is 115200.
      const found = await detectAdapter(session, [ADAPTER])
      if (!found) {
        // Spec 3.1 step 4: no board-profile picker. The canvas with "+ Add
        // component" already IS the manual path, so drop into it rather than
        // hard-erroring — the student may have their own sketch on the port.
        setStatus('manual')
        setNoFirmware(true)
        setScanInfo('No OmniTwin firmware answered on this port — build the rig by hand.')
        setLayout(defaultLayout([]))
        return
      }
      const adapter = found.adapter
      activeAdapter = adapter
      setDevice(found.info)

      setStatus('scanning')
      const scan = parseScan(await session.command(adapter.scanCommand, adapter.scanTimeoutMs))
      // Ask the board to read each identifiable address's WHOAMI register, so
      // identity comes off the chip rather than off the address.
      const askWhoami = (addr, reg) =>
        session.command(adapter.identityCommand(addr, reg), adapter.identityTimeoutMs)
          .then(adapter.parseIdentity)
      const detected = await detectComponents(scan, askWhoami)
      setScanInfo(scanNotice(scan))
      setLayout(prev => mergeLayout(prev, detected))

      await session.command(adapter.streamOnCommand)
      setStatus('streaming')
      if (isTutorDemo()) {
        setTutor({
          messages: [{ role: 'user', content: 'Why does the vibration flag keep turning on?' }],
          reply: 'Your rig reads temp ≈25 °C, humidity ≈59%, and the live accel stream just spiked (vib ≈0.9, above the 0.2 threshold). That is the local anomaly flag firing. Check the MPU6050 mounting — a loose breadboard seat reads as mechanical noise, not real vibration.',
          sessionId: 'demo',
        })
      }
    } catch (err) {
      await closeSession()
      setStatus('error')
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  const askTutorFlow = async ({ messages }) => {
    if (isDemo()) {  // ponytail: offline tour — never call the backend in demo mode
      const q = messages.length ? messages[messages.length - 1].content : ''
      setTutor({
        messages,
        reply: 'Demo rig: temp ≈25 °C, humidity ≈59%, and a vibration spike (vib ≈0.9, above the 0.2 threshold) just fired the local anomaly flag. Check the MPU6050 mounting — a loose breadboard seat reads as mechanical noise, not real vibration.' + (q ? ` (On "${q.slice(0, 40)}" — in a live session I would ground the answer in these readings.)` : ''),
        sessionId: 'demo',
      })
      return
    }
    setTutor(t => ({ ...t, messages, reply: null, error: null }))
    try {
      const res = await askTutor({ deviceId: device?.id ?? CTX_DEVICE_ID, context: context(), messages })
      setTutor(t => ({ ...t, reply: res.reply, sessionId: res.session_id }))
    } catch (err) {
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  useEffect(() => { if (isDemo()) connect() }, []) // demo: skip the Connect click
  useEffect(() => () => { sessionRef.current?.close() }, [])

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-brand">
          <img className="navbar-wordmark" src={wordmark} alt="OmniTwin" />
        </div>
        <span className="navbar-sep" />
        <span className="navbar-sub">Digital twin learning lab</span>
        <div className="navbar-right">
          <span className={`status-dot ${status === 'streaming' ? 'status-dot--live' : 'status-dot--off'}`} />
          <span className={`status-label ${status === 'streaming' ? '' : 'status-label--off'}`}>
            {status}
          </span>
        </div>
      </header>

      <div className="workspace">
        <main className="charts-area">
          {status === 'needPort' || status === 'error' ? (
            <div className="empty-state">
              <p>No board connected.</p>
              <button className="btn-primary" onClick={connect} disabled={status === 'connecting'}>
                {supportsSerial() ? 'Connect your ESP32' : 'Web Serial unsupported — use Chrome or Edge'}
              </button>
              {status === 'error' && (<>
                <p className="tutor-error">Check the cable and try again.</p>
                {tutor?.error && <p className="tutor-error" style={{ fontSize: 10 }}>{tutor.error}</p>}
              </>)}
            </div>
          ) : (
            <>
              {device && (
                <div className="charts-header">
                  <span className="charts-device-name">{device.id}</span>
                  <span className="charts-device-location">{device.board} · fw {device.fw}</span>
                </div>
              )}
              {noFirmware && (
                <p className="empty-state" style={{ fontSize: 11 }}>
                  No OmniTwin firmware answered on this port. Add components by hand below, or
                  flash the node firmware and reconnect.
                </p>
              )}
              <TwinCanvas layout={layout} live={live} sensorFlags={sensorFlags}
                onMove={(id, x, y) => setLayout(l => moveComponent(l, id, x, y))}
                onAdd={(type) => setLayout(l => addComponent(l, type))}
                onWire={(fc, fp, tc, tp) => setLayout(l => addWire(l, fc, fp, tc, tp))}
                onUnwire={(wid) => setLayout(l => removeWire(l, wid))} scanInfo={scanInfo} />
            </>
          )}
        </main>

        <TutorPanel context={context()} onSubmit={askTutorFlow} replyState={tutor}
          initialThread={isTutorDemo() ? [{ role: 'user', content: 'Why does the vibration flag keep turning on?' }] : []} />
      </div>
    </div>
  )
}