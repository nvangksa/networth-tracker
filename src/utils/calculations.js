// Asset classes that use live market prices vs manual valuation
export const MARKET_CLASSES = ['stocks', 'crypto', 'commodities']
export const MANUAL_CLASSES = ['property', 'private_equity', 'collectibles', 'bonds', 'vehicles', 'jewelry', 'art', 'business', 'banknotes', 'other']
export const DEPRECIATING_CLASSES = ['vehicles'] // default depreciation applied
export const CASH_CLASS = 'cash'

// Common first — when a user opens "Add Asset" the four most-likely classes
// (cash, stocks, crypto, property) sit at the top; everything else follows.
// The order also dictates the alphabetical-ish grouping inside the asset
// selector dropdown across the app, so we keep cash-first to match how most
// users will register their first asset (a checking account).
export const ASSET_CLASSES = [
  { value: 'cash',          label: 'Cash & Savings',    icon: '💵' },
  { value: 'stocks',        label: 'Stocks',            icon: '📈' },
  { value: 'crypto',        label: 'Crypto',            icon: '🪙' },
  { value: 'property',      label: 'Property',          icon: '🏠' },
  { value: 'bonds',         label: 'Bonds & Fixed Income', icon: '📜' },
  { value: 'commodities',   label: 'Commodities',       icon: '🪨' },
  { value: 'vehicles',      label: 'Vehicles',          icon: '🚗', defaultDepreciation: 15 },
  { value: 'private_equity',label: 'Private Equity',    icon: '🏢' },
  { value: 'business',      label: 'Business',          icon: '🏪' },
  { value: 'art',           label: 'Art',               icon: '🖼️' },
  { value: 'collectibles',  label: 'Collectibles',      icon: '🎨' },
  { value: 'jewelry',       label: 'Jewelry & Watches', icon: '💎' },
  { value: 'banknotes',     label: 'Bank Notes',        icon: '💴' },
  { value: 'other',         label: 'Other',             icon: '📦' },
]

const ALL_TRADABLE = ['stocks','crypto','commodities','bonds','private_equity','collectibles','vehicles','jewelry','art','business','banknotes','other','property']
const ALL_REVALUABLE = ['property','private_equity','collectibles','bonds','vehicles','jewelry','art','business','banknotes','other','cash']

export const TRANSACTION_TYPES = [
  { value: 'buy',            label: 'Buy',              short: 'buy',       classes: ALL_TRADABLE },
  { value: 'sell',           label: 'Sell',             short: 'sell',      classes: ALL_TRADABLE },
  { value: 'deposit',        label: 'Deposit',          short: 'deposit',   classes: ['cash'] },
  { value: 'withdrawal',     label: 'Withdrawal',       short: 'withdraw',  classes: ['cash'] },
  { value: 'revaluation',    label: 'Revaluation',      short: 'reval',     classes: ALL_REVALUABLE },
  { value: 'rental_income',   label: 'Rental Income',     short: 'rent',     classes: ['property'] },
  { value: 'mortgage_payment',label: 'Mortgage Payment',  short: 'mortgage', classes: ['property'] },
  { value: 'expense',         label: 'Expense / Bill',    short: 'expense',  classes: ['cash'] },
  { value: 'liability_payment',label: 'Liability Payment',short: 'pay',      classes: ['cash'] },
  { value: 'dividend',       label: 'Dividend / Distribution', short: 'dividend', classes: ['stocks','bonds','private_equity','business'] },
  { value: 'staking_reward', label: 'Staking Reward',   short: 'staking',   classes: ['crypto'] },
  { value: 'interest_income',label: 'Interest Income',  short: 'interest',  classes: ['cash','bonds'] },
  { value: 'salary',         label: 'Salary / Wages',   short: 'salary',    classes: ['cash'] },
  // Transfer: moves money out of THIS cash account. The matching deposit on
  // the destination account is a separate `deposit` txn (with the same
  // `transferGroupId` for traceability) created by the modal — keeps the
  // accounting symmetric without special-casing the destination side.
  { value: 'transfer',       label: 'Transfer Out',     short: 'transfer',  classes: ['cash'] },
  // Stock split: stores the split RATIO in `price` (e.g. 2 for a 2-for-1
  // split, 0.5 for a 1-for-2 reverse split). Quantity is multiplied by the
  // ratio; avg cost is divided by it — total cost basis is preserved.
  { value: 'split',          label: 'Stock Split',      short: 'split',     classes: ['stocks', 'crypto'] },
]

// Short label lookup for compact badge display in tables
export const TXN_SHORT = Object.fromEntries(TRANSACTION_TYPES.map(t => [t.value, t.short]))

export const INCOME_TYPES = ['rental_income', 'dividend', 'staking_reward', 'interest_income', 'salary']
// Passive subset — everything except salary (for "Past Year Passive Income")
export const PASSIVE_INCOME_TYPES = ['rental_income', 'dividend', 'staking_reward', 'interest_income']

export const CURRENCIES = ['USD','IDR','SGD','EUR','GBP','JPY','AUD','CAD']

// Best-effort currency guess from the browser locale. The onboarding
// wizard uses this to pre-select a sensible default on first run so the
// user doesn't have to scroll a list just to confirm "yes, USD".
//
// We use Intl.Locale to read the region, then map it. For locales we don't
// recognize the function returns null — the wizard falls back to USD.
//
// Currencies we restrict ourselves to are the eight in CURRENCIES above:
// USD / IDR / SGD / EUR / GBP / JPY / AUD / CAD. Anything outside this set
// (e.g. INR, KRW) falls back to USD because the FX layer can't yet display
// totals in unsupported base currencies anyway — better to suggest a
// supported default than auto-pick something that breaks.
const REGION_TO_CURRENCY = {
  US: 'USD',
  ID: 'IDR',
  SG: 'SGD',
  GB: 'GBP',
  IE: 'EUR', AT: 'EUR', BE: 'EUR', DE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', IT: 'EUR', LU: 'EUR', NL: 'EUR', PT: 'EUR',
  EE: 'EUR', LV: 'EUR', LT: 'EUR', SK: 'EUR', SI: 'EUR', CY: 'EUR',
  MT: 'EUR', HR: 'EUR',
  JP: 'JPY',
  AU: 'AUD',
  CA: 'CAD',
}

export function guessBaseCurrency() {
  try {
    // Prefer Intl.Locale().region when available — modern, exact.
    const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    let region = null
    if (typeof Intl !== 'undefined' && Intl.Locale) {
      try {
        region = new Intl.Locale(lang).region || null
      } catch { /* malformed locale string */ }
    }
    // Fallback: parse the trailing "-XX" off the BCP-47 tag manually.
    if (!region) {
      const m = lang.match(/-([A-Z]{2})$/i)
      if (m) region = m[1].toUpperCase()
    }
    if (region && REGION_TO_CURRENCY[region]) return REGION_TO_CURRENCY[region]
  } catch { /* ignore, fall through */ }
  return 'USD'
}

export function getTransactionTypesForClass(assetClass) {
  return TRANSACTION_TYPES.filter(t => t.classes.includes(assetClass))
}

export function getFxRate(from, to, fxCache) {
  if (from === to) return 1
  // Defensive default — callers occasionally pass `data.fxCache` before
  // load completes, and a missing cache used to throw TypeError on the
  // bracket access below.
  const cache = fxCache || {}
  const direct = cache[`${from}_${to}`]
  if (direct?.rate) return direct.rate
  // Try inverse
  const inverse = cache[`${to}_${from}`]
  if (inverse?.rate) return 1 / inverse.rate
  // Triangulate via USD when direct/inverse pair is missing (e.g. AUD→JPY
  // derived from AUD→USD × USD→JPY). Yahoo and the free API always give us
  // USD-anchored rates, so this works for any currency pair.
  if (from !== 'USD' && to !== 'USD') {
    const fromUsd = cache[`${from}_USD`]?.rate
      ?? (cache[`USD_${from}`]?.rate ? 1 / cache[`USD_${from}`].rate : null)
    const usdTo = cache[`USD_${to}`]?.rate
      ?? (cache[`${to}_USD`]?.rate ? 1 / cache[`${to}_USD`].rate : null)
    if (fromUsd && usdTo) return fromUsd * usdTo
  }
  return 1 // fallback: 1:1 (will show warning in UI)
}

export function convertCurrency(amount, from, to, fxCache) {
  return amount * getFxRate(from, to, fxCache)
}

export function calculateAssetHolding(asset, allTransactions, pricesCache, fxCache, baseCurrency) {
  const txns = allTransactions
    .filter(t => t.assetId === asset.id)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  let quantity = 0
  let totalCostNative = 0
  let realizedPnLNative = 0
  let latestRevalPrice = null
  let latestRevalDate = null
  let hasSold = false
  let totalSoldValueNative = 0
  let lastSellDate = null
  const incomeItems = []

  for (const txn of txns) {
    const qty = parseFloat(txn.quantity) || 0
    const price = parseFloat(txn.price) || 0
    const totalVal = parseFloat(txn.totalValue) || (qty * price)

    switch (txn.type) {
      case 'buy': {
        quantity += qty
        totalCostNative += qty * price
        break
      }
      case 'deposit': {
        // For cash: qty = amount, price = 1
        quantity += qty
        totalCostNative += qty * price
        break
      }
      case 'sell': {
        const avgCost = quantity > 0 ? totalCostNative / quantity : 0
        const soldCost = qty * avgCost
        realizedPnLNative += qty * price - soldCost
        quantity = Math.max(0, quantity - qty)
        totalCostNative = Math.max(0, totalCostNative - soldCost)
        hasSold = true
        totalSoldValueNative += qty * price
        lastSellDate = txn.date
        break
      }
      case 'withdrawal': {
        const avgCost = quantity > 0 ? totalCostNative / quantity : 0
        const withdrawnCost = qty * avgCost
        realizedPnLNative += qty * price - withdrawnCost
        quantity = Math.max(0, quantity - qty)
        totalCostNative = Math.max(0, totalCostNative - withdrawnCost)
        // Only non-cash positions are "sold out" when emptied. A cash account
        // that briefly hits zero is still an open account — the user will
        // deposit into it again. Without this gate, an emptied cash account
        // got priceSource='sold' / currentPrice=0 and disappeared from the
        // sold-out heuristics, plus showed a confusing "Sold" badge in detail.
        if (asset.class !== CASH_CLASS) hasSold = true
        break
      }
      case 'revaluation': {
        // price = new total value of the whole asset (quantity=1 for property)
        latestRevalPrice = price
        latestRevalDate = txn.date
        break
      }
      case 'staking_reward': {
        // Adds tokens at $0 cost (lowers avg cost)
        quantity += qty
        incomeItems.push({ ...txn, amount: totalVal || qty * price })
        break
      }
      case 'rental_income': {
        incomeItems.push({ ...txn, amount: totalVal || price })
        break
      }
      case 'dividend': {
        const amount = totalVal || price
        incomeItems.push({ ...txn, amount })
        // DRIP: when the dividend was auto-reinvested, the user enters how
        // many shares they got at what reinvest price (in `quantity` and
        // `reinvestPrice`). The shares add to the position at zero ADDITIONAL
        // cost (the cost is the dividend itself, already income-tagged).
        if (txn.reinvest && parseFloat(txn.quantity) > 0) {
          quantity += parseFloat(txn.quantity) || 0
          // Cost stays unchanged — these shares were paid for by the dividend
          // which is already counted as income; double-counting cost would
          // overstate unrealized P&L.
        }
        break
      }
      case 'interest_income':
      case 'salary': {
        // For cash assets, this is money landing IN the account so it must
        // also increase the balance. For non-cash assets (e.g. interest from
        // a bond) the income is recorded but the asset quantity stays put.
        const amount = totalVal || price
        incomeItems.push({ ...txn, amount })
        if (asset.class === 'cash') {
          quantity += amount
          totalCostNative += amount
        }
        break
      }
      case 'expense':
      case 'liability_payment':
      case 'transfer': {
        // Cash outflows that reduce the account balance like a withdrawal
        // but are tagged separately so they show up as expenses (or
        // payments / inter-account transfers) instead of generic withdrawals.
        const amount = totalVal || (qty * price) || price
        quantity = Math.max(0, quantity - amount)
        totalCostNative = Math.max(0, totalCostNative - amount)
        break
      }
      case 'mortgage_payment': {
        // Recorded on the property: doesn't change property value or
        // quantity. The actual cash outflow + liability balance change is
        // applied via the Liabilities page payment flow when the user
        // selects a source cash account.
        break
      }
      case 'split': {
        // Stock split: ratio lives in `price` (2 = 2-for-1, 0.5 = 1-for-2
        // reverse). Multiply quantity, cost basis stays the same in total
        // (avg cost per unit divides by the ratio implicitly via the new
        // larger quantity). Without this, an AAPL 4-for-1 silently halves
        // your apparent shares vs the broker.
        const ratio = parseFloat(price) || 0
        if (ratio > 0) {
          quantity = quantity * ratio
          // totalCostNative stays the same (split doesn't change basis)
        }
        break
      }
    }
  }

  const avgCostNative = quantity > 0 ? totalCostNative / quantity : 0

  // Determine current price (native currency)
  let currentPrice = 0
  let priceSource = 'none'
  let manualPriceNeeded = false

  if (asset.class === CASH_CLASS) {
    currentPrice = 1
    priceSource = 'face'
  } else if (MANUAL_CLASSES.includes(asset.class)) {
    if (latestRevalPrice !== null) {
      currentPrice = latestRevalPrice
      priceSource = 'revaluation'
    } else if (asset.manualPrice) {
      currentPrice = parseFloat(asset.manualPrice)
      priceSource = 'manual'
    } else if (asset.depreciationRate && (asset.purchaseDate || txns.find(t => t.type === 'buy'))) {
      // Auto-depreciation: value = originalCost * (1 - rate/100) ^ years
      const rate = parseFloat(asset.depreciationRate) / 100
      const firstBuy = txns.find(t => t.type === 'buy')
      const startDate = asset.purchaseDate || firstBuy?.date
      const years = Math.max(0, (Date.now() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000))
      const originalValue = firstBuy ? parseFloat(firstBuy.quantity) * parseFloat(firstBuy.price) : avgCostNative * quantity
      const depreciated = originalValue * Math.pow(1 - rate, years)
      // Express as per-unit price so downstream math works
      currentPrice = quantity > 0 ? depreciated / quantity : depreciated
      priceSource = 'depreciated'
    } else {
      // Use original cost as fallback
      currentPrice = avgCostNative
      priceSource = 'cost'
      manualPriceNeeded = true
    }
  } else {
    // Market asset
    const cached = pricesCache[asset.symbol]
    if (cached?.price) {
      currentPrice = parseFloat(cached.price)
      priceSource = 'api'
    } else if (asset.manualPrice) {
      currentPrice = parseFloat(asset.manualPrice)
      priceSource = 'manual'
    } else {
      currentPrice = avgCostNative
      manualPriceNeeded = true
      priceSource = 'cost'
    }
  }

  // For manual assets, manualPrice/revaluation represents TOTAL value — treat
  // qty as 1 regardless of the underlying quantity. Without this, a user with
  // 10 collectibles revalued to $8000 saw currentValueNative = 10 × 8000 =
  // $80,000 instead of $8000. The prior guard only forced qty=1 when
  // quantity===0 (the "ghost asset / no buy txn" case) and silently broke
  // for any manual asset with quantity > 1.
  //
  // 'depreciated' is exempt because that branch already computes currentPrice
  // as per-unit (depreciated / quantity) when quantity > 0 — multiplying by
  // quantity there gives the correct total. We still force qty=1 for
  // depreciated when quantity===0 to handle the ghost-asset case.
  //
  // Sold-out positions (hasSold && quantity===0) skip virtualization so their
  // value collapses to zero — they belong in Realized P&L, not active pages.
  let effectiveQty = quantity
  const isSoldOut = hasSold && quantity === 0
  if (MANUAL_CLASSES.includes(asset.class) && !isSoldOut && currentPrice > 0) {
    if (priceSource === 'revaluation' || priceSource === 'manual') {
      effectiveQty = 1
    } else if (priceSource === 'depreciated' && quantity === 0) {
      effectiveQty = 1
    }
  }
  if (isSoldOut) {
    currentPrice = 0
    priceSource = 'sold'
  }
  const currentValueNative = effectiveQty * currentPrice
  const unrealizedPnLNative = currentValueNative - totalCostNative
  const unrealizedPnLPct = totalCostNative > 0
    ? (unrealizedPnLNative / totalCostNative) * 100 : 0

  const rate = getFxRate(asset.currency, baseCurrency, fxCache)

  // Fractional ownership: e.g. 0.5 = 50% (you own half of the underlying asset).
  // Default 1 (full ownership). Affects value, cost, P&L, income — NOT quantity
  // (quantity stays the raw underlying count) and NOT mortgage balance (user
  // should enter their share of the mortgage directly).
  //
  // Exception: for `business` and `private_equity`, the user enters their OWN
  // stake's value directly (investment amount or share-count × per-share). The
  // ownership % is informational metadata that describes what slice of the
  // company those numbers represent — so we don't double-scale.
  const ownershipRaw = asset.ownershipPct
  const ownership = (ownershipRaw === undefined || ownershipRaw === null || ownershipRaw === '' || isNaN(parseFloat(ownershipRaw)))
    ? 1
    : Math.max(0, parseFloat(ownershipRaw) / 100)
  const ownershipScales = asset.class !== 'business' && asset.class !== 'private_equity'
  const scale = ownershipScales ? ownership : 1

  const ownedValueNative = currentValueNative * scale
  const ownedCostNative = totalCostNative * scale
  const ownedUnrealizedNative = unrealizedPnLNative * scale
  const ownedRealizedNative = realizedPnLNative * scale

  const currentValueBase = ownedValueNative * rate
  const costBasisBase = ownedCostNative * rate
  const unrealizedPnLBase = ownedUnrealizedNative * rate
  const realizedPnLBase = ownedRealizedNative * rate
  const totalIncomeNative = incomeItems.reduce((s, i) => s + (i.amount || 0), 0) * scale
  const totalIncomeBase = totalIncomeNative * rate

  // Property net equity (mortgage is NOT scaled — user enters their own share)
  let netEquityNative = null
  let netEquityBase = null
  if (asset.class === 'property') {
    const mb = parseFloat(asset.mortgageBalance) || 0
    netEquityNative = ownedValueNative - mb
    netEquityBase = netEquityNative * rate
  }

  return {
    ...asset,
    quantity,
    ownershipPct: ownership * 100,
    avgCostNative,
    currentPrice,
    currentValueNative: ownedValueNative,
    fullValueNative: currentValueNative, // pre-ownership value of the whole asset
    currentValueBase,
    costBasisNative: ownedCostNative,
    costBasisBase,
    unrealizedPnLNative: ownedUnrealizedNative,
    unrealizedPnLBase,
    unrealizedPnLPct,
    realizedPnLNative: ownedRealizedNative,
    realizedPnLBase,
    totalIncomeNative,
    totalIncomeBase,
    priceSource,
    manualPriceNeeded,
    netEquityNative,
    netEquityBase,
    latestRevalDate,
    incomeItems,
    rate,
    isSoldOut,
    hasSold,
    lastSellDate,
  }
}

export function calculateHoldings(assets, transactions, pricesCache, fxCache, baseCurrency) {
  return assets.map(a =>
    calculateAssetHolding(a, transactions, pricesCache, fxCache, baseCurrency)
  )
}

// ── Historical reconstruction ────────────────────────────────────────────
// Replay transactions up to `dateISO` to derive holdings at that date.
// For current price we use: last revaluation ≤ date (manual assets) or
// the live price cache (market assets — we lack historical price data).
// For cost basis we use transactions up to `dateISO` only.
// Liabilities are assumed constant (no per-transaction history) — we return
// the current total liabilities balance as an approximation.
// Same reconstruction logic as computeNetWorthAsOf but only sums asset classes
// in `classes`. Used for per-class historical value charts (Markets, Cash, …)
// so the line reflects buys/sells back-dated correctly without waiting for
// snapshots to roll over.
export function computeAssetClassValueAsOf(data, dateISO, baseCurrency, classes) {
  const cutoff = dateISO
  const txnsUpTo = data.transactions.filter(t => (t.date || '') <= cutoff)
  const classSet = new Set(classes)
  let totalBase = 0
  for (const asset of data.assets) {
    if (!classSet.has(asset.class)) continue
    const firstTxn = txnsUpTo
      .filter(t => t.assetId === asset.id)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]
    const purchaseDate = asset.purchaseDate || firstTxn?.date
    if (!firstTxn && (!purchaseDate || purchaseDate > cutoff)) continue
    const h = calculateAssetHolding(
      { ...asset },
      txnsUpTo,
      data.pricesCache || {},
      data.fxCache || {},
      baseCurrency
    )
    totalBase += h.currentValueBase || 0
  }
  return { date: dateISO, value: totalBase }
}

export function computeNetWorthAsOf(data, dateISO, baseCurrency) {
  const cutoff = dateISO
  const txnsUpTo = data.transactions.filter(t => (t.date || '') <= cutoff)

  let totalAssetsBase = 0
  for (const asset of data.assets) {
    // Skip assets created (first txn) after cutoff — they didn't exist yet
    const firstTxn = txnsUpTo
      .filter(t => t.assetId === asset.id)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]
    // If the asset had no txns up to cutoff AND no purchaseDate ≤ cutoff, skip
    const purchaseDate = asset.purchaseDate || firstTxn?.date
    if (!firstTxn && (!purchaseDate || purchaseDate > cutoff)) continue

    const h = calculateAssetHolding(
      { ...asset },
      txnsUpTo,
      data.pricesCache || {},
      data.fxCache || {},
      baseCurrency
    )
    totalAssetsBase += h.currentValueBase || 0
  }

  // Liabilities: exclude those that didn't exist yet at the cutoff date.
  // For legacy liabilities without an explicit startDate we infer one so we
  // don't show a mortgage existing before the property it backs:
  //   1. If the liability name resembles an asset name (e.g. "Villa Mortgage"
  //      matches "Jakarta Villa") use that asset's purchaseDate / first txn.
  //   2. Otherwise fall back to the earliest transaction date in the dataset.
  // Without inference a 2021 cutoff with a 2022-purchased property + its
  // legacy mortgage would yield a negative net worth.
  const inferLiabilityStart = (liability) => {
    if (liability.startDate) return liability.startDate
    const nameLower = (liability.name || '').toLowerCase()
    if (nameLower) {
      // Match on shared word ≥ 4 chars (filters "and", "the", "for", etc.)
      const words = nameLower.split(/\s+/).filter(w => w.length >= 4)
      let bestAsset = null
      for (const a of data.assets) {
        const aname = (a.name || '').toLowerCase()
        if (!aname) continue
        // For mortgages, prefer property assets
        if (liability.type === 'mortgage' && a.class !== 'property') continue
        if (words.some(w => aname.includes(w))) { bestAsset = a; break }
      }
      if (bestAsset) {
        const firstAssetTxn = (data.transactions || [])
          .filter(t => t.assetId === bestAsset.id)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]
        const inferred = bestAsset.purchaseDate || firstAssetTxn?.date
        if (inferred) return inferred
      }
    }
    // Fallback: earliest transaction date in the dataset. If there are no
    // transactions either we have no way to infer when this liability
    // started — default to today so it shows up only at the latest
    // reconstruction point, rather than being treated as having existed
    // since the dawn of time (returning '' used to make the > cutoff check
    // always false, including it everywhere).
    const earliestTxn = (data.transactions || [])
      .map(t => t.date)
      .filter(Boolean)
      .sort()[0]
    return earliestTxn || todayISO()
  }

  const totalLiabilitiesBase = (data.liabilities || []).reduce((s, l) => {
    const effectiveStart = inferLiabilityStart(l)
    if (effectiveStart && effectiveStart > cutoff) return s
    const rate = getFxRate(l.currency, baseCurrency, data.fxCache || {})
    return s + (parseFloat(l.balance) || 0) * rate
  }, 0)

  return {
    date: dateISO,
    totalAssets: totalAssetsBase,
    totalLiabilities: totalLiabilitiesBase,
    netWorth: totalAssetsBase - totalLiabilitiesBase,
    reconstructed: true,
  }
}

export function calculateNetWorth(holdings, liabilities, fxCache, baseCurrency) {
  const totalAssetsBase = holdings.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  const totalLiabilitiesBase = liabilities.reduce((s, l) => {
    const rate = getFxRate(l.currency, baseCurrency, fxCache)
    return s + (parseFloat(l.balance) || 0) * rate
  }, 0)
  return {
    totalAssetsBase,
    totalLiabilitiesBase,
    netWorthBase: totalAssetsBase - totalLiabilitiesBase,
  }
}

export function getAllocationByClass(holdings) {
  const byClass = {}
  for (const h of holdings) {
    const cls = h.class || 'other'
    byClass[cls] = (byClass[cls] || 0) + (h.currentValueBase || 0)
  }
  return byClass
}

export function getTotalPassiveIncome(transactions, fxCache, baseCurrency, assets) {
  const incomeTypes = INCOME_TYPES
  let total = 0
  for (const txn of transactions) {
    if (!incomeTypes.includes(txn.type)) continue
    const asset = assets.find(a => a.id === txn.assetId)
    const currency = asset?.currency || 'USD'
    const amount = parseFloat(txn.totalValue) || parseFloat(txn.price) || 0
    total += amount * getFxRate(currency, baseCurrency, fxCache)
  }
  return total
}

// Passive income only (excludes salary) — optional `sinceDate` ISO filter
export function getPassiveIncomeSince(transactions, fxCache, baseCurrency, assets, sinceISO) {
  let total = 0
  for (const txn of transactions) {
    if (!PASSIVE_INCOME_TYPES.includes(txn.type)) continue
    if (sinceISO && txn.date < sinceISO) continue
    const asset = assets.find(a => a.id === txn.assetId)
    const currency = asset?.currency || 'USD'
    const amount = parseFloat(txn.totalValue) || parseFloat(txn.price) || 0
    total += amount * getFxRate(currency, baseCurrency, fxCache)
  }
  return total
}

export function getIncomeByMonth(transactions, assets, fxCache, baseCurrency) {
  const result = {}
  for (const txn of transactions) {
    if (!INCOME_TYPES.includes(txn.type)) continue
    const asset = assets.find(a => a.id === txn.assetId)
    const currency = asset?.currency || 'USD'
    const amount = (parseFloat(txn.totalValue) || parseFloat(txn.price) || 0)
      * getFxRate(currency, baseCurrency, fxCache)
    const month = txn.date?.slice(0, 7) || 'unknown'
    if (!result[month]) result[month] = { total: 0, byType: {} }
    result[month].total += amount
    result[month].byType[txn.type] = (result[month].byType[txn.type] || 0) + amount
  }
  return result
}

export function getProjectedAnnualIncome(transactions, assets, fxCache, baseCurrency) {
  // Sample the trailing 90 days of income and scale to 365. Earlier this
  // used calendar-month subtraction (which varies 89–92 days) and a fixed
  // ×4 multiplier — close but not quite annual. Pinning to exactly 90 days
  // and a 365/90 factor makes the projection consistent month-to-month.
  //
  // Use localISO so the cutoff aligns to the user's local calendar — txn.date
  // values are written as local-day strings (todayISO uses local components),
  // so toISOString here would shift the window by ±1 day for users far from
  // UTC and silently miss / double-count edge-of-window transactions.
  const WINDOW_DAYS = 90
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)
  const cutoffISO = localISO(cutoff)
  let total = 0
  for (const txn of transactions) {
    if (!INCOME_TYPES.includes(txn.type)) continue
    if ((txn.date || '') < cutoffISO) continue
    const asset = assets.find(a => a.id === txn.assetId)
    const currency = asset?.currency || 'USD'
    total += (parseFloat(txn.totalValue) || parseFloat(txn.price) || 0)
      * getFxRate(currency, baseCurrency, fxCache)
  }
  return total * (365 / WINDOW_DAYS)
}

export function getRealizedPnLPerSale(transactions, assets, fxCache, baseCurrency) {
  // Build running cost basis per asset, return realized P&L per sell
  const results = []
  const positionByAsset = {}

  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date))

  for (const txn of sorted) {
    const asset = assets.find(a => a.id === txn.assetId)
    if (!asset) continue
    const rate = getFxRate(asset.currency, baseCurrency, fxCache)
    const key = txn.assetId

    if (!positionByAsset[key]) positionByAsset[key] = { qty: 0, cost: 0, firstAcquired: null }
    const pos = positionByAsset[key]

    if (txn.type === 'buy' || txn.type === 'deposit') {
      const qty = parseFloat(txn.quantity) || 0
      const price = parseFloat(txn.price) || 0
      // Track the EARLIEST acquisition date for the open position. When the
      // position is fully closed and reopened, this resets via the position
      // becoming empty. Used to flag long-term capital gain (>1yr held).
      if (pos.qty <= 0) pos.firstAcquired = txn.date
      pos.qty += qty
      pos.cost += qty * price
    } else if (txn.type === 'split') {
      // Multiply qty (and implicitly divide avg cost) so a sell after a
      // split prices against the correct post-split basis.
      const ratio = parseFloat(txn.price) || 0
      if (ratio > 0) pos.qty = pos.qty * ratio
    } else if (txn.type === 'staking_reward') {
      // Crypto staking adds tokens at $0 cost — qty grows, cost stays the
      // same → avg cost falls. Without this a later sell looks like 100%
      // profit on the earned tokens.
      const qty = parseFloat(txn.quantity) || 0
      // Reopen tracking when staking rebuilds a previously-closed position
      // — otherwise daysHeld is computed against the prior closed-out buy
      // date, inflating longTerm flags on freshly-earned tokens.
      if (pos.qty <= 0 && qty > 0) pos.firstAcquired = txn.date
      pos.qty += qty
    } else if (txn.type === 'dividend' && txn.reinvest) {
      // DRIP: dividend auto-reinvested into additional shares at zero
      // ADDITIONAL cost (the dividend itself is the cost — already income-
      // tagged). Mirrors calculateAssetHolding so a later sell prices
      // against the correct DRIP-diluted avg cost. Without this, qty here
      // lagged the calculation engine and realized P&L diverged.
      const qty = parseFloat(txn.quantity) || 0
      if (pos.qty <= 0 && qty > 0) pos.firstAcquired = txn.date
      pos.qty += qty
    } else if ((txn.type === 'interest_income' || txn.type === 'salary') && asset.class === 'cash') {
      // For CASH, these txns are stored with `quantity: 1, price: amount`
      // (TransactionModal sets quantity='1' for income types). The dollar
      // amount lives in totalValue/price, not quantity. We add it to BOTH
      // qty and cost — symmetric with calculateAssetHolding so a later
      // withdrawal correctly reports zero realized P&L (avg cost = 1/unit).
      const amt = parseFloat(txn.totalValue) || parseFloat(txn.price) || 0
      if (amt > 0) {
        pos.qty += amt
        pos.cost += amt
      }
    } else if (txn.type === 'expense' || txn.type === 'liability_payment' || txn.type === 'transfer') {
      // Cash outflows reduce qty + cost proportionally so the per-sale P&L
      // engine doesn't see ghost profits on cash transfers. Mirror the
      // sell/withdrawal accounting at avg cost = 1.
      if (asset.class === 'cash') {
        const amt = parseFloat(txn.totalValue) || parseFloat(txn.price) || 0
        const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 1
        const cost = amt * avgCost
        pos.qty = Math.max(0, pos.qty - amt)
        pos.cost = Math.max(0, pos.cost - cost)
      }
    } else if (txn.type === 'sell' || txn.type === 'withdrawal') {
      const qty = parseFloat(txn.quantity) || 0
      const price = parseFloat(txn.price) || 0
      const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0
      const realized = qty * (price - avgCost)
      const soldCost = qty * avgCost
      pos.qty = Math.max(0, pos.qty - qty)
      pos.cost = Math.max(0, pos.cost - soldCost)
      // Long-term vs short-term: standard threshold is 1 year for capital
      // gains tax treatment in many jurisdictions (US, UK, AU). We expose
      // both the days-held count and a long-term flag so the UI can hint
      // at potential tax efficiency without claiming to be tax advice.
      const daysHeld = pos.firstAcquired
        ? Math.floor((new Date(txn.date) - new Date(pos.firstAcquired)) / 86_400_000)
        : null
      results.push({
        txnId: txn.id,
        assetId: asset.id,
        date: txn.date,
        assetName: asset.name,
        assetClass: asset.class,
        qty,
        sellPrice: price,
        avgCost,
        realizedNative: realized,
        realizedBase: realized * rate,
        currency: asset.currency,
        firstAcquired: pos.firstAcquired,
        daysHeld,
        longTerm: daysHeld != null && daysHeld >= 365,
      })
    }
  }
  return results
}

export function formatCurrency(amount, currency = 'USD', compact = false) {
  if (amount === null || amount === undefined || isNaN(amount)) return '—'
  const absAmt = Math.abs(amount)
  if (compact && absAmt >= 1_000_000_000) {
    return (amount < 0 ? '-' : '') + formatSymbol(currency) + (absAmt / 1_000_000_000).toFixed(2) + 'B'
  }
  if (compact && absAmt >= 1_000_000) {
    return (amount < 0 ? '-' : '') + formatSymbol(currency) + (absAmt / 1_000_000).toFixed(2) + 'M'
  }
  if (compact && absAmt >= 1_000) {
    return (amount < 0 ? '-' : '') + formatSymbol(currency) + (absAmt / 1_000).toFixed(1) + 'K'
  }
  try {
    const zeroDecimal = currency === 'IDR' || currency === 'JPY'
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'BTC' ? 'USD' : currency,
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(amount)
    // Normalize symbols for currencies that Intl formats as a code instead of a glyph.
    if (currency === 'BTC')  return formatted.replace('$', '₿')
    if (currency === 'IDR')  return formatted.replace(/IDR\s?/, 'Rp ')
    if (currency === 'SGD')  return formatted.replace(/SGD\s?/, 'S$')
    if (currency === 'CAD')  return formatted.replace(/CAD\s?|CA\$/, 'C$')
    return formatted
  } catch {
    return `${formatSymbol(currency)}${amount.toFixed(2)}`
  }
}

function formatSymbol(currency) {
  const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', SGD: 'S$', CAD: 'C$', IDR: 'Rp ', BTC: '₿' }
  return symbols[currency] || currency + ' '
}

export function formatPct(value) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%'
}

export function formatNumber(value, decimals = 4) {
  if (value === null || value === undefined || isNaN(value)) return '—'
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(value) >= 1_000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return value.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

export function generateId() {
  // crypto.randomUUID is available in all modern browsers + Node 19+ and is
  // cryptographically random — eliminates the collision risk of the old
  // Date.now() + Math.random() approach when bulk-importing or batch-creating.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

// ─────────────────────────────────────────────────────────────────────────
// Financial planning helpers — amortization, FIRE math, runway, concentration.
// All pure functions; called from Liability / Property / Dashboard / Reports.
// ─────────────────────────────────────────────────────────────────────────

// Standard amortization formula. Given a principal, an APR (e.g. 6 means 6%),
// and a monthly payment, return how many months until payoff and what
// fraction of each payment is interest vs principal.
//
// Returns { months, totalInterest, totalPaid, schedule } where schedule is
// an array of { month, payment, interest, principal, balance } rows.
//
// Caps the schedule at 600 months (50 years) so a payment that's smaller
// than the monthly interest accrual (which would never pay off) returns a
// clear "infinite" signal instead of looping forever.
export function amortizationSchedule(principal, aprPct, monthlyPayment, maxMonths = 600) {
  const P = Number(principal) || 0
  const r = (Number(aprPct) || 0) / 100 / 12 // monthly rate
  const m = Number(monthlyPayment) || 0
  if (P <= 0) return { months: 0, totalInterest: 0, totalPaid: 0, schedule: [], neverPaysOff: false }
  if (m <= 0) return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, schedule: [], neverPaysOff: true }
  // If payment doesn't cover monthly interest, the loan grows forever
  if (r > 0 && m <= P * r) return {
    months: Infinity, totalInterest: Infinity, totalPaid: Infinity, schedule: [], neverPaysOff: true
  }

  let bal = P
  let totalInterest = 0
  let totalPaid = 0
  const schedule = []
  for (let i = 1; i <= maxMonths && bal > 0.005; i++) {
    const interest = bal * r
    let principalPaid = m - interest
    if (principalPaid > bal) principalPaid = bal // last payment trims to exact balance
    const paid = principalPaid + interest
    bal -= principalPaid
    totalInterest += interest
    totalPaid += paid
    schedule.push({ month: i, payment: paid, interest, principal: principalPaid, balance: Math.max(0, bal) })
  }
  return {
    months: schedule.length,
    totalInterest,
    totalPaid,
    schedule,
    neverPaysOff: bal > 0.005, // hit cap without paying off
  }
}

// Suggest a monthly payment that pays the loan off in `years` years at the
// given APR. Useful for the Liability modal "auto-fill payment" button.
export function suggestPaymentForTerm(principal, aprPct, years) {
  const P = Number(principal) || 0
  const r = (Number(aprPct) || 0) / 100 / 12
  const n = Number(years) * 12
  if (P <= 0 || n <= 0) return 0
  if (r === 0) return P / n
  return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

// FIRE (Financial Independence) projection using the 4% safe-withdrawal
// rule. `targetNetWorth = annualExpenses × 25`. Given current net worth,
// monthly net savings, and an assumed real return (default 5%), returns
// years until target is reached. Returns Infinity if savings ≤ 0.
export function fireProjection(currentNetWorth, monthlyNetSavings, annualExpenses, realReturnPct = 5) {
  const NW = Number(currentNetWorth) || 0
  const m = Number(monthlyNetSavings) || 0
  const E = Number(annualExpenses) || 0
  const r = (Number(realReturnPct) || 0) / 100 / 12
  const target = E * 25
  if (target <= 0) return { years: 0, target: 0, reached: true }
  if (NW >= target) return { years: 0, target, reached: true }
  if (m <= 0 && r === 0) return { years: Infinity, target, reached: false }
  // Future value formula: FV = PV(1+r)^n + PMT × ((1+r)^n - 1)/r
  // Solve for n: target = NW(1+r)^n + m × ((1+r)^n - 1)/r
  // (1+r)^n × (NW + m/r) = target + m/r
  // n = ln((target + m/r) / (NW + m/r)) / ln(1+r)
  if (r === 0) return { years: (target - NW) / (m * 12), target, reached: false }
  const a = target + m / r
  const b = NW + m / r
  if (b <= 0) return { years: Infinity, target, reached: false }
  const months = Math.log(a / b) / Math.log(1 + r)
  if (!isFinite(months) || months < 0) return { years: Infinity, target, reached: false }
  return { years: months / 12, target, reached: false }
}

// Annualized return between two values over a span. Used for "this property
// has appreciated 4.2%/yr since purchase".
export function annualizedReturn(startValue, endValue, years) {
  const s = Number(startValue) || 0
  const e = Number(endValue) || 0
  const y = Number(years) || 0
  if (s <= 0 || y <= 0) return null
  return (Math.pow(e / s, 1 / y) - 1) * 100
}

// Per-asset annualized income (last 12 months) — used by the Retirement
// Income Planner so users can see what income each asset is currently
// producing and run "what if I sell this?" scenarios.
//
// Returns rows of { id, name, class, currency, monthlyIncomeNative,
// monthlyIncomeBase, valueBase, yieldPct } sorted by monthlyIncomeBase desc.
// `yieldPct` is monthly_income × 12 / current_value — the asset's effective
// dividend/rental yield over the trailing year.
// Aggregate the last 12 months of income, grouped meaningfully.
// Grouping rules:
//   1. If a transaction has an explicit `source` field set, group by source.
//      This works for ANY income type — salary by employer, interest by
//      bank ("BCA Bank" combines all BCA savings + CD + money-market into
//      one stream), dividend by issuer if user wants finer-grained tagging.
//   2. Otherwise: salary falls into a single "unspecified" bucket;
//      dividend / rental / staking / interest fall back to asset-grouping
//      (the asset IS the source by default — Apple's dividends, Jakarta
//      Villa's rent, USD Savings's interest).
//
// Returns rows of { id, kind, name, class, currency, source, assetId,
// dominantType, monthlyIncomeNative, monthlyIncomeBase, valueBase, yieldPct }
// sorted by monthlyIncomeBase desc. `id` is "asset:<assetId>" or
// "source:<sourceName>" so the planner can tag toggle state without
// collisions. `dominantType` is the income type contributing most of this
// stream's value (for showing a clear "Dividend" / "Interest" / "Salary"
// badge instead of the misleading asset-class badge).
export function getIncomeStreamsByAsset(assets, transactions, fxCache, baseCurrency, holdings) {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1)
  // localISO so the 12-month window matches the local-calendar dates stored
  // on transactions (todayISO writes local-day strings).
  const cutoffISO = localISO(cutoff)
  const INCOME = ['rental_income', 'dividend', 'staking_reward', 'interest_income', 'salary']
  const groups = {}
  for (const t of transactions) {
    if (!INCOME.includes(t.type)) continue
    if (t.date < cutoffISO) continue
    const a = assets.find(x => x.id === t.assetId)
    if (!a) continue
    const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
    const src = (t.source && String(t.source).trim()) || ''

    let key, name, kind, source = null
    if (src) {
      // Explicit source → group by it regardless of income type
      key = `source:${src.toLowerCase()}`
      name = src
      kind = t.type === 'salary' ? 'salary' : 'source'
      source = src
    } else if (t.type === 'salary') {
      // Legacy salary with no source — single fallback bucket
      key = `source:__unspecified_salary__`
      name = 'Salary (unspecified source)'
      kind = 'salary'
    } else {
      // Asset-grouped fallback (dividend / rental / staking / interest)
      key = `asset:${a.id}`
      name = a.name
      kind = 'asset'
    }

    if (!groups[key]) {
      groups[key] = {
        id: key, kind, name,
        class: a.class, currency: a.currency,
        source, assetId: a.id,
        monthlyIncomeNative: 0, monthlyIncomeBase: 0, breakdownByType: {},
      }
    }
    groups[key].monthlyIncomeNative += amt / 12
    groups[key].monthlyIncomeBase += (amt / 12) * getFxRate(a.currency, baseCurrency, fxCache)
    groups[key].breakdownByType[t.type] = (groups[key].breakdownByType[t.type] || 0) + amt
    // Track the most-recent destination/source asset (lets the planner ✎
    // icon navigate to a sensible single asset when relevant)
    groups[key].assetId = a.id
  }
  // Compute dominantType + valueBase + yieldPct
  return Object.values(groups).map(row => {
    // Pick the income type contributing most of this stream's value
    const types = Object.entries(row.breakdownByType)
    const dominantType = types.length
      ? types.sort((a, b) => b[1] - a[1])[0][0]
      : null
    if (row.kind === 'salary') {
      // Salary has no underlying "value" — yield doesn't apply
      return { ...row, dominantType, valueBase: 0, yieldPct: null }
    }
    // For source-grouped streams that span multiple assets, valueBase isn't
    // a single number — leave it at 0 and skip yield rather than misleading.
    if (row.kind === 'source') {
      return { ...row, dominantType, valueBase: 0, yieldPct: null }
    }
    const h = (holdings || []).find(x => x.id === row.assetId)
    const valueBase = h?.currentValueBase || 0
    const annualBase = row.monthlyIncomeBase * 12
    return {
      ...row,
      dominantType,
      valueBase,
      yieldPct: valueBase > 0 ? (annualBase / valueBase) * 100 : null,
    }
  }).sort((a, b) => b.monthlyIncomeBase - a.monthlyIncomeBase)
}

// Compound interest projection — given a current balance, a monthly
// contribution, an APY%, and a number of years, return future value.
// Used on Cash & Savings to visualize "if you keep this in the account at
// the current 4.5% APY, in 10 years it'll be worth X."
export function projectCompoundGrowth(currentBalance, apyPct, years, monthlyContribution = 0) {
  const P = Number(currentBalance) || 0
  const r = (Number(apyPct) || 0) / 100 / 12
  const n = Math.round(Number(years) * 12)
  const m = Number(monthlyContribution) || 0
  if (n <= 0) return [{ month: 0, value: P, contributed: 0, interest: 0 }]
  const points = []
  let bal = P
  let contributed = 0
  for (let i = 0; i <= n; i++) {
    if (i > 0) {
      bal = bal * (1 + r) + m
      contributed += m
    }
    points.push({ month: i, value: bal, contributed: P + contributed, interest: bal - P - contributed })
  }
  return points
}

// Debt payoff strategy comparison — for a list of liabilities with
// interestRate + minimum payment, simulate how long total payoff takes
// under "avalanche" (highest rate first) vs "snowball" (smallest balance
// first). Extra monthly budget is rolled into the focus loan once the
// minimum on every other loan is covered.
export function debtStrategy(liabilities, extraMonthly = 0, strategy = 'avalanche') {
  const loans = liabilities
    .filter(l => l.balance > 0 && l.monthlyPayment > 0)
    .map(l => ({
      id: l.id, name: l.name,
      balance: Number(l.balance) || 0,
      rate: (Number(l.interestRate) || 0) / 100 / 12,
      minPayment: Number(l.monthlyPayment) || 0,
      currency: l.currency,
    }))
  if (!loans.length) return { months: 0, totalInterest: 0, payoffOrder: [], schedule: [] }

  const sortFn = strategy === 'snowball'
    ? (a, b) => a.balance - b.balance
    : (a, b) => b.rate - a.rate // avalanche

  const remaining = loans.map(l => ({ ...l }))
  let month = 0
  let totalInterest = 0
  const payoffOrder = []
  const MAX = 600

  while (remaining.some(l => l.balance > 0.005) && month < MAX) {
    month++
    // Accrue interest on every loan
    for (const l of remaining) {
      if (l.balance <= 0) continue
      const i = l.balance * l.rate
      l.balance += i
      totalInterest += i
    }
    // Each loan pays at least its minimum; the focus loan also gets the extra
    const active = remaining.filter(l => l.balance > 0).sort(sortFn)
    let extra = extraMonthly
    for (const l of active) {
      const payment = l.id === active[0]?.id ? l.minPayment + extra : l.minPayment
      const paid = Math.min(payment, l.balance)
      l.balance -= paid
      // Roll any leftover (loan paid off mid-month) into the next focus loan
      if (l.id === active[0]?.id) extra = Math.max(0, payment - paid)
      if (l.balance <= 0.005) {
        l.balance = 0
        payoffOrder.push({ id: l.id, name: l.name, payoffMonth: month })
      }
    }
  }
  return {
    months: month,
    totalInterest,
    payoffOrder,
    neverPaysOff: remaining.some(l => l.balance > 0.005),
  }
}

// Rebalancing helper: given holdings + a target allocation map (class→pct),
// compute drift per class and how much to buy/sell to reach target.
// Targets that don't sum to 100% are normalized so the user doesn't have to
// be exact.
export function computeRebalance(holdings, targets) {
  const totalValue = holdings.reduce((s, h) => s + (h.currentValueBase || 0), 0)
  if (totalValue <= 0) return { rows: [], totalValue: 0 }
  // Normalize targets
  const targetSum = Object.values(targets || {}).reduce((s, v) => s + (Number(v) || 0), 0)
  const normTargets = {}
  if (targetSum > 0) {
    for (const [cls, v] of Object.entries(targets)) normTargets[cls] = (Number(v) || 0) / targetSum * 100
  }
  // Group holdings by class
  const byClass = {}
  for (const h of holdings) {
    const cls = h.class || 'other'
    byClass[cls] = (byClass[cls] || 0) + (h.currentValueBase || 0)
  }
  // Build row for each class that has either a holding OR a target
  const allClasses = new Set([...Object.keys(byClass), ...Object.keys(normTargets)])
  const rows = [...allClasses].map(cls => {
    const current = byClass[cls] || 0
    const currentPct = (current / totalValue) * 100
    const targetPct = normTargets[cls] || 0
    const targetValue = (targetPct / 100) * totalValue
    const driftValue = current - targetValue // + means overweight, − means underweight
    return { class: cls, currentPct, targetPct, currentValue: current, targetValue, driftValue }
  }).sort((a, b) => Math.abs(b.driftValue) - Math.abs(a.driftValue))
  return { rows, totalValue }
}

// Local-time ISO date (YYYY-MM-DD) of today. Critical for users in timezones
// far from UTC: at 11pm PT (= 7am UTC next day), `new Date().toISOString()`
// would return tomorrow's date — making "today's snapshot" save under the
// wrong day, charts misalign, and date filters skip the current day. Using
// local components keeps the calendar date matching what the user sees.
export function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Same idea for any Date instance — used by chart code that needs an ISO
// string from a constructed local-midnight Date.
export function localISO(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
