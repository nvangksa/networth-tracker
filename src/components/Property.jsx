import React, { useState } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { formatCurrency, INCOME_TYPES, annualizedReturn, localISO } from '../utils/calculations.js'
import AssetModal from './modals/AssetModal.jsx'
import TransactionModal from './modals/TransactionModal.jsx'
import AssetDetailModal from './modals/AssetDetailModal.jsx'
import AssetDeleteModal from './modals/AssetDeleteModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

export default function Property({ onNavigate }) {
  const { holdings, data, deleteAsset } = usePortfolio()
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [txnModalAssetId, setTxnModalAssetId] = useState(null)
  const [sellModalAssetId, setSellModalAssetId] = useState(null)
  const [search, setSearch] = useState('')
  const [detailHolding, setDetailHolding] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const cur = data.settings.baseCurrency
  // Hide sold-out properties — they live in Realized P&L
  const allProperties = holdings.filter(h => h.class === 'property' && !h.isSoldOut)
  const q = search.trim().toLowerCase()
  const properties = q
    ? allProperties.filter(h => `${h.name || ''} ${h.notes || ''}`.toLowerCase().includes(q))
    : allProperties

  // Summary totals use the full list (not the search-filtered view)
  const totalValue = allProperties.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const totalMortgage = allProperties.reduce((s, h) => {
    const mb = parseFloat(h.mortgageBalance) || 0
    return s + mb * (h.rate || 1)
  }, 0)
  const totalEquity = totalValue - totalMortgage

  const totalRentalIncome = allProperties.reduce((s, h) => s + (h.totalIncomeBase || 0), 0)

  // Per-property income and expenses from transactions
  function getPropertyTransactions(assetId) {
    return data.transactions
      .filter(t => t.assetId === assetId)
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Property</div>
          <div className="page-subtitle">
            {allProperties.length} properties{q && ` · ${properties.length} match "${search}"`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CurrencyToggle />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate?.('realized', { from: 'property', filterClass: 'property' })}
            title="See realized P&L from sold properties"
          >
            📊 Realized P&L
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAssetModal(true)}>
            + Add Property
          </button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid" style={{ marginBottom: 24 }}>
        <div className="metric-card">
          <div className="metric-label">Total Property Value</div>
          <div className="metric-value">{formatCurrency(totalValue, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Mortgage</div>
          <div className={`metric-value ${totalMortgage > 0 ? 'loss' : ''}`}>
            {formatCurrency(totalMortgage, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net Equity</div>
          <div className={`metric-value ${totalEquity >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalEquity, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Rental Income</div>
          <div className="metric-value accent">{formatCurrency(totalRentalIncome, cur, true)}</div>
        </div>
      </div>

      {/* Search bar */}
      {allProperties.length > 0 && (
        <div className="filters-bar" style={{ marginBottom: 16 }}>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search property name or notes…"
            style={{ width: 280 }}
          />
          {search && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕ Clear</button>
          )}
        </div>
      )}

      {properties.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🏠</div>
            <h3>No properties yet</h3>
            <p style={{ marginBottom: 16 }}>
              Add a property asset to track its value, mortgage, rental income, and net equity.
            </p>
            <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}>+ Add Property</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {properties.map(h => {
            const txns = getPropertyTransactions(h.id)
            const rentalTxns = txns.filter(t => t.type === 'rental_income')
            const revalTxns = txns.filter(t => t.type === 'revaluation').slice(0, 3)
            const mb = parseFloat(h.mortgageBalance) || 0
            const netEq = h.currentValueNative - mb
            const netEqBase = netEq * (h.rate || 1)

            const totalRental = rentalTxns.reduce((s, t) => s + (parseFloat(t.totalValue) || parseFloat(t.price) || 0), 0)
            // Estimate purchase price = original cost basis
            const purchasePrice = h.costBasisNative

            // Considerate planning metrics —
            //   LTV: how leveraged is this property
            //   Annualized return: capital gain + rental yield, expressed per year
            //   Gross rental yield: annual rent ÷ current value
            const ltvPct = h.currentValueNative > 0 && mb > 0
              ? (mb / h.currentValueNative) * 100
              : null
            const purchaseISO = h.purchaseDate || txns.filter(t => t.type === 'buy')[0]?.date
            const yearsHeld = purchaseISO
              ? Math.max(0, (Date.now() - new Date(purchaseISO + 'T00:00:00').getTime()) / (365.25 * 86_400_000))
              : 0
            const annualReturnPct = yearsHeld >= 0.25 && h.costBasisNative > 0
              ? annualizedReturn(h.costBasisNative, h.currentValueNative, yearsHeld)
              : null
            // Annualized rent — sum the past 12 months of rental_income txns.
            // localISO so the 12-month window aligns with the user's calendar
            // (txn.date is a local-day string, so toISOString could shift by 1).
            const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
            const cutoffISO = localISO(cutoff)
            const annualRent = rentalTxns
              .filter(t => t.date >= cutoffISO)
              .reduce((s, t) => s + (parseFloat(t.totalValue) || parseFloat(t.price) || 0), 0)
            const grossYieldPct = h.currentValueNative > 0 && annualRent > 0
              ? (annualRent / h.currentValueNative) * 100
              : null

            return (
              <div
                key={h.id}
                className="property-card"
                onClick={() => setDetailHolding(h)}
                style={{ cursor: 'pointer' }}
                title="Click to view property details"
              >
                <div className="property-card-header" onClick={e => e.stopPropagation()}>
                  <div>
                    <div className="property-name">{h.name}</div>
                    {h.notes && <div className="property-sub">{h.notes}</div>}
                    {h.latestRevalDate && (
                      <div className="property-sub">Last revalued: {h.latestRevalDate}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-xs btn-secondary" onClick={() => setTxnModalAssetId(h.id)}>
                      + Transaction
                    </button>
                    <button className="btn btn-xs btn-secondary" onClick={() => setSellModalAssetId(h.id)} title="Record the sale price and date">
                      💰 Sell
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => setEditingAsset(h)}>✎ Edit</button>
                    <button className="btn btn-xs btn-ghost" style={{ color: 'var(--loss)' }} onClick={() => setConfirmDelete(h)} title="Delete property and all its transactions">
                      🗑 Delete
                    </button>
                  </div>
                </div>

                <div className="property-metrics">
                  <div>
                    <div className="property-metric-label">Purchase Price</div>
                    <div className="property-metric-value">
                      {purchasePrice > 0 ? formatCurrency(purchasePrice, h.currency) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="property-metric-label">Current Value</div>
                    <div className="property-metric-value">
                      {formatCurrency(h.currentValueNative, h.currency)}
                      {h.currency !== cur && (
                        <span className="metric-sub-value">
                          ≈ {formatCurrency(h.currentValueBase, cur, true)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="property-metric-label">Mortgage Balance</div>
                    <div className={`property-metric-value ${mb > 0 ? 'loss' : 'muted'}`}>
                      {mb > 0 ? formatCurrency(mb, h.currency) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="property-metric-label">Net Equity</div>
                    <div className={`property-metric-value ${netEq >= 0 ? 'gain' : 'loss'}`}>
                      {formatCurrency(netEq, h.currency)}
                      {h.currency !== cur && (
                        <span className="metric-sub-value">
                          ≈ {formatCurrency(netEqBase, cur, true)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="property-metric-label">Capital Gain</div>
                    <div className={`property-metric-value ${h.unrealizedPnLBase >= 0 ? 'gain' : 'loss'}`}>
                      {formatCurrency(h.unrealizedPnLNative, h.currency)}
                      {h.costBasisNative > 0 && (
                        <span className="metric-sub-value">
                          {((h.unrealizedPnLNative / h.costBasisNative) * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="property-metric-label">Total Rental Income</div>
                    <div className="property-metric-value accent">
                      {totalRental > 0 ? formatCurrency(totalRental, h.currency) : '—'}
                    </div>
                  </div>
                </div>

                {/* Planning metrics — only shown when meaningful data exists */}
                {(ltvPct !== null || annualReturnPct !== null || grossYieldPct !== null) && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)',
                  }}>
                    {ltvPct !== null && (
                      <div>
                        <div className="property-metric-label">Loan-to-Value (LTV)</div>
                        <div className={`property-metric-value ${ltvPct > 80 ? 'loss' : ltvPct > 60 ? 'accent-text' : 'gain'}`}>
                          {ltvPct.toFixed(1)}%
                          <span className="metric-sub-value">
                            {ltvPct > 80 ? 'High leverage' : ltvPct > 60 ? 'Moderate' : 'Conservative'}
                          </span>
                        </div>
                      </div>
                    )}
                    {annualReturnPct !== null && (
                      <div>
                        <div className="property-metric-label">Annualized Appreciation</div>
                        <div className={`property-metric-value ${annualReturnPct >= 0 ? 'gain' : 'loss'}`}>
                          {annualReturnPct >= 0 ? '+' : ''}{annualReturnPct.toFixed(2)}%/yr
                          <span className="metric-sub-value">
                            over {yearsHeld.toFixed(1)} year{yearsHeld === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    )}
                    {grossYieldPct !== null && (
                      <div>
                        <div className="property-metric-label">Gross Rental Yield</div>
                        <div className="property-metric-value accent">
                          {grossYieldPct.toFixed(2)}%/yr
                          <span className="metric-sub-value">
                            {formatCurrency(annualRent, h.currency)} rent (last 12mo)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Recent revaluations */}
                {revalTxns.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent Revaluations
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {revalTxns.map(t => (
                        <div key={t.id} style={{ fontSize: 12 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{t.date}: </span>
                          <span style={{ fontWeight: 600 }}>{formatCurrency(t.price, h.currency)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent rental income */}
                {rentalTxns.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent Rental Income
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {rentalTxns.slice(0, 6).map(t => (
                        <div key={t.id} style={{ fontSize: 12 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{t.date}: </span>
                          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                            +{formatCurrency(parseFloat(t.totalValue) || t.price, h.currency)}
                          </span>
                          {t.notes && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({t.notes})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAssetModal && (
        <AssetModal
          asset={{ class: 'property', currency: 'USD' }}
          onClose={() => setShowAssetModal(false)}
        />
      )}
      {editingAsset && <AssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
      {txnModalAssetId && (
        <TransactionModal
          preselectedAssetId={txnModalAssetId}
          onClose={() => setTxnModalAssetId(null)}
        />
      )}
      {sellModalAssetId && (
        <TransactionModal
          preselectedAssetId={sellModalAssetId}
          preselectedType="sell"
          onClose={() => setSellModalAssetId(null)}
        />
      )}
      {detailHolding && <AssetDetailModal holding={detailHolding} onClose={() => setDetailHolding(null)} />}
      {confirmDelete && (
        <AssetDeleteModal
          holding={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onSellInstead={({ type, quantity, price }) => {
            // Property's existing "Sell" flow goes through setSellModalAssetId
            // (which opens TransactionModal with preselectedType='sell'). We
            // reuse that here so the sell logic stays in one place rather
            // than diverging — the user gets the same form they'd see
            // clicking the 💰 Sell action on the row.
            setSellModalAssetId(confirmDelete.id)
            setConfirmDelete(null)
            // type/quantity/price are computed by AssetDeleteModal but
            // intentionally unused here — the existing sell modal already
            // pre-fills qty=1 for a property and prompts for the sale price.
            void type; void quantity; void price
          }}
          onDelete={() => { deleteAsset(confirmDelete.id); setConfirmDelete(null) }}
        />
      )}
    </div>
  )
}
