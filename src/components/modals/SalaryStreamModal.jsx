import React, { useMemo, useState } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import { formatCurrency, getFxRate, localISO } from '../../utils/calculations.js'
import TransactionModal from './TransactionModal.jsx'

// Modal that lets users edit / add salary entries for a given source string,
// without leaving the Planning page. Stays open while the user opens a
// nested TransactionModal — closing the inner modal returns them here so
// they can edit additional entries.
//
// Props:
//   source: string | null  — the source name to filter on. Null/empty means
//                            "all salary transactions without a source set"
//   onClose: required handler
export default function SalaryStreamModal({ source, onClose }) {
  const { data, deleteTransaction } = usePortfolio()
  const cur = data.settings.baseCurrency
  const [editingTxn, setEditingTxn] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDeleteTxn, setConfirmDeleteTxn] = useState(null)

  const sourceLower = (source || '').trim().toLowerCase()
  const isUnsourced = !sourceLower

  // Salary transactions matching this source. For unsourced streams we list
  // ALL salary txns that have no source field — which is what the user sees
  // grouped together in the planner.
  const matching = useMemo(() => {
    return (data.transactions || [])
      .filter(t => t.type === 'salary')
      .filter(t => {
        const txnSource = (t.source || '').trim().toLowerCase()
        return isUnsourced ? !txnSource : txnSource === sourceLower
      })
      .map(t => ({ ...t, asset: data.assets.find(a => a.id === t.assetId) }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.transactions, data.assets, isUnsourced, sourceLower])

  // Aggregate stats so the user gets context (total received, monthly avg, distinct accounts)
  const totalBase = matching.reduce((s, t) => {
    const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
    const fx = getFxRate(t.asset?.currency || 'USD', cur, data.fxCache || {})
    return s + amt * fx
  }, 0)
  const accounts = [...new Set(matching.map(t => t.asset?.name).filter(Boolean))]
  // Monthly avg over the last 12 months only.
  // localISO so the 12-month boundary aligns with the user's calendar —
  // transactions are stored as local-day strings (todayISO writes local
  // components), so toISOString here would shift by ±1 day for users far
  // from UTC and silently miss / double-count edge-of-window salaries.
  const monthlyAvg = useMemo(() => {
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
    const cutoffISO = localISO(cutoff)
    let s = 0
    for (const t of matching) {
      if (t.date < cutoffISO) continue
      const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
      const fx = getFxRate(t.asset?.currency || 'USD', cur, data.fxCache || {})
      s += amt * fx
    }
    return s / 12
  }, [matching, cur, data.fxCache])

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 105 }}>
      <div className="modal" style={{ maxWidth: 640, width: '92vw' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              {isUnsourced ? 'Salary (no source set)' : `Salary from ${source}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {matching.length} entr{matching.length === 1 ? 'y' : 'ies'}
              {accounts.length > 0 && <> · paid into {accounts.join(', ')}</>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Stat strip */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            <Kpi label="Total Received" value={formatCurrency(totalBase, cur, true)} />
            <Kpi label="Monthly Avg (12mo)" value={formatCurrency(monthlyAvg, cur, true)} />
            <Kpi label="Distinct Accounts" value={accounts.length} />
          </div>

          {/* Helpful banner for unsourced legacy salary */}
          {isUnsourced && matching.length > 0 && (
            <div style={{
              fontSize: 12, color: 'var(--accent)', marginBottom: 10,
              background: 'var(--bg-secondary)', padding: 10, borderRadius: 6,
              borderLeft: '3px solid var(--accent)',
            }}>
              💡 These salary entries don't have a source recorded yet. Click any
              entry below to add an employer/payer name, or use the rename
              field below to apply one to <strong>all of them</strong> at once.
            </div>
          )}

          {/* Bulk-rename source */}
          {!renaming ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRenaming(true)}
              style={{ marginBottom: 10 }}
            >
              {isUnsourced ? '✎ Set source for all entries' : '✎ Rename this source'}
            </button>
          ) : (
            <BulkRename
              initial={source || ''}
              ids={matching.map(t => t.id)}
              onCancel={() => setRenaming(false)}
              onDone={() => setRenaming(false)}
            />
          )}

          {/* Add-new button */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              + Add salary entry
            </button>
          </div>

          {/* Salary entries list */}
          {matching.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p>No matching salary entries yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th className="text-right">Amount</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {matching.map(t => {
                    const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
                    return (
                      <tr key={t.id} onClick={() => setEditingTxn(t)} style={{ cursor: 'pointer' }} title="Click to edit">
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.date}</td>
                        <td style={{ fontWeight: 600 }}>{t.asset?.name || '—'}</td>
                        <td className="text-right gain fw-600">+{formatCurrency(amt, t.asset?.currency || cur)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{t.notes}</td>
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

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Nested TransactionModal — opens for editing or adding salary entries */}
      {editingTxn && (
        <TransactionModal transaction={editingTxn} onClose={() => setEditingTxn(null)} />
      )}
      {showAdd && (
        <TransactionModal
          preselectedType="salary"
          onClose={() => setShowAdd(false)}
        />
      )}
      {confirmDeleteTxn && (
        <div className="modal-backdrop" onClick={e => { e.stopPropagation(); setConfirmDeleteTxn(null) }} style={{ zIndex: 110 }}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Delete Salary Entry</span>
              <button className="modal-close" onClick={() => setConfirmDeleteTxn(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete this salary entry from <strong>{confirmDeleteTxn.date}</strong>?</p>
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

function Kpi({ label, value }) {
  return (
    <div style={{
      padding: 10, background: 'var(--bg-secondary)',
      border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// Inline bulk-rename input. Uses updateData to apply the new source string
// to every matching salary id in a SINGLE state update so we don't fire one
// POST per row (the prior loop over editTransaction created N round-trips
// for a bulk rename — slow for users with many legacy salary entries).
function BulkRename({ initial, ids, onCancel, onDone }) {
  const { updateData } = usePortfolio()
  const [val, setVal] = useState(initial || '')
  function apply() {
    const next = val.trim()
    if (!next) return
    const idSet = new Set(ids)
    updateData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t =>
        idSet.has(t.id) ? { ...t, source: next } : t
      ),
    }))
    onDone()
  }
  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12,
      padding: 10, background: 'var(--bg-secondary)', borderRadius: 6,
    }}>
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="e.g. Acme Corp"
        style={{ flex: 1 }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply() } }}
      />
      <button className="btn btn-primary btn-sm" onClick={apply} disabled={!val.trim()}>Apply to {ids.length}</button>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </div>
  )
}
