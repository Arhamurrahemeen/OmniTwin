---
owner: Arham
project: OmniTwin
status: active
tags:
  - project/omnitwin
  - type/overview
  - status/active
type: overview
updated: 2026-08-14
---
# OmniTwin — Overview

**Status:** Active, early setup phase. Reset/relaunch of the concept previously called "TwinLab Edu," now an independent venture under the name **OmniTwin**, separate from OmniteX/TwinLab.

**Source:** Drafted from the uploaded PDF (`TwinLab_Edu___Detailed_Overview.pdf`, 2026-08-13), renamed and reframed as OmniTwin per Arham's direction. Original product content largely carries over; branding and company relationship do not.

---

## 1. Problem Statement

Engineering students across Pakistan learn embedded systems, IoT, and industrial automation almost entirely through theory. Real hardware labs are expensive to build, expensive to maintain, and rarely available at scale — most students never get hands-on time outside a lucky few final-year projects. Universities either lack modern IoT/digital-twin labs entirely, or they're locked in a handful of top-tier institutions. Students graduate having read about sensor networks, predictive maintenance, and industrial monitoring, but never actually built, broke, or debugged one in real conditions.

## 2. Solution

OmniTwin is a hands-on digital twin learning platform: students connect a low-cost hardware kit (ESP32 + sensors) to a software platform that mirrors sensor data in a live, interactive dashboard in real time. Instead of simulating a system on paper, students see actual physical behavior — vibration, temperature, flow — reflected instantly in a virtual twin they can monitor, analyze, run AI-assisted fault detection on, and get AI coaching that guides them through fixing the issue (guidance, not autonomous control of the hardware). Designed to scale from one curious student on a free virtual tier to an entire university department running it as core lab infrastructure.

## 3. Product Tiers

**Model:** No feature-gating. Every tier gets full platform access, including AI-assisted fault detection and AI coaching (guidance on how to fix issues, not autonomous control). What's gated is **project count**, not capability.

| Tier | What's included | Purpose |
|---|---|---|
| Freemium | Full features, limited to 1 project, virtual-only mode | Hook students before they commit to hardware |
| Pro | Fixed monthly subscription, individual student, unlimited projects | Marketing/awareness wedge — student-to-university funnel |
| University License | 50 seats, unlimited projects for duration of license, full LMS integration | Institutional B2B — the real revenue driver |

**Pricing (confirmed 2026-08-13):**
- Pro: **$20/month**, fixed subscription — not usage/token-metered. (Earlier tokenized/Claude-style consumption model considered and dropped in favor of predictable fixed pricing and unit economics.)
- University License: **5 Lac PKR/year for 50 seats** (≈10,000 PKR/seat/year).

**Flag, not yet resolved:** Pro ($20/mo ≈ 67,000 PKR/yr individual) prices well above per-seat university cost (10,000 PKR/seat/yr) — deliberate choice, not yet stress-tested against student willingness-to-pay.

## 4. Why It's Needed (the honest version)

This is not a category being invented from scratch — digital twin education kits are an active, growing academic and commercial space globally (Siemens, PTC, National Instruments all have education tiers; Labtech International sells a near-identical "physical lab equipment → live digital twin" product commercially today). The real gap: none of these are built for Pakistani universities — priced for Pakistani budgets or running in Urdu. The honest wedge is not "no one does this," but "no one does this affordably and locally for this market."

## 5. Competitive Landscape

| Platform              | Price                         | Pakistan-focused | Student tier      |
| --------------------- | ----------------------------- | ---------------- | ----------------- |
| Siemens MindSphere    | ~$5,000+/month                | No               | No                |
| PTC ThingWorx         | ~$4,000+/month                | No               | No                |
| AWS IoT TwinMaker     | Pay-per-resource              | No               | Limited           |
| Labtech International | Enterprise, custom quote      | No               | No                |
| **OmniTwin**          | **PKR 5 Lac/year (50 seats)** | **Yes**          | **Yes — 3 tiers** |

## 6. Defensibility

1. **Price** — a fraction of global vendor cost, viable for Pakistani university budgets.
2. **Localization** — Urdu-first UI; global vendors have no commercial incentive to build this.
3. **Physical presence** — can walk into DUET, pilot, and close a contract; not economical for Siemens or Labtech to build a Pakistan-specific sales motion for this market size.
4. **Existing traction** — academic anchor at DUET, shortlisted/placed at Pitch Your Vision 2026 and ELXR'26 — real proof-of-concept credibility, not just an idea.

## 7. Relationship to OmniteX / TwinLab

OmniTwin is a **separate venture** from OmniteX (the company behind TwinLab, a Supply Chain Asset Performance Management platform for Textile/FMCG). They share a conceptual ancestor — this Edu concept previously existed as a parked "TwinLab Edu" sub-brand — but as of 2026-08-13 OmniTwin stands alone: new name, new team, own pricing model (licensing, vs. TwinLab's subscription/transactional). See `Hackathons/TwinLab/TwinLab_Edu_Parked.md` for historical background only.

## 8. Open Questions Carried Over (worth revisiting)
- Whether the same ESP32 + sensor set is right for lab instrumentation, or whether it needs to differ from an industrial sensor kit.

---

## Related
- [[Profile/Who is Arham]] §5a — identity-level summary of OmniTwin
- `Hackathons/TwinLab/TwinLab_Edu_Parked.md` — historical background, now superseded
- [[OmniTwin/Team]] — team roster (Arham, Asma Aslam, Tasbiha Naz)
- [[OmniTwin/GTM-Revenue]] — customer/revenue, GTM, commercial risk
- [[OmniTwin/Cost-Structure]] — CAPEX/OPEX
- [[OmniTwin/Brand]] — theme, voice, visual identity, logo
