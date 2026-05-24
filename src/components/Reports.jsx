import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, formatPct, ASSET_CLASSES, INCOME_TYPES, TRANSACTION_TYPES,
  getFxRate, getRealizedPnLPerSale, todayISO, computeNetWorthAsOf,
  calculateAssetHolding,
} from '../utils/calculations.js'
import CurrencyToggle from './CurrencyToggle.jsx'

// ── Date helpers ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate()
}
function isoDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}
function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function getPeriodRanges(period, customStart, customEnd) {
  const today = todayISO()
  const now = new Date(today + 'T00:00:00Z')
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1 // 1-12

  if (period === 'YTD') {
    const start = isoDate(year, 1, 1)
    const end = today
    const prevStart = isoDate(year - 1, 1, 1)
    const prevEnd = isoDate(year - 1, month, now.getUTCDate())
    return {
      current: { start, end, label: `YTD ${year}` },
      prior:   { start: prevStart, end: prevEnd, label: `YTD ${year - 1}` },
    }
  }
  if (period === 'MoM') {
    const lastMonthEndDate = new Date(Date.UTC(year, month - 1, 0))
    const lmYear = lastMonthEndDate.getUTCFullYear()
    const lmMonth = lastMonthEndDate.getUTCMonth() + 1
    const start = isoDate(lmYear, lmMonth, 1)
    const end = isoDate(lmYear, lmMonth, daysInMonth(lmYear, lmMonth))
    const priorEndDate = new Date(Date.UTC(lmYear, lmMonth - 1, 0))
    const pYear = priorEndDate.getUTCFullYear()
    const pMonth = priorEndDate.getUTCMonth() + 1
    const prevStart = isoDate(pYear, pMonth, 1)
    const prevEnd = isoDate(pYear, pMonth, daysInMonth(pYear, pMonth))
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return {
      current: { start, end, label: `${monthNames[lmMonth - 1]} ${lmYear}` },
      prior:   { start: prevStart, end: prevEnd, label: `${monthNames[pMonth - 1]} ${pYear}` },
    }
  }
  if (period === 'YoY') {
    const start = isoDate(year, 1, 1)
    const end = today
    const prevStart = isoDate(year - 1, 1, 1)
    const prevEnd = isoDate(year - 1, month, Math.min(now.getUTCDate(), daysInMonth(year - 1, month)))
    return {
      current: { start, end, label: `${year} YTD` },
      prior:   { start: prevStart, end: prevEnd, label: `${year - 1} YTD (same period)` },
    }
  }
  // Custom — the prior comparison ends EXACTLY on the user's start date so
  // headers like "as of {prior.end}" line up with the picker without the
  // confusing one-day-back shift the earlier version introduced.
  const cStart = customStart || isoDate(year, 1, 1)
  const cEnd = customEnd || today
  const ms = new Date(cEnd + 'T00:00:00Z').getTime() - new Date(cStart + 'T00:00:00Z').getTime()
  const spanDays = Math.round(ms / (24 * 3600 * 1000)) + 1
  const prevEnd = cStart
  const prevStart = addDaysISO(prevEnd, -(spanDays - 1))
  return {
    current: { start: cStart, end: cEnd, label: `${cStart} to ${cEnd}` },
    prior:   { start: prevStart, end: prevEnd, label: `${prevStart} to ${prevEnd}` },
  }
}

// ── Snapshot helpers ──────────────────────────────────────────
function snapshotAtOrBefore(snapshots, dateISO) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  let chosen = null
  for (const s of sorted) {
    if (s.date <= dateISO) chosen = s
    else break
  }
  return chosen
}

function balanceSheetAt(data, dateISO, baseCurrency) {
  const snap = snapshotAtOrBefore(data.snapshots, dateISO)
  if (snap) return { ...snap, fromSnapshot: true }
  return computeNetWorthAsOf(data, dateISO, baseCurrency)
}

// Per-asset and per-liability values at a given date so the Balance Sheet
// can show line-item comparisons (not just totals).
function assetsByClassAt(data, dateISO, baseCurrency) {
  const txnsUpTo = data.transactions.filter(t => (t.date || '') <= dateISO)
  const map = {}
  for (const asset of data.assets) {
    const firstTxn = txnsUpTo
      .filter(t => t.assetId === asset.id)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]
    const purchaseDate = asset.purchaseDate || firstTxn?.date
    if (!firstTxn && (!purchaseDate || purchaseDate > dateISO)) continue
    const h = calculateAssetHolding(
      { ...asset }, txnsUpTo, data.pricesCache || {}, data.fxCache || {}, baseCurrency
    )
    if (!h.currentValueBase) continue
    const cls = asset.class || 'other'
    if (!map[cls]) map[cls] = { total: 0, items: [] }
    map[cls].total += h.currentValueBase || 0
    map[cls].items.push({
      id: asset.id,
      name: asset.name || asset.symbol || 'Asset',
      symbol: asset.symbol,
      valueBase: h.currentValueBase || 0,
    })
  }
  return map
}

function liabilitiesAt(data, dateISO, baseCurrency) {
  // Reuse the same start-date inference as computeNetWorthAsOf so a mortgage
  // doesn't appear before the property it backs.
  const inferStart = (l) => {
    if (l.startDate) return l.startDate
    const lname = (l.name || '').toLowerCase()
    if (lname) {
      const words = lname.split(/\s+/).filter(w => w.length >= 4)
      for (const a of data.assets) {
        const aname = (a.name || '').toLowerCase()
        if (l.type === 'mortgage' && a.class !== 'property') continue
        if (words.some(w => aname.includes(w))) {
          const firstTxn = data.transactions
            .filter(t => t.assetId === a.id)
            .sort((x, y) => (x.date || '').localeCompare(y.date || ''))[0]
          return a.purchaseDate || firstTxn?.date || ''
        }
      }
    }
    const earliest = data.transactions.map(t => t.date).filter(Boolean).sort()[0]
    return earliest || ''
  }
  return data.liabilities
    .filter(l => {
      const start = inferStart(l)
      return !start || start <= dateISO
    })
    .map(l => {
      const rate = getFxRate(l.currency, baseCurrency, data.fxCache || {})
      return {
        id: l.id,
        name: l.name || 'Liability',
        type: l.type,
        balanceBase: (parseFloat(l.balance) || 0) * rate,
      }
    })
}

// ── Income / realized calculations scoped to period ───────────
function computeIncomeForPeriod(transactions, assets, fxCache, baseCurrency, start, end) {
  const byType = {}
  let total = 0
  for (const t of transactions) {
    if (!INCOME_TYPES.includes(t.type)) continue
    if (!t.date || t.date < start || t.date > end) continue
    const asset = assets.find(a => a.id === t.assetId)
    const currency = asset?.currency || 'USD'
    const amount = (parseFloat(t.totalValue) || parseFloat(t.price) || 0) * getFxRate(currency, baseCurrency, fxCache)
    byType[t.type] = (byType[t.type] || 0) + amount
    total += amount
  }
  return { byType, total }
}

function computeRealizedForPeriod(realizedRows, start, end) {
  return realizedRows
    .filter(r => r.date >= start && r.date <= end)
    .reduce((s, r) => s + (r.realizedBase || 0), 0)
}

// ── Balance sheet assembly ────────────────────────────────────
function pctDelta(curr, prev) {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function DeltaCell({ curr, prev, cur }) {
  const delta = (curr || 0) - (prev || 0)
  const pct = pctDelta(curr, prev)
  const cls = delta > 0 ? 'gain' : delta < 0 ? 'loss' : ''
  return (
    <td className={`text-right ${cls}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatCurrency(delta, cur)}
      {pct !== null && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>({formatPct(pct)})</span>}
    </td>
  )
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function Reports() {
  const { data, holdings, netWorthStats } = usePortfolio()
  const cur = data.settings.baseCurrency
  const [period, setPeriod] = useState('YTD')
  const [customStart, setCustomStart] = useState(`${new Date().getFullYear()}-01-01`)
  const [customEnd, setCustomEnd] = useState(todayISO())
  const [exportScope, setExportScope] = useState('both')
  const [momYear, setMomYear] = useState(new Date().getFullYear())

  const ranges = useMemo(() => getPeriodRanges(period, customStart, customEnd),
    [period, customStart, customEnd])

  const currentSnap = useMemo(() => balanceSheetAt(data, ranges.current.end, cur),
    [data, ranges.current.end, cur])
  const priorSnap = useMemo(() => balanceSheetAt(data, ranges.prior.end, cur),
    [data, ranges.prior.end, cur])

  const liveTotalAssets = netWorthStats.totalAssetsBase
  const liveTotalLiab = netWorthStats.totalLiabilitiesBase
  const liveNetWorth = netWorthStats.netWorthBase

  const useLiveCurrent = ranges.current.end >= todayISO()
  const bsCurrent = useLiveCurrent
    ? { totalAssets: liveTotalAssets, totalLiabilities: liveTotalLiab, netWorth: liveNetWorth, isLive: true }
    : currentSnap
      ? { totalAssets: currentSnap.totalAssets, totalLiabilities: currentSnap.totalLiabilities, netWorth: currentSnap.netWorth, isLive: false }
      : { totalAssets: liveTotalAssets, totalLiabilities: liveTotalLiab, netWorth: liveNetWorth, isLive: true }

  const bsPrior = priorSnap
    ? { totalAssets: priorSnap.totalAssets, totalLiabilities: priorSnap.totalLiabilities, netWorth: priorSnap.netWorth }
    : null

  // Current period: use live holdings (matches metric cards exactly)
  const assetsByClass = useMemo(() => {
    const map = {}
    for (const h of holdings) {
      const cls = h.class || 'other'
      if (!map[cls]) map[cls] = { total: 0, items: [] }
      map[cls].total += h.currentValueBase || 0
      map[cls].items.push({
        id: h.id, name: h.name || h.symbol, symbol: h.symbol,
        valueBase: h.currentValueBase || 0,
      })
    }
    return map
  }, [holdings])

  // Prior period: reconstruct per-class assets at the prior date so we can
  // populate the comparison column for every line item (not just totals).
  const assetsByClassPrior = useMemo(
    () => assetsByClassAt(data, ranges.prior.end, cur),
    [data, ranges.prior.end, cur]
  )

  const liabilitiesRows = useMemo(() => {
    return data.liabilities.map(l => {
      const rate = getFxRate(l.currency, cur, data.fxCache)
      return { ...l, balanceBase: (parseFloat(l.balance) || 0) * rate }
    })
  }, [data.liabilities, data.fxCache, cur])

  const liabilitiesPrior = useMemo(
    () => liabilitiesAt(data, ranges.prior.end, cur),
    [data, ranges.prior.end, cur]
  )

  // Convenience lookup: prior balance for a current asset/liability by id
  const priorAssetById = useMemo(() => {
    const m = {}
    for (const cls of Object.values(assetsByClassPrior)) {
      for (const it of cls.items) m[it.id] = it.valueBase
    }
    return m
  }, [assetsByClassPrior])
  const priorLiabilityById = useMemo(
    () => Object.fromEntries(liabilitiesPrior.map(l => [l.id, l.balanceBase])),
    [liabilitiesPrior]
  )

  const realizedAll = useMemo(() =>
    getRealizedPnLPerSale(data.transactions, data.assets, data.fxCache, cur),
    [data.transactions, data.assets, data.fxCache, cur])

  const incomeCurrent = useMemo(() =>
    computeIncomeForPeriod(data.transactions, data.assets, data.fxCache, cur, ranges.current.start, ranges.current.end),
    [data.transactions, data.assets, data.fxCache, cur, ranges.current.start, ranges.current.end])
  const incomePrior = useMemo(() =>
    computeIncomeForPeriod(data.transactions, data.assets, data.fxCache, cur, ranges.prior.start, ranges.prior.end),
    [data.transactions, data.assets, data.fxCache, cur, ranges.prior.start, ranges.prior.end])

  const realizedCurrent = useMemo(() => computeRealizedForPeriod(realizedAll, ranges.current.start, ranges.current.end), [realizedAll, ranges.current])
  const realizedPrior = useMemo(() => computeRealizedForPeriod(realizedAll, ranges.prior.start, ranges.prior.end), [realizedAll, ranges.prior])

  const netIncomeCurrent = incomeCurrent.total + realizedCurrent
  const netIncomePrior = incomePrior.total + realizedPrior

  const bsCurrentStartSnap = useMemo(() => balanceSheetAt(data, addDaysISO(ranges.current.start, -1), cur), [data, ranges.current.start, cur])
  const bsPriorStartSnap = useMemo(() => balanceSheetAt(data, addDaysISO(ranges.prior.start, -1), cur), [data, ranges.prior.start, cur])

  const changeNetWorthCurrent = bsCurrentStartSnap && bsCurrent
    ? bsCurrent.netWorth - bsCurrentStartSnap.netWorth
    : null
  const changeNetWorthPrior = bsPriorStartSnap && bsPrior
    ? bsPrior.netWorth - bsPriorStartSnap.netWorth
    : null

  const unexplainedCurrent = changeNetWorthCurrent !== null ? changeNetWorthCurrent - netIncomeCurrent : null
  const unexplainedPrior = changeNetWorthPrior !== null ? changeNetWorthPrior - netIncomePrior : null

  const typeLabel = (t) => TRANSACTION_TYPES.find(x => x.value === t)?.label || t

  // ── MoM 12-month data for selected year ──────────────────────
  const todayStr = todayISO()
  const momMonthlyData = useMemo(() => {
    return MONTH_NAMES.map((name, idx) => {
      const m = idx + 1
      const lastDay = daysInMonth(momYear, m)
      const endDate = isoDate(momYear, m, lastDay)
      const startDate = isoDate(momYear, m, 1)
      const isFuture = startDate > todayStr
      const isCurrentMonth = todayStr >= startDate && todayStr <= endDate

      if (isFuture) return { name, endDate, startDate, isFuture: true, isCurrentMonth: false }

      const bs = isCurrentMonth
        ? { totalAssets: bsCurrent.totalAssets, totalLiabilities: bsCurrent.totalLiabilities, netWorth: bsCurrent.netWorth }
        : balanceSheetAt(data, endDate, cur)
      const income = computeIncomeForPeriod(data.transactions, data.assets, data.fxCache, cur, startDate, endDate)
      const realized = computeRealizedForPeriod(realizedAll, startDate, endDate)

      return {
        name,
        endDate,
        startDate,
        isFuture: false,
        isCurrentMonth,
        netWorth: bs?.netWorth ?? null,
        totalAssets: bs?.totalAssets ?? null,
        totalLiabilities: bs?.totalLiabilities ?? null,
        income: income.total,
        realized,
      }
    })
  }, [momYear, data, cur, realizedAll, bsCurrent, todayStr])

  // ── CSV export ──────────────────────────────────────────────
  function escapeCsv(v) {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  function toCsvRow(arr) { return arr.map(escapeCsv).join(',') }

  function exportCsv() {
    const rows = []
    rows.push([`Financial Report — ${ranges.current.label}`])
    rows.push([`Generated`, new Date().toISOString()])
    rows.push([`Base Currency`, cur])
    rows.push([`Sections`, exportScope === 'both' ? 'Balance Sheet + Income Statement' : exportScope === 'balance' ? 'Balance Sheet only' : 'Income Statement only'])
    rows.push([])

    if (exportScope !== 'income') {
      rows.push(['BALANCE SHEET (as of ' + ranges.current.end + ')'])
      rows.push(['Section', 'Item', ranges.current.end, ranges.prior.end, 'Delta'])
      for (const cls of ASSET_CLASSES) {
        const grp = assetsByClass[cls.value]
        const priorGrp = assetsByClassPrior[cls.value]
        if ((!grp || grp.total === 0) && (!priorGrp || priorGrp.total === 0)) continue
        const currTotal = grp?.total || 0
        const priorTotal = priorGrp?.total || 0
        rows.push(['Assets', cls.label + ' (subtotal)', currTotal.toFixed(2), priorTotal.toFixed(2), (currTotal - priorTotal).toFixed(2)])
        // Union of items so sold-out assets still appear with prior value
        const allIds = new Set([
          ...((grp?.items || []).map(i => i.id)),
          ...((priorGrp?.items || []).map(i => i.id)),
        ])
        for (const id of allIds) {
          const c = (grp?.items || []).find(i => i.id === id)
          const p = (priorGrp?.items || []).find(i => i.id === id)
          const name = c?.name || p?.name || c?.symbol || p?.symbol || id
          // Items expose `valueBase` (set by both assetsByClass + assetsByClassAt).
          // The previous code read `currentValueBase` which doesn't exist on these
          // items — every line item exported as $0.00.
          const cv = c?.valueBase || 0
          const pv = p?.valueBase || 0
          rows.push(['Assets', '  ' + name, cv.toFixed(2), pv.toFixed(2), (cv - pv).toFixed(2)])
        }
      }
      rows.push(['Assets', 'TOTAL ASSETS', bsCurrent.totalAssets.toFixed(2), bsPrior ? bsPrior.totalAssets.toFixed(2) : '', bsPrior ? (bsCurrent.totalAssets - bsPrior.totalAssets).toFixed(2) : ''])
      // Union of current + prior liabilities so closed/paid-off ones still appear
      const allLiabIds = new Set([
        ...liabilitiesRows.map(l => l.id),
        ...liabilitiesPrior.map(l => l.id),
      ])
      for (const id of allLiabIds) {
        const c = liabilitiesRows.find(l => l.id === id)
        const p = liabilitiesPrior.find(l => l.id === id)
        const name = c?.name || p?.name || 'Liability'
        const cv = c?.balanceBase || 0
        const pv = p?.balanceBase || 0
        rows.push(['Liabilities', name, cv.toFixed(2), pv.toFixed(2), (cv - pv).toFixed(2)])
      }
      rows.push(['Liabilities', 'TOTAL LIABILITIES', bsCurrent.totalLiabilities.toFixed(2), bsPrior ? bsPrior.totalLiabilities.toFixed(2) : '', bsPrior ? (bsCurrent.totalLiabilities - bsPrior.totalLiabilities).toFixed(2) : ''])
      rows.push(['Equity', 'NET WORTH', bsCurrent.netWorth.toFixed(2), bsPrior ? bsPrior.netWorth.toFixed(2) : '', bsPrior ? (bsCurrent.netWorth - bsPrior.netWorth).toFixed(2) : ''])
      rows.push([])
    }

    if (exportScope !== 'balance') {
      rows.push(['INCOME STATEMENT (' + ranges.current.start + ' to ' + ranges.current.end + ')'])
      rows.push(['Line Item', ranges.current.start + ' – ' + ranges.current.end, ranges.prior.start + ' – ' + ranges.prior.end, 'Delta'])
      for (const t of INCOME_TYPES) {
        const c = incomeCurrent.byType[t] || 0
        const p = incomePrior.byType[t] || 0
        if (c === 0 && p === 0) continue
        rows.push([typeLabel(t), c.toFixed(2), p.toFixed(2), (c - p).toFixed(2)])
      }
      rows.push(['Total Revenue', incomeCurrent.total.toFixed(2), incomePrior.total.toFixed(2), (incomeCurrent.total - incomePrior.total).toFixed(2)])
      rows.push(['Realized P&L', realizedCurrent.toFixed(2), realizedPrior.toFixed(2), (realizedCurrent - realizedPrior).toFixed(2)])
      rows.push(['Net Income', netIncomeCurrent.toFixed(2), netIncomePrior.toFixed(2), (netIncomeCurrent - netIncomePrior).toFixed(2)])
      if (changeNetWorthCurrent !== null) rows.push(['Change in Net Worth', changeNetWorthCurrent.toFixed(2), changeNetWorthPrior !== null ? changeNetWorthPrior.toFixed(2) : '', ''])
      if (unexplainedCurrent !== null) rows.push(['Market Movement / Revaluation (unexplained)', unexplainedCurrent.toFixed(2), unexplainedPrior !== null ? unexplainedPrior.toFixed(2) : '', ''])
      rows.push([])
    }

    // MoM year summary
    rows.push([`MONTH-ON-MONTH BALANCES — ${momYear}`])
    rows.push(['Metric', ...MONTH_NAMES])
    const momRowDefs = [
      ['Net Worth',         m => m.netWorth],
      ['Total Assets',      m => m.totalAssets],
      ['Total Liabilities', m => m.totalLiabilities],
      ['Income',            m => m.income],
      ['Realized P&L',      m => m.realized],
    ]
    for (const [label, getter] of momRowDefs) {
      rows.push([label, ...momMonthlyData.map(m => m.isFuture ? '' : (getter(m) ?? 0).toFixed(2))])
    }

    const csv = rows.map(toCsvRow).join('\n')
    const stamp = todayISO().replace(/-/g, '')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report-${stamp}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  function doPrint() { window.print() }

  // ── Render ──────────────────────────────────────────────────
  const numStyle = { fontVariantNumeric: 'tabular-nums', textAlign: 'right' }
  const sectionCardStyle = {}
  const hideBalance = exportScope === 'income'
  const hideIncome  = exportScope === 'balance'
  const hideCompare = exportScope !== 'both'

  return (
    <div className="reports-page">
      <div className="page-header no-print">
        <div>
          <div className="page-title">Financial Reports</div>
          <div className="page-subtitle">Balance sheet, income statement, and period comparisons</div>
        </div>
        <div className="flex gap-8 no-print" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <CurrencyToggle />
          <select
            value={exportScope}
            onChange={e => setExportScope(e.target.value)}
            title="Choose which statement(s) to print/export"
            style={{ padding: '6px 10px' }}
          >
            <option value="both">Both statements</option>
            <option value="balance">Balance Sheet only</option>
            <option value="income">Income Statement only</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv}>Export CSV</button>
          <button className="btn btn-primary btn-sm" onClick={doPrint}>Print / PDF</button>
        </div>
      </div>

      {/* Print cover header */}
      <div className="print-only report-print-header" style={{ display: 'none' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#555' }}>
            Personal Financial Statement
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 4px', letterSpacing: '0.02em' }}>
            {exportScope === 'balance' ? 'Balance Sheet'
              : exportScope === 'income' ? 'Income Statement'
              : 'Balance Sheet & Income Statement'}
          </h1>
          <div style={{ fontSize: 13 }}>
            For the period {ranges.current.start} to {ranges.current.end}
          </div>
          <div style={{ fontSize: 11, marginTop: 6, color: '#555' }}>
            Reporting currency: {cur} · Prepared {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="card mb-16 no-print" style={{ padding: 14 }}>
        <div className="flex gap-8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="fw-600 fs-13" style={{ marginRight: 8 }}>Period:</div>
          {['YTD', 'MoM', 'YoY', 'Custom'].map(p => (
            <button
              key={p}
              className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPeriod(p)}
            >{p}</button>
          ))}
          {period === 'Custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ width: 'auto' }} />
              <span className="muted">to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ width: 'auto' }} />
            </>
          )}
          <div className="muted fs-12" style={{ marginLeft: 'auto' }}>
            {ranges.current.start} → {ranges.current.end} · Prior: {ranges.prior.start} → {ranges.prior.end}
          </div>
        </div>
      </div>

      {/* Balance Sheet */}
      <div className={`card mb-16 ${hideBalance ? 'report-hide-section' : ''}`} style={sectionCardStyle}>
        <div className="card-header no-print">
          <div className="fs-12 muted">
            As of {ranges.current.end} {bsCurrent.isLive && <span className="accent-text">(live)</span>}
          </div>
          <div className="fs-12 muted">vs {ranges.prior.end}</div>
        </div>

        <div className="grid-2" style={{ gap: 20 }}>
          {/* Assets */}
          <div>
            <div className="fw-700 fs-13" style={{ marginBottom: 8, borderBottom: '2px solid var(--border)', paddingBottom: 6 }}>ASSETS</div>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">{ranges.current.end}</th>
                  <th className="text-right">{ranges.prior.end}</th>
                  <th className="text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {ASSET_CLASSES.map(cls => {
                  const grp = assetsByClass[cls.value]
                  const priorGrp = assetsByClassPrior[cls.value]
                  if ((!grp || grp.total === 0) && (!priorGrp || priorGrp.total === 0)) return null
                  const currTotal = grp?.total || 0
                  const priorTotal = priorGrp?.total || 0
                  // Union of items across current + prior (so a sold asset
                  // still appears with its prior value and a $0 / Δ negative)
                  const allIds = new Set([
                    ...((grp?.items || []).map(i => i.id)),
                    ...((priorGrp?.items || []).map(i => i.id)),
                  ])
                  const items = [...allIds].map(id => {
                    const c = (grp?.items || []).find(i => i.id === id)
                    const p = (priorGrp?.items || []).find(i => i.id === id)
                    return {
                      id,
                      name: c?.name || p?.name,
                      symbol: c?.symbol || p?.symbol,
                      curr: c?.valueBase || 0,
                      prev: p?.valueBase || 0,
                    }
                  }).sort((a, b) => b.curr - a.curr)
                  return (
                    <React.Fragment key={cls.value}>
                      <tr>
                        <td className="fw-600">{cls.label}</td>
                        <td style={numStyle} className="fw-600">{formatCurrency(currTotal, cur)}</td>
                        <td style={numStyle} className="fw-600 muted">{formatCurrency(priorTotal, cur)}</td>
                        <DeltaCell curr={currTotal} prev={priorTotal} cur={cur} />
                      </tr>
                      {items.map(it => (
                        <tr key={it.id}>
                          <td className="muted" style={{ paddingLeft: 24, fontSize: 12 }}>{it.name || it.symbol}</td>
                          <td style={{ ...numStyle, fontSize: 12 }} className="muted">{formatCurrency(it.curr, cur)}</td>
                          <td style={{ ...numStyle, fontSize: 12 }} className="muted">{formatCurrency(it.prev, cur)}</td>
                          <DeltaCell curr={it.curr} prev={it.prev} cur={cur} />
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="fw-700">Total Assets</td>
                  <td style={numStyle} className="fw-700">{formatCurrency(bsCurrent.totalAssets, cur)}</td>
                  <td style={numStyle}>{bsPrior ? formatCurrency(bsPrior.totalAssets, cur) : <span className="muted">—</span>}</td>
                  {bsPrior
                    ? <DeltaCell curr={bsCurrent.totalAssets} prev={bsPrior.totalAssets} cur={cur} />
                    : <td style={numStyle} className="muted">—</td>}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Liabilities + Net Worth */}
          <div>
            <div className="fw-700 fs-13" style={{ marginBottom: 8, borderBottom: '2px solid var(--border)', paddingBottom: 6 }}>LIABILITIES &amp; EQUITY</div>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">{ranges.current.end}</th>
                  <th className="text-right">{ranges.prior.end}</th>
                  <th className="text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {liabilitiesRows.length === 0 && liabilitiesPrior.length === 0 && (
                  <tr><td className="muted" colSpan={4}>No liabilities</td></tr>
                )}
                {(() => {
                  const allIds = new Set([
                    ...liabilitiesRows.map(l => l.id),
                    ...liabilitiesPrior.map(l => l.id),
                  ])
                  return [...allIds].map(id => {
                    const c = liabilitiesRows.find(l => l.id === id)
                    const p = liabilitiesPrior.find(l => l.id === id)
                    const name = c?.name || p?.name
                    const curr = c?.balanceBase || 0
                    const prev = p?.balanceBase || 0
                    return (
                      <tr key={id}>
                        <td>{name}</td>
                        <td style={numStyle}>{formatCurrency(curr, cur)}</td>
                        <td style={numStyle} className="muted">{formatCurrency(prev, cur)}</td>
                        <DeltaCell curr={curr} prev={prev} cur={cur} />
                      </tr>
                    )
                  })
                })()}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="fw-700">Total Liabilities</td>
                  <td style={numStyle} className="fw-700">{formatCurrency(bsCurrent.totalLiabilities, cur)}</td>
                  <td style={numStyle}>{bsPrior ? formatCurrency(bsPrior.totalLiabilities, cur) : <span className="muted">—</span>}</td>
                  {bsPrior
                    ? <DeltaCell curr={bsCurrent.totalLiabilities} prev={bsPrior.totalLiabilities} cur={cur} />
                    : <td style={numStyle} className="muted">—</td>}
                </tr>
                <tr style={{ borderTop: '3px double var(--border-light)', background: 'var(--accent-dim)' }}>
                  <td className="fw-700 accent-text">NET WORTH</td>
                  <td style={numStyle} className="fw-700 accent-text">{formatCurrency(bsCurrent.netWorth, cur)}</td>
                  <td style={numStyle} className="fw-600">{bsPrior ? formatCurrency(bsPrior.netWorth, cur) : <span className="muted">—</span>}</td>
                  {bsPrior
                    ? <DeltaCell curr={bsCurrent.netWorth} prev={bsPrior.netWorth} cur={cur} />
                    : <td style={numStyle} className="muted">—</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Income Statement */}
      <div className={`card mb-16 ${hideIncome ? 'report-hide-section' : ''}`} style={sectionCardStyle}>
        <div className="card-header no-print">
          <div className="fs-12 muted">{ranges.current.start} – {ranges.current.end}</div>
          <div className="fs-12 muted">vs {ranges.prior.start} – {ranges.prior.end}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Line Item</th>
              <th className="text-right">{ranges.current.start} – {ranges.current.end}</th>
              <th className="text-right">{ranges.prior.start} – {ranges.prior.end}</th>
              <th className="text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-700" colSpan={4} style={{ background: 'var(--surface)' }}>Revenue / Income</td>
            </tr>
            {INCOME_TYPES.map(t => {
              const c = incomeCurrent.byType[t] || 0
              const p = incomePrior.byType[t] || 0
              if (c === 0 && p === 0) return null
              return (
                <tr key={t}>
                  <td style={{ paddingLeft: 24 }}>{typeLabel(t)}</td>
                  <td style={numStyle}>{formatCurrency(c, cur)}</td>
                  <td style={numStyle} className="muted">{formatCurrency(p, cur)}</td>
                  <DeltaCell curr={c} prev={p} cur={cur} />
                </tr>
              )
            })}
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td className="fw-600">Total Revenue</td>
              <td style={numStyle} className="fw-600">{formatCurrency(incomeCurrent.total, cur)}</td>
              <td style={numStyle} className="fw-600 muted">{formatCurrency(incomePrior.total, cur)}</td>
              <DeltaCell curr={incomeCurrent.total} prev={incomePrior.total} cur={cur} />
            </tr>

            <tr>
              <td className="fw-700" colSpan={4} style={{ background: 'var(--surface)' }}>Realized Gains / Losses</td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 24 }}>Realized P&amp;L from sales</td>
              <td style={numStyle} className={realizedCurrent >= 0 ? 'gain' : 'loss'}>{formatCurrency(realizedCurrent, cur)}</td>
              <td style={numStyle} className="muted">{formatCurrency(realizedPrior, cur)}</td>
              <DeltaCell curr={realizedCurrent} prev={realizedPrior} cur={cur} />
            </tr>

            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td className="fw-700">Net Income</td>
              <td style={numStyle} className={`fw-700 ${netIncomeCurrent >= 0 ? 'gain' : 'loss'}`}>{formatCurrency(netIncomeCurrent, cur)}</td>
              <td style={numStyle} className="fw-600 muted">{formatCurrency(netIncomePrior, cur)}</td>
              <DeltaCell curr={netIncomeCurrent} prev={netIncomePrior} cur={cur} />
            </tr>

            {changeNetWorthCurrent !== null && (
              <>
                <tr>
                  <td className="fw-700" colSpan={4} style={{ background: 'var(--surface)' }}>Unrealized / Market Movement</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: 24 }} className="muted">Market movement / revaluation (unexplained)</td>
                  <td style={numStyle} className={unexplainedCurrent >= 0 ? 'gain' : 'loss'}>{formatCurrency(unexplainedCurrent, cur)}</td>
                  <td style={numStyle} className="muted">{unexplainedPrior !== null ? formatCurrency(unexplainedPrior, cur) : '—'}</td>
                  <td style={numStyle} className="muted"></td>
                </tr>
                <tr style={{ borderTop: '3px double var(--border-light)', background: 'var(--accent-dim)' }}>
                  <td className="fw-700 accent-text">Change in Net Worth</td>
                  <td style={numStyle} className={`fw-700 ${changeNetWorthCurrent >= 0 ? 'gain' : 'loss'}`}>{formatCurrency(changeNetWorthCurrent, cur)}</td>
                  <td style={numStyle} className="fw-600">{changeNetWorthPrior !== null ? formatCurrency(changeNetWorthPrior, cur) : <span className="muted">—</span>}</td>
                  <td style={numStyle} className="muted"></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        {changeNetWorthCurrent === null && (
          <div className="fs-12 muted" style={{ marginTop: 8 }}>
            Note: Unrealized change requires snapshot history at period boundaries; not enough data available.
          </div>
        )}
      </div>

      {/* Month-on-Month: full year horizontal view */}
      <div className="card mb-16 no-print">
        <div className="card-header">
          <div className="card-title">Month-on-Month — {momYear}</div>
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setMomYear(y => y - 1)}>‹ {momYear - 1}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setMomYear(y => y + 1)} disabled={momYear >= new Date().getFullYear()}>{momYear + 1} ›</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 900, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 130, textAlign: 'left' }}>Metric</th>
                {momMonthlyData.map(m => (
                  <th key={m.name} className="text-right" style={{
                    minWidth: 90,
                    background: m.isCurrentMonth ? 'var(--accent-dim)' : undefined,
                    color: m.isCurrentMonth ? 'var(--accent)' : undefined,
                  }}>
                    {m.name}
                    {m.isCurrentMonth && <span style={{ display: 'block', fontSize: 9, fontWeight: 400, opacity: 0.7 }}>current</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Net Worth',         key: 'netWorth' },
                { label: 'Total Assets',      key: 'totalAssets' },
                { label: 'Total Liabilities', key: 'totalLiabilities' },
                { label: 'Income',            key: 'income' },
                { label: 'Realized P&L',      key: 'realized' },
              ].map(({ label, key }) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="fw-600" style={{ fontSize: 12 }}>{label}</td>
                  {momMonthlyData.map(m => {
                    if (m.isFuture) return <td key={m.name} style={numStyle} className="muted">—</td>
                    const val = m[key]
                    const isGainLoss = key === 'income' || key === 'realized'
                    const cls = isGainLoss ? (val > 0 ? 'gain' : val < 0 ? 'loss' : '') : ''
                    return (
                      <td key={m.name} style={{
                        ...numStyle,
                        background: m.isCurrentMonth ? 'var(--accent-dim)' : undefined,
                      }} className={cls}>
                        {val !== null ? formatCurrency(val, cur, true) : <span className="muted">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance Attribution — which assets drove the net-worth change */}
      <div className="card mb-16 no-print">
        <div className="card-header">
          <span className="card-title">Performance Attribution</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {ranges.current.start} → {ranges.current.end} · top contributors and detractors
          </span>
        </div>
        {(() => {
          // Diff each asset's value at current vs prior end. Group by asset id.
          const allIds = new Set([
            ...Object.values(assetsByClass).flatMap(g => g.items.map(i => i.id)),
            ...Object.values(assetsByClassPrior).flatMap(g => g.items.map(i => i.id)),
          ])
          const rows = [...allIds].map(id => {
            let curr = 0, prev = 0, name = '', cls = ''
            for (const grp of Object.values(assetsByClass)) {
              const it = grp.items.find(i => i.id === id)
              if (it) { curr = it.valueBase || 0; name = it.name || it.symbol || id; break }
            }
            for (const grp of Object.values(assetsByClassPrior)) {
              const it = grp.items.find(i => i.id === id)
              if (it) { prev = it.valueBase || 0; name = name || it.name || it.symbol || id; break }
            }
            // Find class for the badge
            const asset = data.assets.find(a => a.id === id)
            cls = asset?.class || ''
            const delta = curr - prev
            const pctOfChange = (bsCurrent.totalAssets - (bsPrior?.totalAssets || 0)) !== 0
              ? (delta / (bsCurrent.totalAssets - (bsPrior?.totalAssets || 0))) * 100
              : 0
            return { id, name, class: cls, curr, prev, delta, pctOfChange }
          })
          const movers = rows.filter(r => Math.abs(r.delta) > 0.01).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          if (movers.length === 0) {
            return (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
                No asset value changes in this period.
              </div>
            )
          }
          const top = movers.slice(0, 8)
          const totalChange = bsCurrent.totalAssets - (bsPrior?.totalAssets || 0)
          return (
            <>
              <div style={{ fontSize: 12, marginBottom: 10, color: 'var(--text-muted)' }}>
                Total asset change:{' '}
                <strong className={totalChange >= 0 ? 'gain' : 'loss'}>
                  {totalChange >= 0 ? '+' : ''}{formatCurrency(totalChange, cur)}
                </strong>
              </div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Class</th>
                    <th className="text-right">Prior</th>
                    <th className="text-right">Current</th>
                    <th className="text-right">Δ</th>
                    <th className="text-right">% of total Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.class && <span className={`badge badge-${r.class}`}>{r.class}</span>}</td>
                      <td className="text-right muted">{formatCurrency(r.prev, cur)}</td>
                      <td className="text-right">{formatCurrency(r.curr, cur)}</td>
                      <td className={`text-right fw-600 ${r.delta >= 0 ? 'gain' : 'loss'}`}>
                        {r.delta >= 0 ? '+' : ''}{formatCurrency(r.delta, cur)}
                      </td>
                      <td className="text-right muted">
                        {totalChange !== 0 ? `${r.pctOfChange.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movers.length > 8 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  Showing top 8 movers by absolute change. {movers.length - 8} more not shown.
                </div>
              )}
            </>
          )
        })()}
      </div>

      {/* Period Comparisons — screen only */}
      <div className={`card mb-16 no-print ${hideCompare ? 'report-hide-section' : ''}`} style={sectionCardStyle}>
        <div className="card-header">
          <div className="card-title">Period Comparisons</div>
        </div>
        <div className="grid-3" style={{ gap: 12 }}>
          {['YTD', 'MoM', 'YoY'].map(p => {
            const r = getPeriodRanges(p)
            const snapC = p === 'YTD' || p === 'YoY'
              ? (bsCurrent)
              : balanceSheetAt(data, r.current.end, cur)
            const snapP = balanceSheetAt(data, r.prior.end, cur)
            const incC = computeIncomeForPeriod(data.transactions, data.assets, data.fxCache, cur, r.current.start, r.current.end)
            const incP = computeIncomeForPeriod(data.transactions, data.assets, data.fxCache, cur, r.prior.start, r.prior.end)
            const rlzC = computeRealizedForPeriod(realizedAll, r.current.start, r.current.end)
            const rlzP = computeRealizedForPeriod(realizedAll, r.prior.start, r.prior.end)

            const rows = [
              ['Net Worth',         snapC?.netWorth, snapP?.netWorth],
              ['Total Assets',      snapC?.totalAssets, snapP?.totalAssets],
              ['Total Liabilities', snapC?.totalLiabilities, snapP?.totalLiabilities],
              ['Total Income',      incC.total, incP.total],
              ['Realized P&L',      rlzC, rlzP],
            ]

            const isActive = period === p
            return (
              <div key={p} className="card card-sm" style={{
                border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: isActive ? 'var(--accent-dim)' : 'var(--card)',
              }}>
                <div className="fw-700 fs-13" style={{ marginBottom: 4 }}>{p}</div>
                <div className="muted fs-12" style={{ marginBottom: 8 }}>{r.current.label} vs {r.prior.label}</div>
                <table style={{ fontSize: 12 }}>
                  <tbody>
                    {rows.map(([label, c, pr]) => {
                      const cv = c ?? 0
                      const pv = pr ?? 0
                      const d = cv - pv
                      const pct = pv ? (d / Math.abs(pv)) * 100 : null
                      const cls = d > 0 ? 'gain' : d < 0 ? 'loss' : ''
                      return (
                        <tr key={label}>
                          <td style={{ padding: '4px 0' }} className="muted">{label}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '4px 0' }}>{formatCurrency(cv, cur)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '4px 0', fontSize: 11 }} className={cls}>
                            {pct !== null ? formatPct(pct) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
