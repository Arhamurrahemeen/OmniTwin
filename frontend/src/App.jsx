/* OmniTwin dashboard: connect USB board (Web Serial) -> scan -> twin canvas + tutor. */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import TwinCanvas from './components/TwinCanvas'
import TutorPanel from './components/TutorPanel'
import CodeTab from './code/CodeTab'
import { supportsSerial, requestPort, SerialSession } from './serial/serialBridge'
import { DemoSession } from './serial/demoSession.mjs'
import ADAPTER from './serial/adapters/twinlab_esp32_v1'
import {
  defaultLayout, parseScan, detectAdapter, detectComponents, scanNotice, allComponents,
  addComponent, removeComponent, moveComponent, addWire, removeWire, anomalyFlags, partFaults, wiringFlags, componentDef, notReporting, mergeLayout, mergeDeclaredLayout, isKnown,
} from './serial/serialModel.mjs'
import { askTutor } from './api'
import { formatCodeFlagsForTutor } from './code/codeFlags'
import wordmark from './assets/wordmark.png'
import './App.css'

const CTX_DEVICE_ID = 'local'

// Stable registry surface for CodeTab. Passed as an inline object literal this
// was a NEW identity on every App render, and CodeTab's parse effect depends on
// it — so the effect re-ran, called back into App state, re-rendered App, and
// looped forever once a project folder was loaded. Module scope gives it one
// identity for the app's lifetime.
const REGISTRY_API = { componentDef, isKnown, allComponents }

// The adapter whose IDENT answered. Module-level rather than state: onData fires
// ~10x/sec and must not re-render the tree to reach it.
let activeAdapter = ADAPTER

// ponytail: ?demo=1 replaces the board with a fake session — offline demo + deck screenshots. ?tutor=1 pre-seeds a Q&A for the tutor shot.
const isDemo = () => new URLSearchParams(window.location.search).has('demo')
const isTutorDemo = () => new URLSearchParams(window.location.search).has('tutor')

export default function App() {
  const [status, setStatus] = useState('needPort') // needPort|connecting|scanning|streaming|manual|error
  const [layout, setLayout] = useState(() => defaultLayout([]))
  const [live, setLive] = useState({})
  const [sensorFlags, setSensorFlags] = useState([])
  const [device, setDevice] = useState(null)   // { id, board, fw }
  const [tutor, setTutor] = useState(null)     // { messages, reply, error, sessionId }
  const [scanInfo, setScanInfo] = useState(null) // result of the last SCAN, shown on the canvas
  const [noFirmware, setNoFirmware] = useState(false)
  const [codeFindings, setCodeFindings] = useState(null)
  const [codeFlagsList, setCodeFlagsList] = useState([])
  const [declaredComponents, setDeclaredComponents] = useState([])
  const sessionRef = useRef(null)

  // Sensor flags change ~10x/sec; wiring faults change only when the layout
  // does. Keeping them apart stops the tutor context being rebuilt — and
  // re-sent — on every stream frame or every drag of a component.
  const wiring = useMemo(
    () => wiringFlags(layout.wires, layout.components),
    [layout.wires, layout.components])

  const context = useCallback(() => ({
    device_id: device?.id ?? CTX_DEVICE_ID,
    components: layout.components.map(c => ({ type: c.type, label: componentDef(c.type)?.label ?? c.type, declared: c.declared, confidence: c.confidence })),
    readings: live,
    anomalies: sensorFlags,
    wiring,
    disconnected: notReporting(layout.components, live)
      .map((id) => componentDef(layout.components.find(c => c.id === id)?.type)?.label ?? 'unknown'),
    codeFlags: formatCodeFlagsForTutor(codeFlagsList),
    sourceHardware: codeFindings ? {
      confidence: codeFindings.confidence,
      i2c: codeFindings.i2c.pins,
      addresses: codeFindings.i2c.addresses,
      sensors: codeFindings.sensors.map(({ type, pin, confidence }) => ({ type, pin, confidence })),
      pins: codeFindings.pins.map(({ pin, label, confidence }) => ({ pin, label, confidence })),
    } : null,
  }), [device, layout.components, live, sensorFlags, wiring, codeFlagsList, codeFindings])

  // Handle parsed project from CodeTab
  const onProjectParsed = useCallback((findings, flags) => {
    setCodeFindings(findings)
    setCodeFlagsList(flags)
  }, [])

  const onLayoutGenerated = useCallback((declaredLayout) => {
    setDeclaredComponents(declaredLayout.components.filter(c => c.declared))
    setLayout(prev => mergeDeclaredLayout(prev, declaredLayout))
  }, [])

  // SCAN, then read each identifiable address's WHOAMI register so identity
  // comes off the chip rather than off the address. Shared by connect and
  // Rescan. Add-only on purpose: a part that has gone quiet is badged on the
  // canvas, never deleted, so a flaky bus cannot destroy a hand-built rig.
  const runScan = async (session, adapter) => {
    const scan = parseScan(await session.command(adapter.scanCommand, adapter.scanTimeoutMs))
    const askWhoami = (addr, reg) =>
      session.command(adapter.identityCommand(addr, reg), adapter.identityTimeoutMs)
        .then(adapter.parseIdentity)
    const detected = await detectComponents(scan, askWhoami)
    setScanInfo(scanNotice(scan))
    setLayout(prev => mergeLayout(prev, detected))
  }

  // ponytail: a failed rescan must not look like a dead session. STREAM is
  // still on, so restore the status and surface the error instead.
  const rescan = async () => {
    const s = sessionRef.current
    if (!s) return
    setStatus('scanning')
    try {
      await runScan(s, activeAdapter)
    } catch (err) {
      setTutor(t => ({ ...t, error: `Rescan failed: ${err.message}` }))
    } finally {
      setStatus('streaming')
    }
  }

  const connect = async () => {
    if (!supportsSerial()) { setStatus('error'); return }
    const closeSession = async () => {
      const s = sessionRef.current
      sessionRef.current = null
      // Tell the board to stop streaming before dropping the port — otherwise it
      // keeps pushing 10 Hz of JSON at 115200 until the board is unplugged.
      try { if (s?.writer) await s.command(activeAdapter.streamOffCommand, 500) } catch { /* already gone */ }
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
        // Keeps 10 Hz readings from being mistaken for a command reply, so a
        // Rescan works while STREAM is on. ponytail: bound to the first
        // adapter — rebind to `activeAdapter.isReading` at the point adapter
        // #2 lands, when the dialect is known only after detection.
        isData: ADAPTER.isReading,
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
        // Release the port first: we are about to tell them to flash the board
        // and reconnect, and no flashing tool can open a port we still hold.
        await closeSession()
        setStatus('manual')
        setNoFirmware(true)
        setScanInfo('No OmniTwin firmware answered on this port — build the rig by hand.')
        // Do NOT wipe a rig the student already placed by hand.
        setLayout(prev => (prev.components.length ? prev : defaultLayout([])))
        return
      }
      const adapter = found.adapter
      activeAdapter = adapter
      setDevice(found.info)

      setStatus('scanning')
      await runScan(session, adapter)

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

  const hasDeclared = declaredComponents.length > 0

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

      {hasDeclared && (
        <div className="declared-banner">
          <span>⚠️ Hardware derived from your source code — <strong>confirm it matches your board</strong></span>
          <button onClick={() => setDeclaredComponents([])}>Dismiss</button>
        </div>
      )}

      <div className="workspace">
        {/* LEFT: Code tab - 25% width */}
        <aside className="code-sidebar-full">
          <CodeTab 
            onProjectParsed={onProjectParsed} 
            onLayoutGenerated={onLayoutGenerated} 
            registry={REGISTRY_API}
          />
        </aside>

        {/* MIDDLE: Canvas area - 50% width */}
        <main className="charts-area">
          {status === 'needPort' || status === 'error' ? (
            <div className="empty-state">
              <p>No board connected.</p>
              <button className="btn-primary" onClick={connect} disabled={status === 'connecting'}>
                {supportsSerial() ? 'Connect your microcontroller' : 'Web Serial unsupported — use Chrome or Edge'}
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
                  <button
                    className="btn-secondary rescan-btn"
                    onClick={rescan}
                    disabled={status === 'scanning'}
                    title="Re-run the I2C bus sweep to pick up a sensor you just clipped on"
                  >
                    {status === 'scanning' ? 'Scanning…' : '⟳ Rescan'}
                  </button>
                </div>
              )}
              {noFirmware && (
                <p className="empty-state" style={{ fontSize: 11 }}>
                  No OmniTwin firmware answered on this port. Add components by hand below, or
                  flash the node firmware and reconnect.
                  <button onClick={connect} className="btn-secondary" style={{ marginLeft: 8 }}>
                    Retry connection
                  </button>
                </p>
              )}
              <TwinCanvas layout={layout} live={live} sensorFlags={partFaults(sensorFlags)}
                onMove={(id, x, y) => setLayout(l => moveComponent(l, id, x, y))}
                onAdd={(type) => setLayout(l => addComponent(l, type))}
                onWire={(fc, fp, tc, tp) => setLayout(l => addWire(l, fc, fp, tc, tp))}
                onUnwire={(wid) => setLayout(l => removeWire(l, wid))}
                onRemove={(id) => setLayout(l => removeComponent(l, id))} scanInfo={scanInfo} />
            </>
          )}
        </main>

        {/* RIGHT: AI Tutor - 25% width */}
        <aside className="tutor-sidebar-full">
          <TutorPanel context={context()} onSubmit={askTutorFlow} replyState={tutor}
            initialThread={isTutorDemo() ? [{ role: 'user', content: 'Why does the vibration flag keep turning on?' }] : []} />
        </aside>
      </div>
    </div>
  )
}
