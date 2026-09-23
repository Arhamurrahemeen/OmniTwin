import { useState } from 'react'
import DeviceList from './components/DeviceList'
import SensorChart from './components/SensorChart'
import AlertsPanel from './components/AlertsPanel'
import RosterPanel from './components/RosterPanel'
import { useDeviceSocket } from './hooks/useDeviceSocket'
import wordmark from './assets/wordmark.png'
import './App.css'

export default function App() {
  const [selectedDevice, setSelectedDevice] = useState(null)
  const { messages: liveMessages, connected } = useDeviceSocket(selectedDevice?.device_id ?? null)

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-brand">
          <img className="navbar-wordmark" src={wordmark} alt="OmniTwin" />
        </div>
        <span className="navbar-sep" />
        <span className="navbar-sub">Digital twin learning lab</span>
        <div className="navbar-right">
          <span className={`status-dot ${connected ? 'status-dot--live' : 'status-dot--off'}`} />
          <span className={`status-label ${connected ? '' : 'status-label--off'}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </header>

      {selectedDevice && !connected && (
        <div className="loadshed-banner">
          ⚡ Connectivity lost — showing last known readings. Reconnecting…
        </div>
      )}

      <div className="workspace">
        <div className="left-rail">
          <DeviceList
            selectedId={selectedDevice?.device_id}
            onSelect={setSelectedDevice}
          />
          <RosterPanel />
        </div>

        <main className="charts-area">
          {!selectedDevice ? (
            <div className="empty-state">
              <p>Select a project to view live sensor data.</p>
            </div>
          ) : (
            <>
              <div className="charts-header">
                <span className="charts-device-name">{selectedDevice.name}</span>
                <span className="charts-device-location">{selectedDevice.location}</span>
              </div>
              <div className="charts-grid">
                {(selectedDevice.sensors ?? []).map(sensor => (
                  <SensorChart
                    key={sensor}
                    deviceId={selectedDevice.device_id}
                    sensor={sensor}
                    liveMessages={liveMessages}
                    threshold={selectedDevice.thresholds?.[sensor] ?? null}
                  />
                ))}
              </div>
            </>
          )}
        </main>

        <AlertsPanel device={selectedDevice} liveMessages={liveMessages} />
      </div>
    </div>
  )
}