# Task 7 - Frontend: project framing, roster UI, alert hints (DONE)

## Intent
Reframe the dashboard around **projects** (education framing) instead of industrial equipment: project title/copy, an owner/shared demo-kit account model, a roster panel with quota-aware project creation, and education alert hints (`hint_en`) — matching the on-disk brief (`task-7-brief.md`), which is the single source of requirements.

## Done
- `api.js`: removed dead `getRul`/`postChat`; added `getRoster`, `getProjects` alias, `importRoster` (multipart), `createProject`, `assignDemoKit` — wiring to the Task 5 backend routes.
- `App.jsx`: dropped RulCard + ChatPanel; navbar subtext -> `Digital twin learning lab`; empty-state -> `Select a project to view live sensor data.`; left rail now wraps project list + roster panel.
- `DeviceList.jsx`: title `Devices` -> `Projects`; strip -> `{n} projects · {m} shared demo kit`; card header fallback `(owner || 'Shared')`; dropped criticality badge, warranty, per-card alerts-today polling, status-inactive.
- `RegisterDevice.jsx`: two modes — `project` (Create Project; owner=student email; posts `/projects`, always simulator; `device_id:'project'` placeholder the backend overwrites) vs `hardware` (Register Hardware Kit; MQTT discover; posts `/devices` source hardware). Removed student-visible source dropdown.
- `AlertsPanel.jsx`: renders `a.hint_en` under `a.detail`; dropped 🛒/fuel-theft branches, push_sent line, always-threshold tag.
- `EditDevice.jsx`: slimmed to name/location/source/status/sensors/thresholds; owner read-only; dropped asset_type/plant/criticality/warranty/purchase/vendor/run-hours.
- `RosterPanel.jsx` (new): CSV import via `importRoster`, student rows (name · email · `1 project · N slots remaining` / `quota reached`), click free student -> Create Project prefilled with their email; instructor `+` -> hardware registration.
- Deleted `RulCard.jsx`, `ChatPanel.jsx`.
- `sensor-options.js`: dropped generator `fuel_level`/`load_current` from `SIMULATOR_SENSORS` (Task 6 sim no longer publishes them) — follow-up commit `8c446f2`.

## Verified
- `npm run build` clean (441 modules, 1.15s); `npm run lint` (oxlint) clean.
- `npm run dev` -> VITE ready, then `Invoke-WebRequest http://localhost:5173/` -> `STATUS=200`, HTML served (data calls fail live — services absent per Ruling 12).
- Greps: `last_hr|charge|capacity|charge_remaining|degradation|state` + `RulCard|ChatPanel|getRul|postChat|fuel|genset|generator|warranty|criticality|vendor|purchase_date` -> zero hits in component code (only Task 8-scoped dead CSS blocks in `App.css` remain). No AR-ET-01/DG/PV/GC artifacts.

## Commits
- `7b6e90a` feat: project framing, roster UI, alert hints (10 files, +316/-327)
- `8c446f2` chore: drop generator sensor options from project picker

## Expect
- Students see projects + quota slots, create projects pre-filled from roster clicks; alerts carry education hints. Static verification only — live MQTT end-to-end is Task 10.

## Commands
```powershell
cd D:\OmniTwin\frontend; npm run build; npm run lint
npm run dev   # then: Invoke-WebRequest http://localhost:5173/
```