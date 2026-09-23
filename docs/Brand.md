---
owner: Arham
project: OmniTwin
status: active
tags:
  - project/omnitwin
  - type/brand
  - status/active
type: brand
updated: 2026-08-14
---
# OmniTwin — Brand: Theme, Voice, Visual Identity, Logo

**Status:** Early, in progress. Wordmark direction locked; icon/favicon and domain unresolved.

---

## 1. Audience & Positioning Split

Dual audience, resolved as a deliberate split rather than one blended tone:

- **Students** (freemium hook) — playful, hands-on register.
- **Universities** (procurement/institutional, the real revenue driver per Overview.md §3) — credible, serious register. A department signing a PKR 5 Lac/year contract is a procurement decision, not a hobby purchase; pure maker/Arduino aesthetic risks reading as "student club project" and undercutting the institutional close.

**Resolution (confirmed by Arham):** Core identity (logo, color, type) is credible-first. Playful expression is a separate layer — dashboard UI, icons, illustration, docs — that flexes down for students without the core identity flexing down for universities. Comparable to how Arduino itself splits a serious core mark from a playful ecosystem.

## 2. Wordmark (confirmed direction)

**Selected: wordmark-only, no icon/symbol.**

- Rendered as **Omni** (dark / `--text-primary`) + **Twin** (deep green, `#0F6E56`), single lockup, no separator.
- Typeface: **Space Grotesk**, weight 500, tight letter-spacing (-0.02em).
- Correct capitalization: **OmniTwin** (capital O, capital T) — not "omnitwin" or "Omnitwin."
- Rationale: matches how Linear/Stripe/Vercel actually use their identities day-to-day — wordmark carries the brand in running use; an icon/symbol is secondary (favicon, app tile) rather than the primary mark.

### Rejected concepts (for reference, don't revisit without new reasoning)
- **Concentric rings / pulse node** — rejected: overused in IoT/telemetry startup logos generically, no OmniTwin-specific meaning.
- **Concept A (mirrored squares)**, **B (facing brackets)**, **C (split hex/chip)** — rejected as "too abstract/geometric," despite being technically on-brand for a hardware company.
- **Concept D (ESP32 board silhouette)** — most literal, but too busy at small/favicon sizes.
- **Concept E (single chip icon)** — clean and scales well, but generic; no company-specific meaning.
- **Concept F (solid chip + dashed ghost-twin chip)** — Claude's pick if an icon is wanted: literal hardware object *and* encodes the twin concept via solid/dashed pairing. Not rejected outright — sidelined only because wordmark-only was chosen instead. Worth revisiting if a favicon/app-icon mark is needed later.
- **Concept G (dashboard + waveform)** — deprioritized: leans software-only, undersells the hardware side of the product.
- **Concept H (offset squares, opacity-based twin)**, **I (infinity-loop OT monogram)** — shown on request as "clean SaaS/dev-tool" (Vercel/Linear/Stripe) alternatives; both abstract with no hardware meaning. Not selected.

### Open item
No icon/symbol currently exists. A wordmark alone does not scale down to a 16–32px favicon or app tile. **Concept F** is the standing recommendation if/when an icon is needed — solid chip (physical) + dashed outline chip (digital twin), deep green, offset lower-right.

## 3. Color System

| Color | Hex | Role |
|---|---|---|
| Deep signal green | `#0F6E56` | Primary — logo, wordmark accent, credible/institutional surfaces |
| Ink | `#04342C` | Text / dark UI |
| Kit orange | `#D85A30` | Playful accent — **fenced to student-facing product only** (dashboard highlights, kit packaging, onboarding). Never in the wordmark or university-facing materials. |
| Paper | `#F1EFE8` | Neutral background |

**Note on green choice:** deliberately shifted away from Arduino's exact teal (`#00878F`-ish family) — close enough to signal "hardware/maker" by association, distinct enough to not read as an Arduino reskin. Confirmed: Arduino's own brand identity is built around a specific proprietary teal shade, so straight teal was avoided.

## 4. Typography

| Typeface | Use |
|---|---|
| Space Grotesk | Wordmark, headings — geometric, technical register |
| JetBrains Mono | Data, specs, sensor readouts, code — reinforces hardware/technical register in dashboards and docs |
| System sans (Inter or platform default) | Body copy — Space Grotesk is a display face, not meant for long paragraphs |

Both Space Grotesk and JetBrains Mono are free/open-source (Google Fonts) — no licensing cost, relevant for a pre-revenue startup.

## 5. Voice

Same underlying fact, reworded per audience — not two different claims, two different registers:

- **University-facing:** "A digital twin lab platform built for Pakistani engineering departments, at a fraction of global vendor cost."
- **Student-facing:** "Wire up a sensor, watch it come alive on screen. Break it, fix it, learn how it actually works."

## 5b. Wordmark Asset

- **`docs/OmniTwin_Wordmark_Dark.pdf`** — the dark wordmark (Omni + Twin, deep green `#0F6E56`, Space Grotesk, per §2) supplied by Arham. Use this exact asset in the product (dashboard header, docs cover). Do not re-render/re-approximate the wordmark.

## 6. Name Risk — OmniTwin (flagged, not resolved)

- **Confirmed conflict:** `omnitwin.ai` is a live, active company ("OmniTwin Technologies" — workflow intelligence/AI product, different sector). Their ToS claims trademark protection over "OmniTwin" branding broadly (text, graphics, logos, images, software).
- **Risk assessment:** different sector lowers confusion/legal risk but doesn't eliminate it. No USPTO filing found for either party at time of check — but their ToS asserts trademark claim regardless of filing status.
- **Arham's decision:** keep OmniTwin. Different sector, accepted as low risk. Logged as a known risk, not actively being mitigated.
- **Domain check status (incomplete — search-engine absence is not a registrar confirmation):**
  - `.ai` — taken (confirmed, live site)
  - `.com` — no indexed site found; **not confirmed available**, needs an actual Namecheap/GoDaddy check
  - `.pk` — no indexed site found; **not confirmed available**, needs a PKNIC check specifically (matters given the localization/Pakistan-market positioning in Overview.md §6)
  - `.eth` — registered as an ENS name, irrelevant to actual use
- **Not yet checked:** Pakistan IPO trademark registry, social handles (Instagram/LinkedIn/X), `.com`/`.pk` via an actual registrar tool.

## 7. Open Items

1. Icon/favicon/app-tile mark — none selected. Concept F is the standing recommendation to revisit.
2. Domain registration — needs real registrar/PKNIC check, not search-engine inference.
3. Pakistan IPO trademark search — not yet run.
4. Social handle availability — not yet checked.
5. This document is chat-derived, not yet turned into any downloadable file (per instruction: don't generate files unless explicitly asked).

---

## Related
- [[OmniTwin/Overview]] — product, market, pricing, competitive landscape
- [[OmniTwin/Team]] — team roster
- [[Profile/Who is Arham]] §5a — identity-level OmniTwin summary
