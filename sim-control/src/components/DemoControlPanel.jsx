import { useState } from "react"
import { getDevice, patchDevice, getSimCtrl, putSimCtrl, postSimReset } from "../api"

// Hard-coded demo device IDs from the Phase 10 NFL seed (seed_nfl.py).
const GENSET_ID = "NFL-SITE-GEN-01"
const COMP_ID   = "NFL-SITE-COMP-02"

// PUT /sim/{id} does a full replace, not a patch — always merge onto the
// current doc so base_values / other injectors survive.
async function mergeSimCtrl(deviceId, patch) {
  const current = await getSimCtrl(deviceId)
  await putSimCtrl(deviceId, {
    ...current,
    ...patch,
    inject: { ...current.inject, ...(patch.inject ?? {}) },
  })
}

export default function DemoControlPanel() {
  const [busy, setBusy]     = useState(null)
  const [status, setStatus] = useState(null)

  const run = async (key, fn) => {
    setBusy(key)
    setStatus(null)
    try {
      await fn()
      setStatus({ key, ok: true, text: "done" })
    } catch (e) {
      setStatus({ key, ok: false, text: e.message })
    } finally {
      setBusy(null)
    }
  }

  const injectOverheat = () => run("overheat", async () => {
    await mergeSimCtrl(GENSET_ID, {
      inject: { overheat: { active: true, until_ts: Date.now() + 90_000 } },
    })
  })

  const injectConsumable = () => run("consumable", async () => {
    const device = await getDevice(COMP_ID)
    const threshold = device.run_hours_threshold ?? 500
    // Run-hours accrue in real wall-clock time (~1/3600h per load_current tick).
    // threshold - 0.1 (phase-12 spec's literal value) needs ~6 real minutes of
    // ticks to cross — unworkable on stage. threshold - 0.0003 crosses on the
    // next tick (~1s), confirmed during the Phase 12 rehearsal (rd_benchmarks.md).
    await patchDevice(COMP_ID, { run_hours: threshold - 0.0003 })
  })

  const injectTheft = () => run("theft", async () => {
    await mergeSimCtrl(GENSET_ID, {
      generator_on: false,
      inject: { fuel_theft: { active: true, until_ts: Date.now() + 15_000 } },
    })
  })

  const demoReset = () => run("reset", async () => {
    await postSimReset()
  })

  return (
    <div className="demo-panel">
      <p className="demo-panel-title">Demo Controls</p>
      <div className="demo-panel-buttons">
        <button className="demo-btn" disabled={busy} onClick={injectOverheat}>
          {busy === "overheat" ? "…" : "1. Inject Overheat"}
        </button>
        <button className="demo-btn" disabled={busy} onClick={injectConsumable}>
          {busy === "consumable" ? "…" : "2. Inject Consumable"}
        </button>
        <button className="demo-btn demo-btn--theft" disabled={busy} onClick={injectTheft}>
          {busy === "theft" ? "…" : "3. Inject Theft"} <span className="demo-simulated-pill">SIMULATED</span>
        </button>
        <button className="demo-btn demo-btn--reset" disabled={busy} onClick={demoReset}>
          {busy === "reset" ? "…" : "Demo Reset"}
        </button>
      </div>
      {status && (
        <p className={`demo-status ${status.ok ? "demo-status--ok" : "demo-status--error"}`}>
          {status.key}: {status.text}
        </p>
      )}
    </div>
  )
}
