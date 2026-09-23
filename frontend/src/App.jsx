/* OmniTwin dashboard: connect USB board (Web Serial) -> scan -> twin canvas + tutor. */
import { useEffect, useRef, useState } from 'react'
import TwinCanvas from './components/TwinCanvas'
import TutorPanel from './components/TutorPanel'
import { supportsSerial, requestPort, SerialSession } from './serial/serialBridge'
import {
  defaultLayout, scanToComponents, addComponent, moveComponent,
  anomalyFlags,
} from './serial/serialModel.mjs'
import { askTutor } from './api'
import wordmark from './assets/wordmark.png'
import './App.css'

const CTX_DEVICE_ID = 'local'

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
  const sessionRef = useRef(null)

  const context = () => ({
    device_id: device?.id ?? CTX_DEVICE_ID,
    components: layout.components.map(c => ({ type: c.type, label: c.type })),
    readings: live,
    anomalies: flags,
  })

  const connect = async () => {
    if (!supportsSerial()) { setStatus('error'); return }
    try {
      setStatus('connecting')
      const port = await requestPort()
      const session = new SerialSession({
        port,
        onData: (obj) => {
          if (obj && typeof obj.ts === 'number') {
            const vib = Math.abs(Math.hypot(obj.ax || 0, obj.ay || 0, obj.az || 0) - 1)
            const clean = { temp: obj.temp, hum: obj.hum, vib, ax: obj.ax, ay: obj.ay, az: obj.az }
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
      const scanRes = await session.command('SCAN')
      const detected = scanToComponents(scanRes)
      setLayout(prev => mergeLayout(prev, detected))

      await session.command('STREAM on')
      setStatus('streaming')
    } catch (err) {
      setStatus('error')
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  const askTutorFlow = async ({ messages }) => {
    setTutor(t => ({ ...t, messages, reply: null, error: null }))
    try {
      const res = await askTutor({ deviceId: device?.id ?? CTX_DEVICE_ID, context: context(), messages })
      setTutor(t => ({ ...t, reply: res.reply, sessionId: res.session_id }))
    } catch (err) {
      setTutor(t => ({ ...t, error: err.message }))
    }
  }

  useEffect(() => () => sessionRef.current?.close(), [])

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
              {status === 'error' && <p className="tutor-error">Check the cable and try again.</p>}
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
                onAdd={(type) => setLayout(l => addComponent(l, type))} />
            </>
          )}
        </main>

        <TutorPanel context={context()} onSubmit={askTutorFlow} replyState={tutor} />
      </div>
    </div>
  )
}