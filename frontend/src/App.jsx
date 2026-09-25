/* OmniTwin dashboard: connect USB board (Web Serial) -> scan -> twin canvas + tutor. */
import { useEffect, useRef, useState } from 'react'
import TwinCanvas from './components/TwinCanvas'
import TutorPanel from './components/TutorPanel'
import { supportsSerial, requestPort, SerialSession } from './serial/serialBridge'
import { DemoSession } from './serial/demoSession.mjs'
import {
  defaultLayout, scanToComponents, scanNotice, addComponent, moveComponent,
  anomalyFlags,
} from './serial/serialModel.mjs'
import { askTutor } from './api'
import wordmark from './assets/wordmark.png'
import './App.css'

const CTX_DEVICE_ID = 'local'

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
  const [status, setStatus] = useState('needPort') // needPort|connecting|scanning|streaming|error
  const [layout, setLayout] = useState(() => defaultLayout([]))
  const [live, setLive] = useState({})
  const [flags, setFlags] = useState([])
  const [device, setDevice] = useState(null)   // { id, board, fw }
  const [tutor, setTutor] = useState(null)     // { messages, reply, error, sessionId }
  const [scanInfo, setScanInfo] = useState(null) // result of the last SCAN, shown on the canvas
  const sessionRef = useRef(null)

  const context = () => ({
    device_id: device?.id ?? CTX_DEVICE_ID,
    components: layout.components.map(c => ({ type: c.type, label: c.type })),
    readings: live,
    anomalies: flags,
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
      const port = isDemo() ? null : await requestPort()
      const session = new (isDemo() ? DemoSession : SerialSession)({
        port,
        onData: (obj) => {
          if (obj && typeof obj.ts === 'number') {
            const hasAccel = typeof obj.ax === 'number'
            const vib = hasAccel ? Math.abs(Math.hypot(obj.ax, obj.ay, obj.az) - 1) : null
            const clean = { temp: obj.temp, hum: obj.hum, vib, ax: hasAccel ? obj.ax : null, ay: hasAccel ? obj.ay : null, az: hasAccel ? obj.az : null }
            setLive(clean)
            setFlags(anomalyFlags(clean))
          }
        },
        onError: (err) => { setStatus('error'); setTutor(t => ({ ...t, error: err.message })) },
      })
      sessionRef.current = session
      await session.open()

      const idRes = await session.command('IDENT')
      setDevice({ id: idRes.id, board: idRes.board, fw: idRes.fw })
      await session.command('PING')

      setStatus('scanning')
      const scanRes = await session.command('SCAN', 20000)   // full I2C sweep can take ~12s on an empty bus
      const detected = scanToComponents(scanRes)
      setScanInfo(scanNotice(scanRes))
      setLayout(prev => mergeLayout(prev, detected))

      await session.command('STREAM on')
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
              <TwinCanvas layout={layout} live={live} flags={flags}
                onMove={(id, x, y) => setLayout(l => moveComponent(l, id, x, y))}
                onAdd={(type) => setLayout(l => addComponent(l, type))} scanInfo={scanInfo} />
            </>
          )}
        </main>

        <TutorPanel context={context()} onSubmit={askTutorFlow} replyState={tutor}
          initialThread={isTutorDemo() ? [{ role: 'user', content: 'Why does the vibration flag keep turning on?' }] : []} />
      </div>
    </div>
  )
}