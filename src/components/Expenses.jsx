import React, { useState, useMemo, useEffect } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, getFxRate, todayISO, localISO, CURRENCIES,
  PASSIVE_INCOME_TYPES, INCOME_TYPES
} from '../utils/calculations.js'
import CurrencyToggle from './CurrencyToggle.jsx'
import ExpenseEditModal from './modals/ExpenseEditModal.jsx'

const RECURRENCE = [
  { value: 'one_time', label: 'One-time' },
  { value: 'weekly',   label: 'Weekly'   },
  { value: 'monthly',  label: 'Monthly'  },
  { value: 'yearly',   label: 'Yearly'   },
]

// 52 weeks ÷ 12 months ≈ 4.345 — the canonical multiplier so weekly burn
// converts to monthly without drifting over the year.
const WEEKS_PER_MONTH = 52 / 12

const DEFAULT_CATEGORIES = [
  'Food & Dining', 'Housing', 'Transport', 'Utilities',
  'Entertainment', 'Healthcare', 'Shopping', 'Education',
  'Insurance', 'Subscriptions', 'Travel', 'Taxes', 'Other',
]

function todayStr() { return todayISO() }

// Convert an expense amount into a monthly-equivalent in `base`.
// one_time is excluded from "recurring monthly burn" (clearly labelled).
function monthlyEquivBase(exp, fxCache, base) {
  const amt = parseFloat(exp.amount) || 0
  const rate = getFxRate(exp.currency || base, base, fxCache)
  const baseAmt = amt * rate
  if (exp.recurrence === 'weekly')  return baseAmt * WEEKS_PER_MONTH
  if (exp.recurrence === 'monthly') return baseAmt
  if (exp.recurrence === 'yearly')  return baseAmt / 12
  return 0 // one_time doesn't count toward recurring monthly burn
}

// Total yearly burn from an expense (for annual rollups)
function yearlyEquivBase(exp, fxCache, base) {
  const amt = parseFloat(exp.amount) || 0
  const rate = getFxRate(exp.currency || base, base, fxCache)
  const baseAmt = amt * rate
  if (exp.recurrence === 'weekly')  return baseAmt * 52
  if (exp.recurrence === 'monthly') return baseAmt * 12
  if (exp.recurrence === 'yearly')  return baseAmt
  return baseAmt // one_time is included in annual total
}

// Generate upcoming instances within [fromISO, toISO]
function upcomingOccurrences(exp, fromISO, toISO) {
  const out = []
  if (!exp.startDate) return out
  // Guard against inverted endDate < startDate (an inconsistent record
  // would otherwise hand back the one_time hit but lose the recurring
  // hits — the modal now blocks this on submit, but legacy records exist).
  if (exp.endDate && exp.endDate < exp.startDate) return out
  const start = new Date(exp.startDate + 'T00:00:00Z')
  const end = exp.endDate ? new Date(exp.endDate + 'T00:00:00Z') : null
  const from = new Date(fromISO + 'T00:00:00Z')
  const to = new Date(toISO + 'T00:00:00Z')
  if (exp.recurrence === 'one_time') {
    if (start >= from && start <= to && (!end || start <= end)) {
      out.push({ date: exp.startDate, amount: exp.amount })
    }
    return out
  }
  // Step the cursor forward from startDate. Cap at 10k iterations as a
  // belt-and-suspenders safety net so a malformed recurrence string can't
  // loop forever.
  const cursor = new Date(start)
  let safety = 10_000
  while (cursor <= to && safety-- > 0) {
    if (cursor >= from && (!end || cursor <= end)) {
      out.push({ date: cursor.toISOString().slice(0, 10), amount: exp.amount })
    }
    if (exp.recurrence === 'weekly')      cursor.setUTCDate(cursor.getUTCDate() + 7)
    else if (exp.recurrence === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    else if (exp.recurrence === 'yearly')  cursor.setUTCFullYear(cursor.getUTCFullYear() + 1)
    else break
  }
  return out
}

const EMPTY_FORM = {
  name: '', amount: '', currency: 'USD',
  category: 'Food & Dining', tags: [],
  recurrence: 'monthly',
  startDate: todayStr(), endDate: '',
  sources: [], // [{ assetId, percent }]
  notes: '',
}

// Migrate legacy sourceAssetIds → sources with even split
function normalizeSources(exp) {
  if (Array.isArray(exp?.sources) && exp.sources.length) {
    return exp.sources.map(s => ({ assetId: s.assetId, percent: Number(s.percent) || 0 }))
  }
  const ids = exp?.sourceAssetIds || []
  if (!ids.length) return []
  const even = Math.round((100 / ids.length) * 100) / 100
  return ids.map((id, i) => ({
    assetId: id,
    percent: i === ids.length - 1 ? Math.round((100 - even * (ids.length - 1)) * 100) / 100 : even,
  }))
}

export default function Expenses({ navContext = {} }) {
  const {
    data, holdings, deleteExpense, pastYearPassiveIncome,
  } = usePortfolio()
  const cur = data.settings.baseCurrency

  // Modal state — opened with `editing` set (or null for "add new")
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [autoEditConsumed, setAutoEditConsumed] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterRecurrence, setFilterRecurrence] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const expenses = data.expenses || []
  const customCategories = data.expenseCategories || []
  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...customCategories])]

  const cashAssets = holdings.filter(h => h.class === 'cash')

  function openAdd() {
    setEditing(null)
    setShowForm(true)
  }
  function openEdit(exp) {
    setEditing(exp)
    setShowForm(true)
  }

  // Auto-open the edit form when arriving from another page (e.g. Planning's
  // expense ✎ icon). Runs once per navigation so a manual close doesn't
  // immediately re-trigger.
  useEffect(() => {
    if (autoEditConsumed) return
    if (!navContext?.editExpenseId) return
    const target = (data.expenses || []).find(e => e.id === navContext.editExpenseId)
    if (!target) return
    openEdit(target)
    setAutoEditConsumed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navContext?.editExpenseId, data.expenses, autoEditConsumed])

  // Filters
  const q = search.trim().toLowerCase()
  const filtered = expenses.filter(e => {
    if (filterCategory !== 'all' && e.category !== filterCategory) return false
    if (filterRecurrence !== 'all' && e.recurrence !== filterRecurrence) return false
    if (!q) return true
    const hay = `${e.name} ${e.notes || ''} ${e.category || ''} ${(e.tags || []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  }).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))

  // Totals & forecast
  const totalMonthly = expenses.reduce((s, e) => s + monthlyEquivBase(e, data.fxCache, cur), 0)
  const totalYearly = expenses.reduce((s, e) => s + yearlyEquivBase(e, data.fxCache, cur), 0)

  // Approx monthly income = past-year passive / 12 + salary (last 3 months avg).
  const salaryMonthly = useMemo(() => {
    const since = new Date()
    since.setMonth(since.getMonth() - 3)
    // localISO so the 3-month boundary aligns with the user's calendar day
    // (transactions are stored with local-date strings, so toISOString here
    // would mismatch by ±1 day for users far from UTC).
    const sinceISO = localISO(since)
    let total = 0
    for (const t of data.transactions) {
      if (t.type !== 'salary') continue
      if (t.date < sinceISO) continue
      const asset = data.assets.find(a => a.id === t.assetId)
      const curFrom = asset?.currency || 'USD'
      const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
      total += amt * getFxRate(curFrom, cur, data.fxCache)
    }
    return total / 3
  }, [data.transactions, data.assets, data.fxCache, cur])

  const monthlyPassive = pastYearPassiveIncome / 12
  const monthlyIncome = salaryMonthly + monthlyPassive
  const monthlyNet = monthlyIncome - totalMonthly

  // Forecast 6 months. Use LOCAL-time month construction so the label
  // ("May 26", "Jun 26"…) matches what the user sees on their calendar —
  // mixing Date.UTC with toLocaleDateString shifted the first month back
  // by one for users west of UTC (e.g. America/Toronto rendered "Apr"
  // when today was actually May).
  const forecast = useMemo(() => {
    const months = []
    const todayLocal = new Date()
    const baseYear = todayLocal.getFullYear()
    const baseMonth = todayLocal.getMonth() // 0-indexed local month
    const pad2 = n => String(n).padStart(2, '0')
    for (let i = 0; i < 6; i++) {
      const start = new Date(baseYear, baseMonth + i, 1)
      const end   = new Date(baseYear, baseMonth + i + 1, 0)
      const fromISO = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`
      const toISO   = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`
      let spend = 0
      for (const e of expenses) {
        const rate = getFxRate(e.currency || cur, cur, data.fxCache)
        for (const occ of upcomingOccurrences(e, fromISO, toISO)) {
          spend += (parseFloat(occ.amount) || 0) * rate
        }
      }
      const label = start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      months.push({ label, spend, income: monthlyIncome, net: monthlyIncome - spend })
    }
    return months
  }, [expenses, data.fxCache, cur, monthlyIncome])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Expenses</div>
          <div className="page-subtitle">
            {expenses.length} tracked · {formatCurrency(totalMonthly, cur, true)}/mo · {formatCurrency(totalYearly, cur, true)}/yr
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CurrencyToggle />
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Expense</button>
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Recurring Monthly Burn</div>
          <div className="metric-value loss">{formatCurrency(totalMonthly, cur, true)}</div>
          <div className="metric-sub">Monthly + yearly/12</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Monthly Income (est.)</div>
          <div className="metric-value accent">{formatCurrency(monthlyIncome, cur, true)}</div>
          <div className="metric-sub">Salary (3mo avg) + passive/12</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net Monthly Cashflow</div>
          <div className={`metric-value ${monthlyNet >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(monthlyNet, cur, true)}
          </div>
          <div className="metric-sub">{monthlyNet >= 0 ? 'Surplus' : 'Deficit'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Yearly Burn</div>
          <div className="metric-value loss">{formatCurrency(totalYearly, cur, true)}</div>
          <div className="metric-sub">All expenses annualized</div>
        </div>
      </div>

      {/* Cashflow forecast — visualized stacked bars + table */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">6-Month Cashflow Forecast</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Income (green) vs expenses (red) · net at the bottom
          </span>
        </div>
        {/* Visual bars: each month rendered as a head-to-head income/expense pair */}
        {(() => {
          const max = Math.max(...forecast.map(m => Math.max(m.income, m.spend)), 1)
          return (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 14, height: 140 }}>
              {forecast.map(m => {
                const incH = (m.income / max) * 100
                const expH = (m.spend / max) * 100
                const netCls = m.net >= 0 ? 'gain' : 'loss'
                return (
                  <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div title={`Income ${formatCurrency(m.income, cur, true)} · Expenses ${formatCurrency(m.spend, cur, true)}`}
                         style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 100, width: '100%', justifyContent: 'center' }}>
                      <div style={{ width: '40%', height: `${incH}%`, background: 'var(--accent)', borderRadius: '2px 2px 0 0', minHeight: 1 }} />
                      <div style={{ width: '40%', height: `${expH}%`, background: 'var(--loss)', borderRadius: '2px 2px 0 0', minHeight: 1 }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.label}</div>
                    <div className={netCls} style={{ fontSize: 10, fontWeight: 700 }}>
                      {m.net >= 0 ? '+' : ''}{formatCurrency(m.net, cur, true)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
        <div className="table-wrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Income</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Net</th>
                <th className="text-right">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let cumulative = 0
                return forecast.map(m => {
                  cumulative += m.net
                  return (
                    <tr key={m.label}>
                      <td style={{ fontWeight: 600 }}>{m.label}</td>
                      <td className="text-right accent">{formatCurrency(m.income, cur, true)}</td>
                      <td className="text-right loss">{formatCurrency(m.spend, cur, true)}</td>
                      <td className={`text-right fw-600 ${m.net >= 0 ? 'gain' : 'loss'}`}>
                        {formatCurrency(m.net, cur, true)}
                      </td>
                      <td className={`text-right fw-600 ${cumulative >= 0 ? 'gain' : 'loss'}`}>
                        {cumulative >= 0 ? '+' : ''}{formatCurrency(cumulative, cur, true)}
                      </td>
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search name, notes, tags…"
          style={{ width: 240 }}
        />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ width: 'auto', minWidth: 170 }}>
          <option value="all">All categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterRecurrence} onChange={e => setFilterRecurrence(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="all">All recurrences</option>
          {RECURRENCE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {(search || filterCategory !== 'all' || filterRecurrence !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterCategory('all'); setFilterRecurrence('all') }}>
            ✕ Clear
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length} shown
        </span>
      </div>

      {/* Expense list */}
      {expenses.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <h3>No expenses tracked yet</h3>
            <p style={{ marginBottom: 16 }}>
              Add recurring monthly, yearly, or one-time expenses to forecast your cashflow.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>+ Add First Expense</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header"><span className="card-title">Expense Log</span></div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Recurrence</th>
                  <th>Start</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Monthly ({cur})</th>
                  <th>Paid from</th>
                  <th>Tags</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const monthlyEq = monthlyEquivBase(e, data.fxCache, cur)
                  const sources = normalizeSources(e)
                    .map(s => cashAssets.find(a => a.id === s.assetId)?.name)
                    .filter(Boolean)
                  return (
                    <tr key={e.id} onClick={() => openEdit(e)} style={{ cursor: 'pointer' }} title="Click to edit">
                      <td style={{ fontWeight: 600 }}>{e.name}
                        {e.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.notes}</div>}
                      </td>
                      <td><span className="badge badge-other">{e.category}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {RECURRENCE.find(r => r.value === e.recurrence)?.label || e.recurrence}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>{e.startDate}</td>
                      <td className="text-right fw-600 loss">
                        −{formatCurrency(parseFloat(e.amount) || 0, e.currency || cur)}
                      </td>
                      <td className="text-right muted">
                        {monthlyEq > 0 ? formatCurrency(monthlyEq, cur) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {sources.length === 0 ? '—' : sources.length > 2 ? `${sources.slice(0, 2).join(', ')} +${sources.length - 2}` : sources.join(', ')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(e.tags || []).map(t => <span key={t} className="tag-chip" style={{ fontSize: 10 }}>{t}</span>)}
                        </div>
                      </td>
                      <td onClick={evt => evt.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn btn-xs btn-ghost" onClick={() => openEdit(e)}>✎</button>
                          <button className="btn btn-xs btn-danger" onClick={() => setConfirmDelete(e)}>✕</button>
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

      {showForm && (
        <ExpenseEditModal
          expense={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Expense</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete <strong>{confirmDelete.name}</strong>?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteExpense(confirmDelete.id); setConfirmDelete(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

