import React, { useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import ExplainMetric from './ExplainMetric.jsx'
import { formatCurrency, fireProjection, getFxRate, localISO } from '../utils/calculations.js'

// Financial Health metrics — shared between Dashboard (compact one-liner)
// and Planning (full explainer cards). Centralized so the math only lives in
// one place; both surfaces can't drift.
//
// Exports:
//   useFinancialHealth() — computes the underlying numbers
//   <FinancialHealthSummary onSeeMore /> — compact 1-line summary
//   <FinancialHealthCards /> — the full set of ExplainMetric cards

export function useFinancialHealth() {
  const { data, holdings, netWorthStats } = usePortfolio()
  const cur = data.settings.baseCurrency
  const { totalAssetsBase, netWorthBase } = netWorthStats

  // Liquid = cash & savings only. Investments don't count as "accessible right
  // now" because selling them takes days and may realize losses.
  const liquidBase = useMemo(
    () => holdings.filter(h => h.class === 'cash').reduce((s, h) => s + (h.currentValueBase || 0), 0),
    [holdings]
  )

  // Monthly structural burn from recurring expenses (one-time excluded).
  const monthlyBurnBase = useMemo(() => {
    const WEEKS_PER_MONTH = 52 / 12
    const exps = data.expenses || []
    return exps.reduce((s, e) => {
      const amt = parseFloat(e.amount) || 0
      const rate = getFxRate(e.currency || cur, cur, data.fxCache || {})
      const baseAmt = amt * rate
      if (e.recurrence === 'weekly')  return s + baseAmt * WEEKS_PER_MONTH
      if (e.recurrence === 'monthly') return s + baseAmt
      if (e.recurrence === 'yearly')  return s + baseAmt / 12
      return s
    }, 0)
  }, [data.expenses, data.fxCache, cur])

  // Avg monthly take-home over the last 90 days.
  const monthlyIncomeBase = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90)
    // localISO matches the user's calendar — toISOString shifts the window
    // boundary by ±1 day for non-UTC timezones, causing edge-of-window
    // transactions to be counted in the wrong day's "last 90 days" bucket.
    const cutoffISO = localISO(cutoff)
    let total = 0
    for (const t of data.transactions) {
      if (!['salary', 'rental_income', 'dividend', 'staking_reward', 'interest_income'].includes(t.type)) continue
      if (t.date < cutoffISO) continue
      const asset = data.assets.find(a => a.id === t.assetId)
      const fromCcy = asset?.currency || 'USD'
      const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
      total += amt * getFxRate(fromCcy, cur, data.fxCache || {})
    }
    return total / 3
  }, [data.transactions, data.assets, data.fxCache, cur])

  const monthsCovered = monthlyBurnBase > 0 ? liquidBase / monthlyBurnBase : null
  const monthlyNetSavings = monthlyIncomeBase - monthlyBurnBase

  const fireResult = useMemo(() => {
    if (monthlyBurnBase <= 0) return null
    return fireProjection(netWorthBase, monthlyNetSavings, monthlyBurnBase * 12)
  }, [netWorthBase, monthlyNetSavings, monthlyBurnBase])

  const concentration = useMemo(() => {
    if (!holdings.length || totalAssetsBase <= 0) return null
    const sorted = [...holdings].sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))
    const top = sorted[0]
    const topPct = ((top.currentValueBase || 0) / totalAssetsBase) * 100
    const top3 = sorted.slice(0, 3).reduce((s, h) => s + (h.currentValueBase || 0), 0)
    const top3Pct = (top3 / totalAssetsBase) * 100
    return { top, topPct, top3Pct }
  }, [holdings, totalAssetsBase])

  const currencyExposure = useMemo(() => {
    const map = {}
    for (const h of holdings) {
      const ccy = h.currency || 'USD'
      map[ccy] = (map[ccy] || 0) + (h.currentValueBase || 0)
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([ccy, val]) => ({ ccy, val, pct: total > 0 ? (val / total) * 100 : 0 }))
      .sort((a, b) => b.val - a.val)
  }, [holdings])

  return {
    cur,
    liquidBase, monthlyBurnBase, monthlyIncomeBase,
    monthsCovered, monthlyNetSavings,
    fireResult, concentration, currencyExposure,
    netWorthBase, totalAssetsBase,
    hasAnything: monthsCovered !== null || fireResult || concentration || currencyExposure.length > 1,
  }
}

// Compact one-liner — three headline stats + a "See details" link. Designed
// to slot into a small space on the Dashboard so we don't lose the at-a-glance
// signal, while the full explainers live on Planning.
export function FinancialHealthSummary({ onSeeMore }) {
  const { monthsCovered, fireResult, concentration, hasAnything, cur, monthlyNetSavings, monthlyIncomeBase } = useFinancialHealth()
  if (!hasAnything) return null

  const items = []
  if (monthsCovered !== null) {
    const label = monthsCovered >= 100 ? '∞' : `${monthsCovered.toFixed(1)} mo`
    items.push({ k: 'Emergency fund', v: label, cls: monthsCovered >= 6 ? 'gain' : monthsCovered >= 3 ? '' : 'loss' })
  }
  if (monthlyIncomeBase > 0 && monthlyNetSavings !== 0) {
    const rate = (monthlyNetSavings / monthlyIncomeBase) * 100
    items.push({ k: 'Savings rate', v: `${rate.toFixed(0)}%`, cls: rate >= 20 ? 'gain' : rate >= 10 ? '' : 'loss' })
  }
  if (fireResult) {
    items.push({
      k: 'Years to FI',
      v: fireResult.reached ? 'Reached ✓' : isFinite(fireResult.years) ? `${fireResult.years.toFixed(0)} yrs` : '—',
      cls: fireResult.reached ? 'gain' : '',
    })
  }
  if (concentration && concentration.topPct > 5) {
    items.push({
      k: 'Top concentration',
      v: `${concentration.topPct.toFixed(0)}%`,
      cls: concentration.topPct > 30 ? 'loss' : concentration.topPct > 20 ? 'accent' : '',
    })
  }

  return (
    <div className="card" style={{
      marginBottom: 24, padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: 'var(--text-muted)',
        }}>
          Financial Health
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.k}</span>
            <span className={item.cls} style={{ fontWeight: 600, fontSize: 14 }}>{item.v}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={onSeeMore}
        style={{ whiteSpace: 'nowrap' }}
      >
        See details →
      </button>
    </div>
  )
}

// The full breakdown — used inside Planning's Financial Health tab.
export function FinancialHealthCards() {
  const {
    cur,
    liquidBase, monthlyBurnBase, monthlyIncomeBase,
    monthsCovered, monthlyNetSavings,
    fireResult, concentration, currencyExposure,
    netWorthBase, totalAssetsBase,
  } = useFinancialHealth()

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <span className="card-title">Financial Health</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          💡 Click any metric to see how it's calculated
        </span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14,
      }}>
        {monthsCovered !== null && (
          <ExplainMetric
            label="Emergency Fund"
            value={monthsCovered >= 100 ? '∞' : `${monthsCovered.toFixed(1)} mo`}
            valueClass={monthsCovered >= 6 ? 'gain' : monthsCovered >= 3 ? '' : 'loss'}
            sub={monthsCovered >= 6 ? '✓ Healthy (6+ months)' :
                 monthsCovered >= 3 ? 'Building (3–6 months)' :
                 'Below target — aim for 3+ months'}
            explanation={
              <>
                <strong>How many months your liquid cash &amp; savings would cover your recurring expenses</strong> if all
                income stopped today. We exclude investments because selling stocks in an
                emergency takes days and may force you to realize losses — only what's
                truly accessible counts. Standard guidance is to keep 3–6 months saved.
              </>
            }
            formula="Liquid cash & savings ÷ Monthly recurring expenses"
            inputs={[
              { label: 'Liquid cash & savings', value: formatCurrency(liquidBase, cur, true) },
              { label: 'Monthly recurring expenses', value: formatCurrency(monthlyBurnBase, cur, true) },
              { label: '= Months covered', value: monthsCovered >= 100 ? '∞' : `${monthsCovered.toFixed(2)} mo` },
            ]}
            interpretation={[
              { band: '< 3 mo',  label: 'Below target — build a safety buffer first', cls: 'loss',  active: monthsCovered < 3 },
              { band: '3–6 mo',  label: 'Building — solid foundation, keep growing',  cls: '',      active: monthsCovered >= 3 && monthsCovered < 6 },
              { band: '6–12 mo', label: 'Healthy — most planners recommend this',     cls: 'gain',  active: monthsCovered >= 6 && monthsCovered < 12 },
              { band: '> 12 mo', label: 'Excessive — consider investing the surplus', cls: 'accent', active: monthsCovered >= 12 },
            ]}
          />
        )}
        {monthlyNetSavings !== 0 && monthlyBurnBase > 0 && (
          <ExplainMetric
            label="Monthly Net Cashflow"
            value={`${monthlyNetSavings >= 0 ? '+' : ''}${formatCurrency(monthlyNetSavings, cur, true)}`}
            valueClass={monthlyNetSavings >= 0 ? 'gain' : 'loss'}
            sub={monthlyNetSavings >= 0 && monthlyIncomeBase > 0
              ? `${((monthlyNetSavings / monthlyIncomeBase) * 100).toFixed(0)}% savings rate`
              : monthlyNetSavings >= 0
                ? 'No income logged in the last 90 days'
                : 'Spending exceeds income (90d avg)'}
            explanation={
              <>
                <strong>How much money you have left over each month after expenses,</strong> averaged over the
                last 90 days. Income includes salary, dividends, rental, interest, and
                staking. Expenses are your recurring monthly burn (yearly expenses are
                divided by 12). A negative number means you're drawing down savings.
              </>
            }
            formula="(Income last 90 days ÷ 3 months) − Monthly recurring expenses"
            inputs={[
              { label: 'Avg monthly income (90d)', value: formatCurrency(monthlyIncomeBase, cur, true) },
              { label: 'Monthly recurring expenses', value: formatCurrency(monthlyBurnBase, cur, true) },
              { label: '= Net cashflow', value: `${monthlyNetSavings >= 0 ? '+' : ''}${formatCurrency(monthlyNetSavings, cur, true)}` },
              ...(monthlyIncomeBase > 0 ? [{ label: 'Savings rate', value: `${((monthlyNetSavings / monthlyIncomeBase) * 100).toFixed(1)}%` }] : []),
            ]}
            interpretation={[
              { band: 'Negative', label: 'Spending more than earning — patch the leak', cls: 'loss',  active: monthlyNetSavings < 0 },
              { band: '0–10%',    label: 'Saving a bit — try to push toward 20%',        cls: '',      active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0 && monthlyNetSavings / monthlyIncomeBase < 0.10 },
              { band: '10–20%',   label: 'Solid savings rate',                            cls: 'gain',  active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0.10 && monthlyNetSavings / monthlyIncomeBase < 0.20 },
              { band: '> 20%',    label: 'Excellent — accelerates FI dramatically',       cls: 'accent', active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0.20 },
            ]}
          />
        )}
        {fireResult && monthlyBurnBase > 0 && (
          <ExplainMetric
            label="Years to FI"
            value={fireResult.reached ? '✓ Reached' :
              isFinite(fireResult.years) ? `${fireResult.years.toFixed(1)} yrs` : '—'}
            valueClass={fireResult.reached ? 'gain' : isFinite(fireResult.years) ? '' : 'loss'}
            sub={`Target: ${formatCurrency(fireResult.target, cur, true)}${
              !fireResult.reached && isFinite(fireResult.years) ? ` · age-equiv +${Math.round(fireResult.years)}y` : ''
            }`}
            explanation={
              <>
                <strong>Years until your net worth reaches 25× your annual expenses</strong> — the
                "Trinity Study" 4% safe-withdrawal rule. Once you hit this number, a
                portfolio of mostly stocks &amp; bonds can sustain your current spending
                indefinitely with high probability. Assumes a 5% real (inflation-adjusted)
                return on invested assets.
              </>
            }
            formula="Solve: NetWorth × (1+r)ⁿ + Savings × ((1+r)ⁿ − 1)/r = 25 × annual expenses"
            inputs={[
              { label: 'Current net worth', value: formatCurrency(netWorthBase, cur, true) },
              { label: 'Annual expenses', value: formatCurrency(monthlyBurnBase * 12, cur, true) },
              { label: 'Target (25×)', value: formatCurrency(fireResult.target, cur, true) },
              { label: 'Monthly net savings', value: formatCurrency(monthlyNetSavings, cur, true) },
              { label: 'Assumed real return', value: '5% / yr' },
              { label: '= Years to target', value: fireResult.reached ? '0 (reached!)' :
                isFinite(fireResult.years) ? `${fireResult.years.toFixed(2)} yrs` : 'Need positive savings' },
            ]}
            interpretation={[
              { band: 'Reached', label: 'You can stop working — congrats!',     cls: 'gain', active: fireResult.reached },
              { band: '< 10 yr', label: 'Close — minor tweaks accelerate this', cls: 'gain', active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years < 10 },
              { band: '10–20 yr', label: 'On track — common range',             cls: '',     active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 10 && fireResult.years < 20 },
              { band: '20–30 yr', label: 'Long horizon — increase savings rate', cls: '',    active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 20 && fireResult.years < 30 },
              { band: '> 30 yr',  label: 'Very long — review savings rate',     cls: 'loss', active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 30 },
              { band: 'Never',    label: "Spending exceeds saving — can't get there", cls: 'loss', active: !isFinite(fireResult.years) },
            ]}
          />
        )}
        {concentration && concentration.topPct > 5 && (
          <ExplainMetric
            label="Concentration"
            value={`${concentration.topPct.toFixed(0)}%`}
            valueClass={concentration.topPct > 30 ? 'loss' : concentration.topPct > 20 ? 'accent' : ''}
            sub={`${concentration.top.name}${concentration.topPct > 30 ? ' · consider diversifying' : ''}`}
            explanation={
              <>
                <strong>How much of your total assets are tied up in your single largest holding.</strong> High
                concentration amplifies single-asset risk: if that one position drops 50%,
                so does that share of your net worth. Most advisors suggest keeping any
                single position below 20–25% of your portfolio.
              </>
            }
            formula="Largest holding value ÷ Total assets"
            inputs={[
              { label: 'Largest holding', value: concentration.top.name },
              { label: '  Value', value: formatCurrency(concentration.top.currentValueBase || 0, cur, true) },
              { label: 'Total assets', value: formatCurrency(totalAssetsBase, cur, true) },
              { label: '= Top-1 concentration', value: `${concentration.topPct.toFixed(1)}%` },
              { label: 'Top-3 concentration', value: `${concentration.top3Pct.toFixed(1)}%` },
            ]}
            interpretation={[
              { band: '< 10%',  label: 'Well diversified',                              cls: 'gain',   active: concentration.topPct < 10 },
              { band: '10–20%', label: 'Reasonable for a conviction position',         cls: '',       active: concentration.topPct >= 10 && concentration.topPct < 20 },
              { band: '20–30%', label: 'Watch — single-asset risk is meaningful',      cls: 'accent', active: concentration.topPct >= 20 && concentration.topPct < 30 },
              { band: '> 30%',  label: 'High — consider trimming or hedging',          cls: 'loss',   active: concentration.topPct >= 30 },
            ]}
          />
        )}
      </div>

      {currencyExposure.length > 1 && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
            Currency Exposure
          </div>
          {/* Palette comes from CSS variables (--series-1 … --series-8) so
              each theme can tune its own pastel set without touching this
              component. The bar reads as one cohesive object instead of a
              row of competing primary colors. */}
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
            {currencyExposure.map((c, i) => (
              <div
                key={c.ccy}
                title={`${c.ccy} · ${c.pct.toFixed(1)}% · ${formatCurrency(c.val, cur, true)}`}
                style={{
                  width: `${c.pct}%`,
                  background: `var(--series-${(i % 8) + 1})`,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 11 }}>
            {currencyExposure.map((c, i) => (
              <span key={c.ccy} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: `var(--series-${(i % 8) + 1})`,
                }} />
                <strong>{c.ccy}</strong>
                <span style={{ color: 'var(--text-muted)' }}>{c.pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
