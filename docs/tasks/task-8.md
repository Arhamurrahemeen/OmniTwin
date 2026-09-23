# Task 8 — OmniTwin brand retheme (dashboard + sim-control) (DONE)

## Intent
Rebrand both frontends: paper-light surfaces, deep-green primary, Space Grotesk + JetBrains Mono, real wordmark PNG in the navbar, and zero TwinLab/OmniteX strings.

## Done
- `scripts/render_wordmark.py` (PyMuPDF) → rendered `docs/OmniTwin_Wordmark_Dark.pdf` p1 → `frontend/src/assets/wordmark.png` (27 KB, ink "Omni" + green "Twin" pixel-verified).
- `frontend/` retheme: `:root` palette (`--ot-green #0F6E56 · --ot-ink #04342C · --ot-paper #F1EFE8 · --ot-orange #D85A30`), paper navbar hosting wordmark img (~30px), white cards on `#F6F5F0`, muted `#6A7888`, warning→orange / critical→`#E05252`; fonts added; `<title>` retitled.
- `sim-control/`: same palette, header `OmniTwin · Instructor Console`, new fonts. **No** kit-orange on the instructor console (Brand §3).
- Dead CSS stripped (`.chat-*`, `.rul-*`, `.criticality-*`, `.warranty-*`, `.bm-a/b`, `.brand-mark`, sim `.demo-*`/`.gen-*`); no orphan JSX refs.
- Grep `twinlab|omnitex`: **zero OmniteX leaks**; only data-plane hits remain (MQTT topic, Influx org/bucket/token, Mongo db/uri, 7 internal logger names) + docs/firmware path references; `FastAPI(title=...)` → `OmniTwin API`.
- **Fix round 1:** kit-orange purged from sim-control (`.saving-dot` → green; grep 0 orange); `SensorChart.jsx` chart layer rethemed (grid/ticks/white tooltip/caution orange/humidity green — grep 0 old hexes).
- Commits `ae9eee7` + `576abf7`. Review: clean after 1 fix round.

## Expect
- Dashboard = light paper + green; wordmark in the navbar. Instruct warnings show orange, criticals red — still distinct.
- Wordmark renders `#4FD8AE`-ish green-teal (the supplied PDF's actual tone), not Brand.md's literal `#0F6E56` — per Brand §5b the published asset is authoritative.
- Logger names `twinlab.*` still exist inside backend (invisible plumbing) — sweep only if wanted.

## Commands
```powershell
cd D:\OmniTwin\frontend; npm run dev      # http://localhost:5173 — check wordmark + paper theme
cd D:\OmniTwin\sim-control; npm run dev   # :5174 — check no orange, header
cd D:\OmniTwin; .\.venv\Scripts\python scripts\render_wordmark.py   # re-render if PDF ever changes
```