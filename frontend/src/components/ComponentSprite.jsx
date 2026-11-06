// Author-created schematic art (no external asset download/licenses), keyed by the
// registry's component id. Geometry and pin offsets live in
// src/registry/components.json; the art itself stays here as JSX. A part with no
// art here still renders: its card shows the label, pins and readings.
import { componentDef } from '../serial/serialModel.mjs'

function Esp32() {
  const { size: { w, h }, header } = componentDef('esp32')
  const rows = (side, x, labelX, anchor) => side.map(([label], i) => {
    const y = header.firstDy + i * header.rowGap
    return (
      <g key={label + i}>
        <circle cx={x} cy={y} r="3.5" fill="var(--ot-pin-off)" />
        <text x={labelX} y={y + 3.5} textAnchor={anchor} fontSize="10" fill="var(--ot-muted)">{label}</text>
      </g>
    )
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} fontFamily="JetBrains Mono, monospace">
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="12" fill="var(--ot-pcb)" stroke="var(--ot-pcb-line)" strokeWidth="1.5" />
      <rect x="58" y="14" width="124" height="118" rx="5" fill="var(--ot-chip)" stroke="var(--ot-pcb-line)" />
      <text x={w / 2} y="78" textAnchor="middle" fontSize="11" fill="var(--ot-text)">ESP-WROOM-32</text>
      <rect x={w / 2 - 28} y={h - 24} width="56" height="24" rx="3" fill="var(--ot-chip)" stroke="var(--ot-pcb-line)" />
      {rows(header.left, header.leftDx, header.leftDx + 11, 'start')}
      {rows(header.right, header.rightDx, header.rightDx - 11, 'end')}
    </svg>
  )
}

const SPRITES = {
  esp32: () => <Esp32 />,
  breadboard: () => (
    <svg viewBox="0 0 200 90" width={200} height={90}>
      <rect x="1" y="1" width="198" height="88" rx="8" fill="var(--ot-pcb)" stroke="var(--ot-pcb-line)" />
      <text x="14" y="49" fill="var(--ot-text)" fontSize="11" fontFamily="JetBrains Mono, monospace">Breadboard</text>
      <rect x="20" y="16" width="160" height="8" rx="2" fill="var(--ot-power)" opacity="0.3" />
      <rect x="20" y="66" width="160" height="8" rx="2" fill="var(--ot-ground)" opacity="0.3" />
    </svg>
  ),
  mpu6050: () => (
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="6" fill="var(--ot-chip)" stroke="var(--ot-pcb-line)" />
      <rect x="19" y="19" width="26" height="26" rx="2" fill="var(--ot-signal)" opacity="0.7" />
    </svg>
  ),
}

export default function ComponentSprite({ type }) {
  return SPRITES[type]?.() ?? null
}
