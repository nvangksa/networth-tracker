import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, formatPct, formatNumber,
  ASSET_CLASSES, MARKET_CLASSES
} from '../utils/calculations.js'
import CurrencyToggle from './CurrencyToggle.jsx'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))
import AssetModal from './modals/AssetModal.jsx'
import TransactionModal from './modals/TransactionModal.jsx'
import AssetDetailModal from './modals/AssetDetailModal.jsx'
import AssetDeleteModal from './modals/AssetDeleteModal.jsx'

export default function Holdings({ onNavigate }) {
  const {
    holdings, data, netWorthStats, deleteAsset,
    refreshPrices, priceLoading, setManualPrice, editAsset, priceErrors, saveStatus
  } = usePortfolio()

  const [showAssetModal, setShowAssetModal] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [txnModalAssetId, setTxnModalAssetId] = useState(null)
  // When the user picks "Sell first" in the delete dialog, we route through
  // TransactionModal's prefill path with this object. Carries assetId, type,
  // quantity and price so the form opens ready to submit. Cleared on close.
  const [txnModalPrefill, setTxnModalPrefill] = useState(null)
  const [filterClass, setFilterClass] = useState('all')
  const [search, setSearch] = useState('')
  const [manualPrices, setManualPrices] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showClosed, setShowClosed] = useState(false)
  const [detailHolding, setDetailHolding] = useState(null)

  const cur = data.settings.baseCurrency
  const { totalAssetsBase } = netWorthStats

  // Price freshness: oldest cached market-price timestamp → "Xm ago"
  const oldestPriceTs = useMemo(() => {
    const timestamps = Object.values(data.pricesCache || {})
      .map(p => p?.timestamp)
      .filter(Boolean)
    if (!timestamps.length) return null
    return Math.min(...timestamps)
  }, [data.pricesCache])
  const ageLabel = oldestPriceTs == null ? null : (() => {
    const mins = Math.floor((Date.now() - oldestPriceTs) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
    return `${Math.floor(mins / 1440)}d ago`
  })()

  // A position is "closed" (fully sold) when it's been marked sold-out by
  // the calculation layer, OR it's a non-manual asset with no remaining qty
  // and ~zero value. Cash stays active.
  const isClosed = (h) =>
    h.class !== 'cash' && (
      h.isSoldOut === true ||
      ((h.quantity || 0) <= 0 && Math.abs(h.currentValueBase || 0) < 0.01)
    )

  const active = useMemo(() => holdings.filter(h => !isClosed(h)), [holdings])
  const closed = useMemo(() => holdings.filter(h =>  isClosed(h)), [holdings])

  const baseList = showClosed ? closed : active
  const q = search.trim().toLowerCase()
  const filtered = baseList.filter(h => {
    if (filterClass !== 'all' && h.class !== filterClass) return false
    if (q) {
      const hay = `${h.name || ''} ${h.symbol || ''} ${h.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Summary metrics reflect the CURRENT filter + open/closed toggle
  const sumValue     = filtered.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const sumUnrealized= filtered.reduce((s, h) => s + (h.unrealizedPnLBase || 0), 0)
  const sumCost      = filtered.reduce((s, h) => s + (h.costBasisBase    || 0), 0)
  const sumIncome    = filtered.reduce((s, h) => s + (h.totalIncomeBase  || 0), 0)

  function applyManualPrice(h, val) {
    const numVal = parseFloat(val)
    if (isNaN(numVal) || numVal <= 0) return
    if (MARKET_CLASSES.includes(h.class) && h.symbol) {
      setManualPrice(h.symbol, numVal)
    } else {
      editAsset(h.id, { manualPrice: numVal })
    }
    setManualPrices(p => ({ ...p, [h.id]: '' }))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Holdings</div>
          <div className="page-subtitle">
            {active.length} active · {closed.length} closed ·
            &nbsp;{formatCurrency(totalAssetsBase, cur, true)} total
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CurrencyToggle />
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('realized', { from: 'holdings' })}>
            📊 Realized P&L
          </button>
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
          <button className="btn btn-primary btn-sm" onClick={() => setShowAssetModal(true)}>
            + Add Asset
          </button>
        </div>
      </div>

      {/* Top summary metrics (no scroll needed to see the headline numbers) */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">{showClosed ? 'Closed Value' : 'Total Value'}</div>
          <div className="metric-value">{formatCurrency(sumValue, cur, true)}</div>
          <div className="metric-sub">{filtered.length} positions</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cost Basis</div>
          <div className="metric-value">{formatCurrency(sumCost, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unrealized P&L</div>
          <div className={`metric-value ${sumUnrealized >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(sumUnrealized, cur, true)}
          </div>
          {sumCost > 0 && (
            <div className={`metric-sub ${sumUnrealized >= 0 ? 'gain' : 'loss'}`}>
              {formatPct((sumUnrealized / sumCost) * 100)}
            </div>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-label">Income Collected</div>
          <div className="metric-value accent">{formatCurrency(sumIncome, cur, true)}</div>
          <div className="metric-sub">Dividends, rent, interest</div>
        </div>
      </div>

      {/* Save-status banner */}
      {saveStatus !== 'idle' && saveStatus !== 'saved' && (
        <div className="card card-sm" style={{
          marginBottom: 12,
          borderLeft: `3px solid var(--${saveStatus === 'error' ? 'loss' : 'accent'})`,
          padding: 12, fontSize: 12
        }}>
          {saveStatus === 'saving' && <div>💾 Saving changes...</div>}
          {saveStatus === 'error' && <div style={{ color: 'var(--loss)' }}>✕ Save failed — retrying</div>}
        </div>
      )}

      {/* API errors banner */}
      {priceErrors && priceErrors.length > 0 && (
        <div className="card card-sm" style={{
          marginBottom: 12, borderLeft: '3px solid var(--loss)', padding: 12, fontSize: 12
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--loss)' }}>
            ⚠ {priceErrors.length} symbol{priceErrors.length > 1 ? 's' : ''} couldn't be fetched
          </div>
          {priceErrors.slice(0, 5).map(e => (
            <div key={e.symbol} style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{e.symbol}</strong>: {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search name, symbol, notes…"
          style={{ width: 240 }}
        />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="all">All Classes</option>
          {ASSET_CLASSES.map(c => (
            <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
          ))}
        </select>
        <button
          className={`btn btn-sm ${showClosed ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowClosed(c => !c)}
          title="Toggle to view closed-out positions"
        >
          {showClosed ? '◄ Active' : `Closed (${closed.length}) ►`}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <h3>{showClosed ? 'No closed positions' : (holdings.length === 0 ? 'No assets yet' : 'No matches')}</h3>
            <p style={{ marginBottom: 16 }}>
              {showClosed
                ? 'Positions you\'ve fully sold will appear here.'
                : (holdings.length === 0 ? 'Add your first asset to start tracking your portfolio.' : 'Try a different filter.')}
            </p>
            {holdings.length === 0 && !showClosed && (
              <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}>+ Add Asset</button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th className="col-asset">Asset</th>
                <th className="col-class">Class</th>
                <th className="text-right col-qty">Quantity</th>
                <th className="text-right col-price">Current Price</th>
                <th className="text-right col-value">Value ({cur})</th>
                <th className="text-right col-alloc">Allocation</th>
                <th className="text-right">Unrealized P&L</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const pct = totalAssetsBase > 0 ? (h.currentValueBase / totalAssetsBase) * 100 : 0
                const isMkt = MARKET_CLASSES.includes(h.class)
                const needsPrice = h.class !== 'cash' && (
                  (isMkt && h.manualPriceNeeded) ||
                  (!isMkt && (h.priceSource === 'cost' || h.priceSource === 'none'))
                )
                const fractional = h.ownershipPct != null && h.ownershipPct < 100

                return (
                  <tr
                    key={h.id}
                    onClick={() => setDetailHolding(h)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view details"
                  >
                    <td className="col-asset">
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Clicking the star toggles favorite. Favorites get
                            an extra Sell-confirmation step in TransactionModal. */}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); editAsset(h.id, { favorite: !h.favorite }) }}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault(); e.stopPropagation()
                              editAsset(h.id, { favorite: !h.favorite })
                            }
                          }}
                          title={h.favorite ? 'Unfavorite — removes sell confirmation' : 'Mark as favorite — adds sell confirmation'}
                          style={{
                            cursor: 'pointer',
                            color: h.favorite ? '#fcd535' : 'var(--text-muted)',
                            fontSize: 14, lineHeight: 1,
                          }}
                        >
                          {h.favorite ? '★' : '☆'}
                        </span>
                        <span>{h.name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {h.symbol && <span>{h.symbol}</span>}
                        {fractional && (
                          <span
                            title={
                              (h.class === 'business' || h.class === 'private_equity')
                                ? `Owns ${h.ownershipPct.toFixed(0)}% of the company — value shown is your stake`
                                : 'Fractional ownership — value scaled to your share'
                            }
                            style={{
                              marginLeft: h.symbol ? 6 : 0,
                              padding: '1px 5px',
                              background: 'var(--accent-dim)', color: 'var(--accent)',
                              borderRadius: 3, fontWeight: 600
                            }}
                          >
                            {h.ownershipPct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-class"><span className={`badge badge-${h.class}`}>{CLASS_LABEL[h.class] || h.class}</span></td>
                    <td className="text-right muted col-qty">{
                      // Business / private_equity in lump-sum mode encode the
                      // investment amount in `quantity` with price=1, so the
                      // qty column would otherwise display the dollar amount
                      // as if it were a unit count. Detect via avgCost ≈ 1
                      // (share-count mode would have a real per-share price)
                      // and show "—" instead.
                      ((h.class === 'business' || h.class === 'private_equity') &&
                       h.avgCostNative != null && Math.abs(h.avgCostNative - 1) < 0.0001 &&
                       h.quantity > 1)
                        ? '—'
                        : formatNumber(h.quantity)
                    }</td>
                    <td className="text-right col-price" onClick={e => e.stopPropagation()}>
                      {needsPrice ? (
                        <div className="price-inline-wrap" style={{ justifyContent: 'flex-end' }}>
                          <input
                            className="price-inline-input"
                            type="number" step="any" min="0"
                            value={manualPrices[h.id] || ''}
                            onChange={e => setManualPrices(p => ({ ...p, [h.id]: e.target.value }))}
                            placeholder="Enter price"
                            onKeyDown={e => e.key === 'Enter' && applyManualPrice(h, manualPrices[h.id])}
                          />
                          <button
                            className="btn btn-xs btn-secondary"
                            onClick={() => applyManualPrice(h, manualPrices[h.id])}
                          >✓</button>
                        </div>
                      ) : (
                        <div>
                          <div>{formatCurrency(h.currentPrice, h.currency)}</div>
                          {h.currency !== cur && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.currency}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-right fw-600 col-value">
                      <div>{formatCurrency(h.currentValueBase, cur)}</div>
                      {h.currency !== cur && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          ({formatCurrency(h.currentValueNative, h.currency)})
                        </div>
                      )}
                    </td>
                    <td className="text-right muted col-alloc">{pct.toFixed(1)}%</td>
                    <td className={`text-right fw-600 ${h.unrealizedPnLBase >= 0 ? 'gain' : 'loss'}`}>
                      <div>{formatCurrency(h.unrealizedPnLBase, cur)}</div>
                      <div style={{ fontSize: 11 }}>{formatPct(h.unrealizedPnLPct)}</div>
                    </td>
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-xs btn-secondary" title="Add transaction"
                          onClick={() => setTxnModalAssetId(h.id)}>+ Txn</button>
                        <button className="btn btn-xs btn-ghost" title="Edit asset"
                          onClick={() => setEditingAsset(h)}>✎</button>
                        <button className="btn btn-xs btn-danger" title="Delete asset"
                          onClick={() => setConfirmDelete(h)}>✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Two-option delete confirmation. The "Sell first" branch routes to
          TransactionModal via prefill so realized P&L is captured before the
          asset record disappears. */}
      {confirmDelete && (
        <AssetDeleteModal
          holding={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onSellInstead={({ type, quantity, price }) => {
            setTxnModalPrefill({
              assetId: confirmDelete.id,
              type,
              quantity,
              price,
              totalValue: quantity * price,
            })
            setConfirmDelete(null)
          }}
          onDelete={() => { deleteAsset(confirmDelete.id); setConfirmDelete(null) }}
        />
      )}

      {showAssetModal && <AssetModal onClose={() => setShowAssetModal(false)} />}
      {editingAsset && <AssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
      {detailHolding && (
        <AssetDetailModal
          holding={detailHolding}
          onClose={() => setDetailHolding(null)}
          onEdit={(h) => setEditingAsset(h)}
        />
      )}
      {txnModalAssetId && (
        <TransactionModal
          preselectedAssetId={txnModalAssetId}
          onClose={() => setTxnModalAssetId(null)}
        />
      )}
      {txnModalPrefill && (
        <TransactionModal
          prefill={txnModalPrefill}
          onClose={() => setTxnModalPrefill(null)}
        />
      )}
    </div>
  )
}
