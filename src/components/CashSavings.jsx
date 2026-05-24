import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { formatCurrency, TXN_SHORT, getFxRate, projectCompoundGrowth } from '../utils/calculations.js'
import AssetModal from './modals/AssetModal.jsx'
import TransactionModal from './modals/TransactionModal.jsx'
import AssetDetailModal from './modals/AssetDetailModal.jsx'
import AssetDeleteModal from './modals/AssetDeleteModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

const CASH_TXN_TYPES = [
  'deposit', 'withdrawal', 'expense', 'liability_payment', 'transfer',
  'interest_income', 'salary', 'revaluation',
]
const TXN_LABELS = {
  deposit:           { label: 'Deposit',   color: 'var(--gain)' },
  withdrawal:        { label: 'Withdraw',  color: 'var(--loss)' },
  expense:           { label: 'Expense',   color: 'var(--loss)' },
  liability_payment: { label: 'Payment',   color: 'var(--loss)' },
  transfer:          { label: 'Transfer',  color: 'var(--loss)' },
  interest_income:   { label: 'Interest',  color: 'var(--accent)' },
  salary:            { label: 'Salary',    color: 'var(--accent)' },
  revaluation:       { label: 'Revalue',   color: 'var(--text-muted)' },
}

export default function CashSavings() {
  const { holdings, data, deleteAsset, deleteTransaction } = usePortfolio()
  const cur = data.settings.baseCurrency

  const [showAssetModal, setShowAssetModal] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [txnAssetId, setTxnAssetId] = useState(null)
  const [editingTxn, setEditingTxn] = useState(null)
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState(null)
  const [confirmDeleteTxn, setConfirmDeleteTxn] = useState(null)
  const [detailHolding, setDetailHolding] = useState(null)
  // Carries the prefilled withdrawal payload when the user picks "Withdraw
  // first" in the delete dialog — opens the TransactionModal with the full
  // remaining balance ready to record.
  const [txnPrefill, setTxnPrefill] = useState(null)
  const [search, setSearch] = useState('')
  const [assetFilter, setAssetFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const cashAssets = useMemo(() => holdings.filter(h => h.class === 'cash'), [holdings])

  const totalBase = cashAssets.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  // Interest only — separate from salary so the metric is accurate. Walk
  // transactions and convert each to base currency.
  const cashAssetIdSet = new Set(cashAssets.map(h => h.id))
  const totalInterest = data.transactions.reduce((s, t) => {
    if (t.type !== 'interest_income') return s
    if (!cashAssetIdSet.has(t.assetId)) return s
    const a = cashAssets.find(x => x.id === t.assetId)
    const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
    return s + amt * getFxRate(a?.currency || 'USD', cur, data.fxCache)
  }, 0)
  const numAssets = cashAssets.length

  const q = search.trim().toLowerCase()
  const filteredAssets = cashAssets.filter(h => {
    if (!q) return true
    return `${h.name || ''} ${h.notes || ''} ${h.currency}`.toLowerCase().includes(q)
  })

  const cashAssetIds = new Set(cashAssets.map(h => h.id))
  const cashTxns = useMemo(() => {
    // Sort by date+time so same-day rows respect the optional time field.
    // Falls back to '00:00' so legacy rows without a time stay above newer
    // timed entries on the same day (most recent first).
    const sortKey = t => `${t.date}T${t.time || '00:00'}`
    return data.transactions
      .filter(t => cashAssetIds.has(t.assetId) && CASH_TXN_TYPES.includes(t.type))
      .map(t => ({ ...t, asset: cashAssets.find(h => h.id === t.assetId) }))
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.transactions, cashAssets])

  const filteredTxns = cashTxns.filter(t => {
    if (assetFilter !== 'all' && t.assetId !== assetFilter) return false
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (!q) return true
    const hay = `${t.asset?.name || ''} ${t.notes || ''} ${t.type}`.toLowerCase()
    return hay.includes(q)
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Cash &amp; Savings</div>
          <div className="page-subtitle">
            {numAssets} account{numAssets === 1 ? '' : 's'} · {formatCurrency(totalBase, cur, true)} total
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CurrencyToggle />
          <button className="btn btn-secondary btn-sm" disabled={numAssets === 0} onClick={() => setTxnAssetId('__pick__')}>
            + Transaction
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAssetModal(true)}>
            + Add Account
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Cash &amp; Savings</div>
          <div className="metric-value">{formatCurrency(totalBase, cur, true)}</div>
          <div className="metric-sub">{numAssets} accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Interest Earned</div>
          <div className="metric-value accent">{formatCurrency(totalInterest, cur, true)}</div>
          <div className="metric-sub">Across all accounts</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Currencies</div>
          <div className="metric-value">{new Set(cashAssets.map(h => h.currency)).size}</div>
          <div className="metric-sub">Distinct FX exposures</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Transactions</div>
          <div className="metric-value">{cashTxns.length}</div>
          <div className="metric-sub">Deposits, withdrawals, interest</div>
        </div>
      </div>

      {/* Compound interest projection — only renders for accounts with APY set */}
      {(() => {
        const apyAssets = cashAssets.filter(a => a.apy && parseFloat(a.apy) > 0)
        if (!apyAssets.length) return null
        // Aggregate weighted-avg APY for header summary
        const totalApyValue = apyAssets.reduce((s, a) => s + (a.currentValueNative || 0), 0)
        const wAvgApy = totalApyValue > 0
          ? apyAssets.reduce((s, a) => s + (parseFloat(a.apy) || 0) * (a.currentValueNative || 0), 0) / totalApyValue
          : 0
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">Compound Growth Projection</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {apyAssets.length} account{apyAssets.length === 1 ? '' : 's'} earning interest · {wAvgApy.toFixed(2)}% weighted APY
              </span>
            </div>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">APY</th>
                  <th className="text-right">Today</th>
                  <th className="text-right">+1 yr</th>
                  <th className="text-right">+5 yr</th>
                  <th className="text-right">+10 yr</th>
                  <th className="text-right">+20 yr</th>
                </tr>
              </thead>
              <tbody>
                {apyAssets.map(a => {
                  const apy = parseFloat(a.apy) || 0
                  const cur1  = projectCompoundGrowth(a.currentValueNative, apy, 1).slice(-1)[0]
                  const cur5  = projectCompoundGrowth(a.currentValueNative, apy, 5).slice(-1)[0]
                  const cur10 = projectCompoundGrowth(a.currentValueNative, apy, 10).slice(-1)[0]
                  const cur20 = projectCompoundGrowth(a.currentValueNative, apy, 20).slice(-1)[0]
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td className="text-right accent fw-600">{apy}%</td>
                      <td className="text-right muted">{formatCurrency(a.currentValueNative, a.currency)}</td>
                      <td className="text-right">{formatCurrency(cur1.value, a.currency)}</td>
                      <td className="text-right">{formatCurrency(cur5.value, a.currency)}</td>
                      <td className="text-right gain">{formatCurrency(cur10.value, a.currency)}</td>
                      <td className="text-right gain fw-600">{formatCurrency(cur20.value, a.currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="form-hint" style={{ marginTop: 8 }}>
              Assumes APY stays constant and no deposits/withdrawals. Set APY per account by editing it.
            </div>
          </div>
        )
      })()}

      {/* Search + filter */}
      <div className="filters-bar">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search account or notes…"
          style={{ width: 260 }}
        />
        <select value={assetFilter} onChange={e => setAssetFilter(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
          <option value="all">All accounts</option>
          {cashAssets.map(h => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="all">All activity</option>
          {CASH_TXN_TYPES.map(t => (
            <option key={t} value={t}>{TXN_LABELS[t]?.label || t}</option>
          ))}
        </select>
        {(search || assetFilter !== 'all' || typeFilter !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setAssetFilter('all'); setTypeFilter('all') }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Accounts list */}
      {cashAssets.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💵</div>
            <h3>No cash accounts yet</h3>
            <p style={{ marginBottom: 16 }}>
              Add your checking, savings, or money-market accounts to track balances alongside your investments.
            </p>
            <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}>+ Add Account</button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><span className="card-title">Accounts</span></div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Currency</th>
                  <th className="text-right">Balance (native)</th>
                  <th className="text-right">Balance ({cur})</th>
                  <th className="text-right">Interest Earned</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(h => {
                  // Per-account interest only (excludes salary). Walks the
                  // raw transactions for accuracy regardless of how income
                  // gets aggregated by the calculation engine.
                  const interestNative = data.transactions
                    .filter(t => t.assetId === h.id && t.type === 'interest_income')
                    .reduce((s, t) => s + (parseFloat(t.totalValue) || parseFloat(t.price) || 0), 0)
                  return (
                  <tr key={h.id} onClick={() => setDetailHolding(h)} style={{ cursor: 'pointer' }} title="Click to view details">
                    <td style={{ fontWeight: 600 }}>{h.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{h.currency}</td>
                    <td className="text-right fw-600">{formatCurrency(h.currentValueNative, h.currency)}</td>
                    <td className="text-right">
                      {h.currency !== cur ? formatCurrency(h.currentValueBase, cur) : '—'}
                    </td>
                    <td className="text-right accent">{formatCurrency(interestNative, h.currency)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.notes}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-xs btn-secondary" title="Add transaction" onClick={() => setTxnAssetId(h.id)}>+ Txn</button>
                        <button className="btn btn-xs btn-ghost" title="Edit" onClick={() => setEditingAsset(h)}>✎</button>
                        <button className="btn btn-xs btn-danger" title="Delete" onClick={() => setConfirmDeleteAsset(h)}>✕</button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transaction log */}
      {cashAssets.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Activity Log</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{filteredTxns.length} entries</span>
          </div>
          {filteredTxns.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p>No activity yet. Add a deposit, withdrawal or interest entry.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.map(t => {
                    const amt = parseFloat(t.totalValue) || (parseFloat(t.quantity) * parseFloat(t.price)) || parseFloat(t.price) || 0
                    const label = TXN_LABELS[t.type]?.label || TXN_SHORT[t.type] || t.type
                    const isNegative = t.type === 'withdrawal' || t.type === 'expense' || t.type === 'liability_payment' || t.type === 'transfer'
                    return (
                      <tr key={t.id} onClick={() => setEditingTxn(t)} style={{ cursor: 'pointer' }} title="Click to edit">
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {t.date}{t.time && <span style={{ marginLeft: 6, fontSize: 11 }}>{t.time}</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>{t.asset?.name || '—'}</td>
                        <td><span className={`badge badge-${t.type}`}>{label}</span></td>
                        <td className={`text-right fw-600 ${isNegative ? 'loss' : t.type === 'deposit' ? '' : t.type === 'revaluation' ? 'muted' : 'accent'}`}>
                          {isNegative ? '−' : t.type === 'revaluation' ? '' : '+'}{formatCurrency(amt, t.asset?.currency || 'USD')}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.notes}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button className="btn btn-xs btn-ghost" onClick={() => setEditingTxn(t)}>✎</button>
                            <button className="btn btn-xs btn-danger" onClick={() => setConfirmDeleteTxn(t)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showAssetModal && (
        <AssetModal
          asset={{ class: 'cash', currency: cur }}
          onClose={() => setShowAssetModal(false)}
        />
      )}
      {editingAsset && <AssetModal asset={editingAsset} onClose={() => setEditingAsset(null)} />}
      {detailHolding && <AssetDetailModal holding={detailHolding} onClose={() => setDetailHolding(null)} />}
      {txnAssetId === '__pick__' && (
        <TransactionModal onClose={() => setTxnAssetId(null)} />
      )}
      {txnAssetId && txnAssetId !== '__pick__' && (
        <TransactionModal preselectedAssetId={txnAssetId} onClose={() => setTxnAssetId(null)} />
      )}
      {editingTxn && (
        <TransactionModal transaction={editingTxn} onClose={() => setEditingTxn(null)} />
      )}
      {confirmDeleteAsset && (
        <AssetDeleteModal
          holding={confirmDeleteAsset}
          onClose={() => setConfirmDeleteAsset(null)}
          onSellInstead={({ type, quantity, price }) => {
            setTxnPrefill({
              assetId: confirmDeleteAsset.id,
              type,
              quantity,
              price,
              totalValue: quantity * price,
            })
            setConfirmDeleteAsset(null)
          }}
          onDelete={() => { deleteAsset(confirmDeleteAsset.id); setConfirmDeleteAsset(null) }}
        />
      )}
      {txnPrefill && (
        <TransactionModal prefill={txnPrefill} onClose={() => setTxnPrefill(null)} />
      )}
      {confirmDeleteTxn && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Entry</span>
              <button className="modal-close" onClick={() => setConfirmDeleteTxn(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete this {TXN_LABELS[confirmDeleteTxn.type]?.label || confirmDeleteTxn.type} entry from {confirmDeleteTxn.date}?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteTxn(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteTransaction(confirmDeleteTxn.id); setConfirmDeleteTxn(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
