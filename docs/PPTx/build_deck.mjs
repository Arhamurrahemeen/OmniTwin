// Builds the OmniTwin pitch deck as a native, editable .pptx.
// Run: node docs/PPTx/build_deck.mjs   (requires pptxgenjs — see PPTXGENJS env override)
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const pptxgen = req(process.env.PPTXGENJS || 'C:/Users/Arham/AppData/Local/Temp/opencode/deckscaff/node_modules/pptxgenjs')

const pptx = new pptxgen()
pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
pptx.author = 'OmniTwin'
pptx.title = 'OmniTwin — Digital Twin Learning Platform'

// ---- brand palette (docs/Brand.md) ----
const INK = '04342C'
const GREEN = '0F6E56'
const MINT = '6EC6A6'
const PAPER = 'F1EFE8'
const CARD = 'E9F1EE'
const ORANGE = 'D85A30'
const WHITE = 'FFFFFF'
const MUTED = '5A6B66'
const LINE = 'C9D8D2'

const HEAD = 'Arial', BODY = 'Arial', MONO = 'Courier New'

const SHOTS = 'C:/Users/Arham/AppData/Local/Temp/opencode/omnitwin-deck/shots/'
const WORDMARK = 'D:/OmniTwin/frontend/src/assets/wordmark.png'

const shadow = () => ({ type: 'outer', color: INK, opacity: 0.14, blur: 6, offset: 3, angle: 45 })

// ---- helpers ----
const chip = (s, x, y, size = 0.28, color = GREEN) => {
  s.addShape(pptx.ShapeType.roundRect, { x, y: y + size * 0.35, w: size, h: size * 0.66, rectRadius: 0.3, fill: { color }, line: { type: 'none' } })
  s.addShape(pptx.ShapeType.rect, { x: x + size * 0.25, y, w: size * 0.12, h: size * 0.3, fill: { color }, line: { type: 'none' } })
  s.addShape(pptx.ShapeType.rect, { x: x + size * 0.62, y, w: size * 0.12, h: size * 0.3, fill: { color }, line: { type: 'none' } })
}
const sectionHead = (s, text) => {
  s.addImage({ path: WORDMARK, x: 0.55, y: 0.13, w: 1.6 })
  s.addText('DIGITAL TWIN LEARNING PLATFORM', { x: 2.3, y: 0.21, w: 8, h: 0.3, fontSize: 10, color: MUTED, fontFace: HEAD, isTextBox: true, margin: 0, charSpacing: 2 })
  chip(s, 0.55, 0.8, 0.26)
  s.addText(text, { x: 0.95, y: 0.62, w: 11.85, h: 0.75, fontSize: 29, bold: true, color: INK, fontFace: HEAD, isTextBox: true, margin: 0 })
  s.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 1.52, w: 12.23, h: 0.035, rectRadius: 0.5, fill: { color: LINE }, line: { type: 'none' } })
}
const card = (s, x, y, w, h, fill = CARD) => s.addShape(pptx.ShapeType.roundRect, {
  x, y, w, h, rectRadius: 0.09, fill: { color: fill }, line: { color: LINE, width: 0.75 }, shadow: shadow(),
})
const statNum = (s, x, y, w, text, color = GREEN, o = {}) => s.addText(text, {
  x, y, w, h: 0.95, fontSize: 44, bold: true, color, fontFace: HEAD, isTextBox: true, margin: 0, ...o,
})
const heading = (s, text, o = {}) => s.addText(text, {
  x: 0.5, y: 0.3, w: 4, h: 0.5, fontSize: 16, bold: true, color: INK, fontFace: HEAD, isTextBox: true, margin: 0, ...o,
})
const body = (s, text, o = {}) => s.addText(text, {
  x: 0.5, y: 0.4, w: 4, h: 1, fontSize: 13, color: INK, fontFace: BODY, isTextBox: true, margin: 0, valign: 'top', ...o,
})
const footer = (s) => s.addText('OmniTwin · replaces the retired "TwinLab Edu" deck', {
  x: 0.55, y: 7.1, w: 10, h: 0.3, fontSize: 9, color: MUTED, fontFace: BODY, isTextBox: true, margin: 0,
})
const shot = (s, path, x, y, w, caption) => {
  const h = w * 1100 / 1600
  card(s, x, y, w + 0.18, h + 0.18, WHITE)
  s.addImage({ path, x: x + 0.09, y: y + 0.09, w, h })
  if (caption) s.addText(caption, { x, y: y + h + 0.28, w, h: 0.35, fontSize: 10, color: MUTED, fontFace: MONO, isTextBox: true, margin: 0 })
}

// ================= SLIDE 1 — title (dark) =================
{
  const s = pptx.addSlide()
  s.background = { color: INK }
  s.addText([{ text: 'Omni', options: { color: WHITE } }, { text: 'Twin', options: { color: MINT } }], {
    x: 1.2, y: 1.5, w: 10.9, h: 1.5, fontSize: 72, bold: true, fontFace: HEAD, isTextBox: true, margin: 0,
  })
  s.addText('Bridging the gap between theory and physical reality in engineering education.', {
    x: 1.2, y: 3.15, w: 10.9, h: 0.7, fontSize: 24, italic: true, color: WHITE, fontFace: HEAD, isTextBox: true, margin: 0,
  })
  s.addText('A low-cost, hands-on digital twin learning platform for Pakistani engineering students — a fraction of global vendor cost.', {
    x: 1.2, y: 4.0, w: 9.8, h: 0.8, fontSize: 15, color: 'A8C5BB', fontFace: BODY, isTextBox: true, margin: 0,
  })
  s.addText('digital twin learning lab  ·  web-serial ESP32 rig  ·  on-demand AI tutor', {
    x: 1.2, y: 6.5, w: 10.9, h: 0.4, fontSize: 12, color: MINT, fontFace: MONO, isTextBox: true, margin: 0,
  })
  chip(s, 12.55, 0.85, 0.4, MINT)
}

// ================= SLIDE 2 — problem =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'The hardware bottleneck in Pakistani engineering education')
  card(s, 0.55, 1.85, 12.23, 1.15)
  statNum(s, 1.0, 2.2, 2.2, '53')
  s.addText('HEC-recognized engineering universities face the identical infrastructure gap.', {
    x: 3.3, y: 2.15, w: 9.2, h: 0.6, fontSize: 16, bold: true, color: INK, fontFace: HEAD, isTextBox: true, margin: 0,
  })
  card(s, 0.55, 3.35, 5.95, 3.25)
  chip(s, 0.95, 3.75, 0.24)
  heading(s, 'The reality', { x: 1.35, y: 3.62, w: 5, h: 0.5 })
  body(s, 'Embedded systems, IoT, and automation are taught almost entirely through theory. Hands-on labs are prohibitively expensive, hard to maintain, and rarely accessible to the general student body.', { x: 0.95, y: 4.25, w: 5.15, h: 1.8 })
  card(s, 6.83, 3.35, 5.95, 3.25)
  chip(s, 7.23, 3.75, 0.24, ORANGE)
  heading(s, 'The result', { x: 7.63, y: 3.62, w: 5, h: 0.5, color: ORANGE })
  body(s, 'Students graduate having read about sensors and predictive maintenance — never built, broke, or debugged a real system. "Debugging blind," component burnouts on first contact, and no physical-system experience.', { x: 7.23, y: 4.25, w: 5.15, h: 1.8 })
  footer(s)
}

// ================= SLIDE 3 — market =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'A bottom-up path to a national market')
  const col = (x, num, numSize, name, lines) => {
    card(s, x, 1.95, 3.95, 4.75)
    statNum(s, x + 0.35, 2.35, 3.3, num, GREEN, { fontSize: numSize })
    heading(s, name, { x: x + 0.35, y: 3.3, w: 3.3, h: 0.5 })
    for (let i = 0; i < lines.length; i++) s.addText(lines[i], { x: x + 0.35, y: 3.95 + i * 0.62, w: 3.3, h: 0.6, fontSize: 12.5, color: INK, fontFace: BODY, isTextBox: true, margin: 0, valign: 'top' })
  }
  col(0.55, '53', 44, 'HEC engineering universities', ['Total national addressable market across every province and discipline.'])
  col(4.69, '8–10', 44, 'Karachi engineering universities', ['Serviceable, reachable market for the immediate pilot phase.'])
  col(8.83, 'PKR 2.5M/yr', 26, 'by year 3', ['Year 1 — 1 university at PKR 500,000', 'Year 2 — 3 universities = PKR 1.5M', 'Year 3 — 5 universities = PKR 2.5M'])
  footer(s)
}

// ================= SLIDE 4 — solution (twin screenshot) =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Plug in. Auto-detect. Watch it come alive.')
  const steps = [
    ['USB connect', 'Plug the ESP32 kit into any laptop — Chrome/Edge recognises the board.'],
    ['Auto-scan', 'Firmware probes the I2C bus and the DHT22 GPIO; components snap onto the twin.'],
    ['Live 2D twin', 'Drag components, draw wires, stream temperature, humidity, and acceleration in real time.'],
    ['Ask the Tutor', 'On-demand AI coaching grounded in this rig\u2019s live readings.'],
  ]
  steps.forEach(([t, d], i) => {
    const y = 1.95 + i * 1.15
    s.addShape(pptx.ShapeType.ellipse, { x: 0.75, y, w: 0.5, h: 0.5, fill: { color: GREEN }, line: { type: 'none' } })
    s.addText(String(i + 1), { x: 0.75, y: y + 0.06, w: 0.5, h: 0.4, fontSize: 14, bold: true, color: WHITE, fontFace: HEAD, isTextBox: true, align: 'center', margin: 0 })
    heading(s, t, { x: 1.5, y, w: 4.4, h: 0.4, fontSize: 15 })
    body(s, d, { x: 1.5, y: y + 0.42, w: 4.35, h: 0.7, fontSize: 11.5, color: MUTED })
  })
  shot(s, SHOTS + 'B_twin.png', 6.45, 1.95, 6.3, 'live dashboard — ESP32 + MPU6050 + DHT22 twin (demo rig)')
  footer(s)
}

// ================= SLIDE 5 — features (tutor screenshot) =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Built for real learning moments')
  const feats = [
    ['Plug-and-detect', 'Connect over USB, the board identifies itself, sensors scan, and the twin builds itself — no drivers, no config.'],
    ['Live 2D twin canvas', 'A breadboard you can rearrange: value overlays stream temperature, humidity, and acceleration.'],
    ['Instant local anomaly flags', 'NaN, out-of-range, and frozen readings flagged at zero LLM cost — coaching only when you ask.'],
    ['On-demand AI tutor', 'Explanations grounded in this rig\u2019s actual readings; guidance, never autonomous control of hardware.'],
  ]
  feats.forEach(([t, d], i) => {
    const y = 1.9 + i * 1.13
    chip(s, 0.75, y + 0.1, 0.26)
    heading(s, t, { x: 1.15, y, w: 4.7, h: 0.42, fontSize: 15 })
    body(s, d, { x: 1.15, y: y + 0.45, w: 4.65, h: 0.65, fontSize: 11.5, color: MUTED })
  })
  shot(s, SHOTS + 'C_tutor.png', 6.45, 1.9, 6.3, 'Ask the Tutor — answers grounded in the live readings')
  s.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 6.55, w: 12.23, h: 0.45, rectRadius: 0.16, fill: { color: INK }, line: { type: 'none' } })
  s.addText('Roadmap: Urdu-first UI  ·  offline buffer for load-shedding resilience', {
    x: 0.85, y: 6.63, w: 11.6, h: 0.3, fontSize: 12, color: WHITE, fontFace: HEAD, isTextBox: true, margin: 0,
  })
  footer(s)
}

// ================= SLIDE 6 — tiers =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Capability is never paywalled')
  const tiers = [
    ['Freemium', '1 project', 'Virtual tier', 'Full platform — live twin, anomaly flags, AI tutor. No hardware needed to begin.', 'Virtual tier · free', MUTED],
    ['Pro', 'unlimited projects', '$20/month', 'Individual student. Fixed subscription — not usage-metered. Kit sold separately (~PKR 10k).', 'Fixed monthly · no metering', MUTED],
    ['University', '50 seats · LMS', 'PKR 500,000/yr', 'Unlimited projects for the license term, full LMS integration, shared AI coaching.', 'Institutional licence', MINT],
  ]
  tiers.forEach(([name, tag, price, desc, kicker, kickerColor], i) => {
    const x = 0.55 + i * 4.17
    card(s, x, 1.9, 3.95, 4.4, i === 2 ? INK : CARD)
    s.addText(name, { x: x + 0.35, y: 2.25, w: 3.3, h: 0.5, fontSize: 18, bold: true, color: i === 2 ? WHITE : INK, fontFace: HEAD, isTextBox: true, margin: 0 })
    statNum(s, x + 0.35, 2.75, 3.3, price, i === 2 ? MINT : GREEN, { fontSize: i === 2 ? 26 : 30 })
    s.addText(tag, { x: x + 0.35, y: 3.85, w: 3.3, h: 0.4, fontSize: 12, bold: true, color: i === 2 ? MINT : MUTED, fontFace: MONO, isTextBox: true, margin: 0 })
    body(s, desc, { x: x + 0.35, y: 4.3, w: 3.3, h: 1.6, fontSize: 12, color: i === 2 ? 'C7D6D0' : INK })
    s.addText(kicker, { x: x + 0.35, y: 5.75, w: 3.3, h: 0.3, fontSize: 10, bold: true, color: kickerColor, fontFace: HEAD, isTextBox: true, margin: 0 })
  })
  s.addText('The upgrade trigger is needing more than one project — all AI is available on every tier.', {
    x: 0.55, y: 6.55, w: 12.2, h: 0.4, fontSize: 12, italic: true, color: ORANGE, fontFace: HEAD, isTextBox: true, margin: 0,
  })
  footer(s)
}

// ================= SLIDE 7 — unit economics =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Favourable unit economics')
  const col = (x, num, numSize, label, desc) => {
    card(s, x, 2.0, 3.95, 4.0)
    statNum(s, x + 0.35, 2.4, 3.3, num, GREEN, { fontSize: numSize })
    heading(s, label, { x: x + 0.35, y: 3.45, w: 3.3, h: 0.5 })
    body(s, desc, { x: x + 0.35, y: 4.0, w: 3.3, h: 1.4 })
  }
  col(0.55, 'PKR 10k', 34, 'Hardware BOM per kit', 'ESP32 + sensors kit cost (first batch: ~5 kits \u2248 PKR 50k).')
  col(4.69, 'PKR 25–30k/yr', 26, 'Cloud operating cost', 'Lean hosting, database, and LLM usage for the whole platform.')
  col(8.83, 'Software margin', 26, 'B2B licensing is the engine', 'High-margin annual university licenses — the real revenue driver.')
  s.addText('Pre-revenue; figures from the current cost model, not actuals.', {
    x: 0.55, y: 6.35, w: 12.2, h: 0.35, fontSize: 11, italic: true, color: MUTED, fontFace: BODY, isTextBox: true, margin: 0,
  })
  footer(s)
}

// ================= SLIDE 8 — competition =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'The only digital twin platform priced and built for Pakistan')
  const cell = (t, o = {}) => ({ text: t, options: { fontFace: BODY, fontSize: 13, margin: [0.08, 0.1, 0.08, 0.1], ...o } })
  const rows = [
    [cell('Platform', { bold: true, color: WHITE }), cell('Pakistan-priced', { bold: true, color: WHITE, align: 'center' }), cell('Urdu-first', { bold: true, color: WHITE, align: 'center' }), cell('Student tier', { bold: true, color: WHITE, align: 'center' })],
    [cell('Siemens MindSphere — ~$5,000/mo'), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' })],
    [cell('PTC ThingWorx — ~$4,000/mo'), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' })],
    [cell('AWS IoT TwinMaker — pay-per-resource'), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('partial', { align: 'center', color: MUTED, fontSize: 11 })],
    [cell('Labtech International — enterprise quote'), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' }), cell('\u2717', { align: 'center', color: 'A66A5A' })],
    [cell('OmniTwin — PKR 500,000/yr', { bold: true, color: INK }), cell('\u2713', { align: 'center', bold: true, color: GREEN }), cell('\u2713', { align: 'center', bold: true, color: GREEN }), cell('\u2713', { align: 'center', bold: true, color: GREEN })],
  ]
  s.addTable(rows, {
    x: 0.55, y: 2.0, w: 12.23, colW: [6.23, 2.0, 2.0, 2.0],
    rowH: [0.62, 0.62, 0.62, 0.62, 0.62, 0.62],
    fills: [{ fill: { color: INK }, color: WHITE }, { fill: { color: WHITE } }, { fill: { color: WHITE } }, { fill: { color: WHITE } }, { fill: { color: WHITE } }, { fill: { color: MINT } }],
    valign: 'middle',
  })
  s.addText('Urdu-first UI and load-shedding resilience are core positioning — no global vendor prices for this market.', {
    x: 0.55, y: 6.1, w: 12.2, h: 0.4, fontSize: 11, italic: true, color: MUTED, fontFace: BODY, isTextBox: true, margin: 0,
  })
  footer(s)
}

// ================= SLIDE 9 — GTM =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Anchor, funnel, upsell')
  const phases = [
    ['1', 'Academic anchor', 'Secure a DUET CSE pilot as the reference case and build institutional trust.'],
    ['2', 'Freemium funnel', 'Drive student adoption through the virtual tier and campus awareness sessions.'],
    ['3', 'B2B upsell', 'Convert demand and pilot success into 50-seat university licenses.'],
  ]
  phases.forEach(([n, t, d], i) => {
    const x = 0.55 + i * 4.17
    if (i > 0) s.addText('\u25B8', { x: x - 0.62, y: 3.05, w: 0.5, h: 0.6, fontSize: 26, color: GREEN, fontFace: HEAD, isTextBox: true, align: 'center', margin: 0 })
    card(s, x, 1.95, 3.55, 4.1)
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.35, y: 2.4, w: 0.55, h: 0.55, fill: { color: GREEN }, line: { type: 'none' } })
    s.addText(n, { x: x + 0.35, y: 2.47, w: 0.55, h: 0.42, fontSize: 16, bold: true, color: WHITE, fontFace: HEAD, isTextBox: true, align: 'center', margin: 0 })
    heading(s, t, { x: x + 0.35, y: 3.2, w: 2.9, h: 0.5 })
    body(s, d, { x: x + 0.35, y: 3.8, w: 2.95, h: 1.9 })
  })
  footer(s)
}

// ================= SLIDE 10 — team =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'The team building it')
  const members = [
    ['MA', 'Muhammad Arham Rajput', 'Founder · Hardware lead', 'ESP32, firmware, sensor kits, physical build.'],
    ['AA', 'Asma Aslam', 'AI · Software lead', 'DUET topper (3.96 GPA); applied AI/ML from the State Bank of Pakistan.'],
    ['TN', 'Tasbiha Naz', 'AI/NLP developer', 'LLM applications, RAG systems, automation pipelines.'],
    ['AB', 'Abdul Basit', 'Full-stack developer', 'Robust full-stack architecture experience from Meezan Bank.'],
  ]
  members.forEach(([init, name, role, d], i) => {
    const x = 0.55 + i * 3.13
    card(s, x, 1.95, 2.95, 4.35)
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.9, y: 2.35, w: 1.15, h: 1.15, fill: { color: GREEN }, line: { type: 'none' } })
    s.addText(init, { x: x + 0.9, y: 2.66, w: 1.15, h: 0.55, fontSize: 22, bold: true, color: WHITE, fontFace: HEAD, isTextBox: true, align: 'center', margin: 0 })
    s.addText(name, { x: x + 0.28, y: 3.75, w: 2.4, h: 0.6, fontSize: 13.5, bold: true, color: INK, fontFace: HEAD, isTextBox: true, margin: 0, align: 'center' })
    s.addText(role, { x: x + 0.28, y: 4.4, w: 2.4, h: 0.4, fontSize: 11, bold: true, color: GREEN, fontFace: HEAD, isTextBox: true, margin: 0, align: 'center' })
    body(s, d, { x: x + 0.32, y: 4.9, w: 2.3, h: 1.1, fontSize: 10.5, align: 'center', color: MUTED })
  })
  footer(s)
}

// ================= SLIDE 11 — traction =================
{
  const s = pptx.addSlide()
  s.background = { color: PAPER }
  sectionHead(s, 'Validated demand and forward momentum')
  const stats = [
    ['DUET pilot', 'Academic anchor', 'CSE department pilot relationship secured as the reference case.'],
    ['2026', 'Industry recognition', 'Shortlisted — Pitch Your Vision 2026 and ELXR\u201926.'],
    ['108 + 400', 'Community traction', 'Techverse 2025: 108 direct participants, 400+ visitors engaged.'],
    ['Bench prototype', 'Product readiness', 'Working rig: temperature, humidity, and vibration (IMU) sensing with local anomaly flags.'],
  ]
  stats.forEach(([num, label, d], i) => {
    const x = 0.55 + i * 3.13
    card(s, x, 1.95, 2.95, 4.3)
    statNum(s, x + 0.3, 2.3, 2.35, num, GREEN, { fontSize: 26 })
    heading(s, label, { x: x + 0.3, y: 3.4, w: 2.4, h: 0.4, fontSize: 13.5 })
    body(s, d, { x: x + 0.3, y: 3.95, w: 2.4, h: 1.7, fontSize: 11.5, color: MUTED })
  })
  footer(s)
}

pptx.writeFile({ fileName: 'D:/OmniTwin/docs/PPTx/TwinLab_Edu_Digital_Twins.pptx' })
  .then(f => console.log('wrote', f))
  .catch(e => { console.error(e); process.exit(1) })