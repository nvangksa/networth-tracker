import React, { useState, useEffect, useMemo, useRef } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  generateId, todayISO, localISO, CURRENCIES, ASSET_CLASSES, guessBaseCurrency,
} from '../utils/calculations.js'
import { searchSymbol } from '../utils/api.js'

// Onboarding wizard. Replaces the old single-screen welcome modal with a
// progressive 3-step flow so a brand-new user lands on a populated dashboard
// instead of an empty one.
//
//   Step 1 — Base currency. Auto-detected from the browser locale and shown
//            as a confirmable default. Sample-data shortcut also lives here
//            for users who want to explore before entering anything.
//   Step 2 — First cash account. The single most common first asset; pre-
//            seeding even a small checking balance makes every downstream
//            metric (net worth, allocation, emergency fund) populated.
//   Step 3 — First holding (optional). Lets users add a stock/crypto with
//            ticker autocomplete, or skip and add later via the Holdings page.
//
// Every step has a "Skip" → next-step button so users never feel trapped.
// Dismissed state is persisted in localStorage so we never re-show after
// first run. If the user already has data (e.g. they imported JSON), the
// wizard is suppressed at mount and the dismissed flag is set.

const DISMISSED_KEY = 'portfolio-onboarding-dismissed'

export default function OnboardingModal() {
  const { data, loading, importJson, updateSettings, addAsset, addTransaction } = usePortfolio()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === 'true' } catch { return false }
  })
  const [step, setStep] = useState(1)
  const [baseCurrency, setBaseCurrency] = useState(() =>
    data.settings?.baseCurrency || guessBaseCurrency() || 'USD'
  )
  // Step 2 — cash account
  const [cashName, setCashName] = useState('Checking')
  const [cashAmount, setCashAmount] = useState('')
  // Step 3 — first holding
  const [holdingClass, setHoldingClass] = useState('stocks')
  const [holdingSymbol, setHoldingSymbol] = useState('')
  const [holdingName, setHoldingName] = useState('')
  const [holdingCurrency, setHoldingCurrency] = useState('USD')
  const [holdingQty, setHoldingQty] = useState('')
  const [holdingPrice, setHoldingPrice] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchState, setSearchState] = useState('idle')
  const searchTimer = useRef(null)

  // If the user lands here with data already in place (returning user, or
  // they imported a backup), persist the dismissed flag and never show.
  useEffect(() => {
    if (data.assets?.length > 0 || data.transactions?.length > 0) {
      try { localStorage.setItem(DISMISSED_KEY, 'true') } catch {}
    }
  }, [data.assets, data.transactions])

  // Currency follows base by default until the user clicks a search result
  // (which then snaps to whatever Yahoo returns for that ticker).
  useEffect(() => {
    setHoldingCurrency(baseCurrency)
  }, [baseCurrency])

  // Debounced ticker search for step 3. Mirrors the Asset modal's behavior:
  // 500 ms debounce, cancels on unmount, works without an API key via the
  // free Yahoo proxy.
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!holdingSymbol || holdingSymbol.length < 1 || !['stocks','crypto','commodities'].includes(holdingClass)) {
      setSearchResults([])
      setSearchState('idle')
      return
    }
    let cancelled = false
    setSearchState('searching')
    searchTimer.current = setTimeout(async () => {
      const results = await searchSymbol(holdingSymbol, data.settings?.apiKey)
      if (cancelled) return
      setSearchResults(results)
      setSearchState(results.length ? 'found' : 'none')
    }, 500)
    return () => { cancelled = true; clearTimeout(searchTimer.current) }
  }, [holdingSymbol, holdingClass, data.settings?.apiKey])

  if (loading || dismissed) return null
  if ((data.assets || []).length > 0 || (data.transactions || []).length > 0) return null

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch {}
    setDismissed(true)
  }

  function loadSample() {
    const sample = buildSampleData(baseCurrency)
    importJson(JSON.stringify(sample))
    dismiss()
  }

  // ── Step transitions ────────────────────────────────────────────────────
  function finishStep1() {
    // Persist base currency before advancing so the rest of the wizard's
    // currency-derived defaults (cash account currency, FX cache key) are
    // computed against the user's choice rather than the original USD.
    updateSettings({ baseCurrency })
    setStep(2)
  }

  function finishStep2(skip = false) {
    const amt = parseFloat(cashAmount) || 0
    const name = cashName.trim() || 'Checking'
    if (!skip && amt > 0) {
      const cashAsset = addAsset({
        name,
        class: 'cash',
        currency: baseCurrency,
        notes: '',
      })
      // Initial deposit so the running balance reflects the entered amount.
      // Same shape the Asset modal uses for cash creation — price=1, qty=amt.
      addTransaction({
        assetId: cashAsset.id,
        type: 'deposit',
        date: todayISO(),
        quantity: amt,
        price: 1,
        totalValue: amt,
        notes: 'Initial balance',
        tags: [],
      })
    }
    setStep(3)
  }

  function finishStep3(skip = false) {
    if (!skip) {
      const name = (holdingName || holdingSymbol || '').trim()
      const qty = parseFloat(holdingQty) || 0
      const price = parseFloat(holdingPrice) || 0
      if (name && qty > 0) {
        const a = addAsset({
          name,
          class: holdingClass,
          symbol: holdingSymbol.trim().toUpperCase() || undefined,
          currency: holdingCurrency,
          notes: '',
        })
        // Always record the buy txn so the quantity actually shows up on
        // Holdings. A price of 0 is acceptable — cost basis is just 0 and
        // the user can edit later. Previously a missing price silently
        // dropped the entire transaction, leaving the asset at qty=0.
        addTransaction({
          assetId: a.id,
          type: 'buy',
          date: todayISO(),
          quantity: qty,
          price,
          totalValue: qty * price,
          notes: 'Initial position',
          tags: [],
        })
      }
    }
    dismiss()
  }

  function applyMatch(match) {
    setHoldingSymbol(match.symbol)
    setHoldingName(prev => prev || match.name || match.symbol)
    if (match.currency) setHoldingCurrency(match.currency)
    setSearchResults([])
    setSearchState('found')
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        {/* ── Step indicator ─────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '16px 20px 0 20px',
        }}>
          {[1, 2, 3].map(n => (
            <React.Fragment key={n}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: n <= step ? 'var(--accent)' : 'var(--surface)',
                color: n <= step ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600,
                border: n === step ? '2px solid var(--accent)' : '1px solid var(--border)',
              }}>{n}</div>
              {n < 3 && (
                <div style={{
                  height: 2, flex: 1,
                  background: n < step ? 'var(--accent)' : 'var(--border)',
                }} />
              )}
            </React.Fragment>
          ))}
          <button
            className="modal-close"
            onClick={dismiss}
            title="Skip onboarding"
            style={{ marginLeft: 8 }}
          >×</button>
        </div>

        {step === 1 && (
          <Step1
            baseCurrency={baseCurrency}
            setBaseCurrency={setBaseCurrency}
            onNext={finishStep1}
            onSample={loadSample}
            onSkipAll={dismiss}
          />
        )}
        {step === 2 && (
          <Step2
            baseCurrency={baseCurrency}
            cashName={cashName} setCashName={setCashName}
            cashAmount={cashAmount} setCashAmount={setCashAmount}
            onBack={() => setStep(1)}
            onNext={() => finishStep2(false)}
            onSkip={() => finishStep2(true)}
          />
        )}
        {step === 3 && (
          <Step3
            holdingClass={holdingClass} setHoldingClass={setHoldingClass}
            holdingSymbol={holdingSymbol} setHoldingSymbol={setHoldingSymbol}
            holdingName={holdingName} setHoldingName={setHoldingName}
            holdingCurrency={holdingCurrency} setHoldingCurrency={setHoldingCurrency}
            holdingQty={holdingQty} setHoldingQty={setHoldingQty}
            holdingPrice={holdingPrice} setHoldingPrice={setHoldingPrice}
            searchResults={searchResults} searchState={searchState}
            applyMatch={applyMatch}
            onBack={() => setStep(2)}
            onFinish={() => finishStep3(false)}
            onSkip={() => finishStep3(true)}
          />
        )}
      </div>
    </div>
  )
}

// ── Step 1 ─────────────────────────────────────────────────────────────────
function Step1({ baseCurrency, setBaseCurrency, onNext, onSample, onSkipAll }) {
  return (
    <>
      <div className="modal-header" style={{ borderBottom: 'none' }}>
        <span className="modal-title" style={{ fontSize: 22 }}>Welcome 👋</span>
      </div>
      <div className="modal-body">
        <p style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.6 }}>
          This is a <strong>local-first portfolio tracker</strong>. Your data lives
          in a JSON file on this machine — nothing is sent to any server except
          anonymous Yahoo Finance price lookups.
        </p>

        <div className="form-group">
          <label>Pick your base display currency</label>
          <select value={baseCurrency} onChange={e => setBaseCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="form-hint" style={{ fontSize: 11 }}>
            We detected <strong>{baseCurrency}</strong> from your browser locale —
            change it if you'd prefer a different one. You can change again later
            in Settings.
          </div>
        </div>

        <div style={{
          marginTop: 14, marginBottom: 10,
          padding: '10px 12px',
          background: 'var(--surface)', borderRadius: 8,
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          <strong style={{ color: 'var(--text)' }}>Just exploring?</strong>{' '}
          <button
            type="button"
            onClick={onSample}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
              textDecoration: 'underline',
            }}
          >
            Load sample data
          </button>{' '}
          to see the app fully populated — clear it anytime in Settings.
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkipAll}>
          Skip — start empty
        </button>
        <button type="button" className="btn btn-primary" onClick={onNext}>
          Next →
        </button>
      </div>
    </>
  )
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
function Step2({ baseCurrency, cashName, setCashName, cashAmount, setCashAmount, onBack, onNext, onSkip }) {
  const amt = parseFloat(cashAmount) || 0
  const canNext = amt > 0 && cashName.trim().length > 0
  return (
    <>
      <div className="modal-header" style={{ borderBottom: 'none' }}>
        <span className="modal-title" style={{ fontSize: 20 }}>Add your first cash account</span>
      </div>
      <div className="modal-body">
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          Most people start by tracking their checking or savings account. Add yours
          and we'll set the initial balance — this powers your emergency-fund metric
          and the "Cash & Savings" page.
        </p>

        <div className="form-row">
          <div className="form-group mb-0">
            <label>Account name *</label>
            <input
              value={cashName}
              onChange={e => setCashName(e.target.value)}
              placeholder="Checking, Savings, etc."
              autoFocus
            />
          </div>
          <div className="form-group mb-0">
            <label>Currency</label>
            <input value={baseCurrency} readOnly
              style={{ background: 'var(--surface)', color: 'var(--text-muted)' }} />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Current balance ({baseCurrency}) *</label>
          <input
            type="number" step="any" min="0"
            value={cashAmount}
            onChange={e => setCashAmount(e.target.value)}
            placeholder="e.g. 5000"
          />
          <div className="form-hint" style={{ fontSize: 11 }}>
            The amount currently in this account. Future deposits / withdrawals
            are logged as transactions.
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSkip}>
            Skip
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNext}
            disabled={!canNext}
            title={canNext ? '' : 'Enter a name and balance, or skip this step'}
          >
            Next →
          </button>
        </div>
      </div>
    </>
  )
}

// ── Step 3 ─────────────────────────────────────────────────────────────────
function Step3({
  holdingClass, setHoldingClass,
  holdingSymbol, setHoldingSymbol,
  holdingName, setHoldingName,
  holdingCurrency, setHoldingCurrency,
  holdingQty, setHoldingQty,
  holdingPrice, setHoldingPrice,
  searchResults, searchState, applyMatch,
  onBack, onFinish, onSkip,
}) {
  const needsSymbol = ['stocks','crypto','commodities'].includes(holdingClass)
  const qty = parseFloat(holdingQty) || 0
  const price = parseFloat(holdingPrice) || 0
  const canFinish = (holdingName || holdingSymbol).trim().length > 0 && qty > 0

  return (
    <>
      <div className="modal-header" style={{ borderBottom: 'none' }}>
        <span className="modal-title" style={{ fontSize: 20 }}>Add your first holding</span>
      </div>
      <div className="modal-body">
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          Optional — add a stock, crypto position, or any other asset. Skip if
          you'd rather add things from the Holdings page later.
        </p>

        <div className="form-row">
          <div className="form-group mb-0">
            <label>Type</label>
            <select value={holdingClass} onChange={e => setHoldingClass(e.target.value)}>
              {ASSET_CLASSES.filter(c => c.value !== 'cash').map(c => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>
          {needsSymbol && (
            <div className="form-group mb-0" style={{ position: 'relative' }}>
              <label>
                Ticker
                {searchState === 'searching' && <span className="muted" style={{ fontWeight: 400 }}> · searching…</span>}
                {searchState === 'found' && searchResults.length > 0 && <span className="gain" style={{ fontWeight: 400 }}> · ✓ {searchResults.length} match{searchResults.length > 1 ? 'es' : ''}</span>}
              </label>
              <input
                value={holdingSymbol}
                onChange={e => setHoldingSymbol(e.target.value.toUpperCase())}
                placeholder={
                  holdingClass === 'crypto' ? 'BTC-USD'
                  : holdingClass === 'commodities' ? 'GC=F'
                  : 'AAPL'
                }
                autoComplete="off"
              />
              {searchResults.length > 0 && searchState === 'found' && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', marginTop: 4,
                  maxHeight: 200, overflowY: 'auto', boxShadow: 'var(--shadow)',
                }}>
                  {searchResults.slice(0, 6).map((r, i) => (
                    <button
                      key={`${r.symbol}-${i}`}
                      type="button"
                      onClick={() => applyMatch(r)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--text)', cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {r.symbol} <span className="muted" style={{ fontWeight: 400 }}>· {r.currency}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Name {needsSymbol && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(auto-fills from ticker)</span>}</label>
          <input
            value={holdingName}
            onChange={e => setHoldingName(e.target.value)}
            placeholder={holdingClass === 'crypto' ? 'Bitcoin' : holdingClass === 'property' ? 'Home' : 'Apple Inc'}
          />
        </div>

        <div className="form-row">
          <div className="form-group mb-0">
            <label>Quantity</label>
            <input
              type="number" step="any" min="0"
              value={holdingQty}
              onChange={e => setHoldingQty(e.target.value)}
              placeholder={holdingClass === 'crypto' ? '0.5' : '10'}
            />
          </div>
          <div className="form-group mb-0">
            <label>Avg buy price ({holdingCurrency})</label>
            <input
              type="number" step="any" min="0"
              value={holdingPrice}
              onChange={e => setHoldingPrice(e.target.value)}
              placeholder="e.g. 150"
            />
          </div>
        </div>
        <div className="form-hint" style={{ fontSize: 11, marginTop: 6 }}>
          Live price updates after you save — this is just the cost basis.
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSkip}>
            Finish without holding
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onFinish}
            disabled={!canFinish}
            title={canFinish ? '' : 'Need at least a name and quantity'}
          >
            Finish ✓
          </button>
        </div>
      </div>
    </>
  )
}

// Build a small but realistic sample dataset. Dates anchored relative to
// today so the charts always look populated regardless of when the user
// installs the app.
function buildSampleData(base) {
  const today = todayISO()
  // Use localISO (not toISOString) so dates respect the user's timezone — for
  // users west of UTC, toISOString().slice(0,10) shifts the date forward by a
  // day near midnight, making "1 month ago" anchored to the wrong calendar day.
  const isoNDaysAgo = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n)
    return localISO(d)
  }
  const isoNMonthsAgo = (n) => {
    const d = new Date(); d.setMonth(d.getMonth() - n)
    return localISO(d)
  }

  const id = () => generateId()

  const stockId = id(), btcId = id(), cashId = id(), savId = id(), houseId = id(), carId = id()

  return {
    settings: { baseCurrency: base, apiKey: '', autoRefresh: false, lastSnapshotDate: today },
    assets: [
      { id: stockId, name: 'Apple Inc', class: 'stocks', symbol: 'AAPL', currency: 'USD', notes: 'Sample position' },
      { id: btcId,   name: 'Bitcoin',   class: 'crypto', symbol: 'BTC-USD', currency: 'USD', notes: '' },
      { id: cashId,  name: 'Checking',  class: 'cash',   currency: 'USD', notes: 'Daily expenses' },
      { id: savId,   name: 'High-Yield Savings', class: 'cash', currency: 'USD', notes: '4.5% APY' },
      { id: houseId, name: 'Home',      class: 'property', currency: 'USD', manualPrice: 600000, mortgageBalance: 320000, purchaseDate: isoNMonthsAgo(36), notes: '' },
      { id: carId,   name: 'Car',       class: 'vehicles', currency: 'USD', depreciationRate: 15, purchaseDate: isoNMonthsAgo(24), notes: '' },
    ],
    transactions: [
      { id: id(), assetId: stockId, type: 'buy',  date: isoNMonthsAgo(18), quantity: 30, price: 165, totalValue: 4950, notes: 'Initial position', tags: [] },
      { id: id(), assetId: stockId, type: 'buy',  date: isoNMonthsAgo(6),  quantity: 10, price: 195, totalValue: 1950, notes: '', tags: [] },
      { id: id(), assetId: stockId, type: 'dividend', date: isoNMonthsAgo(3), quantity: 1, price: 38,  totalValue: 38, notes: 'Q dividend', tags: [] },
      { id: id(), assetId: btcId,   type: 'buy',  date: isoNMonthsAgo(12), quantity: 0.15, price: 42000, totalValue: 6300, notes: '', tags: [] },
      { id: id(), assetId: cashId,  type: 'deposit', date: isoNMonthsAgo(18), quantity: 5000, price: 1, totalValue: 5000, notes: 'Initial balance', tags: [] },
      { id: id(), assetId: savId,   type: 'deposit', date: isoNMonthsAgo(18), quantity: 12000, price: 1, totalValue: 12000, notes: 'Initial balance', tags: [] },
      { id: id(), assetId: cashId,  type: 'salary', date: isoNMonthsAgo(2), quantity: 1, price: 6500, totalValue: 6500, notes: 'Monthly salary', tags: [] },
      { id: id(), assetId: cashId,  type: 'salary', date: isoNMonthsAgo(1), quantity: 1, price: 6500, totalValue: 6500, notes: 'Monthly salary', tags: [] },
      { id: id(), assetId: savId,   type: 'interest_income', date: isoNMonthsAgo(1), quantity: 1, price: 47, totalValue: 47, notes: '', tags: [] },
      { id: id(), assetId: cashId,  type: 'expense', date: isoNDaysAgo(15), quantity: 1, price: 320, totalValue: 320, notes: 'Groceries', tags: [] },
      { id: id(), assetId: cashId,  type: 'expense', date: isoNDaysAgo(7),  quantity: 1, price: 180, totalValue: 180, notes: 'Utilities', tags: [] },
      { id: id(), assetId: carId,   type: 'buy',  date: isoNMonthsAgo(24), quantity: 1, price: 32000, totalValue: 32000, notes: 'Initial purchase', tags: [] },
      { id: id(), assetId: houseId, type: 'buy',  date: isoNMonthsAgo(36), quantity: 1, price: 540000, totalValue: 540000, notes: 'Initial purchase', tags: [] },
      { id: id(), assetId: houseId, type: 'rental_income', date: isoNMonthsAgo(2), quantity: 1, price: 1800, totalValue: 1800, notes: 'Monthly rent', tags: [] },
      { id: id(), assetId: houseId, type: 'rental_income', date: isoNMonthsAgo(1), quantity: 1, price: 1800, totalValue: 1800, notes: 'Monthly rent', tags: [] },
    ],
    // Mirror the property's mortgageBalance as a real Liability row.
    // The auto-create-on-addAsset flow doesn't run when sample data is
    // imported wholesale via importJson, so without this row the property's
    // mortgage was reflected on the Property page (via mortgageBalance)
    // but never subtracted from Total Liabilities — overstating net worth.
    liabilities: [
      {
        id: id(),
        name: 'Home Mortgage',
        type: 'mortgage',
        balance: 320000,
        currency: 'USD',
        startDate: isoNMonthsAgo(36),
        linkedAssetId: houseId,
        notes: 'Auto-created from property mortgage',
      },
    ],
    snapshots: [],
    expenses: [
      { id: id(), name: 'Rent',       amount: 1500, currency: base, category: 'Housing',         tags: ['essential'], recurrence: 'monthly', startDate: isoNMonthsAgo(12), endDate: '', sources: [], sourceAssetIds: [] },
      { id: id(), name: 'Netflix',    amount: 16,   currency: base, category: 'Subscriptions',   tags: [],            recurrence: 'monthly', startDate: isoNMonthsAgo(24), endDate: '', sources: [], sourceAssetIds: [] },
      { id: id(), name: 'Gym',        amount: 39,   currency: base, category: 'Healthcare',      tags: [],            recurrence: 'monthly', startDate: isoNMonthsAgo(8),  endDate: '', sources: [], sourceAssetIds: [] },
    ],
    expenseCategories: [],
    pricesCache: {},
    fxCache: {},
  }
}
