import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import AllocationChart from './charts/AllocationChart.jsx'
import NetWorthChart from './charts/NetWorthChart.jsx'
import { formatCurrency, formatPct, ASSET_CLASSES, localISO } from '../utils/calculations.js'
import { buildNetWorthSeries, makeDaily, makeMonthly, makeYearly } from '../utils/netWorthSeries.js'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))
import TransactionModal from './modals/TransactionModal.jsx'
import AssetModal from './modals/AssetModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'
import { FinancialHealthSummary } from './FinancialHealth.jsx'

export default function Dashboard({ onNavigate }) {
  const {
    data, holdings, netWorthStats, allocationByClass,
    totalIncome, pastYearPassiveIncome, totalUnrealizedPnL, totalRealizedPnL,
    priceLoading, refreshPrices
  } = usePortfolio()

  // Quick-add buttons each open the TransactionModal with a preselected
  // type (and asset where it makes sense). The generic +Asset path still
  // exists for users who want to add a new holding before logging anything.
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [txnPreset, setTxnPreset] = useState(null) // { type, assetId? } | null
  const [dashTimeframe, setDashTimeframe] = useState('all')

  const defaultCashId = useMemo(
    () => (data.assets.find(a => a.class === 'cash')?.id) || '',
    [data.assets]
  )
  const hasCash = !!defaultCashId
  const hasMultipleCash = data.assets.filter(a => a.class === 'cash').length > 1

  const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = netWorthStats
  const cur = data.settings.baseCurrency

  // Oldest cached market-price timestamp → "Xm ago" hint so users know
  // whether the figures on screen are live or cached. Mirrors the same
  // logic on the Holdings page so the two surfaces agree.
  const priceAgeLabel = useMemo(() => {
    const stamps = Object.values(data.pricesCache || {})
      .map(p => p?.timestamp).filter(Boolean)
    if (!stamps.length) return null
    const mins = Math.floor((Date.now() - Math.min(...stamps)) / 60000)
    if (mins < 1)    return 'just now'
    if (mins < 60)   return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return `${Math.floor(mins / 1440)}d ago`
  }, [data.pricesCache])

  // Build the same densely-reconstructed series the Net Worth History page uses,
  // then slice/downsample for the selected timeframe so 30D / 12W / 12M / 5Y / All
  // never collapse onto the same handful of saved snapshots.
  const fullSeries = useMemo(() =>
    buildNetWorthSeries(data, cur, { totalAssetsBase, totalLiabilitiesBase, netWorthBase }),
    [data, cur, totalAssetsBase, totalLiabilitiesBase, netWorthBase]
  )
  const filteredSnapshots = useMemo(() => {
    if (!fullSeries.length) return []
    if (dashTimeframe === 'daily')   return makeDaily(fullSeries, 30)
    // 3M view: sample DAILY across 90 days, not weekly across 12. Weekly
    // sampling could only place anchors on Mondays — so a mid-week
    // transaction (e.g. a Wednesday buy) compressed all its impact into the
    // gap between the prior and following Monday, producing a near-vertical
    // hockey-stick. Daily sampling places the jump on the day it actually
    // happened.
    if (dashTimeframe === 'weekly')  return makeDaily(fullSeries, 90)
    if (dashTimeframe === 'monthly') return makeMonthly(fullSeries, 12)
    if (dashTimeframe === 'yearly')  return makeYearly(fullSeries, 5)
    if (dashTimeframe === 'all') {
      const first = new Date(fullSeries[0].date + 'T00:00:00Z')
      const now = new Date()
      const months = (now.getUTCFullYear() - first.getUTCFullYear()) * 12 + (now.getUTCMonth() - first.getUTCMonth()) + 1
      return makeMonthly(fullSeries, Math.max(2, months))
    }
    return fullSeries
  }, [fullSeries, dashTimeframe])

  const topHoldings = [...holdings]
    .sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))
    .slice(0, 5)

  // YoY = today vs ~12 months ago, using the reconstructed series so it works
  // even when the user has no snapshot exactly from January last year.
  // Use localISO instead of toISOString so users far from UTC don't get the
  // target date shifted by a day at month/year boundaries.
  const yoyChange = useMemo(() => {
    if (!fullSeries.length) return null
    const today = new Date()
    const target = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
    const targetISO = localISO(target)
    // Latest series point on/before target date
    let snap = null
    for (const p of fullSeries) {
      if (p.date > targetISO) break
      snap = p
    }
    if (!snap) return null
    return netWorthBase - snap.netWorth
  }, [fullSeries, netWorthBase])

  // Financial Health metrics moved into a shared component
  // (src/components/FinancialHealth.jsx) — Dashboard now shows the compact
  // summary line and full explainer cards live on Planning. Keeps the
  // dashboard digestible while preserving the math in one place.

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CurrencyToggle />
          {hasCash && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setTxnPreset({ type: 'salary', assetId: defaultCashId })}
                title="Log income (salary, dividend, interest…)"
              >
                + Income
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setTxnPreset({ type: 'expense', assetId: defaultCashId })}
                title="Log an expense"
              >
                − Expense
              </button>
            </>
          )}
          {data.assets.some(a => a.class !== 'cash') && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTxnPreset({ type: 'buy' })}
              title="Record a buy"
            >
              + Buy
            </button>
          )}
          {hasMultipleCash && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTxnPreset({ type: 'transfer', assetId: defaultCashId })}
              title="Transfer between cash accounts"
            >
              ⇄ Transfer
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowAssetModal(true)} title="Add a new asset">
            + Asset
          </button>
          {/* Refresh button + freshness hint. The "Xm ago" label sits inline so
              users see at a glance whether they're looking at live or cached
              prices — they only click refresh when the number actually feels stale. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {priceAgeLabel && (
              <span
                style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
                title="Time since the oldest cached price was last refreshed"
              >
                {priceAgeLabel}
              </span>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => refreshPrices({ force: true })}
              disabled={priceLoading}
              title={priceAgeLabel ? `Prices last refreshed ${priceAgeLabel}` : 'Refresh live prices'}
            >
              {priceLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'}
            </button>
          </div>
        </div>
      </div>

      {/* Hero metrics layout. Net Worth is the headline number — gets a wider
          card with a tiny inline sparkline so users feel the trajectory at
          first glance. The four supporting metrics (Assets, Liabilities, two
          P&L) stack to the right as smaller cards. Total Income lives below
          as a wider banner card so users still see at-a-glance how much
          money has come in lifetime, without it competing visually with the
          balance-sheet trio above. */}
      <div className="metrics-hero">
        <div
          className="metric-card metric-card-hero clickable"
          onClick={() => onNavigate('history')}
          title="View net worth history"
        >
          <div>
            <div className="metric-label">Net Worth</div>
            <div className={`hero-number ${netWorthBase >= 0 ? '' : 'loss'}`}>
              {formatCurrency(netWorthBase, cur, true)}
            </div>
            {yoyChange !== null && (
              <div
                className={`hero-yoy-pill ${yoyChange >= 0 ? 'gain' : 'loss'}`}
                style={{ marginTop: 14 }}
              >
                {yoyChange >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(yoyChange), cur, true)} YoY
              </div>
            )}
          </div>
          {/* Inline sparkline drawn from the last ~90 days of the
              reconstructed net-worth series. Sized larger (100px tall) than
              before so the trajectory feels like a real visual element of
              the hero rather than a hairline afterthought. Pointer-events:none
              so the card's click handler still fires when the user clicks
              on the chart area. */}
          {fullSeries.length > 1 && (() => {
            const series = fullSeries.slice(-90)
            if (series.length < 2) return null
            const values = series.map(s => s.netWorth)
            const min = Math.min(...values)
            const max = Math.max(...values)
            const range = max - min || 1
            const W = 600, H = 100
            const pts = series.map((s, i) => {
              const x = (i / (series.length - 1)) * W
              const y = H - ((s.netWorth - min) / range) * H
              return `${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' ')
            const last = series[series.length - 1].netWorth
            const first = series[0].netWorth
            const up = last >= first
            return (
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                style={{ height: 100, width: '100%', marginTop: 20, pointerEvents: 'none' }}>
                <defs>
                  <linearGradient id="nw-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={up ? 'var(--gain)' : 'var(--loss)'} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={up ? 'var(--gain)' : 'var(--loss)'} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline points={pts} fill="none"
                  stroke={up ? 'var(--gain)' : 'var(--loss)'} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />
                <polygon
                  points={`0,${H} ${pts} ${W},${H}`}
                  fill="url(#nw-spark-fill)" />
              </svg>
            )
          })()}
        </div>

        <div className="metric-card metric-card-sm clickable" onClick={() => onNavigate('holdings')} title="View all holdings">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(totalAssetsBase, cur, true)}</div>
          <div className="metric-sub">{holdings.length} positions</div>
        </div>
        <div className="metric-card metric-card-sm clickable" onClick={() => onNavigate('liabilities')} title="View liabilities">
          <div className="metric-label">Total Liabilities</div>
          <div className={`metric-value ${totalLiabilitiesBase > 0 ? 'loss' : ''}`}>
            {formatCurrency(totalLiabilitiesBase, cur, true)}
          </div>
          <div className="metric-sub">{data.liabilities.length} items</div>
        </div>
        <div className="metric-card metric-card-sm clickable" onClick={() => onNavigate('holdings')} title="View holdings">
          <div className="metric-label">Unrealized P&L</div>
          <div className={`metric-value ${totalUnrealizedPnL >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalUnrealizedPnL, cur, true)}
          </div>
          <div className="metric-sub">Open positions</div>
        </div>
        <div className="metric-card metric-card-sm clickable" onClick={() => onNavigate('realized')} title="Realized P&L breakdown">
          <div className="metric-label">Realized P&L</div>
          <div className={`metric-value ${totalRealizedPnL >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalRealizedPnL, cur, true)}
          </div>
          <div className="metric-sub">From completed sales →</div>
        </div>
      </div>

      {/* Income banner — sits in its own row below the hero block so it
          doesn't compete with the balance-sheet metrics for visual weight. */}
      <div
        className="metric-card metric-card-banner clickable"
        onClick={() => onNavigate('income')}
        title="View income details"
        style={{ marginBottom: 24 }}
      >
        <div>
          <div className="metric-label">Total Income</div>
          <div className="metric-value">{formatCurrency(totalIncome, cur, true)}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          All time · <strong style={{ color: 'var(--text)' }}>{formatCurrency(pastYearPassiveIncome, cur, true)}</strong> passive (1Y)
        </div>
      </div>

      {/* Compact Financial Health summary — full breakdown lives on Planning */}
      <FinancialHealthSummary onSeeMore={() => onNavigate('planning')} />

      {/* Charts row */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Allocation by Class</span>
          </div>
          <AllocationChart allocationByClass={allocationByClass} baseCurrency={cur} />
        </div>
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span
              className="card-title"
              onClick={() => onNavigate('history')}
              style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.textDecorationColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}
              title="Click to view full history"
            >
              Net Worth History →
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {['daily', 'weekly', 'monthly', 'yearly', 'all'].map(tf => (
                <button
                  key={tf}
                  className={`btn btn-xs ${dashTimeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDashTimeframe(tf)}
                  style={{ minWidth: 44 }}
                >
                  {tf === 'daily' ? '30D' : tf === 'weekly' ? '3M' : tf === 'monthly' ? '12M' : tf === 'yearly' ? '5Y' : 'All'}
                </button>
              ))}
            </div>
          </div>
          <NetWorthChart snapshots={filteredSnapshots} baseCurrency={cur} height={200} />
        </div>
      </div>

      {/* Top Holdings */}
      {topHoldings.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Top Holdings</span>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('holdings')}>View all →</button>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Class</th>
                  <th className="text-right">Value ({cur})</th>
                  <th className="text-right">Allocation</th>
                  <th className="text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map(h => {
                  const pct = totalAssetsBase > 0 ? (h.currentValueBase / totalAssetsBase) * 100 : 0
                  // Navigate to asset's respective page if one exists,
                  // otherwise fall back to the general Holdings page.
                  const handleRowClick = () => {
                    if (h.class === 'property') onNavigate('property')
                    else if (h.class === 'stocks' || h.class === 'crypto') onNavigate('stocks')
                    else if (h.class === 'cash') onNavigate('cash')
                    else onNavigate('holdings')
                  }
                  return (
                    <tr key={h.id} onClick={handleRowClick} style={{ cursor: 'pointer' }} title="Click to view details">
                      <td>
                        <div style={{ fontWeight: 600 }}>{h.name}</div>
                        {h.symbol && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.symbol}</div>}
                      </td>
                      <td><span className={`badge badge-${h.class}`}>{CLASS_LABEL[h.class] || h.class}</span></td>
                      <td className="text-right fw-600">{formatCurrency(h.currentValueBase, cur)}</td>
                      <td className="text-right muted">{pct.toFixed(1)}%</td>
                      <td className={`text-right fw-600 ${h.unrealizedPnLBase >= 0 ? 'gain' : 'loss'}`}>
                        {formatCurrency(h.unrealizedPnLBase, cur)}
                        {' '}
                        <span style={{ fontSize: 11 }}>({formatPct(h.unrealizedPnLPct)})</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {holdings.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <h3>Welcome to Portfolio Tracker</h3>
            <p style={{ marginBottom: 16 }}>Start by adding your first asset, then log transactions.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}>+ Add First Asset</button>
              <button className="btn btn-secondary" onClick={() => onNavigate('settings')}>⚙ Configure Settings</button>
            </div>
          </div>
        </div>
      )}

      {txnPreset && (
        <TransactionModal
          preselectedAssetId={txnPreset.assetId}
          preselectedType={txnPreset.type}
          onClose={() => setTxnPreset(null)}
        />
      )}
      {showAssetModal && <AssetModal onClose={() => setShowAssetModal(false)} />}
    </div>
  )
}
