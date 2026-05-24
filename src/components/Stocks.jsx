import React, { useEffect, useMemo, useState } from 'react'
import { Doughnut, Bar } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { formatCurrency, formatPct, getFxRate, INCOME_TYPES, computeAssetClassValueAsOf, todayISO } from '../utils/calculations.js'
import EarningsTimeframeChart from './charts/EarningsTimeframeChart.jsx'
import { fetchSectorInfo } from '../utils/api.js'
import { useTheme } from '../hooks/useTheme.js'
import CurrencyToggle from './CurrencyToggle.jsx'
import AssetModal from './modals/AssetModal.jsx'
import AssetDetailModal from './modals/AssetDetailModal.jsx'
import TransactionModal from './modals/TransactionModal.jsx'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement)

const SECTOR_COLORS = [
  '#3b82f6', '#0ecb81', '#a855f7', '#f97316', '#eab308',
  '#ec4899', '#14b8a6', '#f43f5e', '#6366f1', '#8b5cf6',
  '#10b981', '#d946ef', '#fcd535',
]

export default function Stocks({ onNavigate }) {
  const { holdings, data, editAsset, refreshPrices, priceLoading } = usePortfolio()
  const { theme } = useTheme()
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSector, setFilterSector] = useState('all')
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [editingHolding, setEditingHolding] = useState(null)
  const [detailHolding, setDetailHolding] = useState(null)
  const [showTxnModal, setShowTxnModal] = useState(false)
  const [txnAssetId, setTxnAssetId] = useState(null)
  const cur = data.settings.baseCurrency

  // Oldest cached market-price timestamp → "Xm ago" hint on the Refresh button.
  // Scoped strictly to symbols this button actually refreshes (market assets
  // with a symbol). Otherwise a stale manually-set price on a non-market
  // asset could surface as "Oldest cached price" and clicking Refresh
  // wouldn't move the needle, since the button doesn't touch those entries.
  const oldestPriceTs = useMemo(() => {
    const marketSymbols = new Set(
      data.assets
        .filter(a => ['stocks', 'crypto', 'commodities'].includes(a.class) && a.symbol)
        .map(a => a.symbol)
    )
    const timestamps = Object.entries(data.pricesCache || {})
      .filter(([sym]) => marketSymbols.has(sym))
      .map(([, p]) => p?.timestamp)
      .filter(Boolean)
    if (!timestamps.length) return null
    return Math.min(...timestamps)
  }, [data.pricesCache, data.assets])
  // Tick a state value every 30 s so the relative age label refreshes
  // ("just now" → "1m ago" → "2m ago") without waiting for an unrelated
  // re-render. Cheap: one no-op setState per half-minute while the page
  // is open, and the interval clears when no cache exists yet.
  const [, setAgeTick] = useState(0)
  useEffect(() => {
    if (oldestPriceTs == null) return
    const id = setInterval(() => setAgeTick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [oldestPriceTs])
  const ageLabel = oldestPriceTs == null ? null : (() => {
    const mins = Math.floor((Date.now() - oldestPriceTs) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return `${Math.floor(mins / 1440)}d ago`
  })()

  // Markets = stocks + crypto. Crypto is auto-sectored as "Cryptocurrency".
  const markets = useMemo(
    () => holdings.filter(h => h.class === 'stocks' || h.class === 'crypto'),
    [holdings]
  )
  const stocks = markets.filter(h => h.class === 'stocks')
  const cryptos = markets.filter(h => h.class === 'crypto')

  // Fetch Yahoo sectors only for stocks; crypto gets a synthetic sector.
  // Key the effect on the actual list of (id+symbol) — using only
  // `stocks.length` used to miss the case where the user added or changed
  // a symbol on an existing stock holding, leaving its sector unhydrated.
  const stocksSig = useMemo(
    () => stocks
      .map(h => {
        const a = data.assets.find(x => x.id === h.id)
        return `${h.id}:${a?.symbol || ''}:${a?.sector ? '1' : '0'}`
      })
      .join('|'),
    [stocks, data.assets]
  )
  useEffect(() => {
    let cancelled = false
    async function hydrateSectors() {
      const missing = stocks
        .map(h => data.assets.find(a => a.id === h.id))
        .filter(a => a && a.symbol && !a.sector)
      if (!missing.length) return
      setLoading(true)
      for (const asset of missing) {
        const info = await fetchSectorInfo(asset.symbol)
        if (cancelled) return
        if (info && (info.sector || info.industry)) {
          editAsset(asset.id, { sector: info.sector || null, industry: info.industry || null })
        }
      }
      if (!cancelled) setLoading(false)
    }
    hydrateSectors()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocksSig])

  // Merge sector info; crypto → "Cryptocurrency" sector / coin-name industry.
  const enriched = markets.map(h => {
    const a = data.assets.find(x => x.id === h.id) || {}
    if (h.class === 'crypto') {
      return { ...h, sector: 'Cryptocurrency', industry: a.name || h.symbol }
    }
    return { ...h, sector: a.sector, industry: a.industry }
  })

  const totalMarkets = enriched.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const totalStocks = stocks.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const totalCrypto = cryptos.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const totalUnrealized = enriched.reduce((s, h) => s + (h.unrealizedPnLBase || 0), 0)

  // Markets value series — reconstructs historical stocks+crypto value
  // by sampling at every transaction date AND every month-end so the line
  // breaks exactly where buys/sells happen. Each transaction is sampled both
  // the day before and the day of so the spike is sharp, not a slow ramp.
  const marketsValueSeries = useMemo(() => {
    if (!data.assets.some(a => a.class === 'stocks' || a.class === 'crypto')) return []
    const today = new Date(todayISO() + 'T00:00:00Z')
    const marketAssetIds = new Set(
      data.assets.filter(a => a.class === 'stocks' || a.class === 'crypto').map(a => a.id)
    )
    const txnDates = data.transactions
      .filter(t => marketAssetIds.has(t.assetId))
      .map(t => t.date)
      .filter(Boolean)
    const purchaseDates = data.assets
      .filter(a => a.class === 'stocks' || a.class === 'crypto')
      .map(a => a.purchaseDate)
      .filter(Boolean)
    const allEvents = [...txnDates, ...purchaseDates].sort()
    if (!allEvents.length) return []
    const earliest = allEvents[0]

    // Build the set of sample dates: every month-end + the day-before & day-of
    // every event date + today.
    const dateSet = new Set()
    dateSet.add(earliest)
    dateSet.add(todayISO())
    for (const ev of new Set(allEvents)) {
      dateSet.add(ev)
      // Day before — captures the value just before the txn lands so the
      // chart shows a clean step rather than a smoothed slope across months.
      const d = new Date(ev + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - 1)
      const prev = d.toISOString().slice(0, 10)
      if (prev >= earliest) dateSet.add(prev)
    }
    // 1st-of-month backbone. Start-of-month (not end-of-month) so backbone
    // dates land exactly on the chart's monthly x-axis ticks.
    const start = new Date(earliest + 'T00:00:00Z')
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    while (cursor <= today) {
      dateSet.add(cursor.toISOString().slice(0, 10))
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }

    const sortedDates = [...dateSet].sort()
    const points = sortedDates.map(d => {
      // Use live total for today so the chart tip matches the metric card
      if (d === todayISO()) return { date: d, value: totalMarkets }
      const p = computeAssetClassValueAsOf(data, d, cur, ['stocks', 'crypto'])
      return { date: d, value: p.value }
    })
    return points
  }, [data, cur, totalMarkets])

  const bySector = useMemo(() => {
    const m = {}
    for (const h of enriched) {
      const key = h.sector || 'Unclassified'
      m[key] = (m[key] || 0) + (h.currentValueBase || 0)
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [enriched])

  // Re-read theme colors whenever theme flips so the chart repaints correctly
  const css = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const cardBg      = css?.getPropertyValue('--card').trim()       || '#1e2329'
  const borderCol   = css?.getPropertyValue('--border').trim()     || '#2b3139'
  const textCol     = css?.getPropertyValue('--text').trim()       || '#eaecef'
  const mutedCol    = css?.getPropertyValue('--text-muted').trim() || '#5e6673'
  const gridCol     = css?.getPropertyValue('--chart-grid').trim() || 'rgba(43,49,57,0.6)'

  const sectorChartData = {
    labels: bySector.map(([k]) => k),
    datasets: [{
      data: bySector.map(([, v]) => v),
      backgroundColor: bySector.map((_, i) => SECTOR_COLORS[i % SECTOR_COLORS.length]),
      borderColor: cardBg,
      borderWidth: 3,
      hoverOffset: 8,
    }],
  }
  const sectorChartOptions = {
    cutout: '64%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cardBg, borderColor: borderCol, borderWidth: 1,
        titleColor: textCol, bodyColor: mutedCol, padding: 10,
        callbacks: {
          label: (ctx) => {
            const pct = totalMarkets > 0 ? ((ctx.raw / totalMarkets) * 100).toFixed(1) : 0
            return ` ${formatCurrency(ctx.raw, cur, true)} (${pct}%)`
          }
        }
      }
    },
    maintainAspectRatio: true,
    responsive: true,
  }

  // Top positions bar chart (horizontal, ranked)
  const topPositions = [...enriched]
    .filter(h => (h.currentValueBase || 0) > 0)
    .sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))
    .slice(0, 10)
  const positionsBarData = {
    labels: topPositions.map(h => h.symbol || h.name.slice(0, 8)),
    datasets: [{
      label: `Value (${cur})`,
      data: topPositions.map(h => h.currentValueBase),
      backgroundColor: topPositions.map(h => h.class === 'crypto' ? '#a855f7' : '#3b82f6'),
      borderRadius: 4,
      barThickness: 18,
    }]
  }
  const positionsBarOptions = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cardBg, borderColor: borderCol, borderWidth: 1,
        titleColor: textCol, bodyColor: mutedCol, padding: 10,
        callbacks: {
          label: (ctx) => ` ${formatCurrency(ctx.raw, cur, true)}`
        }
      }
    },
    scales: {
      x: {
        grid: { color: gridCol, drawBorder: false },
        ticks: { color: mutedCol, font: { size: 10 }, callback: v => formatCurrency(v, cur, true) },
        border: { display: false },
      },
      y: {
        grid: { display: false, drawBorder: false },
        ticks: { color: textCol, font: { size: 11, weight: 600 } },
        border: { display: false },
      }
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Markets</div>
          <div className="page-subtitle">
            {stocks.length} stocks · {cryptos.length} crypto {loading && '· fetching sectors…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CurrencyToggle />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => refreshPrices({ force: true })}
            disabled={priceLoading}
            title={ageLabel ? `Oldest cached price: ${ageLabel}` : 'No prices cached yet'}
          >
            {priceLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'} Prices
            {ageLabel && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>
                · {ageLabel}
              </span>
            )}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate?.('realized', { from: 'stocks', filterClass: 'markets' })}
            title="See realized P&L from sold stocks & crypto"
          >
            📊 Realized P&L
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowTxnModal(true)} disabled={markets.length === 0}>
            + Transaction
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAssetModal(true)}>
            + Add Asset
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Market Value</div>
          <div className="metric-value">{formatCurrency(totalMarkets, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Stocks</div>
          <div className="metric-value">{formatCurrency(totalStocks, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Crypto</div>
          <div className="metric-value">{formatCurrency(totalCrypto, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unrealized P&L</div>
          <div className={`metric-value ${totalUnrealized >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalUnrealized, cur, true)}
          </div>
        </div>
      </div>

      {markets.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <h3>No market holdings</h3>
            <p>Add a stock or crypto asset from the Holdings page to begin.</p>
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <EarningsTimeframeChart
              series={marketsValueSeries}
              baseCurrency={cur}
              title="Markets Value"
              mode="value"
              height={240}
            />
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Allocation by Sector</span>
              </div>
              <div className="alloc-compact">
                <div className="alloc-compact-donut">
                  <Doughnut key={`sec-${theme}`} data={sectorChartData} options={sectorChartOptions} />
                  <div className="alloc-compact-center">
                    <div className="alloc-compact-center-label">TOTAL</div>
                    <div className="alloc-compact-center-value">{formatCurrency(totalMarkets, cur, true)}</div>
                  </div>
                </div>
                <div className="alloc-chip-grid">
                  {bySector.map(([sector, val], i) => {
                    const pct = totalMarkets > 0 ? (val / totalMarkets) * 100 : 0
                    const color = SECTOR_COLORS[i % SECTOR_COLORS.length]
                    return (
                      <div key={sector} className="alloc-chip" title={`${sector} · ${pct.toFixed(1)}% · ${formatCurrency(val, cur, true)}`}>
                        <span className="alloc-chip-dot" style={{ background: color }} />
                        <span className="alloc-chip-name">{sector}</span>
                        <span className="alloc-chip-pct">{pct.toFixed(1)}%</span>
                        <span className="alloc-chip-amt">{formatCurrency(val, cur, true)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Top Positions</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: '#3b82f6', borderRadius: '50%', marginRight: 4 }} /> Stocks
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: '#a855f7', borderRadius: '50%', marginRight: 4, marginLeft: 10 }} /> Crypto
                </span>
              </div>
              {topPositions.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <p>No positions yet</p>
                </div>
              ) : (
                <div style={{ height: Math.max(180, topPositions.length * 28 + 20) }}>
                  <Bar key={`pos-${theme}`} data={positionsBarData} options={positionsBarOptions} />
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Positions</span>
            </div>
            <div className="filters-bar" style={{ marginBottom: 12 }}>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search symbol or name…"
                style={{ width: 220 }}
              />
              <select value={filterSector} onChange={e => setFilterSector(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
                <option value="all">All sectors</option>
                {[...new Set(enriched.map(h => h.sector).filter(Boolean))].sort().map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {(search || filterSector !== 'all') && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterSector('all') }}>
                  ✕ Clear
                </button>
              )}
            </div>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Sector</th>
                    <th>Industry</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Current Price</th>
                    <th className="text-right">Value ({cur})</th>
                    <th className="text-right">Unrealized P&L</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {enriched
                    .filter(h => filterSector === 'all' || h.sector === filterSector)
                    .filter(h => {
                      const q = search.trim().toLowerCase()
                      if (!q) return true
                      return `${h.symbol || ''} ${h.name || ''}`.toLowerCase().includes(q)
                    })
                    .map(h => (
                    <tr
                      key={h.id}
                      onClick={() => setDetailHolding(h)}
                      style={{ cursor: 'pointer' }}
                      title="Click to view details"
                    >
                      <td style={{ fontWeight: 600 }}>{h.symbol}</td>
                      <td>{h.name}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{h.sector || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{h.industry || '—'}</td>
                      <td className="text-right muted">{(h.quantity || 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                      <td className="text-right">{h.currentPrice ? formatCurrency(h.currentPrice, h.currency) : '—'}</td>
                      <td className="text-right fw-600">{formatCurrency(h.currentValueBase, cur)}</td>
                      <td className={`text-right fw-600 ${h.unrealizedPnLBase >= 0 ? 'gain' : 'loss'}`}>
                        {formatCurrency(h.unrealizedPnLBase, cur)}
                        <span style={{ fontSize: 11, marginLeft: 4 }}>({formatPct(h.unrealizedPnLPct)})</span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn btn-xs btn-secondary" title="Add transaction" onClick={() => setTxnAssetId(h.id)}>+ Txn</button>
                          <button className="btn btn-xs btn-ghost" title="Edit asset" onClick={() => setEditingHolding(h)}>✎</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showAssetModal && <AssetModal onClose={() => setShowAssetModal(false)} />}
      {editingHolding && <AssetModal asset={editingHolding} onClose={() => setEditingHolding(null)} />}
      {detailHolding && (
        <AssetDetailModal
          holding={detailHolding}
          onClose={() => setDetailHolding(null)}
          onEdit={(h) => setEditingHolding(h)}
        />
      )}
      {showTxnModal && <TransactionModal onClose={() => setShowTxnModal(false)} />}
      {txnAssetId && (
        <TransactionModal preselectedAssetId={txnAssetId} onClose={() => setTxnAssetId(null)} />
      )}
    </div>
  )
}
