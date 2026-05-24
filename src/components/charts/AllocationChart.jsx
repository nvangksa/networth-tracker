import React from 'react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { ASSET_CLASSES, formatCurrency } from '../../utils/calculations.js'
import { useTheme } from '../../hooks/useTheme.js'

ChartJS.register(ArcElement, Tooltip, Legend)

// Muted pastel palette matching the new asset-class chip tones in
// globals.css (`.badge-stocks`, `.badge-crypto`, etc.). Keeping the donut
// segments and the chip indicators in lockstep means "Property = peach"
// reads consistently everywhere on the page. The earlier saturated
// primaries (#3b82f6, #a855f7, #f97316…) competed with the rest of the UI.
const CLASS_COLORS = {
  stocks:        '#8fb5d6',  // dusty blue
  crypto:        '#c3a8dc',  // lavender
  property:      '#e0a593',  // peach
  vehicles:      '#d9a0ae',  // dusty rose (differentiates from property)
  commodities:   '#e0c886',  // mustard
  cash:          '#9cc4a8',  // sage green
  bonds:         '#92bfb8',  // muted teal
  private_equity:'#d9a0ae',  // rose
  jewelry:       '#d9a0ae',  // rose
  art:           '#92bfb8',  // muted teal
  collectibles:  '#c3a8dc',  // lavender
  business:      '#b5a488',  // warm taupe
  banknotes:     '#9cc4a8',  // sage
  other:         '#a0a8b3',  // soft grey
}

export default function AllocationChart({ allocationByClass, baseCurrency }) {
  const { theme } = useTheme() // re-read CSS vars whenever theme flips

  const entries = Object.entries(allocationByClass)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  if (!entries.length) {
    return (
      <div className="empty-state" style={{ padding: '32px 0' }}>
        <div style={{ fontSize: 32 }}>◷</div>
        <p style={{ marginTop: 8 }}>No assets yet</p>
      </div>
    )
  }

  const total = entries.reduce((s, [, v]) => s + v, 0)

  const css = getComputedStyle(document.documentElement)
  const cardBg      = css.getPropertyValue('--card').trim()       || '#1e2329'
  const borderColor = css.getPropertyValue('--border').trim()     || '#2b3139'
  const textColor   = css.getPropertyValue('--text').trim()       || '#eaecef'
  const mutedColor  = css.getPropertyValue('--text-muted').trim() || '#5e6673'

  const chartData = {
    labels: entries.map(([cls]) => ASSET_CLASSES.find(a => a.value === cls)?.label || cls),
    datasets: [{
      data: entries.map(([, v]) => v),
      backgroundColor: entries.map(([cls]) => CLASS_COLORS[cls] || '#848e9c'),
      borderColor: cardBg,
      borderWidth: 3,
      hoverBorderWidth: 3,
    }]
  }

  const options = {
    cutout: '68%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0
            return ` ${formatCurrency(ctx.raw, baseCurrency, true)} (${pct}%)`
          }
        },
        backgroundColor: cardBg,
        borderColor: borderColor,
        borderWidth: 1,
        titleColor: textColor,
        bodyColor: mutedColor,
        padding: 10,
      }
    },
    maintainAspectRatio: true,
    responsive: true,
  }

  return (
    <div className="alloc-compact">
      {/* Compact donut */}
      <div className="alloc-compact-donut">
        <Doughnut key={theme} data={chartData} options={options} />
        <div className="alloc-compact-center">
          <div className="alloc-compact-center-label">TOTAL</div>
          <div className="alloc-compact-center-value">{formatCurrency(total, baseCurrency, true)}</div>
        </div>
      </div>

      {/* One-row chip legend, two columns — far more compact */}
      <div className="alloc-chip-grid">
        {entries.map(([cls, val]) => {
          const info = ASSET_CLASSES.find(a => a.value === cls)
          const pct = total > 0 ? (val / total) * 100 : 0
          const color = CLASS_COLORS[cls] || '#848e9c'
          return (
            <div key={cls} className="alloc-chip" title={`${info?.label || cls} · ${pct.toFixed(1)}% · ${formatCurrency(val, baseCurrency, true)}`}>
              <span className="alloc-chip-dot" style={{ background: color }} />
              <span className="alloc-chip-name">{info?.label || cls}</span>
              <span className="alloc-chip-pct">{pct.toFixed(1)}%</span>
              <span className="alloc-chip-amt">{formatCurrency(val, baseCurrency, true)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
