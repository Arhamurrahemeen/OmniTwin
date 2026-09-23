# Task 7 — Frontend: project framing, roster UI, alert hints (DONE)

## Intent
Make the student dashboard speak "project" not "device": RUL strip + chat FAB removed, roster import + project-creation UI, alerts show their education hint (`hint_en`), and the left rail hosts a student roster panel.

## Done
- `frontend/src/api.js`: dropped `getRul`/`postChat`; added `getRoster`, `getProjects` (=getDevices), `importRoster` (multipart), `createProject` (POST /projects, surfaces `d.detail`), `assignDemoKit` (POST /demo-kit).
- `App.jsx`: RulCard + ChatPanel gone; subtext → `Digital twin learning lab`; empty-state → `Select a project to view live sensor data.`; RosterPanel in a left rail under the project list.
- `DeviceList.jsx`: panel → **Projects**; strip → `{n} projects · {m} shared demo kit`; card header falls back to `(owner || 'Shared')`.
- `RegisterDevice.jsx`: project-creation mode — required **Owner (email)** + Name/Location/Sensors/Thresholds → `createProject` (always simulator); `mode="hardware"` instructor path (shared-kit registration) lives on RosterPanel.
- `AlertsPanel.jsx`: renders `hint_en` under each alert's detail; fuel-tamper/push_sent/grocery branches gone; tag always `threshold`.
- `EditDevice.jsx`: slimmed (no asset_type/plant/criticality/warranty/vendor/run-hours); `owner` read-only.
- `RosterPanel.jsx` (new): CSV import (`name,email`), rows `name · email · 1 project · N slots remaining`, click with remaining quota → Create Project pre-filled with that student.
- Deleted `RulCard.jsx`, `ChatPanel.jsx`. `SIMULATOR_SENSORS` = hardware sensors only (no dead generator sensors offered).
- Verified: `npm run build` ✓, `npm run lint` (oxlint) ✓, `npm run dev` HTTP 200 ✓, grep clean for industrial fields.
- Commit `7b6e90a` + `8c446f2` (cleanup). Review: clean.

## Expect
- Dashboard now frames projects, imports a roster CSV, enforces the 1-slot quota in the UI, and shows alert hints. Shared kit = "demo kit" card, instructor registers it via RosterPanel legend.
- Live data still needs services (Task 10). `assignDemoKit` API exists but has no UI button yet — rotation UI lands with Task 8/9.
- The brand header is still the old mark — wordmark PNG lands in Task 8.

## Commands
```powershell
cd D:\OmniTwin\frontend; npm run dev   # http://localhost:5173 — visual check after services up
```