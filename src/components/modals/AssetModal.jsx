import React, { useState, useEffect, useRef, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import { ASSET_CLASSES, CURRENCIES, MANUAL_CLASSES, todayISO } from '../../utils/calculations.js'
import { searchSymbol } from '../../utils/api.js'

const DEFAULTS = {
  name: '', class: 'stocks', symbol: '', currency: 'USD',
  manualPrice: '', mortgageBalance: '', notes: '',
  depreciationRate: '', purchaseDate: '', ownershipPct: '',
  initialQty: '', initialAvgPrice: '', initialDate: todayISO(),
  // Cash-only: annual percentage yield. Surfaces a compound-interest
  // projection on the Cash & Savings page so users see what their balance
  // will grow to if left untouched.
  apy: '',
  // Marks the asset as a favorite. Favorites are flagged with a star in the
  // UI and trigger an extra confirmation step before a Sell transaction is
  // recorded so the user can't accidentally close a position they care about.
  favorite: false,
  // Bond-specific fields. Optional everywhere else but unlock structural
  // tracking (coupon income, maturity countdown, YTM) on the Bonds page.
  faceValue: '',         // par value per unit (native currency)
  couponRate: '',        // annual coupon rate (%)
  couponFrequency: '2',  // payments per year — semi-annual is most common
  maturityDate: '',
  issueDate: '',
  issuer: '',
  bondType: '',          // treasury / corporate / municipal / agency / foreign / other
  creditRating: '',      // AAA / AA / A / BBB / BB / B / CCC / D / NR
  callable: false,
  taxStatus: '',         // taxable / tax_exempt
}

const BOND_TYPES = [
  { value: '',           label: '— Select —'    },
  { value: 'treasury',   label: 'Treasury'      },
  { value: 'corporate',  label: 'Corporate'     },
  { value: 'municipal',  label: 'Municipal'     },
  { value: 'agency',     label: 'Agency'        },
  { value: 'foreign',    label: 'Foreign / Sovereign' },
  { value: 'other',      label: 'Other'         },
]
const CREDIT_RATINGS = ['', 'AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB','B','CCC','CC','C','D','NR']
const COUPON_FREQUENCIES = [
  { value: '1',  label: 'Annual (1×/yr)'         },
  { value: '2',  label: 'Semi-annual (2×/yr)'    },
  { value: '4',  label: 'Quarterly (4×/yr)'      },
  { value: '12', label: 'Monthly (12×/yr)'       },
]
const TAX_STATUSES = [
  { value: '',           label: '— Not specified —' },
  { value: 'taxable',    label: 'Taxable'           },
  { value: 'tax_exempt', label: 'Tax-Exempt'        },
]

// Classes where fractional ownership is a realistic field to surface.
// Fungible market assets (stocks, crypto, commodities, bonds) and pure cash
// don't realistically use this — a user co-owning 50% of a brokerage just
// halves the share count they enter.
const OWNERSHIP_CLASSES = ['property', 'vehicles', 'private_equity', 'business', 'art', 'collectibles', 'jewelry']

// Equity-stake classes: ownership % is informational (describes the slice of
// the company) and does NOT scale value/cost/PnL — the user already enters
// their own stake's value directly (lump-sum or share-count × per-share). The
// matching change lives in [calculations.js] (see `ownershipScales` there).
const EQUITY_STAKE_CLASSES = ['business', 'private_equity']

// Classes where the asset is always a single discrete item — a house is a
// house, a car is a car. A "quantity" field there is meaningless noise (a
// user buying two cars files them as two separate assets so depreciation
// and purchase date can differ). For these we collapse qty + per-unit price
// into one "Purchase Price" field and store qty=1 internally so cost basis
// math (qty × price) still works unchanged. Collectibles stay qty-based
// because a user can legitimately track e.g. "10 graded cards" as one asset.
const SINGLE_UNIT_CLASSES = ['property', 'vehicles', 'art', 'jewelry']

// Classes where annual depreciation is a natural way to value the asset.
// Vehicles obviously depreciate; property is often depreciated for tax /
// accounting purposes even though market value can appreciate. Everything
// else in MANUAL_CLASSES (art, jewelry, collectibles, bonds, etc.) typically
// holds or appreciates, so showing a "% depreciation" field there just adds
// noise and invites incorrect data entry.
const DEPRECIATION_CLASSES = ['property', 'vehicles']

export default function AssetModal({ asset, onClose, onSaved }) {
  const { addAsset, editAsset, addTransaction, editTransaction, data } = usePortfolio()
  const isEdit = !!asset?.id

  // When editing, find the earliest buy/deposit txn — that's the "initial position"
  // we'll let the user edit in place (qty, price, date). This surfaces the
  // original cost basis so users can correct a mis-entered purchase price
  // without hunting through the Transactions page.
  const initialTxn = useMemo(() => {
    if (!isEdit) return null
    return (data?.transactions || [])
      .filter(t => t.assetId === asset.id && (t.type === 'buy' || t.type === 'deposit'))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null
  }, [isEdit, asset?.id, data?.transactions])

  const [form, setForm] = useState(() => {
    // For single-unit classes (property/vehicles/art/jewelry), collapse any
    // legacy qty + per-unit price into a single total "Purchase Price" so
    // the simplified UI displays one truthful number even for assets that
    // were saved with qty != 1 under the old form.
    const isSingleUnit = SINGLE_UNIT_CLASSES.includes(asset?.class)
    const txnQty   = initialTxn ? (parseFloat(initialTxn.quantity) || 0) : 0
    const txnPrice = initialTxn ? (parseFloat(initialTxn.price)    || 0) : 0
    const initialQty = initialTxn
      ? (isSingleUnit ? '1' : String(initialTxn.quantity ?? ''))
      : ''
    const initialAvgPrice = initialTxn
      ? (isSingleUnit ? String(txnQty * txnPrice) : String(initialTxn.price ?? ''))
      : ''
    return {
      ...DEFAULTS,
      ...(asset || {}),
      // Pre-fill initial-position fields from the earliest buy/deposit when editing
      initialTxnId: initialTxn?.id || null,
      initialQty,
      initialAvgPrice,
      initialDate: initialTxn?.date || todayISO(),
    }
  })
  const [searchResults, setSearchResults] = useState([])
  const [searchState, setSearchState] = useState('idle') // idle | searching | found | none
  const searchTimer = useRef(null)
  // When the user clicks a ticker search result, the currency is auto-set
  // from the match. Track that fact so we can show a small inline note next
  // to the Currency select. The note clears if the user changes the currency
  // themselves (so we don't keep claiming "auto-set" after they overrode it).
  const [currencyAutoFrom, setCurrencyAutoFrom] = useState(null) // string | null

  // For business / private_equity assets the Initial Position has two input
  // modes:
  //   - Lump-sum (default): one "Investment Amount" field — qty stores the $
  //     amount, price is forced to 1 (same encoding trick as cash deposits).
  //   - Share-count: qty = # of shares the user owns, price = per-share price.
  // Detect share-count from the SAVED initial txn's price: lump-sum always
  // writes price=1, so a non-1 per-unit price means the user originally
  // entered share-shaped data. Using `quantity !== 1` here was wrong — a
  // lump-sum amount of e.g. $50,000 produces qty=50000, which would
  // misclassify as share-count on every reopen.
  const initialShareCountMode = !!(
    asset && EQUITY_STAKE_CLASSES.includes(asset.class) && initialTxn &&
    initialTxn.price != null && parseFloat(initialTxn.price) !== 1
  )
  const [shareCountMode, setShareCountMode] = useState(initialShareCountMode)

  function set(k, v) {
    // If the user changed the currency themselves, the "auto-set from <ticker>"
    // hint is no longer accurate — clear it so the form stops asserting
    // something the user just overrode.
    if (k === 'currency') setCurrencyAutoFrom(null)
    // Switching into/out of an equity-stake class flips the meaning of qty
    // and price (lump-sum amount vs. share count). Reset share-count mode to
    // its default (lump-sum) so the input UI doesn't lie about the field.
    if (k === 'class' && v !== form.class &&
        (EQUITY_STAKE_CLASSES.includes(v) || EQUITY_STAKE_CLASSES.includes(form.class))) {
      setShareCountMode(false)
    }
    setForm(f => {
      const next = { ...f, [k]: v }
      // When user switches to a class that depreciates by default, pre-fill the rate
      if (k === 'class' && !f.depreciationRate) {
        const info = ASSET_CLASSES.find(c => c.value === v)
        if (info?.defaultDepreciation) {
          next.depreciationRate = String(info.defaultDepreciation)
        }
      }
      // Class change away from / into cash OR equity-stake (in lump-sum mode):
      // reset the carryover Initial Position price so a value typed for "$ per
      // share" doesn't become the deposit's per-unit price (which must be 1).
      // Without this, switching stocks → cash after entering qty + price left
      // initialAvgPrice = 150, the deposit got saved with cost = qty × 150
      // while balance = qty, and the asset opened with unrealizedPnL ≈ −cost
      // on the Holdings page. Same trap applies to business/PE lump-sum input.
      if (k === 'class' && v !== f.class) {
        const intoLump = v === 'cash' || EQUITY_STAKE_CLASSES.includes(v)
        const outOfLump = f.class === 'cash' || EQUITY_STAKE_CLASSES.includes(f.class)
        const intoSingleUnit  = SINGLE_UNIT_CLASSES.includes(v)
        const outOfSingleUnit = SINGLE_UNIT_CLASSES.includes(f.class)
        if (intoLump) {
          next.initialAvgPrice = '1'
        } else if (intoSingleUnit) {
          // Entering single-unit: clear any leftover per-share price and
          // force qty=1 so the simplified "Purchase Price" field starts fresh.
          next.initialAvgPrice = ''
          next.initialQty = '1'
        } else if (outOfLump || outOfSingleUnit) {
          // Leaving single-unit or lump-sum: a stored total-cost / amount
          // would be wrong as a per-unit price for a fungible class. Also
          // clear the forced qty=1 so user re-enters share count.
          next.initialAvgPrice = ''
          if (outOfSingleUnit) next.initialQty = ''
        }
      }
      return next
    })
  }

  // Auto-search ticker when user types symbol (debounced). Works WITHOUT a
  // Twelve Data API key — falls back to the Yahoo search proxy. The
  // `cancelled` flag guards setState after the modal unmounts mid-fetch.
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!form.symbol || form.symbol.length < 1) {
      setSearchResults([])
      setSearchState('idle')
      return
    }
    if (!['stocks', 'crypto', 'commodities'].includes(form.class)) return

    let cancelled = false
    setSearchState('searching')
    searchTimer.current = setTimeout(async () => {
      const results = await searchSymbol(form.symbol, data.settings.apiKey)
      if (cancelled) return
      setSearchResults(results)
      setSearchState(results.length ? 'found' : 'none')
    }, 500)
    return () => { cancelled = true; clearTimeout(searchTimer.current) }
  }, [form.symbol, form.class, data.settings.apiKey])

  function applyMatch(match) {
    setForm(f => ({
      ...f,
      symbol: match.symbol,
      name: f.name || match.name,
      currency: match.currency || f.currency,
    }))
    // Capture WHO auto-set the currency so the inline note can name it. Only
    // remember if Yahoo/Twelve Data actually returned a currency on the match.
    if (match.currency) setCurrencyAutoFrom(match.symbol)
    setSearchResults([])
    setSearchState('found')
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    // Build the payload conditionally so unset/empty fields don't overwrite
    // valid existing values when editing. Without this, simply re-saving an
    // asset wipes per-asset metadata that wasn't part of this form (e.g.
    // depreciationRate, ownershipPct) — the original bug we're fixing.
    const payload = {
      name: form.name.trim(),
      class: form.class,
      currency: form.currency,
      notes: form.notes.trim(),
    }
    if (form.symbol?.trim()) payload.symbol = form.symbol.trim().toUpperCase()
    if (form.manualPrice !== '' && form.manualPrice != null && !isNaN(parseFloat(form.manualPrice))) {
      payload.manualPrice = parseFloat(form.manualPrice)
    }
    if (form.class === 'property' && form.mortgageBalance !== '' && form.mortgageBalance != null) {
      payload.mortgageBalance = parseFloat(form.mortgageBalance) || 0
    } else if (form.class === 'property') {
      // Explicitly clear when user emptied the mortgage on a property
      payload.mortgageBalance = 0
    }
    if (form.depreciationRate !== '' && form.depreciationRate != null && !isNaN(parseFloat(form.depreciationRate))) {
      payload.depreciationRate = parseFloat(form.depreciationRate)
    }
    if (form.purchaseDate) payload.purchaseDate = form.purchaseDate
    if (form.ownershipPct !== '' && form.ownershipPct != null && !isNaN(parseFloat(form.ownershipPct))) {
      payload.ownershipPct = parseFloat(form.ownershipPct)
    }
    if (form.class === 'cash' && form.apy !== '' && !isNaN(parseFloat(form.apy))) {
      payload.apy = parseFloat(form.apy)
    }
    // Persist bond-specific fields only when class === 'bonds' so a class
    // change away from bonds doesn't leave stale coupon/face data hanging
    // on the record. Empty fields are saved as empty strings (truthy-checked
    // at read time) to allow blanking values via the edit form.
    if (form.class === 'bonds') {
      if (form.faceValue !== '' && !isNaN(parseFloat(form.faceValue))) {
        payload.faceValue = parseFloat(form.faceValue)
      }
      if (form.couponRate !== '' && !isNaN(parseFloat(form.couponRate))) {
        payload.couponRate = parseFloat(form.couponRate)
      }
      if (form.couponFrequency) payload.couponFrequency = parseInt(form.couponFrequency, 10)
      if (form.maturityDate) payload.maturityDate = form.maturityDate
      if (form.issueDate)    payload.issueDate    = form.issueDate
      if (form.issuer?.trim())       payload.issuer       = form.issuer.trim()
      if (form.bondType)             payload.bondType     = form.bondType
      if (form.creditRating)         payload.creditRating = form.creditRating
      if (form.taxStatus)            payload.taxStatus    = form.taxStatus
      payload.callable = !!form.callable
    }
    payload.favorite = !!form.favorite
    if (isEdit) {
      editAsset(asset.id, payload)
      // Sync the initial-position buy/deposit transaction if the user edited it.
      // For cash, force per-unit price = 1 — same reasoning as the create path:
      // a leftover price from a different class would corrupt the cost basis.
      const qty = parseFloat(form.initialQty)
      const isCashEdit = form.class === 'cash'
      const price = isCashEdit ? 1 : parseFloat(form.initialAvgPrice)
      const hasInitial = qty > 0 && price >= 0
      if (initialTxn && hasInitial) {
        editTransaction(initialTxn.id, {
          quantity: qty,
          price,
          totalValue: qty * price,
          date: form.initialDate || initialTxn.date,
        })
      } else if (!initialTxn && hasInitial) {
        // No initial txn existed but user supplied one now — create it.
        // Cash accounts use 'deposit', everything else uses 'buy'. Tag the
        // generated txn so a re-save doesn't add a SECOND duplicate buy when
        // initialTxn is rederived from the freshly-saved data.
        addTransaction({
          assetId: asset.id,
          type: isCashEdit ? 'deposit' : 'buy',
          date: form.initialDate || todayISO(),
          quantity: qty,
          price,
          totalValue: qty * price,
          notes: isCashEdit ? 'Initial balance (added via edit)' : 'Initial position (added via edit)',
          tags: [],
        })
      }
      onSaved?.({ ...asset, ...payload })
    } else {
      const saved = addAsset(payload)
      // Auto-create initial buy/deposit transaction if qty + price provided
      const qty = parseFloat(form.initialQty)
      const isCash = form.class === 'cash'
      // For cash, the per-unit price is always 1 — the "amount" the user
      // entered IS the quantity in dollars/units. Ignoring any leftover
      // initialAvgPrice prevents a class-switch (stocks → cash without
      // re-typing the Amount field) from poisoning the deposit's cost basis
      // and making the asset open with PnL ≈ −cost.
      const price = isCash ? 1 : parseFloat(form.initialAvgPrice)
      if (qty > 0 && price >= 0) {
        // All non-cash classes (including vehicles, jewelry, art, business, property)
        // get an initial Buy transaction so cost basis is recorded. Without this,
        // depreciating assets showed phantom profit = currentValue − 0.
        addTransaction({
          assetId: saved.id,
          type: isCash ? 'deposit' : 'buy',
          date: form.initialDate || todayISO(),
          quantity: qty,
          price,
          totalValue: qty * price,
          notes: isCash ? 'Initial balance' : 'Initial purchase',
          tags: [],
        })
      }
      onSaved?.(saved)
    }
    onClose()
  }

  const needsSymbol = ['stocks', 'crypto', 'commodities'].includes(form.class)
  const isProperty = form.class === 'property'

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Asset' : 'Add Asset'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Asset Name *</label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Apple Inc., Residential Property..."
                required autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Asset Class *</label>
                <select value={form.class} onChange={e => set('class', e.target.value)}>
                  {ASSET_CLASSES.map(c => (
                    <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group mb-0">
                <label>
                  Priced In *
                  {currencyAutoFrom && (
                    <span className="gain" style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                      ✓ auto-set from {currencyAutoFrom}
                    </span>
                  )}
                </label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <div className="form-hint" style={{ fontSize: 11 }}>
                  Currency this asset is priced in (e.g. IDR for a Jakarta stock, USD for Apple). Will be auto-converted to your base currency for display.
                </div>
              </div>
            </div>

            {needsSymbol && (
              <div className="form-group" style={{ position: 'relative' }}>
                <label>
                  Ticker Symbol{' '}
                  {searchState === 'searching' && <span className="muted" style={{ fontWeight: 400 }}>searching…</span>}
                  {searchState === 'found' && searchResults.length > 0 && <span className="gain" style={{ fontWeight: 400 }}>✓ {searchResults.length} match{searchResults.length > 1 ? 'es' : ''}</span>}
                  {searchState === 'none' && form.symbol && <span className="loss" style={{ fontWeight: 400 }}>✕ not found — manual entry</span>}
                </label>
                <input
                  value={form.symbol}
                  onChange={e => set('symbol', e.target.value.toUpperCase())}
                  placeholder={
                    // Yahoo uses dash for crypto (BTC-USD), =X for forex
                    // (EURUSD=X), and =F for futures (GC=F). The server
                    // normalizer also accepts slash forms (XAU/USD, BTC/USD,
                    // EUR/USD) and routes them to the right Yahoo spelling.
                    // For precious metals Yahoo doesn't host spot tickers,
                    // so we route XAU/USD → GC=F (gold futures, tracks
                    // spot within ~0.5%). ETF alternatives like GLD or IAU
                    // also work and turn up via the autocomplete.
                    form.class === 'crypto' ? 'BTC-USD, ETH-USD, SOL-USD, PAXG-USD' :
                    form.class === 'commodities' ? 'GC=F or GOLD (gold), SI=F (silver), CL=F (oil), GLD (gold ETF)' :
                    'AAPL, BBCA.JK, MSFT'
                  }
                  autoComplete="off"
                />
                {searchResults.length > 0 && searchState === 'found' && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', marginTop: 4,
                    maxHeight: 240, overflowY: 'auto', boxShadow: 'var(--shadow)'
                  }}>
                    {searchResults.map((r, i) => (
                      <button
                        key={`${r.symbol}-${r.exchange}-${i}`}
                        type="button"
                        onClick={() => applyMatch(r)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 12px', background: 'none', border: 'none',
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text)', cursor: 'pointer', fontSize: 12,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {r.symbol} <span className="muted" style={{ fontWeight: 400 }}>· {r.currency}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {r.name} {r.exchange && `— ${r.exchange}`} {r.country && `(${r.country})`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="form-hint">
                  {data.settings.apiKey
                    ? 'Type to search · Click a match to auto-fill · Live prices via Twelve Data + Yahoo fallback'
                    : 'Type to search · Click a match to auto-fill · Free Yahoo Finance (no API key needed)'}
                </div>
              </div>
            )}

            {(ASSET_CLASSES.find(a => a.value === form.class) &&
              !needsSymbol && form.class !== 'cash') && (
              <div className="form-group">
                <label>Current Value ({form.currency}) — optional</label>
                <input
                  type="number" step="any" min="0"
                  value={form.manualPrice}
                  onChange={e => set('manualPrice', e.target.value)}
                  placeholder="Market value today (not the purchase price)"
                />
                <div className="form-hint" style={{ fontSize: 11 }}>
                  This is the <strong>current</strong> market value. Enter your purchase price below
                  under <em>Initial Position</em> — cost basis drives your P&amp;L.
                </div>
              </div>
            )}

            {isProperty && (
              <div className="form-group">
                <label>Outstanding Mortgage Balance ({form.currency})</label>
                <input
                  type="number" step="any" min="0"
                  value={form.mortgageBalance}
                  onChange={e => set('mortgageBalance', e.target.value)}
                  placeholder="0"
                />
                <div className="form-hint">Net equity = current value − mortgage balance</div>
              </div>
            )}

            {/* Fractional ownership — only makes sense for single discrete
                physical / illiquid assets that can have co-owners (property,
                business, art, etc.). Fungible markets like stocks, crypto,
                commodities, and bonds don't co-own a single share, so we
                hide it for those classes entirely to stop the form sprawling.
                For business / private_equity this is informational only — the
                user already enters their OWN stake's value, so it doesn't
                scale anything. We use it to derive an implied company
                valuation for the hint below. */}
            {OWNERSHIP_CLASSES.includes(form.class) && (() => {
              const isStake = EQUITY_STAKE_CLASSES.includes(form.class)
              const pct = parseFloat(form.ownershipPct)
              const qty = parseFloat(form.initialQty)
              const price = parseFloat(form.initialAvgPrice)
              const stakeValue = (isFinite(qty) && qty > 0)
                ? (isFinite(price) && price > 0 ? qty * price : qty)
                : NaN
              const impliedTotal = (isStake && isFinite(pct) && pct > 0 && pct < 100 && isFinite(stakeValue))
                ? stakeValue / (pct / 100)
                : null
              return (
                <div className="form-group">
                  <label>
                    {isStake ? 'Ownership Share of Company (%)' : 'Ownership Share (%)'}
                  </label>
                  <input
                    type="number" step="any" min="0" max="100"
                    value={form.ownershipPct}
                    onChange={e => set('ownershipPct', e.target.value)}
                    placeholder={isStake
                      ? 'e.g. 30 if you own 30% of the company'
                      : '100 (full ownership) — e.g. 50 if you co-own with a partner'}
                  />
                  <div className="form-hint" style={{ fontSize: 11 }}>
                    {isStake ? (
                      <>
                        Informational — the value above is already your stake. Used to derive
                        the implied total company valuation.
                        {impliedTotal != null && (
                          <div style={{ marginTop: 4 }}>
                            <strong>Implied company valuation:</strong>{' '}
                            {form.currency} {impliedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            {' '}({pct}% = your stake)
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        Leave blank or 100 for full ownership. If co-owned (e.g. 50% share of a building),
                        all values, cost basis, P&L, and income are scaled by this percentage.
                        {form.class === 'property' && ' Mortgage balance is NOT scaled — enter your own share of the mortgage directly.'}
                      </>
                    )}
                  </div>
                </div>
              )
            })()}

            {DEPRECIATION_CLASSES.includes(form.class) && (
              <div className="form-row">
                <div className="form-group mb-0">
                  <label>Annual Depreciation (%)</label>
                  <input
                    type="number" step="any" min="0" max="100"
                    value={form.depreciationRate}
                    onChange={e => set('depreciationRate', e.target.value)}
                    placeholder={form.class === 'vehicles' ? '15 (typical)' : 'Leave blank'}
                  />
                  <div className="form-hint" style={{ fontSize: 11 }}>
                    Auto-calculates current value: cost × (1 − rate)^years since purchase
                  </div>
                </div>
                <div className="form-group mb-0">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={form.purchaseDate}
                    onChange={e => set('purchaseDate', e.target.value)}
                  />
                  <div className="form-hint" style={{ fontSize: 11 }}>
                    Defaults to first buy transaction date if blank
                  </div>
                </div>
              </div>
            )}

            {/* Bond-specific structural fields. Hidden unless the class is
                'bonds' so the modal stays focused for other asset types. */}
            {form.class === 'bonds' && (
              <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Bond Details
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Face / Par Value per unit ({form.currency})</label>
                    <input
                      type="number" step="any" min="0"
                      value={form.faceValue}
                      onChange={e => set('faceValue', e.target.value)}
                      placeholder="e.g. 1000"
                    />
                    <div className="form-hint" style={{ fontSize: 11 }}>
                      Amount returned per unit at maturity. Different from the
                      market price you paid for the bond.
                    </div>
                  </div>
                  <div className="form-group mb-0">
                    <label>Coupon Rate (% per year)</label>
                    <input
                      type="number" step="any" min="0" max="100"
                      value={form.couponRate}
                      onChange={e => set('couponRate', e.target.value)}
                      placeholder="e.g. 4.5"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Coupon Frequency</label>
                    <select
                      value={form.couponFrequency}
                      onChange={e => set('couponFrequency', e.target.value)}
                    >
                      {COUPON_FREQUENCIES.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group mb-0">
                    <label>Maturity Date</label>
                    <input
                      type="date"
                      value={form.maturityDate}
                      onChange={e => set('maturityDate', e.target.value)}
                    />
                  </div>
                </div>
                {/* Bond secondary fields (issuer, rating, tax status, etc.)
                    — useful for tracking but not required to compute coupon
                    income / maturity countdown. Kept inline so users don't
                    miss them. */}
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Issuer</label>
                    <input
                      type="text"
                      value={form.issuer}
                      onChange={e => set('issuer', e.target.value)}
                      placeholder="e.g. US Treasury, Apple Inc., City of NYC"
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Bond Type</label>
                    <select
                      value={form.bondType}
                      onChange={e => set('bondType', e.target.value)}
                    >
                      {BOND_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Issue Date (optional)</label>
                    <input
                      type="date"
                      value={form.issueDate}
                      onChange={e => set('issueDate', e.target.value)}
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Credit Rating (optional)</label>
                    <select
                      value={form.creditRating}
                      onChange={e => set('creditRating', e.target.value)}
                    >
                      {CREDIT_RATINGS.map(r => (
                        <option key={r} value={r}>{r || '— Not rated —'}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Tax Status</label>
                    <select
                      value={form.taxStatus}
                      onChange={e => set('taxStatus', e.target.value)}
                    >
                      {TAX_STATUSES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group mb-0">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!form.callable}
                        onChange={e => set('callable', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Callable (issuer can redeem early)</span>
                    </label>
                  </div>
                </div>
                <div className="form-hint" style={{ marginTop: 8, fontSize: 11 }}>
                  Reference data only — these fields are stored with the asset
                  so the full bond's structure stays visible in its detail view.
                  Log actual coupon payments as Interest Income transactions
                  whenever you receive them.
                </div>
              </div>
            )}

            {form.class !== 'cash' && (() => {
              const isStake = EQUITY_STAKE_CLASSES.includes(form.class)
              const isSingleUnit = SINGLE_UNIT_CLASSES.includes(form.class)
              const lumpSum = isStake && !shareCountMode
              return (
                <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {isSingleUnit ? 'Purchase Details' : 'Initial Position'} {isEdit ? (initialTxn ? '(editing original buy transaction)' : '(add one)') : '(optional)'}
                  </div>
                  {lumpSum ? (
                    // Lump-sum input for business / private_equity. We bind
                    // the amount to initialQty and force initialAvgPrice = 1
                    // (same encoding as cash deposits) so the existing submit
                    // path doesn't need to branch.
                    <div className="form-group mb-0">
                      <label>Investment Amount ({form.currency})</label>
                      <input
                        type="number" step="any" min="0"
                        value={form.initialQty}
                        onChange={e => {
                          set('initialQty', e.target.value)
                          set('initialAvgPrice', '1')
                        }}
                        placeholder="e.g. 50000"
                      />
                      <div className="form-hint" style={{ fontSize: 11, marginTop: 4 }}>
                        Total amount you invested in this stake. Enter your ownership %
                        above to see the implied total company valuation.
                      </div>
                    </div>
                  ) : isSingleUnit ? (
                    // Single discrete item (property / vehicle / art / jewelry):
                    // qty is always 1, so we collapse qty + per-unit price into
                    // one "Purchase Price" field. Bound to initialAvgPrice with
                    // qty forced to 1 — the existing submit path stores it as
                    // a normal qty=1 × price=purchasePrice buy txn.
                    <div className="form-group mb-0">
                      <label>Purchase Price ({form.currency})</label>
                      <input
                        type="number" step="any" min="0"
                        value={form.initialAvgPrice}
                        onChange={e => {
                          set('initialAvgPrice', e.target.value)
                          set('initialQty', '1')
                        }}
                        placeholder={
                          form.class === 'property' ? 'e.g. 350000' :
                          form.class === 'vehicles' ? 'e.g. 25000'  :
                          'e.g. 5000'
                        }
                      />
                      <div className="form-hint" style={{ fontSize: 11, marginTop: 4 }}>
                        What you paid in total when you acquired it. Drives cost basis,
                        P&amp;L{form.class === 'vehicles' || form.class === 'property' ? ', and depreciation' : ''}.
                      </div>
                    </div>
                  ) : (
                    <div className="form-row">
                      <div className="form-group mb-0">
                        <label>
                          {isStake ? '# of Shares You Own' :
                           form.class === 'stocks' ? '# of Shares' :
                           form.class === 'crypto' ? '# of Coins' :
                           form.class === 'property' ? 'Units (usually 1)' :
                           form.class === 'commodities' ? '# of Units' :
                           'Quantity'}
                        </label>
                        <input
                          type="number" step="any" min="0"
                          value={form.initialQty}
                          onChange={e => set('initialQty', e.target.value)}
                          placeholder={isStake ? 'e.g. 1000' : 'e.g. 10'}
                        />
                      </div>
                      <div className="form-group mb-0">
                        <label>{isStake ? `Price Per Share (${form.currency})` : `Avg Buy Price (${form.currency})`}</label>
                        <input
                          type="number" step="any" min="0"
                          value={form.initialAvgPrice}
                          onChange={e => set('initialAvgPrice', e.target.value)}
                          placeholder="e.g. 150.00"
                        />
                      </div>
                    </div>
                  )}
                  <div className="form-group mb-0" style={{ marginTop: 8 }}>
                    <label>Purchase Date</label>
                    <input
                      type="date"
                      value={form.initialDate}
                      onChange={e => set('initialDate', e.target.value)}
                    />
                  </div>
                  {isStake && (
                    <button
                      type="button"
                      onClick={() => {
                        // Switching modes: clear the qty/price so a lump-sum
                        // amount doesn't become an absurd share count (or
                        // vice-versa). Reset price to '1' for lump-sum mode
                        // so submit's qty × 1 = amount stays correct.
                        setShareCountMode(m => {
                          const next = !m
                          setForm(f => ({
                            ...f,
                            initialQty: '',
                            initialAvgPrice: next ? '' : '1',
                          }))
                          return next
                        })
                      }}
                      style={{
                        background: 'none', border: 'none', padding: '6px 0',
                        color: 'var(--accent)', cursor: 'pointer',
                        fontSize: 11, fontWeight: 500, marginTop: 4,
                      }}
                    >
                      {shareCountMode
                        ? '← Use a lump-sum amount instead'
                        : 'Track by share count instead →'}
                    </button>
                  )}
                  <div className="form-hint" style={{ marginTop: 6 }}>
                    Creates a Buy transaction so cost basis and quantity are tracked. Leave blank to add transactions later.
                  </div>
                </div>
              )
            })()}
            {form.class === 'cash' && !isEdit && (
              <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Initial Balance (optional)
                </div>
                <div className="form-group mb-0">
                  <label>Amount ({form.currency})</label>
                  <input
                    type="number" step="any" min="0"
                    value={form.initialQty}
                    onChange={e => {
                      set('initialQty', e.target.value)
                      set('initialAvgPrice', '1')
                    }}
                    placeholder="e.g. 5000"
                  />
                </div>
              </div>
            )}
            {form.class === 'cash' && (
              <div className="form-group">
                <label>APY (%) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number" step="any" min="0" max="100"
                  value={form.apy}
                  onChange={e => set('apy', e.target.value)}
                  placeholder="e.g. 4.5 for a high-yield savings account"
                />
                <div className="form-hint">
                  Annual percentage yield. When set, the Cash &amp; Savings page shows a compound-growth projection for this account.
                </div>
              </div>
            )}

            <div className="form-group">
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                title="Adds a star icon in tables and asks for confirmation before any Sell — so you can't accidentally close a position you care about."
              >
                <input
                  type="checkbox"
                  checked={!!form.favorite}
                  onChange={e => set('favorite', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>⭐ Mark as Favorite</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  — extra Sell confirmation
                </span>
              </label>
            </div>

            <div className="form-group mb-0">
              <label>Notes</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
