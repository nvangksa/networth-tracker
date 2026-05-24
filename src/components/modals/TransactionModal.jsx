import React, { useState, useRef, useEffect, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import {
  INCOME_TYPES, getTransactionTypesForClass, ASSET_CLASSES,
  todayISO, formatCurrency, getFxRate, generateId,
} from '../../utils/calculations.js'
import { getRecents, setRecents, RECENT_KEYS } from '../../utils/recents.js'

// Classes where the asset is always a single discrete item (1 house, 1 car,
// 1 painting, 1 ring). For these, a "Quantity" field is meaningless noise —
// collapse the qty + per-unit price pair into a single price field and store
// qty=1 internally so cost-basis math (qty × price) keeps working. Mirrors
// SINGLE_UNIT_CLASSES in AssetModal.jsx.
const SINGLE_UNIT_CLASSES = ['property', 'vehicles', 'art', 'jewelry']

const DEFAULTS = {
  assetId: '', type: 'buy', date: todayISO(),
  // Optional clock time (HH:MM) — only surfaced for cash/savings transactions
  // so users can record the exact moment of a deposit/withdrawal. Stored
  // separately from `date` to keep YYYY-MM-DD string comparisons elsewhere
  // working without change.
  time: '',
  quantity: '', price: '', totalValue: '',
  notes: '', tags: [],
  // For sells: optional cash account to deposit proceeds into. The deposit
  // is recorded as a separate `deposit` transaction so cash balances stay in
  // sync with the realized P&L.
  proceedsAccountId: '',
  // For transfers: required destination cash account. The matching deposit
  // is created automatically with a shared transferGroupId for traceability.
  transferToAssetId: '',
  // For dividends with DRIP: track if the dividend was auto-reinvested in
  // additional shares (so qty + price represent reinvestment, not cash).
  reinvest: false,
  // Income source: WHO paid this. Critical for salary because the asset is
  // just the destination account — without a source, two different jobs
  // paying the same checking account look identical. Optional for other
  // income types (the asset usually IS the source there: e.g. AAPL pays
  // AAPL's dividend).
  source: '',
}

export default function TransactionModal({ transaction, preselectedAssetId, preselectedType, prefill, onClose }) {
  const { data, addTransaction, editTransaction, allUsedTags } = usePortfolio()
  const isEdit = !!transaction
  const [form, setForm] = useState(() => {
    if (isEdit) return { ...DEFAULTS, ...transaction, tags: transaction.tags || [] }
    // `prefill` is for "log again" — a brand-new transaction with most fields
    // copied from an existing one. We strip id/transferGroupId (must be
    // freshly generated for the new pair) and linkedExpenseId (the old txn
    // was created by an Expense entry; a manual re-log shouldn't be tied to
    // that same expense — otherwise deleting the expense would also wipe the
    // re-logged copy). Force date to today.
    if (prefill) {
      const {
        id: _id,
        transferGroupId: _tg,
        linkedExpenseId: _le,
        ...rest
      } = prefill
      const base = {
        ...DEFAULTS,
        ...rest,
        tags: prefill.tags || [],
        date: todayISO(),
        // Stringify numeric fields so the controlled inputs render cleanly
        quantity: rest.quantity != null ? String(rest.quantity) : '',
        price: rest.price != null ? String(rest.price) : '',
        totalValue: rest.totalValue != null ? String(rest.totalValue) : '',
      }
      return base
    }
    const base = { ...DEFAULTS, assetId: preselectedAssetId || '', type: preselectedType || 'buy' }
    // For a property sell, prefill qty=1 so the user only needs to type the sale price
    if (preselectedType === 'sell' && preselectedAssetId) {
      const a = data?.assets?.find(x => x.id === preselectedAssetId)
      if (a && (a.class === 'property' || ['business','art','collectibles','jewelry','vehicles'].includes(a.class))) {
        base.quantity = '1'
      }
    }
    // Pull persisted "last used" values so recurring entries don't require
    // re-typing the same source / destination every time. Only applied when
    // the field would otherwise be blank — never overwrite an explicit prop.
    const recents = getRecents()
    if (base.type === 'salary' && !base.source && recents[RECENT_KEYS.employer]) {
      base.source = recents[RECENT_KEYS.employer]
    }
    if (base.type === 'transfer' && !base.transferToAssetId && recents[RECENT_KEYS.transferToAssetId]) {
      // Only honor the recent destination if it still exists AND isn't the
      // same as the source — otherwise the modal would block submit.
      const recentTo = recents[RECENT_KEYS.transferToAssetId]
      const recentToAsset = data?.assets?.find(a => a.id === recentTo)
      if (recentToAsset && recentTo !== base.assetId) base.transferToAssetId = recentTo
    }
    return base
  })
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  // Holds the pending submit event when a favorite-asset sell is being
  // confirmed. Submitting is paused until the user clicks Confirm / Cancel.
  const [pendingFavoriteSell, setPendingFavoriteSell] = useState(false)
  const tagRef = useRef(null)

  // Past sources for the type-ahead helper. We pull every distinct source
  // string the user has used before so a new salary entry suggests "Acme",
  // "Consulting Co" etc instead of being a blank text box.
  const pastSources = useMemo(() => {
    const set = new Set()
    for (const t of data.transactions) {
      const s = (t.source || '').trim()
      if (s) set.add(s)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [data.transactions])

  const selectedAsset = data.assets.find(a => a.id === form.assetId)
  const availableTypes = selectedAsset
    ? getTransactionTypesForClass(selectedAsset.class)
    : []

  // Auto-set type when asset changes
  useEffect(() => {
    if (!selectedAsset) return
    const types = getTransactionTypesForClass(selectedAsset.class)
    if (!types.find(t => t.value === form.type)) {
      setForm(f => ({ ...f, type: types[0]?.value || 'buy' }))
    }
  }, [form.assetId])

  // Auto-calculate totalValue. CRITICAL: skip outflow types — those store
  // the amount directly in `price` + `totalValue` with `quantity: 0`, so
  // recomputing `qty * price` here would zero totalValue out (the underlying
  // bug that caused every expense / liability_payment / mortgage_payment to
  // persist with totalValue = 0 and rely on `|| price` fallbacks downstream).
  //
  // Also skip for DRIP dividends: `price` is the TOTAL cash dividend received,
  // `quantity` is the # of shares reinvested — so `qty × price` is nonsense
  // (e.g. 0.4 shares × $50 dividend = $20, understating the $50 income and
  // corrupting the reinvest-price display = totalValue / qty). For DRIP we
  // mirror price into totalValue so amount = totalVal || price downstream
  // gives the correct dividend figure.
  useEffect(() => {
    const OUTFLOW = new Set(['expense', 'liability_payment', 'mortgage_payment'])
    if (OUTFLOW.has(form.type)) return
    if (form.type === 'dividend' && form.reinvest) {
      const price = parseFloat(form.price)
      if (!isNaN(price)) {
        setForm(f => ({ ...f, totalValue: String(price) }))
      }
      return
    }
    const qty = parseFloat(form.quantity)
    const price = parseFloat(form.price)
    if (!isNaN(qty) && !isNaN(price)) {
      setForm(f => ({ ...f, totalValue: String((qty * price).toFixed(6)) }))
    }
  }, [form.quantity, form.price, form.type, form.reinvest])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addTag(tag) {
    const t = tag.trim().toLowerCase()
    if (!t || form.tags.includes(t)) return
    setForm(f => ({ ...f, tags: [...f.tags, t] }))
    setTagInput('')
  }

  function removeTag(tag) {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && form.tags.length) {
      removeTag(form.tags[form.tags.length - 1])
    }
  }

  const tagSuggestions = allUsedTags.filter(t =>
    tagInput && t.includes(tagInput.toLowerCase()) && !form.tags.includes(t)
  )

  const isIncomeType = INCOME_TYPES.includes(form.type)
  const isRevaluation = form.type === 'revaluation'
  const isBuySell = ['buy', 'sell', 'deposit', 'withdrawal', 'transfer'].includes(form.type)
  const isStaking = form.type === 'staking_reward'
  const isTransfer = form.type === 'transfer'
  const isSplit = form.type === 'split'
  const isDividend = form.type === 'dividend'
  // Cash outflow types (expense / liability_payment / mortgage_payment) need
  // their own amount field. Without this the user could pick the type but had
  // no UI to enter a value, so the transaction was saved with totalValue=0
  // and the cash balance silently never decreased.
  const isOutflow = ['expense', 'liability_payment', 'mortgage_payment'].includes(form.type)

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.assetId) return
    // Favorite-asset safety net: pause and show a confirmation prompt before
    // recording a Sell on a starred asset. Skipped for edits (where the sell
    // already exists) and once the user has clicked Confirm.
    if (!isEdit && form.type === 'sell' && !pendingFavoriteSell) {
      const a = data.assets.find(x => x.id === form.assetId)
      if (a?.favorite) {
        setPendingFavoriteSell(true)
        return
      }
    }
    const qty = parseFloat(form.quantity) || 0
    const price = parseFloat(form.price) || 0
    const totalVal = parseFloat(form.totalValue) || qty * price

    // Guard against over-selling / over-withdrawing — without this the cost
    // basis math attributes 100% of the over-sold proceeds as profit, and
    // cash balances can also go effectively negative on paper.
    if (!isEdit && (form.type === 'sell' || form.type === 'withdrawal' || form.type === 'transfer' || form.type === 'expense' || form.type === 'liability_payment')) {
      // Replay transactions in chronological order so a stock split (which
      // multiplies the running quantity) is applied BEFORE any later sell —
      // otherwise a 4-for-1 split + selling 350 of the now-400 shares
      // erroneously trips this guard against the pre-split 100. Mirror the
      // same case list calculateAssetHolding uses so the two stay in sync.
      const sorted = [...(data.transactions || [])]
        .filter(t => t.assetId === form.assetId)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      const owned = sorted.reduce((acc, t) => {
        const q = parseFloat(t.quantity) || 0
        const tv = parseFloat(t.totalValue) || q * (parseFloat(t.price) || 0)
        if (t.type === 'buy' || t.type === 'deposit') return acc + q
        if (t.type === 'sell' || t.type === 'withdrawal') return Math.max(0, acc - q)
        if (t.type === 'staking_reward') return acc + q
        // DRIP dividends reinvest at zero cost — the txn carries the new
        // share count in `quantity`. Without this a sell after a DRIP would
        // be blocked even though calculateAssetHolding gave the user those
        // shares.
        if (t.type === 'dividend' && t.reinvest) return acc + q
        // Stock splits multiply the running quantity by the ratio (stored in
        // `price`). Skipping this branch left the guard's view of "owned"
        // stuck at the pre-split share count.
        if (t.type === 'split') {
          const ratio = parseFloat(t.price) || 0
          return ratio > 0 ? acc * ratio : acc
        }
        if (selectedAsset?.class === 'cash' && (t.type === 'salary' || t.type === 'interest_income')) {
          return acc + (tv || (parseFloat(t.price) || 0))
        }
        if (t.type === 'expense' || t.type === 'liability_payment' || t.type === 'transfer') {
          return Math.max(0, acc - (tv || q * (parseFloat(t.price) || 0) || (parseFloat(t.price) || 0)))
        }
        return acc
      }, 0)
      const requested = (form.type === 'expense' || form.type === 'liability_payment' || form.type === 'transfer')
        ? (totalVal || qty * price || price)
        : qty
      if (requested > owned + 1e-9) {
        const cls = selectedAsset?.class === 'cash' ? 'available balance' : 'owned quantity'
        alert(`This would exceed your ${cls} (${owned.toLocaleString(undefined, { maximumFractionDigits: 6 })}). Adjust the amount or record a Revaluation/Deposit first.`)
        return
      }
    }

    const payload = {
      assetId: form.assetId,
      type: form.type,
      date: form.date,
      quantity: qty,
      price: price,
      totalValue: totalVal,
      notes: form.notes.trim(),
      tags: form.tags,
    }
    // Persist optional time (HH:MM) when the user provided one. Surfaced only
    // for cash-account transactions, so most rows still store date-only.
    if (form.time && /^\d{2}:\d{2}$/.test(form.time)) {
      payload.time = form.time
    }
    // Persist the DRIP flag so calculateAssetHolding adds reinvested shares
    if (isDividend && form.reinvest) payload.reinvest = true
    // Persist the income source if entered (employer / payer for salary,
    // or a freeform note for any other income type the user wants to tag).
    if (form.source && String(form.source).trim()) {
      payload.source = String(form.source).trim()
    }

    // Persist a few "last used" fields so recurring entries don't require
    // re-typing on the next open. Read on mount, written here on submit.
    function persistRecents() {
      const updates = {}
      if (form.type === 'salary' && form.source) updates[RECENT_KEYS.employer] = form.source
      if (INCOME_TYPES.includes(form.type) && selectedAsset?.class === 'cash') {
        updates[RECENT_KEYS.depositToAssetId] = form.assetId
      }
      if (['expense', 'liability_payment', 'mortgage_payment'].includes(form.type)) {
        updates[RECENT_KEYS.paidFromAssetId] = form.assetId
      }
      if (form.type === 'transfer') {
        updates[RECENT_KEYS.transferFromAssetId] = form.assetId
        if (form.transferToAssetId) updates[RECENT_KEYS.transferToAssetId] = form.transferToAssetId
      }
      setRecents(updates)
    }

    if (isEdit) {
      editTransaction(transaction.id, payload)
    } else {
      // Transfer creates a paired (transfer-out, deposit-in) record under a
      // shared groupId so both halves move together if the user later edits.
      if (form.type === 'transfer') {
        if (!form.transferToAssetId || form.transferToAssetId === form.assetId) {
          alert('Choose a destination cash account that is different from the source.')
          return
        }
        const target = data.assets.find(a => a.id === form.transferToAssetId)
        const sourceCcy = selectedAsset?.currency || 'USD'
        const targetCcy = target?.currency || sourceCcy
        const fx = getFxRate(sourceCcy, targetCcy, data.fxCache || {})
        const inTargetCcy = totalVal * fx
        const groupId = generateId()
        addTransaction({ ...payload, transferGroupId: groupId, notes: payload.notes || `Transfer to ${target?.name || ''}` })
        addTransaction({
          assetId: form.transferToAssetId,
          type: 'deposit',
          date: form.date,
          // Mirror the optional time onto the deposit leg so both halves of
          // the transfer share the same clock for the activity log sort.
          ...(payload.time ? { time: payload.time } : {}),
          quantity: inTargetCcy,
          price: 1,
          totalValue: inTargetCcy,
          notes: `Transfer from ${selectedAsset?.name || ''}${payload.notes ? ' · ' + payload.notes : ''}`,
          tags: ['transfer'],
          transferGroupId: groupId,
        })
        persistRecents()
        onClose()
        return
      }

      // Sell → optionally deposit proceeds into a chosen cash account.
      // Convert the proceeds from the sold asset's currency into the cash
      // account's currency so the deposit reflects what actually arrives.
      // Pair both txns under a `transferGroupId` so editing/deleting one
      // cascades to the other (no orphaned half-transactions).
      if (form.type === 'sell' && form.proceedsAccountId && totalVal > 0) {
        const target = data.assets.find(a => a.id === form.proceedsAccountId)
        if (target) {
          const sellCcy = selectedAsset?.currency || target.currency
          const fx = getFxRate(sellCcy, target.currency, data.fxCache || {})
          const inTargetCcy = totalVal * fx
          const groupId = generateId()
          addTransaction({ ...payload, transferGroupId: groupId })
          addTransaction({
            assetId: form.proceedsAccountId,
            type: 'deposit',
            date: form.date,
            quantity: inTargetCcy,
            price: 1,
            totalValue: inTargetCcy,
            notes: `Proceeds from ${selectedAsset?.name || 'sale'}${form.notes ? ' · ' + form.notes : ''}`,
            tags: ['proceeds'],
            transferGroupId: groupId,
          })
        } else {
          addTransaction(payload)
        }
      } else {
        addTransaction(payload)
      }
    }
    persistRecents()
    onClose()
  }

  const cashAccounts = data.assets.filter(a => a.class === 'cash')

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Transaction' : 'Add Transaction'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Asset selector */}
            <div className="form-group">
              <label>Asset *</label>
              <select
                value={form.assetId}
                onChange={e => set('assetId', e.target.value)}
                required
              >
                <option value="">— Select asset —</option>
                {ASSET_CLASSES.map(cls => {
                  const assets = data.assets.filter(a => a.class === cls.value)
                  if (!assets.length) return null
                  return (
                    <optgroup key={cls.value} label={`${cls.icon} ${cls.label}`}>
                      {assets.map(a => (
                        <option key={a.id} value={a.id}>{a.name}{a.symbol ? ` (${a.symbol})` : ''}</option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </div>

            {/* Transaction type */}
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Type *</label>
                <select
                  value={form.type}
                  onChange={e => set('type', e.target.value)}
                  disabled={!selectedAsset}
                >
                  {(selectedAsset ? availableTypes : [{ value: 'buy', label: 'Buy' }]).map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Date *</label>
                <input
                  type="date" value={form.date}
                  onChange={e => set('date', e.target.value)} required
                />
              </div>
              {/* Optional clock time for cash transactions — useful for users
                  who want to track exact deposit/withdrawal moments (e.g.
                  recording the time a paycheck cleared, or sequencing multiple
                  same-day transfers). Stored as HH:MM in a separate field
                  so date string comparisons across the app are unaffected. */}
              {selectedAsset?.class === 'cash' && (
                <div className="form-group mb-0">
                  <label>Time (optional)</label>
                  <input
                    type="time" value={form.time}
                    onChange={e => set('time', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Amount fields */}
            {(isBuySell || isStaking) && (() => {
              const isSingleUnit = SINGLE_UNIT_CLASSES.includes(selectedAsset?.class)
              // Cash flows (deposit / withdrawal / transfer) collapse the
              // qty + per-unit price pair into a single Amount field. Price
              // is always 1 for cash, so asking the user to type it is just
              // a footgun — leaving it blank silently saved transactions
              // with price=0 / totalValue=0, which then corrupted realized
              // P&L (withdrawal at price=0 attributes 100% of the withdrawn
              // amount as a realized loss against avg cost = 1).
              const isCashFlow = selectedAsset?.class === 'cash'
                && (form.type === 'deposit' || form.type === 'withdrawal' || form.type === 'transfer')
              if (isCashFlow) {
                return (
                  <div className="form-group">
                    <label>Amount ({selectedAsset?.currency || '—'}) *</label>
                    <input
                      key={`amt-${form.assetId}-${form.type}`}
                      type="number" step="any" min="0"
                      value={form.quantity}
                      onChange={e => {
                        set('quantity', e.target.value)
                        set('price', '1')
                        set('totalValue', e.target.value)
                      }}
                      placeholder="0.00"
                      required
                      autoFocus={!isEdit && !!form.assetId}
                    />
                  </div>
                )
              }
              if (isSingleUnit && isBuySell) {
                return (
                  <div className="form-group">
                    <label>
                      {form.type === 'sell' ? 'Sale Price' : 'Purchase Price'} ({selectedAsset?.currency || '—'}) *
                    </label>
                    <input
                      key={`price-${form.assetId}-${form.type}`}
                      type="number" step="any" min="0"
                      value={form.price}
                      onChange={e => {
                        set('price', e.target.value)
                        set('quantity', '1')
                      }}
                      placeholder={
                        selectedAsset?.class === 'property' ? 'e.g. 350000' :
                        selectedAsset?.class === 'vehicles' ? 'e.g. 25000'  :
                        'e.g. 5000'
                      }
                      required
                      autoFocus={!isEdit && !!form.assetId}
                    />
                  </div>
                )
              }
              return (
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>
                      {selectedAsset?.class === 'stocks'     ? '# of Shares *' :
                       selectedAsset?.class === 'crypto'     ? '# of Coins *' :
                       selectedAsset?.class === 'cash'       ? 'Amount *' :
                       selectedAsset?.class === 'bonds'      ? 'Face Value / Units *' :
                       selectedAsset?.class === 'commodities'? '# of Units (oz/barrels) *' :
                       'Quantity *'}
                    </label>
                    <input
                      key={`qty-${form.assetId}-${form.type}`}
                      type="number" step="any" min="0"
                      value={form.quantity}
                      onChange={e => set('quantity', e.target.value)}
                      placeholder="e.g. 10"
                      required={isBuySell}
                      autoFocus={!isEdit && !!form.assetId}
                    />
                  </div>
                  {!isStaking && (
                    <div className="form-group mb-0">
                      <label>Price per {selectedAsset?.class === 'cash' ? 'Unit' : 'Share'} ({selectedAsset?.currency || '—'}) *</label>
                      <input
                        type="number" step="any" min="0"
                        value={form.price}
                        onChange={e => set('price', e.target.value)}
                        placeholder={selectedAsset?.class === 'cash' ? '1' : 'e.g. 185.50'}
                        required={isBuySell}
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Outflow types — expense / liability_payment / mortgage_payment.
                Stores the amount in BOTH price and totalValue so downstream
                math (calculateAssetHolding) reduces the cash balance correctly
                regardless of which field it reads. */}
            {isOutflow && (
              <div className="form-group">
                <label>
                  Amount ({selectedAsset?.currency || '—'}) *
                </label>
                <input
                  type="number" step="any" min="0"
                  value={form.price}
                  onChange={e => {
                    set('price', e.target.value)
                    set('totalValue', e.target.value)
                    set('quantity', '0')
                  }}
                  placeholder="0.00"
                  required
                />
                <div className="form-hint" style={{ fontSize: 11 }}>
                  {form.type === 'expense' && 'Recorded as a cash outflow that reduces this account\'s balance.'}
                  {form.type === 'liability_payment' && 'Records a payment against a liability — link the matching liability separately if needed.'}
                  {form.type === 'mortgage_payment' && 'Logged for record-keeping on the property. Pay down the mortgage balance from the Liabilities page.'}
                </div>
              </div>
            )}

            {/* Revaluation: just enter total value */}
            {isRevaluation && (
              <div className="form-group">
                <label>New Total Value ({selectedAsset?.currency || '—'})</label>
                <input
                  type="number" step="any" min="0"
                  value={form.price}
                  onChange={e => set('price', e.target.value)}
                  placeholder="Enter current total value of asset"
                  required={isRevaluation}
                />
                <div className="form-hint">
                  Updates the current estimated value. Does not change cost basis.
                </div>
              </div>
            )}

            {/* Income: just enter total amount */}
            {isIncomeType && !isStaking && (
              <div className="form-group">
                <label>
                  Income Amount ({selectedAsset?.currency || '—'})
                  {form.type === 'dividend' && ' — total received'}
                </label>
                <input
                  type="number" step="any" min="0"
                  value={form.price}
                  onChange={e => {
                    set('price', e.target.value)
                    if (!form.reinvest) set('quantity', '1')
                  }}
                  placeholder="0.00"
                  required
                />
              </div>
            )}

            {/* Income SOURCE — who paid you. Critical for salary; useful for
                any income type the user wants to attribute to a specific payer. */}
            {isIncomeType && (
              <div className="form-group">
                <label>
                  {form.type === 'salary'
                    ? 'Source / Employer *'
                    : 'Source / Payer (optional)'}
                </label>
                <input
                  type="text"
                  value={form.source}
                  onChange={e => set('source', e.target.value)}
                  list="txn-source-suggestions"
                  placeholder={
                    form.type === 'salary' ? 'e.g. Acme Corp, Side gig, Consulting'
                      : form.type === 'rental_income' ? 'e.g. Tenant name (defaults to property)'
                      : form.type === 'dividend' ? 'e.g. Apple Inc (defaults to stock)'
                      : form.type === 'interest_income' ? 'e.g. HSBC Savings (defaults to account)'
                      : 'e.g. Patreon, Coinbase staking'
                  }
                  required={form.type === 'salary'}
                  autoComplete="off"
                />
                <datalist id="txn-source-suggestions">
                  {pastSources.map(s => <option key={s} value={s} />)}
                </datalist>
                <div className="form-hint" style={{ fontSize: 11 }}>
                  {form.type === 'salary'
                    ? 'WHO paid this salary — used to keep multiple jobs separate even when they all land in the same checking account.'
                    : 'Optional. Defaults to the asset name if blank. Lets you split a single asset into multiple income streams (e.g. two tenants in one property).'}
                </div>
              </div>
            )}

            {/* DRIP: dividend reinvested into additional shares */}
            {isDividend && (
              <div className="form-group" style={{ background: 'var(--bg-secondary)', padding: 10, borderRadius: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: form.reinvest ? 8 : 0 }}>
                  <input
                    type="checkbox"
                    checked={!!form.reinvest}
                    onChange={e => {
                      set('reinvest', e.target.checked)
                      if (!e.target.checked) set('quantity', '1')
                    }}
                    style={{ width: 'auto' }}
                  />
                  <span style={{ fontSize: 13 }}>Reinvested in additional shares (DRIP)</span>
                </label>
                {form.reinvest && (
                  <div className="form-row">
                    <div className="form-group mb-0">
                      <label>Shares Received</label>
                      <input
                        type="number" step="any" min="0"
                        value={form.quantity}
                        onChange={e => set('quantity', e.target.value)}
                        placeholder="e.g. 0.4521"
                        required
                      />
                    </div>
                    <div className="form-group mb-0">
                      <label>Reinvest Price ({selectedAsset?.currency || '—'})</label>
                      <input
                        type="number" step="any" min="0"
                        value={form.totalValue && form.quantity ? (parseFloat(form.totalValue) / parseFloat(form.quantity)).toFixed(4) : ''}
                        readOnly
                        placeholder="auto"
                        style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}
                      />
                    </div>
                  </div>
                )}
                <div className="form-hint" style={{ marginTop: 6, fontSize: 11 }}>
                  Reinvested shares add to your position at zero additional cost (the dividend itself is the cost). Avg cost falls accordingly.
                </div>
              </div>
            )}

            {/* Stock split: just a ratio */}
            {isSplit && (
              <div className="form-group">
                <label>Split Ratio</label>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <input
                      type="number" step="any" min="0"
                      value={form.price}
                      onChange={e => { set('price', e.target.value); set('quantity', '0') }}
                      placeholder="2 for a 2-for-1, 0.5 for a 1-for-2 reverse"
                      required
                    />
                  </div>
                </div>
                <div className="form-hint" style={{ fontSize: 11 }}>
                  Shares multiply by this ratio, total cost basis stays the same. Examples: AAPL 4-for-1 → enter <strong>4</strong>; reverse 1-for-10 → enter <strong>0.1</strong>.
                </div>
              </div>
            )}

            {/* Total value display */}
            {isBuySell && parseFloat(form.totalValue) > 0 && (
              <div className="form-group" style={{ marginTop: -6 }}>
                <label>Total Value</label>
                <div style={{
                  padding: '8px 10px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text)',
                }}>
                  {formatCurrency(parseFloat(form.totalValue), selectedAsset?.currency || 'USD')}
                </div>
              </div>
            )}

            {/* Sell → deposit proceeds into a cash account */}
            {!isEdit && form.type === 'sell' && cashAccounts.length > 0 && parseFloat(form.totalValue) > 0 && (
              <div className="form-group">
                <label>Deposit Proceeds Into</label>
                <select
                  value={form.proceedsAccountId}
                  onChange={e => set('proceedsAccountId', e.target.value)}
                >
                  <option value="">— Don't move money (record sale only) —</option>
                  {cashAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
                {form.proceedsAccountId && (() => {
                  const target = data.assets.find(a => a.id === form.proceedsAccountId)
                  const sellCcy = selectedAsset?.currency || target?.currency
                  const fx = getFxRate(sellCcy, target?.currency || 'USD', data.fxCache || {})
                  const proceeds = parseFloat(form.totalValue) * fx
                  return (
                    <div className="form-hint" style={{ color: 'var(--gain)' }}>
                      ↳ {formatCurrency(proceeds, target?.currency || 'USD')} will be deposited
                      into <strong>{target?.name}</strong>
                      {sellCcy !== target?.currency && (
                        <span> · converted from {formatCurrency(parseFloat(form.totalValue), sellCcy)} at {fx.toFixed(4)} {sellCcy}/{target?.currency}</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Transfer → choose destination cash account */}
            {!isEdit && isTransfer && (
              <div className="form-group">
                <label>Transfer To *</label>
                <select
                  value={form.transferToAssetId}
                  onChange={e => set('transferToAssetId', e.target.value)}
                  required
                >
                  <option value="">— Select destination account —</option>
                  {cashAccounts.filter(a => a.id !== form.assetId).map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
                {form.transferToAssetId && parseFloat(form.totalValue) > 0 && (() => {
                  const target = data.assets.find(a => a.id === form.transferToAssetId)
                  const sourceCcy = selectedAsset?.currency || target?.currency
                  const fx = getFxRate(sourceCcy, target?.currency || sourceCcy, data.fxCache || {})
                  const arrives = parseFloat(form.totalValue) * fx
                  return (
                    <div className="form-hint" style={{ color: 'var(--gain)' }}>
                      ↳ {formatCurrency(arrives, target?.currency || 'USD')} will land
                      in <strong>{target?.name}</strong>
                      {sourceCcy !== target?.currency && (
                        <span> · converted at {fx.toFixed(4)} {sourceCcy}/{target?.currency}</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Notes */}
            <div className="form-group">
              <label>Notes</label>
              <input
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Optional notes..."
              />
            </div>

            {/* Tags */}
            <div className="form-group mb-0" style={{ position: 'relative' }}>
              <label>Tags</label>
              <div className="tags-input-wrap" onClick={() => tagRef.current?.focus()}>
                {form.tags.map(tag => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)}>×</button>
                  </span>
                ))}
                <input
                  ref={tagRef}
                  value={tagInput}
                  onChange={e => { setTagInput(e.target.value); setShowTagSuggestions(true) }}
                  onKeyDown={handleTagKeyDown}
                  onFocus={() => setShowTagSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                  placeholder={form.tags.length ? '' : 'Add tags… (Enter to add)'}
                />
              </div>
              {showTagSuggestions && tagSuggestions.length > 0 && (
                <div className="tags-suggestions" style={{ top: '100%', left: 0, right: 0 }}>
                  {tagSuggestions.map(t => (
                    <button key={t} type="button" onMouseDown={() => addTag(t)}>{t}</button>
                  ))}
                </div>
              )}
            </div>

          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>

      {/* Confirmation gate for selling a favorite-flagged asset. Re-submits
          the form synthetically once the user confirms so the rest of the
          sell flow (proceeds deposit, transfer pairing, etc.) runs unchanged. */}
      {pendingFavoriteSell && (() => {
        const a = data.assets.find(x => x.id === form.assetId)
        return (
          <div className="modal-backdrop" onClick={() => setPendingFavoriteSell(false)}>
            <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">⭐ Confirm Sell — Favorite Asset</span>
                <button type="button" className="modal-close" onClick={() => setPendingFavoriteSell(false)}>×</button>
              </div>
              <div className="modal-body">
                <p style={{ marginBottom: 8 }}>
                  You're about to record a <strong>Sell</strong> against your
                  favorite-flagged asset <strong>{a?.name || 'this asset'}</strong>.
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Continue only if this is intentional. You can remove the
                  favorite flag by editing the asset.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPendingFavoriteSell(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleSubmit({ preventDefault: () => {} })}
                >
                  Yes, Sell {a?.name || 'Asset'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
