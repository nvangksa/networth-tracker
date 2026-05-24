import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, ASSET_CLASSES, TRANSACTION_TYPES, TXN_SHORT,
  getRealizedPnLPerSale
} from '../utils/calculations.js'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))
import TransactionModal from './modals/TransactionModal.jsx'
import CsvImportModal from './modals/CsvImportModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

export default function Transactions() {
  const { data, deleteTransaction } = usePortfolio()
  const [editingTxn, setEditingTxn] = useState(null)
  const [prefillTxn, setPrefillTxn] = useState(null) // for "log again"
  const [showModal, setShowModal] = useState(false)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const [filterClass, setFilterClass] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [showRealized, setShowRealized] = useState(false)

  const cur = data.settings.baseCurrency

  const realizedPnL = useMemo(() =>
    getRealizedPnLPerSale(data.transactions, data.assets, data.fxCache, cur),
    [data.transactions, data.assets, data.fxCache, cur]
  )
  const realizedMap = Object.fromEntries(realizedPnL.map(r => [r.txnId, r]))

  const enriched = useMemo(() => {
    return data.transactions
      .map(t => {
        const asset = data.assets.find(a => a.id === t.assetId)
        return { ...t, asset }
      })
      .filter(t => {
        if (filterClass !== 'all' && t.asset?.class !== filterClass) return false
        if (filterType !== 'all' && t.type !== filterType) return false
        if (filterDateFrom && t.date < filterDateFrom) return false
        if (filterDateTo && t.date > filterDateTo) return false
        if (search.trim()) {
          const q = search.trim().toLowerCase()
          const hay = `${t.asset?.name || ''} ${t.asset?.symbol || ''} ${t.notes || ''} ${t.type || ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      // Sort by date first, then by optional clock time (cash transactions
      // have an HH:MM field), then by id as a stable tiebreaker. The old
      // comment claimed IDs sorted chronologically — that was only true when
      // generateId used Date.now() in base36; modern browsers now hit the
      // crypto.randomUUID() branch and UUIDs are not time-ordered.
      .sort((a, b) => {
        const aKey = `${a.date || ''}T${a.time || '00:00'}`
        const bKey = `${b.date || ''}T${b.time || '00:00'}`
        return bKey.localeCompare(aKey) || (b.id || '').localeCompare(a.id || '')
      })
  }, [data.transactions, data.assets, filterClass, filterType, filterDateFrom, filterDateTo, search])

  const totalCount = enriched.length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Transactions</div>
          <div className="page-subtitle">{data.transactions.length} total transactions</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CurrencyToggle />
          <button className="btn btn-secondary btn-sm" onClick={() => setShowRealized(r => !r)}>
            {showRealized ? 'Hide' : 'Show'} Realized P&L
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowCsvModal(true)}
            title="Import a CSV exported from your broker"
          >
            ⤓ Import CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingTxn(null); setShowModal(true) }}>
            + Add Transaction
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search asset, symbol, notes…"
          style={{ width: 220 }}
        />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)}>
          <option value="all">All Classes</option>
          {ASSET_CLASSES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All Types</option>
          {TRANSACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input
          type="date" value={filterDateFrom}
          onChange={e => setFilterDateFrom(e.target.value)}
          style={{ width: 140 }}
          title="From date"
        />
        <input
          type="date" value={filterDateTo}
          onChange={e => setFilterDateTo(e.target.value)}
          style={{ width: 140 }}
          title="To date"
        />
        {(filterClass !== 'all' || filterType !== 'all' || filterDateFrom || filterDateTo || search) && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setFilterClass('all'); setFilterType('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearch('')
          }}>✕ Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {totalCount} results
        </span>
      </div>

      {enriched.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⇄</div>
            <h3>{data.transactions.length === 0 ? 'No transactions yet' : 'No results'}</h3>
            <p style={{ marginBottom: 12 }}>
              {data.transactions.length === 0
                ? 'Start logging your buys, sells, income, and revaluations.'
                : 'Try adjusting your filters.'}
            </p>
            {data.transactions.length === 0 && (
              <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Transaction</button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Asset</th>
                <th>Class</th>
                <th>Type</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
                <th className="text-right">Total</th>
                {showRealized && <th className="text-right">Realized P&L</th>}
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {enriched.map(t => {
                const realPnL = realizedMap[t.id]
                return (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{t.date}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.asset?.name || '—'}</div>
                      {t.asset?.symbol && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.asset.symbol}</div>
                      )}
                    </td>
                    <td>
                      {t.asset && <span className={`badge badge-${t.asset.class}`}>{CLASS_LABEL[t.asset.class] || t.asset.class}</span>}
                    </td>
                    <td><span className={`badge badge-${t.type}`}>{TXN_SHORT[t.type] || t.type.replace(/_/g, ' ')}</span></td>
                    <td className="text-right muted">
                      {t.quantity ? t.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
                    </td>
                    <td className="text-right muted">
                      {t.price ? formatCurrency(t.price, t.asset?.currency || 'USD') : '—'}
                    </td>
                    <td className="text-right fw-600">
                      {formatCurrency(parseFloat(t.totalValue) || t.price, t.asset?.currency || 'USD')}
                    </td>
                    {showRealized && (
                      <td className={`text-right fw-600 ${realPnL ? realPnL.realizedBase >= 0 ? 'gain' : 'loss' : 'muted'}`}>
                        {realPnL ? formatCurrency(realPnL.realizedBase, cur) : '—'}
                      </td>
                    )}
                    <td style={{ maxWidth: 140 }}>
                      <div className="truncate muted" style={{ fontSize: 12 }} title={t.notes}>{t.notes}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => { setPrefillTxn(t); setShowModal(true) }}
                          title="Log again — pre-fills a new transaction with these values"
                        >↻</button>
                        <button className="btn btn-xs btn-ghost" onClick={() => { setEditingTxn(t); setShowModal(true) }}>✎</button>
                        <button className="btn btn-xs btn-danger" onClick={() => setConfirmDelete(t)}>✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Transaction</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete this <strong>{confirmDelete.type}</strong> transaction on <strong>{confirmDelete.date}</strong>?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteTransaction(confirmDelete.id); setConfirmDelete(null) }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <TransactionModal
          transaction={editingTxn || undefined}
          prefill={!editingTxn ? prefillTxn || undefined : undefined}
          onClose={() => { setShowModal(false); setEditingTxn(null); setPrefillTxn(null) }}
        />
      )}

      {showCsvModal && (
        <CsvImportModal onClose={() => setShowCsvModal(false)} />
      )}
    </div>
  )
}
