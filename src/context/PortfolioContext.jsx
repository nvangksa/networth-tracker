import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  calculateHoldings, calculateNetWorth, getAllocationByClass,
  getTotalPassiveIncome, getPassiveIncomeSince, generateId, todayISO, localISO, CURRENCIES,
  getFxRate,
} from '../utils/calculations.js'
import { fetchPrices, fetchPricesFree, fetchAllFxRates, fetchFxRatesFree, fetchFxRatesYahoo, buildHardcodedFxCache, isCacheStale, exportCSV, parseCSV } from '../utils/api.js'

const PortfolioContext = createContext(null)
export const usePortfolio = () => useContext(PortfolioContext)

const EMPTY_DATA = {
  assets: [], transactions: [], liabilities: [], snapshots: [],
  expenses: [], expenseCategories: [],
  settings: { apiKey: '', baseCurrency: 'USD', autoRefresh: false, lastSnapshotDate: null },
  pricesCache: {}, fxCache: {}
}

export function PortfolioProvider({ children }) {
  const [data, setData] = useState(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | saved | error
  const [priceLoading, setPriceLoading] = useState(false)
  const [fxMissing, setFxMissing] = useState(false)
  const [priceErrors, setPriceErrors] = useState([])
  const [undoStack, setUndoStack] = useState([]) // latest first; each entry: { label, restore: prevData, at: ms }

  // dataRef always points at the LATEST data so pushUndo never captures a stale
  // closure. Without this, two rapid deletes both snapshot the same render's
  // data and the second undo restores nothing.
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  // Push a snapshot of current data onto the undo stack BEFORE a destructive action.
  const pushUndo = useCallback((label) => {
    setUndoStack(prev => {
      const snap = { label, restore: dataRef.current, at: Date.now() }
      return [snap, ...prev].slice(0, 10) // keep last 10
    })
  }, [])

  // Pop and restore the most recent undo entry. We deliberately call
  // setData INSIDE the setUndoStack updater so that React 18's batching of
  // a double-click correctly pops two entries (each updater sees the latest
  // in-progress stack). A previous version used a ref to read the stack
  // outside the updater, which silently no-op'd the second click because the
  // ref hadn't been refreshed yet within the same React batch.
  // saveData is NOT called here — the data-change effect persists for us
  // (and avoids StrictMode's double-fire of side-effect-in-updater patterns).
  const undoLast = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev
      const [top, ...rest] = prev
      setData(top.restore)
      return rest
    })
  }, [])

  // ── Save to server ──────────────────────────────────────────
  // Checks res.ok so an HTTP 5xx flips saveStatus to 'error' instead of
  // silently reporting success. The "Save failed — retrying" banner in
  // Holdings depends on this.
  const saveData = useCallback(async (newData) => {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData)
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      console.error('Save failed:', err)
      setSaveStatus('error')
    }
  }, [])

  // Side-effect-free state update. Persistence happens in the data-change
  // effect below — keeping setState updaters pure means StrictMode's
  // double-invocation in dev no longer doubles POSTs to /api/data.
  const updateData = useCallback((updater) => {
    setData(prev => typeof updater === 'function' ? updater(prev) : { ...prev, ...updater })
  }, [])

  // Persist whenever `data` changes (after the initial load completes).
  // Replaces every `saveData(next)` call that used to live inside setData
  // updaters — those are state-mutation side effects that fire twice under
  // <React.StrictMode>. Here the effect fires once per committed render.
  useEffect(() => {
    if (loading) return
    saveData(data)
  }, [data, loading, saveData])

  // ── Load from server ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/data')
        // CRITICAL: an HTTP error here used to flow through as `{error: ...}`
        // which then got `setData()`'d and saved back to disk — wiping the
        // user's real portfolio. Bail without touching state on any non-OK.
        if (!res.ok) {
          console.error(`Failed to load data: HTTP ${res.status}`)
          return
        }
        const json = await res.json()
        if (!json || typeof json !== 'object' || json.error) {
          console.error('Invalid data from server:', json)
          return
        }
        const merged = { ...EMPTY_DATA, ...json }

        // Ensure FX cache is populated (free API → hardcoded fallback).
        // Fallback rates are seeded first so any pair has SOME value, then
        // overlaid with fresh free rates, then with whatever the user had
        // stored (Twelve Data paid rates, manual overrides) — but ONLY for
        // non-fallback stored entries so stale "free" cache entries don't
        // win over fresh free-API rates.
        const base = merged.settings?.baseCurrency || 'USD'
        const fallback = buildHardcodedFxCache(base)
        const fallbackUsd = base === 'USD' ? {} : buildHardcodedFxCache('USD')
        // Parallelize: free API fetches are independent.
        const [freeRates, freeRatesUsd] = await Promise.all([
          fetchFxRatesFree(base),
          base === 'USD' ? Promise.resolve(null) : fetchFxRatesFree('USD'),
        ])
        const storedKept = Object.fromEntries(
          Object.entries(merged.fxCache || {}).filter(([, v]) =>
            v && v.source !== 'fallback' && v.source !== 'free')
        )
        merged.fxCache = {
          ...fallback,
          ...fallbackUsd,
          ...(freeRatesUsd || {}),
          ...(freeRates || {}),
          ...storedKept,
        }

        setData(merged)
        // saveData(merged) is unnecessary here — the data-change effect
        // above will persist as soon as loading flips to false.

        // Auto-snapshot once per day
        const today = todayISO()
        if (json.settings?.lastSnapshotDate !== today) {
          setTimeout(() => autoSnapshot(merged, today), 500)
        }
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Prices ──────────────────────────────────────────────────
  const refreshPrices = useCallback(async (opts = {}) => {
    const { force = false } = opts
    const d = data
    setPriceLoading(true)

    const marketAssets = d.assets.filter(a =>
      ['stocks', 'crypto', 'commodities'].includes(a.class) && a.symbol
    )
    const symbols = [...new Set(marketAssets.map(a => a.symbol))]
    const targets = force ? symbols : symbols.filter(s => isCacheStale(d.pricesCache[s]))

    // Track only prices actually fetched this cycle. The bug we're avoiding:
    // if we seed this with the existing cache, a symbol that already has a
    // stale price looks "already fetched" and the free fallback is skipped —
    // so BTC-USD (etc.) never updates. Track fresh fetches separately and
    // merge into the existing cache at the end.
    let fetchedPrices = {}
    let allErrors = []
    if (targets.length) {
      // Try paid API first (if key exists)
      if (d.settings.apiKey) {
        const { prices, errors } = await fetchPrices(targets, d.settings.apiKey)
        fetchedPrices = { ...fetchedPrices, ...prices }
        allErrors = errors || []
      }
      // Fallback to free source (Yahoo proxy) for any symbol not yet freshly fetched
      const missing = targets.filter(s => !fetchedPrices[s])
      if (missing.length > 0) {
        const { prices: freePrices, errors: freeErrors } = await fetchPricesFree(missing)
        fetchedPrices = { ...fetchedPrices, ...freePrices }
        allErrors = [...allErrors.filter(e => !missing.includes(e.symbol)), ...freeErrors]
      }
      setPriceErrors(allErrors)
    } else {
      setPriceErrors([])
    }
    const mergedPrices = { ...d.pricesCache, ...fetchedPrices }

    // Refresh FX: Yahoo proxy first (most accurate), then free API fill-in, then Twelve Data if key provided.
    // We always pull USD↔everything in addition to base↔everything so that
    // cross-pairs (e.g. AUD→JPY) can be triangulated via USD even when the
    // base currency is something else. The four lookups are independent —
    // run them in parallel so a multi-currency portfolio refresh takes ~1 s
    // instead of stacking each request's per-symbol throttle.
    const allCurrencies = [...new Set(d.assets.map(a => a.currency).concat(d.liabilities.map(l => l.currency)).concat(CURRENCIES))].filter(Boolean)
    const base = d.settings.baseCurrency
    const [yahooFxBase, yahooFxUsd, freeFxBase, freeFxUsd] = await Promise.all([
      fetchFxRatesYahoo(base, allCurrencies.filter(c => c !== base)),
      base === 'USD' ? Promise.resolve({}) : fetchFxRatesYahoo('USD', allCurrencies.filter(c => c !== 'USD')),
      fetchFxRatesFree(base).then(r => r || {}),
      base === 'USD' ? Promise.resolve({}) : fetchFxRatesFree('USD').then(r => r || {}),
    ])
    let mergedFx = { ...d.fxCache, ...freeFxBase, ...freeFxUsd, ...yahooFxUsd, ...yahooFxBase }
    if (d.settings.apiKey) {
      const tdFx = await fetchAllFxRates(base, allCurrencies, d.settings.apiKey)
      mergedFx = { ...mergedFx, ...tdFx }
    }

    const missingFx = allCurrencies
      .filter(c => c !== base)
      .some(c => !mergedFx[`${base}_${c}`])
    setFxMissing(missingFx)

    updateData(prev => ({ ...prev, pricesCache: mergedPrices, fxCache: mergedFx }))
    setPriceLoading(false)
  }, [data, updateData])

  // Auto-fetch prices when market symbols change. We key on a stable string
  // of the full symbol set (not just `.length`) so editing an existing asset
  // to add or change its symbol triggers a refresh too — the old length-only
  // dep silently swallowed those edits.
  const marketSymsKey = useMemo(() => {
    return data.assets
      .filter(a => ['stocks', 'crypto', 'commodities'].includes(a.class) && a.symbol)
      .map(a => a.symbol)
      .sort()
      .join(',')
  }, [data.assets])
  useEffect(() => {
    if (loading) return
    if (!marketSymsKey) return
    const marketSyms = marketSymsKey.split(',')
    const hasStale = marketSyms.some(s => isCacheStale(data.pricesCache[s]))
    if (hasStale) refreshPrices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketSymsKey, loading])

  // Refresh free FX rates when base currency changes.
  //
  // CRITICAL: we re-fetch BOTH base-anchored and USD-anchored free rates and
  // re-seed fallback for both anchors. The earlier version dropped every
  // `source: 'free'` entry from cache without re-fetching USD-anchored ones,
  // which silently broke cross-pair triangulation (e.g. AUD → JPY through
  // USD) until the next manual Refresh Prices click. After a base-currency
  // change to e.g. IDR you'd see SGD→JPY collapse to the 1:1 fallback.
  useEffect(() => {
    if (loading) return
    const base = data.settings.baseCurrency
    let cancelled = false
    ;(async () => {
      const fallback = buildHardcodedFxCache(base)
      const fallbackUsd = base === 'USD' ? {} : buildHardcodedFxCache('USD')
      const [free, freeUsd] = await Promise.all([
        fetchFxRatesFree(base),
        base === 'USD' ? Promise.resolve(null) : fetchFxRatesFree('USD'),
      ])
      if (cancelled) return
      const next = { ...fallback, ...fallbackUsd, ...(freeUsd || {}), ...(free || {}) }
      // Keep yahoo / twelve-data rates that already exist (they're more
      // accurate than the free er-api fallback). 'fallback' and 'free' get
      // overwritten by the freshly fetched set above.
      for (const [k, v] of Object.entries(data.fxCache || {})) {
        if (v?.source !== 'fallback' && v?.source !== 'free') next[k] = v
      }
      updateData(prev => ({ ...prev, fxCache: { ...next } }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.settings.baseCurrency, loading])

  // Auto-refresh every hour if enabled. We funnel through a ref so the
  // interval doesn't get torn down on every render — `refreshPrices` has
  // `data` in its dep array, so its identity changes on every save, which
  // used to reset the 1-hour timer on every keystroke (so it never fired).
  const refreshPricesRef = useRef(refreshPrices)
  useEffect(() => { refreshPricesRef.current = refreshPrices }, [refreshPrices])
  useEffect(() => {
    if (!data.settings.autoRefresh) return
    // Pass force=true so the hourly tick always fetches fresh prices.
    // Without it, `refreshPrices()` only re-fetches symbols whose cache is
    // older than `isCacheStale`'s 1 hour threshold. The interval fires at
    // ≈1 h, so the staleness check is a near-coin-flip on whether anything
    // gets re-fetched — half the auto-refresh ticks did nothing.
    const timer = setInterval(() => refreshPricesRef.current({ force: true }), 3_600_000)
    return () => clearInterval(timer)
  }, [data.settings.autoRefresh])

  // Auto-update today's snapshot on every data change (debounced). One entry per day.
  // Pure setState updater — the data-change effect above persists.
  useEffect(() => {
    if (loading) return
    const today = todayISO()
    const t = setTimeout(() => {
      const holdings = calculateHoldings(data.assets, data.transactions, data.pricesCache, data.fxCache, data.settings.baseCurrency)
      const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = calculateNetWorth(holdings, data.liabilities, data.fxCache, data.settings.baseCurrency)
      setData(prev => {
        const existing = prev.snapshots.find(s => s.date === today)
        // Float-tolerant equality. Exact === lets sub-cent FX drift trigger a
        // snapshot rewrite → save → effect re-fire loop. 0.5 of the base
        // currency's smallest unit is well below display precision so this
        // can't visibly hide changes the user would care about.
        const close = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.5
        if (existing &&
            close(existing.netWorth, netWorthBase) &&
            close(existing.totalAssets, totalAssetsBase) &&
            close(existing.totalLiabilities, totalLiabilitiesBase)) return prev
        // Don't clobber a snapshot the user explicitly saved today — they may
        // have captured a specific moment (e.g. before a large transaction)
        // and the auto-recompute would erase that intent.
        if (existing?.manual) return prev
        const snap = { date: today, totalAssets: totalAssetsBase, totalLiabilities: totalLiabilitiesBase, netWorth: netWorthBase }
        const snapshots = existing
          ? prev.snapshots.map(s => s.date === today ? snap : s)
          : [...prev.snapshots, snap].sort((a, b) => a.date.localeCompare(b.date))
        return { ...prev, snapshots, settings: { ...prev.settings, lastSnapshotDate: today } }
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [data.assets, data.transactions, data.liabilities, data.pricesCache, data.fxCache, data.settings.baseCurrency, loading])

  // ── Auto-snapshot ───────────────────────────────────────────
  function autoSnapshot(rawData, today) {
    const d = rawData
    const holdings = calculateHoldings(d.assets, d.transactions, d.pricesCache, d.fxCache, d.settings.baseCurrency)
    const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = calculateNetWorth(holdings, d.liabilities, d.fxCache, d.settings.baseCurrency)
    const snap = { date: today, totalAssets: totalAssetsBase, totalLiabilities: totalLiabilitiesBase, netWorth: netWorthBase }
    setData(prev => {
      const existing = prev.snapshots.find(s => s.date === today)
      // Preserve user-marked manual snapshots — they captured a specific
      // intent and the auto pass shouldn't overwrite it.
      if (existing?.manual) return prev
      const snapshots = existing
        ? prev.snapshots.map(s => s.date === today ? snap : s)
        : [...prev.snapshots, snap]
      return { ...prev, snapshots, settings: { ...prev.settings, lastSnapshotDate: today } }
    })
  }

  // ── Computed values ─────────────────────────────────────────
  const holdings = useMemo(() =>
    calculateHoldings(data.assets, data.transactions, data.pricesCache, data.fxCache, data.settings.baseCurrency),
    [data.assets, data.transactions, data.pricesCache, data.fxCache, data.settings.baseCurrency]
  )

  const netWorthStats = useMemo(() =>
    calculateNetWorth(holdings, data.liabilities, data.fxCache, data.settings.baseCurrency),
    [holdings, data.liabilities, data.fxCache, data.settings.baseCurrency]
  )

  const allocationByClass = useMemo(() => getAllocationByClass(holdings), [holdings])

  const totalIncome = useMemo(() =>
    getTotalPassiveIncome(data.transactions, data.fxCache, data.settings.baseCurrency, data.assets),
    [data.transactions, data.fxCache, data.settings.baseCurrency, data.assets]
  )
  // Legacy alias still used by some components
  const totalPassiveIncome = totalIncome

  const pastYearPassiveIncome = useMemo(() => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    // localISO so the cutoff lines up with transaction dates (stored as local
    // calendar strings) — toISOString shifts by a day for users west of UTC.
    const since = localISO(cutoff)
    return getPassiveIncomeSince(data.transactions, data.fxCache, data.settings.baseCurrency, data.assets, since)
  }, [data.transactions, data.fxCache, data.settings.baseCurrency, data.assets])

  const totalUnrealizedPnL = useMemo(() =>
    holdings.reduce((s, h) => s + (h.unrealizedPnLBase || 0), 0), [holdings])

  const totalRealizedPnL = useMemo(() =>
    holdings.reduce((s, h) => s + (h.realizedPnLBase || 0), 0), [holdings])

  const allUsedTags = useMemo(() => {
    const tags = new Set()
    for (const t of data.transactions) (t.tags || []).forEach(tag => tags.add(tag))
    return [...tags].sort()
  }, [data.transactions])

  // ── CRUD helpers ────────────────────────────────────────────
  // Properties carry a `mortgageBalance` field. We mirror that as a real
  // Liability entry (with `linkedAssetId`) so it shows on the Liabilities page,
  // counts toward debt-to-asset ratios, and can be paid down from a cash
  // account. The two stay in sync automatically through addAsset/editAsset/
  // deleteAsset below.
  const addAsset = useCallback((asset) => {
    const newAsset = { ...asset, id: generateId() }
    updateData(prev => {
      let liabilities = prev.liabilities
      const mb = parseFloat(newAsset.mortgageBalance) || 0
      if (newAsset.class === 'property' && mb > 0) {
        liabilities = [
          ...liabilities,
          {
            id: generateId(),
            name: `${newAsset.name || 'Property'} Mortgage`,
            type: 'mortgage',
            balance: mb,
            currency: newAsset.currency || 'USD',
            startDate: newAsset.purchaseDate || todayISO(),
            linkedAssetId: newAsset.id,
            notes: 'Auto-created from property mortgage',
          },
        ]
      }
      return { ...prev, assets: [...prev.assets, newAsset], liabilities }
    })
    return newAsset
  }, [updateData])

  const editAsset = useCallback((id, updates, opts = {}) => {
    // opts.skipLiabilitySync — when called from the Liability "pay" flow, the
    // mortgage_balance update should NOT echo back to the liability (we just
    // changed it) and must NOT rename the liability (the user may have
    // renamed it; we'd overwrite their label with "<property> Mortgage").
    const { skipLiabilitySync = false } = opts
    updateData(prev => {
      const prior = prev.assets.find(a => a.id === id)
      const next  = prior ? { ...prior, ...updates } : null
      const assets = prev.assets.map(a => a.id === id ? { ...a, ...updates } : a)
      let liabilities = prev.liabilities
      // Class-change AWAY from property: clean up the auto-created mortgage
      // liability so it doesn't dangle as orphaned debt against an asset
      // that no longer represents a property.
      if (!skipLiabilitySync && prior?.class === 'property' && next && next.class !== 'property') {
        liabilities = liabilities.filter(l => l.linkedAssetId !== id)
      } else if (!skipLiabilitySync && next && next.class === 'property') {
        const newMb = parseFloat(next.mortgageBalance) || 0
        const linked = liabilities.find(l => l.linkedAssetId === id)
        if (newMb > 0) {
          if (linked) {
            // Update balance + currency only — preserve user's custom name
            liabilities = liabilities.map(l => l.id === linked.id
              ? { ...l, balance: newMb, currency: next.currency || l.currency }
              : l)
          } else {
            // Create new
            liabilities = [
              ...liabilities,
              {
                id: generateId(),
                name: `${next.name || 'Property'} Mortgage`,
                type: 'mortgage',
                balance: newMb,
                currency: next.currency || 'USD',
                startDate: next.purchaseDate || todayISO(),
                linkedAssetId: id,
                notes: 'Auto-created from property mortgage',
              },
            ]
          }
        } else if (linked) {
          // Mortgage cleared → remove the linked liability
          liabilities = liabilities.filter(l => l.id !== linked.id)
        }
      }
      return { ...prev, assets, liabilities }
    })
  }, [updateData])

  const deleteAsset = useCallback((id) => {
    const name = data.assets.find(a => a.id === id)?.name || 'asset'
    pushUndo(`Deleted ${name}`)
    updateData(prev => ({
      ...prev,
      assets: prev.assets.filter(a => a.id !== id),
      transactions: prev.transactions.filter(t => t.assetId !== id),
      // Clean up any liability that was linked to this asset (e.g. property mortgage)
      liabilities: prev.liabilities.filter(l => l.linkedAssetId !== id),
    }))
  }, [updateData, data.assets, pushUndo])

  const addTransaction = useCallback((txn) => {
    const newTxn = { ...txn, id: generateId() }
    updateData(prev => ({ ...prev, transactions: [...prev.transactions, newTxn] }))
    return newTxn
  }, [updateData])

  const editTransaction = useCallback((id, updates) => {
    updateData(prev => {
      const target = prev.transactions.find(t => t.id === id)
      let transactions = prev.transactions.map(t => t.id === id ? { ...t, ...updates } : t)
      // If this is one half of a transfer pair, mirror date / amount changes
      // onto the other half so they don't drift. We recompute the destination
      // amount via FX from the source amount, the same way TransactionModal
      // computes it on creation.
      if (target?.transferGroupId) {
        const sibling = prev.transactions.find(t =>
          t.id !== id && t.transferGroupId === target.transferGroupId)
        if (sibling) {
          const merged = { ...target, ...updates }
          const sourceAsset = prev.assets.find(a => a.id === merged.assetId)
          const siblingAsset = prev.assets.find(a => a.id === sibling.assetId)
          // The OUT leg is the one with type 'transfer'; the IN leg is the deposit.
          const outTxn = merged.type === 'transfer' ? merged : sibling
          const outAsset = merged.type === 'transfer' ? sourceAsset : siblingAsset
          const inTxn  = merged.type === 'transfer' ? sibling : merged
          const inAsset = merged.type === 'transfer' ? siblingAsset : sourceAsset
          const fx = getFxRate(outAsset?.currency || 'USD', inAsset?.currency || 'USD', prev.fxCache || {})
          const outAmt = parseFloat(outTxn.totalValue) || (parseFloat(outTxn.quantity) * parseFloat(outTxn.price)) || 0
          const inAmt  = outAmt * fx
          transactions = transactions.map(t => {
            if (t.id === sibling.id) {
              // Update the leg the user DIDN'T edit so the pair stays balanced.
              // Also mirror the optional time field so both halves of the
              // transfer stay on the same clock (otherwise editing the out
              // leg's time would leave the in leg without one).
              const timeMirror = merged.time != null ? { time: merged.time } : {}
              return merged.type === 'transfer'
                ? { ...t, date: merged.date, ...timeMirror, quantity: inAmt, price: 1, totalValue: inAmt }
                : { ...t, date: merged.date, ...timeMirror }
            }
            return t
          })
        }
      }
      return { ...prev, transactions }
    })
  }, [updateData])

  const deleteTransaction = useCallback((id) => {
    const t = data.transactions.find(x => x.id === id)
    pushUndo(`Deleted ${t?.type || 'transaction'}`)
    updateData(prev => {
      // If this is half of a transfer pair, delete BOTH halves so the
      // accounting stays symmetric (otherwise the destination cash account
      // is left with a phantom deposit pointing at a deleted transfer).
      const target = prev.transactions.find(x => x.id === id)
      const groupId = target?.transferGroupId
      const transactions = prev.transactions.filter(x =>
        x.id !== id && (!groupId || x.transferGroupId !== groupId))
      return { ...prev, transactions }
    })
  }, [updateData, data.transactions, pushUndo])

  const addLiability = useCallback((liability) => {
    const newL = { ...liability, id: generateId() }
    updateData(prev => ({ ...prev, liabilities: [...prev.liabilities, newL] }))
    return newL
  }, [updateData])

  const editLiability = useCallback((id, updates) => {
    updateData(prev => ({ ...prev, liabilities: prev.liabilities.map(l => l.id === id ? { ...l, ...updates } : l) }))
  }, [updateData])

  const deleteLiability = useCallback((id) => {
    const name = data.liabilities.find(l => l.id === id)?.name || 'liability'
    pushUndo(`Deleted ${name}`)
    updateData(prev => ({ ...prev, liabilities: prev.liabilities.filter(l => l.id !== id) }))
  }, [updateData, data.liabilities, pushUndo])

  // Build the cash-withdrawal transactions implied by an expense's `sources`.
  // Each linked cash account is debited proportional to its `percent` so the
  // running balance reflects what the expense actually consumed. Tagged with
  // `linkedExpenseId` so edits/deletes can later find and reconcile them
  // without touching unrelated entries.
  function buildExpenseTxns(exp, expenseId, assets, fxCache) {
    const sources = Array.isArray(exp.sources) ? exp.sources : []
    if (!sources.length) return []
    const amount = parseFloat(exp.amount) || 0
    if (!(amount > 0)) return []
    const expCcy = exp.currency || 'USD'
    const date = exp.startDate || todayISO()
    return sources
      .filter(s => s.assetId && (Number(s.percent) || 0) > 0)
      .map(s => {
        const cashAsset = assets.find(a => a.id === s.assetId)
        const cashCcy = cashAsset?.currency || expCcy
        const share = (Number(s.percent) || 0) / 100
        // Convert the user's expense amount into the cash account's native
        // currency. Without this a $200 USD expense paid from an IDR account
        // would withdraw 200 IDR instead of ~3.2M IDR.
        const fx = getFxRate(expCcy, cashCcy, fxCache || {})
        const nativeAmt = amount * share * fx
        return {
          id: generateId(),
          assetId: s.assetId,
          type: 'expense',
          date,
          quantity: 0,
          price: nativeAmt,
          totalValue: nativeAmt,
          notes: `Expense: ${exp.name}${exp.notes ? ' · ' + exp.notes : ''}`,
          tags: ['expense'],
          linkedExpenseId: expenseId,
        }
      })
      .filter(t => t.totalValue > 0)
  }

  const addExpense = useCallback((exp) => {
    const newE = { ...exp, id: generateId() }
    updateData(prev => {
      // Auto-create the matching cash withdrawals so the user's selected
      // accounts actually reflect the spend. Without this the expense was
      // just a forecasting record and balances never decreased.
      const linkedTxns = buildExpenseTxns(newE, newE.id, prev.assets, prev.fxCache)
      return {
        ...prev,
        expenses: [...(prev.expenses || []), newE],
        transactions: linkedTxns.length ? [...prev.transactions, ...linkedTxns] : prev.transactions,
      }
    })
    return newE
  }, [updateData])

  const editExpense = useCallback((id, updates) => {
    updateData(prev => {
      const merged = { ...((prev.expenses || []).find(e => e.id === id) || {}), ...updates }
      const expenses = (prev.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e)
      // Replace any previously-linked withdrawal transactions for this
      // expense with a freshly computed set so amount/source/currency edits
      // propagate through to the cash accounts cleanly.
      const transactions = [
        ...prev.transactions.filter(t => t.linkedExpenseId !== id),
        ...buildExpenseTxns(merged, id, prev.assets, prev.fxCache),
      ]
      return { ...prev, expenses, transactions }
    })
  }, [updateData])

  const deleteExpense = useCallback((id) => {
    const name = (data.expenses || []).find(e => e.id === id)?.name || 'expense'
    pushUndo(`Deleted ${name}`)
    updateData(prev => ({
      ...prev,
      expenses: (prev.expenses || []).filter(e => e.id !== id),
      // Also drop the auto-created cash withdrawals tied to this expense
      // so the linked accounts aren't left with orphaned debits.
      transactions: prev.transactions.filter(t => t.linkedExpenseId !== id),
    }))
  }, [updateData, data.expenses, pushUndo])

  const addExpenseCategory = useCallback((cat) => {
    const trimmed = (cat || '').trim()
    if (!trimmed) return
    updateData(prev => {
      const existing = prev.expenseCategories || []
      if (existing.some(c => c.toLowerCase() === trimmed.toLowerCase())) return prev
      return { ...prev, expenseCategories: [...existing, trimmed] }
    })
  }, [updateData])

  const deleteSnapshot = useCallback((date) => {
    updateData(prev => ({ ...prev, snapshots: prev.snapshots.filter(s => s.date !== date) }))
  }, [updateData])

  const addSnapshot = useCallback((snap) => {
    updateData(prev => {
      const existing = prev.snapshots.find(s => s.date === snap.date)
      const snapshots = existing
        ? prev.snapshots.map(s => s.date === snap.date ? snap : s)
        : [...prev.snapshots, snap].sort((a, b) => a.date.localeCompare(b.date))
      return { ...prev, snapshots }
    })
  }, [updateData])

  const saveManualSnapshot = useCallback(() => {
    const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = netWorthStats
    // Mark with manual: true so the auto-snapshot effect won't clobber it.
    const snap = { date: todayISO(), totalAssets: totalAssetsBase, totalLiabilities: totalLiabilitiesBase, netWorth: netWorthBase, manual: true }
    addSnapshot(snap)
  }, [netWorthStats, addSnapshot])

  const updateSettings = useCallback((updates) => {
    updateData(prev => ({ ...prev, settings: { ...prev.settings, ...updates } }))
  }, [updateData])

  const setManualPrice = useCallback((symbol, price) => {
    updateData(prev => ({
      ...prev,
      pricesCache: { ...prev.pricesCache, [symbol]: { price, timestamp: Date.now(), manual: true } }
    }))
  }, [updateData])

  // ── Import / Export ─────────────────────────────────────────
  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'portfolio-backup.json'; a.click()
    URL.revokeObjectURL(url)
  }, [data])

  const exportCsvFile = useCallback(() => {
    const csv = exportCSV(data.transactions, data.assets)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'portfolio-transactions.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [data])

  const importJson = useCallback((jsonString) => {
    try {
      const parsed = JSON.parse(jsonString)
      if (!parsed || typeof parsed !== 'object') return false
      // Coerce array fields to arrays so corrupted/legacy payloads don't crash
      // downstream code that calls .filter / .map on these.
      const merged = {
        ...EMPTY_DATA,
        ...parsed,
        assets:        Array.isArray(parsed.assets)        ? parsed.assets        : [],
        transactions:  Array.isArray(parsed.transactions)  ? parsed.transactions  : [],
        liabilities:   Array.isArray(parsed.liabilities)   ? parsed.liabilities   : [],
        snapshots:     Array.isArray(parsed.snapshots)     ? parsed.snapshots     : [],
        expenses:      Array.isArray(parsed.expenses)      ? parsed.expenses      : [],
        expenseCategories: Array.isArray(parsed.expenseCategories) ? parsed.expenseCategories : [],
        settings:      { ...EMPTY_DATA.settings, ...(parsed.settings || {}) },
        pricesCache:   (parsed.pricesCache && typeof parsed.pricesCache === 'object') ? parsed.pricesCache : {},
        fxCache:       (parsed.fxCache && typeof parsed.fxCache === 'object')         ? parsed.fxCache     : {},
      }
      setData(merged)
      // Persistence handled by the data-change effect.
      return true
    } catch {
      return false
    }
  }, [])

  const resetData = useCallback(() => {
    setData(EMPTY_DATA)
  }, [])

  // Import transactions from a CSV file. Strategy:
  //   1. Parse the CSV with our broker-aware header mapper.
  //   2. For each row, find an existing asset by symbol OR name; if neither
  //      matches, auto-create a new asset using the row's class/currency.
  //   3. Append the resulting transactions, skipping rows with missing date
  //      or type. Returns { added, created, skipped, errors }.
  const importTransactionsCSV = useCallback((csvText) => {
    const { rows, errors } = parseCSV(csvText)
    if (errors.length) return { added: 0, created: 0, skipped: 0, errors }
    // Compute the new assets/transactions arrays + tallies OUTSIDE the
    // state updater so StrictMode's double-render doesn't double-count or
    // create duplicate auto-imported assets. Read latest data via dataRef.
    const prev = dataRef.current
    const assets = [...prev.assets]
    const transactions = [...prev.transactions]
    let added = 0, created = 0, skipped = 0
    const skipReasons = []
    const findAsset = (row) => {
      if (row.symbol) {
        const m = assets.find(a => (a.symbol || '').toUpperCase() === row.symbol)
        if (m) return m
      }
      if (row.asset) {
        const m = assets.find(a => (a.name || '').toLowerCase() === row.asset.toLowerCase())
        if (m) return m
      }
      return null
    }
    for (const row of rows) {
      if (!row.date || !row.type) { skipped++; skipReasons.push('missing date/type'); continue }
      let asset = findAsset(row)
      if (!asset) {
        const inferredClass = row.class || (row.symbol ? 'stocks' : 'cash')
        asset = {
          id: generateId(),
          name: row.asset || row.symbol || 'Imported asset',
          class: inferredClass,
          symbol: row.symbol || '',
          currency: row.currency || 'USD',
          notes: 'Auto-created on CSV import',
        }
        assets.push(asset)
        created++
      }
      transactions.push({
        id: generateId(),
        assetId: asset.id,
        type: row.type,
        date: row.date,
        quantity: row.quantity || 0,
        price: row.price || 0,
        totalValue: row.totalValue || (row.quantity * row.price) || 0,
        notes: row.notes || '',
        tags: row.tags || [],
      })
      added++
    }
    updateData(p => ({ ...p, assets, transactions }))
    return { added, created, skipped, errors: skipReasons }
  }, [updateData])

  return (
    <PortfolioContext.Provider value={{
      data, loading, saveStatus, priceLoading, fxMissing, priceErrors,
      holdings, netWorthStats, allocationByClass,
      totalPassiveIncome, totalIncome, pastYearPassiveIncome,
      totalUnrealizedPnL, totalRealizedPnL, allUsedTags,
      // actions
      addAsset, editAsset, deleteAsset,
      addTransaction, editTransaction, deleteTransaction,
      addLiability, editLiability, deleteLiability,
      addExpense, editExpense, deleteExpense, addExpenseCategory,
      addSnapshot, deleteSnapshot, saveManualSnapshot, updateSettings,
      refreshPrices, setManualPrice,
      exportJson, exportCsvFile, importJson, importTransactionsCSV, resetData, updateData,
      undoStack, undoLast, pushUndo,
    }}>
      {children}
    </PortfolioContext.Provider>
  )
}
