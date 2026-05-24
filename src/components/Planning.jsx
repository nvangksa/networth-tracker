import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, ASSET_CLASSES,
  getIncomeStreamsByAsset, computeRebalance,
  getFxRate,
} from '../utils/calculations.js'
import CurrencyToggle from './CurrencyToggle.jsx'
import AssetDetailModal from './modals/AssetDetailModal.jsx'
import ExpenseEditModal from './modals/ExpenseEditModal.jsx'
import SalaryStreamModal from './modals/SalaryStreamModal.jsx'
import { FinancialHealthCards } from './FinancialHealth.jsx'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))

/**
 * Planning page — forward-looking tools that turn the tracker into a
 * decision aid:
 *   1. Retirement Income Planner — visualize income gap when selling assets
 *      and cutting expenses, with bridge math at safe withdrawal rates.
 *   2. Asset Rebalancing — target allocation drift + suggested trades.
 */
export default function Planning({ onNavigate }) {
  const { data, holdings, netWorthStats, updateData } = usePortfolio()
  const cur = data.settings.baseCurrency
  const [tab, setTab] = useState('health')

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Planning</div>
          <div className="page-subtitle">
            Forward-looking tools — retirement income gap analysis and portfolio rebalancing
          </div>
        </div>
        <CurrencyToggle />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'health',     label: 'Financial Health' },
          { id: 'retirement', label: 'Retirement Income' },
          { id: 'rebalance',  label: 'Rebalancing' },
          { id: 'bondcalc',   label: 'Bond / Interest Calculator' },
        ].map(t => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'health'     && <FinancialHealthCards />}
      {tab === 'retirement' && <RetirementIncomePlanner data={data} holdings={holdings} cur={cur} onNavigate={onNavigate} />}
      {tab === 'rebalance'  && <RebalancingTool data={data} holdings={holdings} cur={cur} updateData={updateData} />}
      {tab === 'bondcalc'   && <BondInterestCalculator cur={cur} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 3. Bond / Interest Payment Calculator
// ════════════════════════════════════════════════════════════════════════
// Compounding actuary for bonds & interest-bearing accounts. Given a
// principal, an annual interest rate, a term length, a compounding
// frequency, and (optionally) recurring contributions, projects the
// schedule period by period and totals interest earned vs. contributed.
//
// Useful for: comparing CD/bond yields, modelling savings-account compound
// growth with monthly deposits, or sizing a coupon-paying bond.
function BondInterestCalculator({ cur }) {
  const [principal, setPrincipal] = useState('10000')
  const [annualRate, setAnnualRate] = useState('5')   // %
  const [years, setYears] = useState('10')
  const [frequency, setFrequency] = useState('12')    // periods per year
  const [contribution, setContribution] = useState('0') // each period
  const [mode, setMode] = useState('compound')        // 'compound' | 'simple' | 'bond'

  const FREQ_LABELS = {
    '1':   'Annually',
    '2':   'Semi-annually',
    '4':   'Quarterly',
    '12':  'Monthly',
    '26':  'Bi-weekly',
    '52':  'Weekly',
    '365': 'Daily',
  }

  const result = useMemo(() => {
    const P = parseFloat(principal) || 0
    const r = (parseFloat(annualRate) || 0) / 100
    const t = parseFloat(years) || 0
    const n = parseInt(frequency, 10) || 1
    const c = parseFloat(contribution) || 0
    if (P < 0 || t <= 0 || n <= 0) return null
    const periodicRate = r / n
    const periods = Math.round(t * n)
    const schedule = []
    let balance = P
    let totalContributed = 0
    let totalInterest = 0
    // For "bond" mode: principal stays put, every period pays a coupon
    // (periodicRate × face value) in cash. Principal returns at maturity.
    if (mode === 'bond') {
      let coupons = 0
      for (let i = 1; i <= periods; i++) {
        const coupon = P * periodicRate
        coupons += coupon
        schedule.push({
          period: i,
          contribution: 0,
          interest: coupon,
          balance: P, // bond face stays put
          cumulativeInterest: coupons,
        })
      }
      return {
        mode,
        periods, periodicRate,
        finalBalance: P,
        totalContributed: 0,
        totalInterest: coupons,
        couponPerPeriod: P * periodicRate,
        atMaturity: P + coupons,
        schedule,
      }
    }
    // Simple interest: linear, no compounding, contributions add but
    // accrue at the flat annual rate as if held to term.
    if (mode === 'simple') {
      for (let i = 1; i <= periods; i++) {
        const interestThisPeriod = (balance * periodicRate) + (c * periodicRate)
        totalContributed += c
        totalInterest += interestThisPeriod
        balance += c
        schedule.push({
          period: i,
          contribution: c,
          interest: interestThisPeriod,
          balance: balance + totalInterest,
          cumulativeInterest: totalInterest,
        })
      }
      return {
        mode,
        periods, periodicRate,
        finalBalance: P + totalContributed + totalInterest,
        totalContributed,
        totalInterest,
        schedule,
      }
    }
    // Default: compound interest with periodic contributions
    for (let i = 1; i <= periods; i++) {
      const interestThisPeriod = balance * periodicRate
      totalInterest += interestThisPeriod
      balance = balance + interestThisPeriod + c
      totalContributed += c
      schedule.push({
        period: i,
        contribution: c,
        interest: interestThisPeriod,
        balance,
        cumulativeInterest: totalInterest,
      })
    }
    return {
      mode,
      periods, periodicRate,
      finalBalance: balance,
      totalContributed,
      totalInterest,
      schedule,
    }
  }, [principal, annualRate, years, frequency, contribution, mode])

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 14, borderLeft: '3px solid var(--accent)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>Bond &amp; Interest Calculator.</strong> Compounding actuary
          for bonds, CDs, and interest-bearing savings accounts. Plug in a
          principal, an annual rate, a term length, and a compounding
          frequency to project the period-by-period interest, contributions,
          and balance.
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        {/* Inputs */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Inputs</span>
          </div>
          <div className="form-group">
            <label>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="compound">Compound interest (savings / CD)</option>
              <option value="simple">Simple interest (no compounding)</option>
              <option value="bond">Bond coupon (principal returned at maturity)</option>
            </select>
            <div className="form-hint" style={{ fontSize: 11 }}>
              {mode === 'compound' && 'Interest is added to the balance each period and earns interest in subsequent periods.'}
              {mode === 'simple'   && 'Interest accrues at the periodic rate without compounding.'}
              {mode === 'bond'     && 'Bond face value (principal) stays put; each period pays a fixed coupon in cash. Face value is returned at maturity.'}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group mb-0">
              <label>Principal / Face Value ({cur})</label>
              <input
                type="number" step="any" min="0"
                value={principal}
                onChange={e => setPrincipal(e.target.value)}
              />
            </div>
            <div className="form-group mb-0">
              <label>Annual Rate (%)</label>
              <input
                type="number" step="any" min="0" max="100"
                value={annualRate}
                onChange={e => setAnnualRate(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group mb-0">
              <label>Term (years)</label>
              <input
                type="number" step="any" min="0"
                value={years}
                onChange={e => setYears(e.target.value)}
              />
            </div>
            <div className="form-group mb-0">
              <label>Compounding Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}>
                {Object.entries(FREQ_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          {mode !== 'bond' && (
            <div className="form-group">
              <label>Contribution per period ({cur}) — optional</label>
              <input
                type="number" step="any" min="0"
                value={contribution}
                onChange={e => setContribution(e.target.value)}
                placeholder="0 for none"
              />
              <div className="form-hint" style={{ fontSize: 11 }}>
                Recurring amount added at the END of each compounding period.
                For monthly deposits with monthly compounding, just enter the
                monthly amount.
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Projection</span>
            {result && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {result.periods} periods · {FREQ_LABELS[frequency]}
              </span>
            )}
          </div>
          {!result ? (
            <div style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center', fontSize: 13 }}>
              Enter a principal, rate, and term to see the projection.
            </div>
          ) : mode === 'bond' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <Kpi label="Coupon per period" value={formatCurrency(result.couponPerPeriod, cur)} />
                <Kpi label="Total coupons" value={formatCurrency(result.totalInterest, cur)} cls="gain" />
                <Kpi label="Principal at maturity" value={formatCurrency(result.finalBalance, cur)} />
                <Kpi label="Total cash returned" value={formatCurrency(result.atMaturity, cur)} cls="accent" />
              </div>
              <div className="form-hint">
                Effective yield ≈{' '}
                <strong>
                  {(((result.atMaturity / (parseFloat(principal) || 1)) ** (1 / Math.max(parseFloat(years) || 1, 0.0001)) - 1) * 100).toFixed(2)}%
                </strong>{' '}
                per year (assuming coupons are NOT reinvested).
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <Kpi label="Final balance" value={formatCurrency(result.finalBalance, cur)} cls="accent" />
                <Kpi label="Total interest earned" value={formatCurrency(result.totalInterest, cur)} cls="gain" />
                <Kpi label="Total contributions" value={formatCurrency(result.totalContributed, cur)} />
                <Kpi label="Effective annual yield" value={(() => {
                  const P = parseFloat(principal) || 0
                  const t = parseFloat(years) || 0
                  if (P <= 0 || t <= 0) return '—'
                  const totalIn = P + result.totalContributed
                  if (totalIn <= 0) return '—'
                  return (((result.finalBalance / totalIn) ** (1 / t) - 1) * 100).toFixed(2) + '%'
                })()} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Schedule table */}
      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">Period Schedule</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Showing {Math.min(result.schedule.length, 60)} of {result.schedule.length} periods
            </span>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="text-right">Contribution</th>
                  <th className="text-right">Interest</th>
                  <th className="text-right">Cumulative Interest</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.slice(0, 60).map(row => (
                  <tr key={row.period}>
                    <td className="muted">{row.period}</td>
                    <td className="text-right">{formatCurrency(row.contribution, cur)}</td>
                    <td className="text-right gain">{formatCurrency(row.interest, cur)}</td>
                    <td className="text-right muted">{formatCurrency(row.cumulativeInterest, cur)}</td>
                    <td className="text-right fw-600">{formatCurrency(row.balance, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.schedule.length > 60 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0 0' }}>
              Truncated to the first 60 periods for readability — totals at the top still reflect the full term.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Small KPI helper for the calculator's summary cards.
function Kpi({ label, value, cls }) {
  return (
    <div style={{ padding: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div className={cls} style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 1. Retirement Income Planner
// ════════════════════════════════════════════════════════════════════════
function RetirementIncomePlanner({ data, holdings, cur, onNavigate }) {
  const [excludedAssets, setExcludedAssets] = useState(new Set())
  const [excludedExpenses, setExcludedExpenses] = useState(new Set())
  const [extraMonthlyExpenses, setExtraMonthlyExpenses] = useState('')
  // Edit modals open IN PLACE so the planner's scenario state (which assets
  // marked as sold, which expenses cut) is preserved when the user closes
  // the modal. Three independent slots cover the three editable surfaces:
  //   - asset-grouped income streams (dividend / rent / interest / staking)
  //   - salary streams (grouped by source string)
  //   - recurring expenses
  const [detailHolding, setDetailHolding] = useState(null)
  const [salarySource, setSalarySource] = useState(null) // string | '' (unsourced) | null (closed)
  const [editingExpense, setEditingExpense] = useState(null)

  // Per-asset income streams (last 12 months annualized → monthly)
  const streams = useMemo(
    () => getIncomeStreamsByAsset(data.assets, data.transactions, data.fxCache, cur, holdings),
    [data.assets, data.transactions, data.fxCache, cur, holdings]
  )

  // Monthly recurring expense per item — list each user expense converted
  // to a monthly base-currency figure so they can be toggled individually.
  // Yearly expenses divide by 12; one-time ones are excluded from "structural
  // monthly burn" (they're not recurring).
  const expenseRows = useMemo(() => {
    const WEEKS_PER_MONTH = 52 / 12
    const exps = data.expenses || []
    return exps
      .map(e => {
        const amt = parseFloat(e.amount) || 0
        const rate = getFxRate(e.currency || cur, cur, data.fxCache || {})
        const baseAmt = amt * rate
        let monthlyBase = 0
        if (e.recurrence === 'weekly')       monthlyBase = baseAmt * WEEKS_PER_MONTH
        else if (e.recurrence === 'monthly') monthlyBase = baseAmt
        else if (e.recurrence === 'yearly')  monthlyBase = baseAmt / 12
        return {
          id: e.id, name: e.name, category: e.category, recurrence: e.recurrence,
          currency: e.currency || cur, amount: amt, monthlyBase,
        }
      })
      .filter(r => r.monthlyBase > 0)
      .sort((a, b) => b.monthlyBase - a.monthlyBase)
  }, [data.expenses, data.fxCache, cur])

  const recurringMonthlyBurn = expenseRows.reduce((s, r) => s + r.monthlyBase, 0)
  const remainingExpensesFromList = expenseRows
    .filter(r => !excludedExpenses.has(r.id))
    .reduce((s, r) => s + r.monthlyBase, 0)
  // Optional adder for expenses not yet logged in the system (medical,
  // travel projections, etc.) — keeps the user from having to add them as
  // recurring expenses just to model a scenario.
  const extraExp = parseFloat(extraMonthlyExpenses) || 0
  const monthlyExpenses = remainingExpensesFromList + extraExp

  const totalMonthly = streams.reduce((s, r) => s + r.monthlyIncomeBase, 0)
  const remainingMonthly = streams
    .filter(r => !excludedAssets.has(r.id))
    .reduce((s, r) => s + r.monthlyIncomeBase, 0)
  const lostMonthly = totalMonthly - remainingMonthly
  const cutExpenses = recurringMonthlyBurn - remainingExpensesFromList

  const monthlyGap = monthlyExpenses - remainingMonthly // + means shortfall
  const annualGap = monthlyGap * 12
  // 4% rule: a $X annual gap requires $X × 25 invested to bridge sustainably
  const bridgeAt4 = annualGap * 25
  const bridgeAt5 = annualGap * 20 // 5% withdrawal — more aggressive
  const bridgeAt35 = annualGap / 0.035 // very conservative 3.5%

  // Value of assets currently being excluded — the "if you sold these,
  // here's how much capital you'd have to redeploy" number.
  const excludedValue = streams
    .filter(r => excludedAssets.has(r.id))
    .reduce((s, r) => s + r.valueBase, 0)

  function toggleAsset(id) {
    setExcludedAssets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleExpense(id) {
    setExcludedExpenses(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function resetScenario() {
    setExcludedAssets(new Set())
    setExcludedExpenses(new Set())
    setExtraMonthlyExpenses('')
  }
  const hasChanges = excludedAssets.size > 0 || excludedExpenses.size > 0 || extraMonthlyExpenses !== ''

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 14, borderLeft: '3px solid var(--accent)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>Retirement Income Stress Test.</strong> See your current monthly
          income from each asset and your recurring expenses, then{' '}
          <strong style={{ color: 'var(--accent)' }}>click any item</strong> to
          simulate selling that asset (income source) or cutting that expense.
          The visualization on the right shows the resulting income vs. your
          monthly expenses, and how much capital you'd need to bridge any gap
          at safe withdrawal rates.
        </div>
        {hasChanges && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Scenario active: {excludedAssets.size} income stream{excludedAssets.size === 1 ? '' : 's'} excluded
              {excludedExpenses.size > 0 && `, ${excludedExpenses.size} expense${excludedExpenses.size === 1 ? '' : 's'} cut`}
              {extraMonthlyExpenses !== '' && `, +${formatCurrency(extraExp, cur)} extra expenses`}
            </span>
            <button className="btn btn-xs btn-ghost" onClick={resetScenario}>
              ↺ Reset scenario
            </button>
          </div>
        )}
      </div>

      {streams.length === 0 && expenseRows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💼</div>
            <h3>Nothing to model yet</h3>
            <p>Log some income transactions (dividends, rental, interest, salary) and recurring expenses to use this planner.</p>
          </div>
        </div>
      ) : (
        <div className="grid-2" style={{ gap: 16 }}>
          {/* LEFT: Stacked income streams + expenses, both toggleable */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Income streams */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Income Streams</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  12-mo avg · {streams.length} asset{streams.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{
                fontSize: 11, color: 'var(--accent)', marginBottom: 8,
                background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 4,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                👆 <span><strong>Click any row</strong> to simulate stopping that income stream (selling the asset, or losing the salary).</span>
              </div>
              {streams.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
                  No income streams logged yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {streams.map(s => {
                    const excluded = excludedAssets.has(s.id)
                    const isSalary = s.kind === 'salary'
                    const isSourceGrouped = s.kind === 'source'
                    const isAssetGrouped = s.kind === 'asset'
                    // Asset-grouped streams resolve to a single holding and
                    // open AssetDetailModal in-place. Source-grouped or
                    // salary streams may span multiple assets, so we route
                    // to the Income page with appropriate filters.
                    const holding = isAssetGrouped ? (holdings.find(h => h.id === s.assetId) || null) : null
                    // Friendly income-type label for the badge — "Interest"
                    // beats "Cash & Savings" for clarity. Maps the dominant
                    // contributing transaction type to a short label.
                    const TYPE_LABELS = {
                      salary: 'Salary',
                      dividend: 'Dividend',
                      rental_income: 'Rent',
                      interest_income: 'Interest',
                      staking_reward: 'Staking',
                    }
                    const typeBadge = TYPE_LABELS[s.dominantType] || (CLASS_LABEL[s.class] || s.class)
                    const handleEdit = (ev) => {
                      ev.stopPropagation()
                      // ALL edit flows stay on the Planning page via modals so
                      // the user's scenario state (excluded assets/expenses) is
                      // preserved. No navigation away from this page.
                      if (isSalary) {
                        // Open the dedicated SalaryStreamModal — shows all
                        // matching salary entries (by source string), lets the
                        // user edit any of them or add new ones, with a one-
                        // click bulk-rename for legacy unsourced entries.
                        setSalarySource(s.source || '')
                      } else if (holding) {
                        // Asset-grouped: open the asset's detail modal in-place
                        setDetailHolding(holding)
                      }
                    }
                    return (
                      <div
                        key={s.id}
                        onClick={() => toggleAsset(s.id)}
                        className={`tile-toggle${excluded ? ' checked' : ''}`}
                        style={{ padding: 10, cursor: 'pointer' }}
                        role="checkbox"
                        aria-checked={excluded}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAsset(s.id) } }}
                        title={excluded
                          ? 'Click to include this income stream again'
                          : (isSalary ? 'Click to simulate losing this salary' : 'Click to simulate selling this asset')}
                      >
                        <span className="tile-toggle-box">{excluded ? '✓' : ''}</span>
                        <div style={{ flex: 1, marginLeft: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ fontWeight: 600, textDecoration: excluded ? 'line-through' : 'none', color: excluded ? 'var(--text-muted)' : 'var(--text)' }}>
                              {s.name}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`fw-600 ${excluded ? 'muted' : 'accent'}`}>
                                {excluded ? '−' : ''}{formatCurrency(s.monthlyIncomeBase, cur)}/mo
                              </span>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={handleEdit}
                                title={isSalary
                                  ? `View ${s.name} entries on the Income page`
                                  : `Edit ${s.name} — view income transactions`}
                                aria-label={`Edit ${s.name}`}
                                style={{ padding: '2px 6px', fontSize: 11 }}
                              >✎</button>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {/* Show INCOME TYPE as the badge, not the asset class.
                                "Interest" or "Dividend" is far clearer than
                                "Cash & Savings" for an interest-income stream. */}
                            <span className={`badge badge-${s.dominantType || s.class}`} style={{ marginRight: 6 }}>
                              {typeBadge}
                            </span>
                            {isSalary ? (
                              <>{s.source
                                ? <>From: <strong>{s.source}</strong></>
                                : <em>No source recorded — click ✎ to add one</em>}</>
                            ) : isSourceGrouped ? (
                              // Source-grouped non-salary stream — show source +
                              // who/what. Yields don't apply (may span assets).
                              <>From: <strong>{s.source}</strong></>
                            ) : (
                              <>
                                {s.yieldPct != null && <>Yield: <strong>{s.yieldPct.toFixed(2)}%</strong> · </>}
                                Value: {formatCurrency(s.valueBase, cur, true)}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recurring expenses — toggleable */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Recurring Expenses</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {expenseRows.length} item{expenseRows.length === 1 ? '' : 's'} · {formatCurrency(remainingExpensesFromList, cur)}/mo active
                </span>
              </div>
              <div style={{
                fontSize: 11, color: 'var(--accent)', marginBottom: 8,
                background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 4,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                👆 <span><strong>Click any row</strong> to simulate cutting that expense in retirement.</span>
              </div>
              {expenseRows.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>
                  No recurring expenses logged. Add some on the Expenses page or use the "extra" field below.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {expenseRows.map(e => {
                    const excluded = excludedExpenses.has(e.id)
                    return (
                      <div
                        key={e.id}
                        onClick={() => toggleExpense(e.id)}
                        className={`tile-toggle${excluded ? ' checked' : ''}`}
                        style={{ padding: 10, cursor: 'pointer' }}
                        role="checkbox"
                        aria-checked={excluded}
                        tabIndex={0}
                        onKeyDown={(ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleExpense(e.id) } }}
                        title={excluded ? 'Click to include this expense again' : 'Click to simulate cutting this expense'}
                      >
                        <span className="tile-toggle-box">{excluded ? '✓' : ''}</span>
                        <div style={{ flex: 1, marginLeft: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ fontWeight: 600, textDecoration: excluded ? 'line-through' : 'none', color: excluded ? 'var(--text-muted)' : 'var(--text)' }}>
                              {e.name}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`fw-600 ${excluded ? 'muted' : 'loss'}`}>
                                {excluded ? '+' : '−'}{formatCurrency(e.monthlyBase, cur)}/mo
                              </span>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={(ev) => { ev.stopPropagation(); setEditingExpense(e) }}
                                title={`Edit ${e.name}`}
                                aria-label={`Edit ${e.name}`}
                                style={{ padding: '2px 6px', fontSize: 11 }}
                              >✎</button>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            <span className="badge badge-other" style={{ marginRight: 6 }}>{e.category}</span>
                            <span style={{ textTransform: 'capitalize' }}>{e.recurrence?.replace('_', '-')}</span>
                            {' · '}{formatCurrency(e.amount, e.currency)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Visualization + gap analysis */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Extra expenses input */}
            <div className="card">
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                Extra Monthly Expenses (not in your log)
              </div>
              <input
                type="number" step="any" min="0"
                value={extraMonthlyExpenses}
                onChange={e => setExtraMonthlyExpenses(e.target.value)}
                placeholder="0 — add for medical, travel, projected lifestyle"
              />
              <div className="form-hint" style={{ marginTop: 6 }}>
                Use this to model expenses you haven't logged: healthcare premiums, projected travel, gifts. Adds on top of the recurring expenses above.
              </div>
            </div>

            {/* Visualization: income vs expenses bar */}
            <div className="card">
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12 }}>
                Income vs Expenses (after scenario)
              </div>
              <IncomeBar
                remaining={remainingMonthly}
                lost={lostMonthly}
                expenses={monthlyExpenses}
                cutExpenses={cutExpenses}
                cur={cur}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>REMAINING INCOME</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }} className="accent">
                    {formatCurrency(remainingMonthly, cur)}/mo
                  </div>
                  {lostMonthly > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--loss)', marginTop: 2 }}>
                      −{formatCurrency(lostMonthly, cur)} from sold assets
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>EXPENSES</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }} className="loss">
                    {formatCurrency(monthlyExpenses, cur)}/mo
                  </div>
                  {cutExpenses > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--gain)', marginTop: 2 }}>
                      −{formatCurrency(cutExpenses, cur)} from cuts
                    </div>
                  )}
                  {extraExp > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      +{formatCurrency(extraExp, cur)} extra
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Gap or surplus + bridge calc */}
            <div className="card" style={{
              borderLeft: `3px solid ${monthlyGap > 0 ? 'var(--loss)' : 'var(--gain)'}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                {monthlyGap > 0 ? 'Income Gap' : 'Income Surplus'}
              </div>
              <div className={monthlyGap > 0 ? 'loss' : 'gain'} style={{ fontSize: 28, fontWeight: 700 }}>
                {monthlyGap > 0 ? '−' : monthlyGap < 0 ? '+' : ''}{formatCurrency(Math.abs(monthlyGap), cur)}/mo
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                {monthlyGap > 0
                  ? `${formatCurrency(annualGap, cur)} per year shortfall after these sales`
                  : `${formatCurrency(Math.abs(annualGap), cur)} per year more income than expenses`}
              </div>

              {monthlyGap > 0 && (
                <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                    Capital needed to bridge the gap
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Conservative (3.5%)</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(bridgeAt35, cur, true)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Standard (4% rule)</div>
                      <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(bridgeAt4, cur, true)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Aggressive (5%)</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(bridgeAt5, cur, true)}</div>
                    </div>
                  </div>
                  {excludedValue > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}>
                      You'd be unlocking <strong>{formatCurrency(excludedValue, cur, true)}</strong> from
                      the assets you marked. Comparing against the standard 4% bridge of{' '}
                      <strong>{formatCurrency(bridgeAt4, cur, true)}</strong>:{' '}
                      {excludedValue >= bridgeAt4 ? (
                        <span className="gain"><strong>✓ Sufficient</strong> — proceeds cover the gap with{' '}
                        {formatCurrency(excludedValue - bridgeAt4, cur, true)} left over.</span>
                      ) : (
                        <span className="loss"><strong>✗ Insufficient</strong> — proceeds fall short by{' '}
                        {formatCurrency(bridgeAt4 - excludedValue, cur, true)}.</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {monthlyGap <= 0 && remainingMonthly > 0 && (
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  You're income-positive even after selling these. Coverage ratio:{' '}
                  <strong style={{ color: 'var(--gain)' }}>
                    {monthlyExpenses > 0 ? `${((remainingMonthly / monthlyExpenses) * 100).toFixed(0)}%` : '∞'}
                  </strong>
                  {' '}— each $1 of expenses covered by ${(remainingMonthly / Math.max(monthlyExpenses, 1)).toFixed(2)} of income.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* All edit-✎ buttons in the planner open one of these modals IN PLACE
          so the user's scenario state (which assets are toggled off, which
          expenses are cut) survives the round-trip. No navigation. */}
      {detailHolding && (
        <AssetDetailModal holding={detailHolding} onClose={() => setDetailHolding(null)} />
      )}
      {salarySource !== null && (
        <SalaryStreamModal source={salarySource} onClose={() => setSalarySource(null)} />
      )}
      {editingExpense && (
        <ExpenseEditModal expense={editingExpense} onClose={() => setEditingExpense(null)} />
      )}
    </div>
  )
}

// Visual stacked bar: income (active green + faded sold) vs expenses (active red + faded cut)
function IncomeBar({ remaining, lost, expenses, cutExpenses = 0, cur }) {
  const totalIncome = remaining + lost
  const totalExpenses = expenses + cutExpenses
  const max = Math.max(totalIncome, totalExpenses, 1)
  const remainingPct = (remaining / max) * 100
  const lostPct = (lost / max) * 100
  const expensesPct = (expenses / max) * 100
  const cutPct = (cutExpenses / max) * 100
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>INCOME</div>
      <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', marginBottom: 8, background: 'var(--bg-secondary)' }}>
        <div style={{ width: `${remainingPct}%`, background: 'var(--accent)' }} title={`Active income: ${formatCurrency(remaining, cur)}/mo`} />
        <div style={{ width: `${lostPct}%`, background: 'rgba(244, 63, 94, 0.4)', borderLeft: lost > 0 ? '1px dashed var(--loss)' : 'none' }} title={`Lost from sold assets: ${formatCurrency(lost, cur)}/mo`} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>EXPENSES</div>
      <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        <div style={{ width: `${expensesPct}%`, background: 'var(--loss)' }} title={`Active expenses: ${formatCurrency(expenses, cur)}/mo`} />
        <div style={{ width: `${cutPct}%`, background: 'rgba(14, 203, 129, 0.35)', borderLeft: cutExpenses > 0 ? '1px dashed var(--gain)' : 'none' }} title={`Cut from scenario: ${formatCurrency(cutExpenses, cur)}/mo`} />
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, fontSize: 11, marginTop: 10, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4 }} /> Active income {formatCurrency(remaining, cur)}</span>
        {lost > 0 && <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(244, 63, 94, 0.4)', borderRadius: 2, marginRight: 4 }} /> Sold income {formatCurrency(lost, cur)}</span>}
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--loss)', borderRadius: 2, marginRight: 4 }} /> Active expenses {formatCurrency(expenses, cur)}</span>
        {cutExpenses > 0 && <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(14, 203, 129, 0.35)', borderRadius: 2, marginRight: 4 }} /> Cut expenses {formatCurrency(cutExpenses, cur)}</span>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// 2. Asset Rebalancing
// ════════════════════════════════════════════════════════════════════════
function RebalancingTool({ data, holdings, cur, updateData }) {
  // Targets stored in data.settings.targetAllocation as { class: pct }
  const stored = data.settings?.targetAllocation || {}
  const [targets, setTargets] = useState(() => ({ ...stored }))
  const [tolerance, setTolerance] = useState(5) // % drift before flagging

  const result = useMemo(() => computeRebalance(holdings, targets), [holdings, targets])

  function setTarget(cls, val) {
    setTargets(t => ({ ...t, [cls]: val === '' ? undefined : Number(val) }))
  }
  function saveTargets() {
    updateData(prev => ({
      ...prev,
      settings: { ...prev.settings, targetAllocation: targets },
    }))
  }
  function applyPreset(preset) {
    setTargets(preset)
  }

  const presets = [
    { name: 'Conservative (40/60)', alloc: { stocks: 30, bonds: 50, cash: 15, property: 5 } },
    { name: 'Balanced (60/40)',     alloc: { stocks: 50, bonds: 30, cash: 10, crypto: 5, property: 5 } },
    { name: 'Aggressive (80/20)',   alloc: { stocks: 60, crypto: 15, bonds: 10, cash: 5, property: 10 } },
    { name: 'All-Weather',          alloc: { stocks: 30, bonds: 40, commodities: 15, cash: 10, property: 5 } },
  ]

  const targetSum = Object.values(targets).reduce((s, v) => s + (Number(v) || 0), 0)
  const flaggedRows = result.rows.filter(r =>
    Math.abs(r.currentPct - r.targetPct) > tolerance && (r.currentPct > 0 || r.targetPct > 0)
  )

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 14, borderLeft: '3px solid var(--accent)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>Asset Rebalancing.</strong> Set a target % for each asset class.
          The tool shows your drift from target and how much to buy or sell to
          hit it. Use a preset or punch in your own numbers.
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        {/* Targets editor */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Target Allocation</span>
            <span style={{ fontSize: 11, color: targetSum === 100 ? 'var(--gain)' : Math.abs(targetSum - 100) < 0.5 ? 'var(--text-muted)' : 'var(--loss)' }}>
              Total: {targetSum.toFixed(1)}%{targetSum === 100 ? ' ✓' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {presets.map(p => (
              <button key={p.name} type="button" className="btn btn-xs btn-ghost" onClick={() => applyPreset(p.alloc)}>
                {p.name}
              </button>
            ))}
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => setTargets({})}>Clear</button>
          </div>
          {ASSET_CLASSES.map(cls => (
            <div key={cls.value} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{cls.icon} {cls.label}</span>
              <input
                type="number" step="any" min="0" max="100"
                value={targets[cls.value] ?? ''}
                onChange={e => setTarget(cls.value, e.target.value)}
                placeholder="—"
                style={{ width: 70, textAlign: 'right' }}
              />
              <span style={{ width: 14, color: 'var(--text-muted)', fontSize: 12 }}>%</span>
            </div>
          ))}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={saveTargets}>Save Targets</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Drift threshold:{' '}
              <input
                type="number" min="0" max="50" step="1"
                value={tolerance} onChange={e => setTolerance(Number(e.target.value) || 0)}
                style={{ width: 50, display: 'inline-block', padding: '2px 6px' }}
              />%
            </span>
          </div>
        </div>

        {/* Drift + suggested trades */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Drift &amp; Suggested Trades</span>
          </div>
          {result.totalValue === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Add some assets to see drift.
            </div>
          ) : flaggedRows.length === 0 ? (
            <div style={{ color: 'var(--gain)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              ✓ Allocation is within {tolerance}% of every target. No action needed.
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Target</th>
                  <th className="text-right">Drift</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {flaggedRows.map(r => {
                  // Compute drift % from the same currentPct/targetPct displayed
                  // in the row so the sign and value are always consistent with
                  // the columns to the left. Explicit ± prefix to make over/under
                  // weight unambiguous.
                  const driftPct = r.currentPct - r.targetPct
                  const sign = driftPct > 0 ? '+' : driftPct < 0 ? '−' : ''
                  return (
                    <tr key={r.class}>
                      <td>{CLASS_LABEL[r.class] || r.class}</td>
                      <td className="text-right">{r.currentPct.toFixed(1)}%</td>
                      <td className="text-right muted">{r.targetPct.toFixed(1)}%</td>
                      <td className={`text-right fw-600 ${driftPct > 0 ? 'loss' : driftPct < 0 ? 'gain' : ''}`}>
                        {sign}{Math.abs(driftPct).toFixed(1)}%
                      </td>
                      <td className="text-right fw-600">
                        {r.driftValue > 0
                          ? <span className="loss">Sell {formatCurrency(r.driftValue, cur, true)}</span>
                          : <span className="gain">Buy {formatCurrency(-r.driftValue, cur, true)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
