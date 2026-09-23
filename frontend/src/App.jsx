import { useState } from 'react'
import DeviceList from './components/DeviceList'
import SensorChart from './components/SensorChart'
import AlertsPanel from './components/AlertsPanel'
import RulCard from './components/RulCard'
import ChatPanel from './components/ChatPanel'
import { useDeviceSocket } from './hooks/useDeviceSocket'
import './App.css'

export default function App() {
  const [selectedDevice, setSelectedDevice] = useState(null)
  const { messages: liveMessages, connected } = useDeviceSocket(selectedDevice?.device_id ?? null)

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-brand">
          <div className="brand-mark">
            <span className="bm-a" />
            <span className="bm-b" />
          </div>
          <span className="brand-twin">Twin</span>
          <span className="brand-lab">Lab</span>
        </div>
        <span className="navbar-sep" />
        <span className="navbar-sub">Predictive Maintenance for Pakistani Industry</span>
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
        <DeviceList
          selectedId={selectedDevice?.device_id}
          onSelect={setSelectedDevice}
        />

        <main className="charts-area">
          {!selectedDevice ? (
            <div className="empty-state">
              <p>Select a device from the panel to view live sensor data.</p>
            </div>
          ) : (
            <>
              <div className="charts-header">
                <span className="charts-device-name">{selectedDevice.name}</span>
                <span className="charts-device-location">{selectedDevice.location}</span>
              </div>
              <RulCard deviceId={selectedDevice.device_id} />
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

      <ChatPanel device={selectedDevice} />
    </div>
  )
}
