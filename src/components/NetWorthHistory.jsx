import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { formatCurrency, todayISO } from '../utils/calculations.js'
import { buildNetWorthSeries, makeDaily, makeMonthly, makeYearly } from '../utils/netWorthSeries.js'
import NetWorthChart from './charts/NetWorthChart.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

export default function NetWorthHistory() {
  const { data, deleteSnapshot: ctxDeleteSnapshot, netWorthStats } = usePortfolio()
  const [timeframe, setTimeframe] = useState('monthly') // 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all'
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showExplain, setShowExplain] = useState(false)
  // Snapshot management is rarely needed (auto-snapshot handles the common
  // case) — collapsed by default so it doesn't add visual weight to the page.
  // The previous "All Points" table dumped every reconstructed row alongside,
  // which read as wall-of-numbers noise; here we only ever surface SAVED
  // snapshots since reconstructed rows aren't deletable anyway.
  const [showManage, setShowManage] = useState(false)

  const cur = data.settings.baseCurrency
  const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = netWorthStats

  // Use the shared series builder so the Dashboard mini-chart and this page
  // always agree. Saved snapshots take precedence over reconstructed points.
  const sorted = useMemo(() =>
    buildNetWorthSeries(data, cur, { totalAssetsBase, totalLiabilitiesBase, netWorthBase }),
    [data, cur, totalAssetsBase, totalLiabilitiesBase, netWorthBase]
  )

  // Build a dense series for the chart: every day (30D), every week (12W),
  // every month (12M) or every year (5Y). Missing days carry the previous
  // value forward so the line goes flat rather than breaking.
  const filteredByTimeframe = useMemo(() => {
    if (!sorted.length) return []
    if (timeframe === 'daily')   return makeDaily(sorted, 30)
    // 3M view uses DAILY sampling (90 days), not weekly Mondays — otherwise
    // a mid-week transaction (e.g. Wednesday buy) compresses its impact into
    // the gap between the surrounding Monday anchors and the chart shows a
    // near-vertical hockey-stick at the live edge.
    if (timeframe === 'weekly')  return makeDaily(sorted, 90)
    if (timeframe === 'monthly') return makeMonthly(sorted, 12)
    if (timeframe === 'yearly')  return makeYearly(sorted, 5)
    if (timeframe === 'all') {
      // For the multi-year view, sample every full month so the line is
      // dense enough to look smooth without exposing intra-month noise.
      // We use makeMonthly which carries the most-recent snapshot forward,
      // so even months that didn't get an explicit reconstruction inherit
      // a sensible value and the line never has visible holes.
      if (!sorted.length) return []
      const first = new Date(sorted[0].date + 'T00:00:00Z')
      const now = new Date(todayISO() + 'T00:00:00Z')
      const months = (now.getUTCFullYear() - first.getUTCFullYear()) * 12 + (now.getUTCMonth() - first.getUTCMonth()) + 1
      return makeMonthly(sorted, Math.max(2, months))
    }
    return sorted
  }, [sorted, timeframe])

  // Year-over-year table
  const yearlyData = useMemo(() => {
    const years = {}
    for (const snap of sorted) {
      const y = snap.date.slice(0, 4)
      if (!years[y]) years[y] = []
      years[y].push(snap)
    }
    const currentYear = new Date().getFullYear()
    return Object.entries(years)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([year, snaps]) => {
        const first = snaps[0]
        const last = snaps[snaps.length - 1]
        const prevYear = sorted.filter(s => s.date.slice(0, 4) === String(parseInt(year) - 1))
        const prevLast = prevYear[prevYear.length - 1]
        const change = prevLast ? last.netWorth - prevLast.netWorth : null
        const changePct = prevLast && prevLast.netWorth !== 0
          ? ((last.netWorth - prevLast.netWorth) / Math.abs(prevLast.netWorth)) * 100 : null
        return { year, first, last, change, changePct, isCurrent: parseInt(year) === currentYear }
      })
  }, [sorted])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Net Worth History</div>
          <div className="page-subtitle">
            {data.snapshots.length} saved snapshots · reconstructed back to your earliest transaction
          </div>
        </div>
        <CurrencyToggle />
      </div>

      {/* How-it-works collapsible */}
      <div className="card" style={{ marginBottom: 16, padding: '10px 14px', borderLeft: '3px solid var(--accent)' }}>
        <button
          onClick={() => setShowExplain(s => !s)}
          className="btn btn-ghost btn-sm"
          style={{ padding: 0, fontSize: 12, fontWeight: 600 }}
        >
          {showExplain ? '▾' : '▸'} How is this chart built?
        </button>
        {showExplain && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            <p style={{ margin: '4px 0' }}>
              <strong style={{ color: 'var(--text)' }}>Auto-reconstructed from your transactions.</strong>{' '}
              For every month-end between your earliest buy/deposit and today, the app replays every transaction up to that date (buys, sells, deposits, withdrawals, revaluations, income) to compute your holdings, then applies the most recent revaluation (for property / manual assets) or today's market price (for stocks/crypto — historical prices aren't pulled) and converts to {cur}.
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong style={{ color: 'var(--text)' }}>Saved snapshots override reconstruction</strong> — if you have a snapshot for a specific date, that value is used instead. A snapshot is taken automatically once per day when you open the app.
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong style={{ color: 'var(--text)' }}>Liabilities</strong> are treated as constant at their current balance — the data model doesn't track per-date liability history yet.
            </p>
          </div>
        )}
      </div>

      {/* Current stats */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Current Net Worth</div>
          <div className={`metric-value ${netWorthBase >= 0 ? '' : 'loss'}`}>
            {formatCurrency(netWorthBase, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(totalAssetsBase, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Liabilities</div>
          <div className={`metric-value ${totalLiabilitiesBase > 0 ? 'loss' : 'muted'}`}>
            {formatCurrency(totalLiabilitiesBase, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Data Points</div>
          <div className="metric-value">{data.snapshots.length}</div>
          <div className="metric-sub">Auto-tracked on every change</div>
        </div>
      </div>

      {/* Chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Net Worth Over Time</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {['daily', 'weekly', 'monthly', 'yearly', 'all'].map(tf => (
              <button
                key={tf}
                className={`btn btn-xs ${timeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTimeframe(tf)}
                style={{ textTransform: 'capitalize', minWidth: 60 }}
              >
                {tf === 'daily' ? '30D' : tf === 'weekly' ? '3M' : tf === 'monthly' ? '12M' : tf === 'yearly' ? '5Y' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <NetWorthChart snapshots={filteredByTimeframe} baseCurrency={cur} height={280} />
      </div>

      <div style={{ marginBottom: 24 }}>
        {/* Year-over-year table */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Year-over-Year</span>
          </div>
          {yearlyData.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No snapshots yet
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}>Year</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}>End Net Worth</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {yearlyData.map(({ year, last, change, changePct, isCurrent }) => (
                  <tr key={year}>
                    <td style={{ padding: '8px 0', fontWeight: isCurrent ? 700 : 500 }}>
                      {year}{isCurrent ? ' (YTD)' : ''}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, padding: '8px 0' }}>
                      {formatCurrency(last.netWorth, cur, true)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 0' }}>
                      {change !== null ? (
                        <span className={change >= 0 ? 'gain' : 'loss'}>
                          {change >= 0 ? '+' : ''}{formatCurrency(change, cur, true)}
                          {changePct !== null && ` (${changePct.toFixed(1)}%)`}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* Snapshot management — collapsed by default. Surfaces only SAVED
          snapshots (manual + auto-daily) so users can delete a bad one if
          needed. Reconstructed points aren't shown because they're derived
          from transactions and edited by changing the underlying txn. */}
      {data.snapshots.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--border)' }}>
          <button
            onClick={() => setShowManage(s => !s)}
            className="btn btn-ghost btn-sm"
            style={{ padding: 0, fontSize: 12, fontWeight: 600 }}
          >
            {showManage ? '▾' : '▸'} Manage saved snapshots ({data.snapshots.length})
          </button>
          {showManage && (
            <div className="table-wrap" style={{ border: 'none', marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Net Worth</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.snapshots].sort((a, b) => b.date.localeCompare(a.date)).map(snap => (
                    <tr key={snap.date}>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {snap.date}
                        {snap.manual && (
                          <span className="badge badge-deposit" style={{ fontSize: 10, marginLeft: 8 }}>Manual</span>
                        )}
                      </td>
                      <td className={`text-right fw-600 ${snap.netWorth >= 0 ? '' : 'loss'}`}>
                        {formatCurrency(snap.netWorth, cur, true)}
                      </td>
                      <td className="text-right">
                        <button
                          className="btn btn-xs btn-danger"
                          onClick={() => setConfirmDelete(snap)}
                          title="Delete saved snapshot"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Snapshot</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete snapshot for <strong>{confirmDelete.date}</strong>?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => {
                ctxDeleteSnapshot(confirmDelete.date)
                setConfirmDelete(null)
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
