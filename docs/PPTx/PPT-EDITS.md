# OmniTwin — Edit list for `TwinLab_Edu_Digital_Twins.pptx`

The deck's slides are rasterized images (Canva/Gemini export — "Gemini" watermark is baked into every slide, so it must be removed while editing each image, not by text-editing the pptx). Changes below are word-for-word corrections against the OmniTwin docs (`docs/Overview.md`, `docs/Brand.md`, `docs/Team.md`, `docs/Cost-Structure.md`).

## Slide 1 — Title
- **Rename** heading from `TwinLab Edu (OmniTwin)` → **`OmniTwin`** (TwinLab Edu is the retired old name; OmniTwin is the standalone venture).
- **Remove** the words `Industrial IoT` from the subtitle. OmniTwin is a learning platform, not industrial IoT.
- Keep the tagline and "at a fraction of global vendor cost" — those are accurate.
- Remove the `Gemini` watermark.

## Slide 2 — Problem
- Content is accurate. Restyle only; no wording changes.

## Slide 3 — Market
- Figures are correct. Restyle only; no wording changes.

## Slide 4 — Hardware & software
- **Fix claim**: `Real-Time 3D Digital Twin Dashboard` → **`Real-Time 2D Digital Twin Dashboard`** (the twin is 2D, not 3D).
- **Replace** `[INSERT PROTOTYPE SCREENSHOT HERE]` with `screenshots/B_twin.png` (live twin: ESP32 + MPU6050 + DHT22 with streaming values).

## Slide 5 — Features (the big one — most misleading slide)
Replace the three claims with what actually ships:

| Current (remove) | Corrected copy |
|---|---|
| `Predictive Fault Detection catches short circuits and I/O conflicts before the physical hardware burns` | **Instant local anomaly flags** — NaN, out-of-range, and frozen readings flagged at zero LLM cost. No short-circuit prediction exists; don't claim it. |
| `Offline buffer ensures continuous data integrity during power cuts` (load-shedding) | Not shipped — move to roadmap: **Roadmap: Urdu-first UI · offline buffer for load-shedding resilience** |
| `Urdu AI Coaching Engine` | **On-demand AI tutor** — grounded in the rig's live readings; guidance, never autonomous control. (Urdu is positioning, not the shipped UI.) |

Keep the plug-and-detect / live 2D twin / value-overlay features — those are real.
- **Replace** `[INSERT UI SCREENSHOT HERE]` with `screenshots/C_tutor.png` (Ask the Tutor panel with a grounded answer).

## Slide 6 — Pricing tiers (wrong model)
| Current (remove) | Corrected copy |
|---|---|
| Freemium: "Limited simulation time" | **Virtual tier · 1 project** — full platform incl. AI tutor |
| Pro: "$20/month · ESP32 Kit + 6-month platform access" | **$20/month · unlimited projects** — fixed subscription, not usage-metered; kit sold separately (~PKR 10k) |
| University: PKR 500,000/year · 50 seats · LMS | Keep — accurate |

Add one line under the tiers: **"Capability is never paywalled — all AI is on every tier. The upgrade trigger is needing more than one project."**
- Remove the `Gemini` watermark.

## Slide 7 — Unit economics
- Figures match the cost model. Add honesty note: `Pre-revenue; figures from the current cost model, not actuals.`
- Remove the `Gemini` watermark.

## Slide 8 — Competitive landscape
- **Rename** `TwinLab Edu (OmniTwin)` → **`OmniTwin`** in the table.
- **Fix typo**: `PKR 500,000M` → **`PKR 500,000/yr`** (as written it reads as 500 million).
- Remove the `Gemini` watermark.

## Slide 9 — GTM
- Content is accurate. Restyle only; no wording changes.

## Slide 10 — Team
- Keep all four members (Muhammad Arham Rajput, Asma Aslam, Tasbiha Naz, Abdul Basit) as-is.
- Note: `docs/Team.md` says roles aren't finalised yet — fine to keep for the pitch, flagged as an open item.
- Remove the `Gemini` watermark.

## Slide 11 — Traction
- **Fix feature overclaim**: `functional temperature, flow, and vibration fault detection` → **`temperature, humidity, and vibration (IMU) sensing with local anomaly flags`** (there is no flow sensor in the rig).
- Remove the `Gemini` watermark.

---

## Screenshots (add manually)
Files in `docs/PPTx/screenshots/`:

| File | What it shows | Use on |
|---|---|---|
| `A_connect.png` | Connect screen — "No board connected · Connect your ESP32" | Optional, slide 1 or 4 as the first step |
| `B_twin.png` | Live 2D twin — ESP32 + MPU6050 + DHT22, streaming values, STREAMING status | Slide 4 (replaces `[INSERT PROTOTYPE SCREENSHOT HERE]`) |
| `C_tutor.png` | Ask the Tutor panel with a grounded Q&A | Slide 5 (replaces `[INSERT UI SCREENSHOT HERE]`) |

All three are real captures of the running dashboard in offline demo mode (`http://localhost:5180`, `?demo=1` / `?demo=1&tutor=1`).