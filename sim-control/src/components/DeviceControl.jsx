import { useEffect, useRef, useState } from "react"
import { putSimCtrl } from "../api"

const INJECT_DURATION_MS = 120_000   // 2 minutes per injector activation
const INJECTORS = [
  { key: "fuel_theft", label: "Inject Fuel Theft",    icon: "⛽" },
  { key: "overheat",   label: "Inject Overheat",      icon: "🌡" },
  { key: "overload",   label: "Inject Overload",      icon: "⚡" },
  { key: "offline",    label: "Drop Connectivity",    icon: "📡" },
]

export default function DeviceControl({ device }) {
  const [ctrl, setCtrl]   = useState(device.sim_control)
  const [now, setNow]     = useState(Date.now())
  const [saving, setSaving] = useState(false)
  const sliderTimer         = useRef(null)

  // Tick countdown every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const remaining = (key) => {
    const inj = ctrl?.inject?.[key]
    if (!inj?.active || inj.until_ts <= now) return null
    return Math.ceil((inj.until_ts - now) / 1000)
  }

  const merge = (current, patch) => ({
    ...current,
    ...patch,
    base_values: { ...current.base_values, ...(patch.base_values ?? {}) },
    inject:      { ...current.inject,      ...(patch.inject      ?? {}) },
  })

  const update = async (patch) => {
    const next = merge(ctrl, patch)
    setCtrl(next)
    setSaving(true)
    try {
      await putSimCtrl(device.device_id, next)
    } catch (e) {
      console.error("sim ctrl update failed", e)
    } finally {
      setSaving(false)
    }
  }

  const handleSliderChange = (key, value) => {
    setCtrl(prev => ({
      ...prev,
      base_values: { ...prev.base_values, [key]: Number(value) },
    }))
  }

  const handleSliderCommit = (key, value) => {
    clearTimeout(sliderTimer.current)
    sliderTimer.current = setTimeout(() => {
      update({ base_values: { [key]: Number(value) } })
    }, 200)
  }

  const toggleGenerator = () => update({ generator_on: !ctrl.generator_on })

  const activateInjector = (key) => {
    update({
      inject: {
        [key]: { active: true, until_ts: Date.now() + INJECT_DURATION_MS },
      },
    })
  }

  const genOn = ctrl?.generator_on ?? true

  return (
    <div className="device-card">
      <div className="device-header">
        <span className="device-name">{device.name ?? device.device_id}</span>
        <span className="sim-badge">SIM</span>
        {saving && <span className="saving-dot" title="Saving…" />}
      </div>

      {/* Generator toggle */}
      <div className="control-row">
        <label className="control-label">Generator</label>
        <button
          className={`gen-toggle ${genOn ? "gen-on" : "gen-off"}`}
          onClick={toggleGenerator}
        >
          {genOn ? "● ON" : "○ OFF"}
        </button>
      </div>

      {/* Base value sliders */}
      <div className="sliders">
        <SliderRow
          label="Fuel Level"
          unit="L"
          value={ctrl?.base_values?.fuel_level ?? 70}
          min={0} max={200}
          onChange={(v) => handleSliderChange("fuel_level", v)}
          onCommit={(v)  => handleSliderCommit("fuel_level", v)}
        />
        <SliderRow
          label="Load Current"
          unit="A"
          value={ctrl?.base_values?.load_current ?? 18}
          min={0} max={60}
          onChange={(v) => handleSliderChange("load_current", v)}
          onCommit={(v)  => handleSliderCommit("load_current", v)}
        />
        <SliderRow
          label="Temperature"
          unit="°C"
          value={ctrl?.base_values?.temperature ?? 35}
          min={0} max={120}
          onChange={(v) => handleSliderChange("temperature", v)}
          onCommit={(v)  => handleSliderCommit("temperature", v)}
        />
        <SliderRow
          label="Humidity"
          unit="%"
          value={ctrl?.base_values?.humidity ?? 55}
          min={0} max={100}
          onChange={(v) => handleSliderChange("humidity", v)}
          onCommit={(v)  => handleSliderCommit("humidity", v)}
        />
      </div>

      {/* Injector buttons */}
      <div className="injectors">
        {INJECTORS.map(({ key, label, icon }) => {
          const secs = remaining(key)
          const active = secs !== null
          return (
            <button
              key={key}
              className={`injector-btn ${active ? "injector-active" : ""}`}
              onClick={() => activateInjector(key)}
              disabled={active}
            >
              <span className="inj-icon">{icon}</span>
              <span className="inj-label">{active ? `${secs}s` : label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SliderRow({ label, unit, value, min, max, onChange, onCommit }) {
  return (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseUp={(e) => onCommit(e.target.value)}
        onTouchEnd={(e) => onCommit(e.target.value)}
      />
      <span className="slider-value">{Number(value).toFixed(0)} {unit}</span>
    </div>
  )
}
