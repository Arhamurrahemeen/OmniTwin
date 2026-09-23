import { useEffect, useState } from "react"
import { getSimDevices } from "./api"
import DeviceControl from "./components/DeviceControl"
import "./App.css"

export default function App() {
  const [devices, setDevices] = useState([])
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSimDevices()
      .then(setDevices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="sim-app">
      <header className="sim-header">
        <span className="sim-title">OmniTwin</span>
        <span className="sim-subtitle">Instructor Console</span>
      </header>

      <main className="sim-main">
        {loading && <p className="sim-muted">Connecting to backend…</p>}
        {error   && <p className="sim-error">Backend unavailable: {error}</p>}
        {!loading && !error && devices.length === 0 && (
          <p className="sim-muted">
            No active simulator devices found. Register a device with Source = Simulator in the dashboard.
          </p>
        )}
        {devices.map((d) => (
          <DeviceControl key={d.device_id} device={d} />
        ))}
      </main>
    </div>
  )
}
