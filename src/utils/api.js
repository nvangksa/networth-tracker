// Price fetching with multiple free sources
const TD_BASE = 'https://api.twelvedata.com'

// Free stock/crypto price sources via our Express proxy (no API key, no CORS issues)
export async function fetchPricesFree(symbols) {
  if (!symbols.length) return { prices: {}, errors: [] }
  const result = {}
  const errors = []

  for (const sym of symbols) {
    try {
      const res = await fetch(`/api/price/${encodeURIComponent(sym)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        errors.push({ symbol: sym, message: err.error || 'Fetch failed' })
        continue
      }
      const json = await res.json()
      if (json.price) {
        result[sym] = { price: json.price, timestamp: Date.now(), source: 'yahoo' }
      } else {
        errors.push({ symbol: sym, message: 'No price returned' })
      }
    } catch (err) {
      errors.push({ symbol: sym, message: err.message })
    }
    await sleep(80)
  }
  return { prices: result, errors }
}

export async function searchSymbol(query, apiKey) {
  const q = query?.trim()
  if (!q) return []
  // Prefer Twelve Data when a key is set (richer instrument metadata: currency,
  // country). Fall back to the Yahoo search proxy so the autocomplete works
  // out-of-the-box without any API key.
  if (apiKey) {
    try {
      const res = await fetch(`${TD_BASE}/symbol_search?symbol=${encodeURIComponent(q)}&apikey=${apiKey}`)
      const json = await res.json()
      if (json?.data?.length) {
        return json.data.slice(0, 10).map(d => ({
          symbol: d.symbol,
          name: d.instrument_name,
          exchange: d.exchange,
          country: d.country,
          currency: d.currency,
          type: d.instrument_type,
        }))
      }
    } catch (err) {
      console.warn('Twelve Data search failed, falling back to Yahoo:', err.message)
    }
  }
  // Yahoo fallback — works without a key
  try {
    const res = await fetch(`/api/search/${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const json = await res.json()
    return json?.results || []
  } catch (err) {
    console.warn('Yahoo symbol search failed:', err.message)
    return []
  }
}

export async function fetchPrices(symbols, apiKey) {
  if (!apiKey || !symbols.length) return { prices: {}, errors: [] }
  const result = {}
  const errors = []
  // Fetch one-at-a-time so a single bad symbol doesn't fail the whole batch
  for (const sym of symbols) {
    try {
      const res = await fetch(`${TD_BASE}/price?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`)
      const json = await res.json()
      if (json.code && json.code !== 200) {
        errors.push({ symbol: sym, message: json.message || 'Unknown error' })
        continue
      }
      if (json.price) {
        result[sym] = { price: parseFloat(json.price), timestamp: Date.now() }
      } else {
        errors.push({ symbol: sym, message: 'No price returned' })
      }
    } catch (err) {
      errors.push({ symbol: sym, message: err.message })
    }
    await sleep(150)
  }
  return { prices: result, errors }
}

export async function fetchFxRate(from, to, apiKey) {
  if (!apiKey || from === to) return null
  try {
    const res = await fetch(`${TD_BASE}/exchange_rate?symbol=${from}/${to}&apikey=${apiKey}`)
    const json = await res.json()
    if (json.rate) return { rate: parseFloat(json.rate), timestamp: Date.now() }
    return null
  } catch {
    return null
  }
}

export async function fetchAllFxRates(baseCurrency, currencies, apiKey) {
  if (!apiKey) return {}
  const targets = currencies.filter(c => c !== baseCurrency && c !== 'BTC')
  const rates = {}
  for (const tgt of targets) {
    const result = await fetchFxRate(baseCurrency, tgt, apiKey)
    if (result) rates[`${baseCurrency}_${tgt}`] = result
    await sleep(200)
  }
  return rates
}

// Free FX rates — no API key required (open.er-api.com)
export async function fetchFxRatesFree(baseCurrency) {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`)
    const json = await res.json()
    if (json?.result !== 'success' || !json.rates) return null
    const result = {}
    for (const [target, rate] of Object.entries(json.rates)) {
      if (!rate || target === baseCurrency) continue
      result[`${baseCurrency}_${target}`] = { rate, timestamp: Date.now(), source: 'free' }
      result[`${target}_${baseCurrency}`] = { rate: 1 / rate, timestamp: Date.now(), source: 'free' }
    }
    return result
  } catch (err) {
    console.warn('Free FX fetch failed:', err.message)
    return null
  }
}

// Yahoo FX proxy (via our Express server) — e.g. USD→IDR fetches USDIDR=X
export async function fetchFxRatesYahoo(baseCurrency, targets) {
  const out = {}
  for (const tgt of targets) {
    if (tgt === baseCurrency) continue
    try {
      const res = await fetch(`/api/fx/${baseCurrency}/${tgt}`)
      if (!res.ok) continue
      const json = await res.json()
      if (json.rate) {
        out[`${baseCurrency}_${tgt}`] = { rate: json.rate, timestamp: Date.now(), source: 'yahoo' }
        out[`${tgt}_${baseCurrency}`] = { rate: 1 / json.rate, timestamp: Date.now(), source: 'yahoo' }
      }
    } catch {/* swallow */}
    await sleep(60)
  }
  return out
}

// Yahoo equity profile (sector/industry) via /api/quote proxy
export async function fetchSectorInfo(symbol) {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`)
    if (!res.ok) return null
    const json = await res.json()
    return { sector: json.sector || null, industry: json.industry || null }
  } catch { return null }
}

// Hardcoded approximate rates (last-resort offline fallback)
const USD_RATES_FALLBACK = {
  USD: 1, IDR: 16000, EUR: 0.92, GBP: 0.79, JPY: 151, AUD: 1.52, SGD: 1.34, CAD: 1.37
}

export function buildHardcodedFxCache(baseCurrency) {
  const baseToUsd = 1 / (USD_RATES_FALLBACK[baseCurrency] || 1)
  const result = {}
  for (const [cur, usdRate] of Object.entries(USD_RATES_FALLBACK)) {
    if (cur === baseCurrency) continue
    const rate = usdRate * baseToUsd
    result[`${baseCurrency}_${cur}`] = { rate, timestamp: Date.now(), source: 'fallback' }
    result[`${cur}_${baseCurrency}`] = { rate: 1 / rate, timestamp: Date.now(), source: 'fallback' }
  }
  return result
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export function isCacheStale(entry, maxAgeMs = 3_600_000) {
  if (!entry?.timestamp) return true
  return Date.now() - entry.timestamp > maxAgeMs
}

// Export portfolio data as CSV
export function exportCSV(transactions, assets) {
  const headers = ['Date','Asset','Class','Symbol','Currency','Type','Quantity','Price','Total Value','Notes','Tags']
  const rows = transactions.map(t => {
    const asset = assets.find(a => a.id === t.assetId) || {}
    return [
      t.date,
      csvEsc(asset.name || ''),
      asset.class || '',
      asset.symbol || '',
      asset.currency || '',
      t.type,
      t.quantity,
      t.price,
      t.totalValue,
      csvEsc(t.notes || ''),
      csvEsc((t.tags || []).join(', ')),
    ].join(',')
  })
  return [headers.join(','), ...rows].join('\n')
}

function csvEsc(v) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// Parse a CSV file produced by either our exporter or a typical broker. We
// accept multiple column-name variants so users don't need to massage the
// headers manually. The function returns { rows, errors } where rows is a
// list of plain row objects keyed by canonical header name (date, asset,
// type, quantity, price, totalValue, notes, currency, symbol, class).
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { rows: [], errors: ['CSV must have a header row and at least one data row'] }
  const headerCells = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  // Header aliases — common broker exports use varied names
  // Note: 'description' used to alias to BOTH `asset` and `notes`, which
  // meant the same column got pulled into two different canonical fields —
  // a broker export with `Description = "Apple Inc."` set both the asset
  // name and the notes to "Apple Inc.". Map it to `asset` only; brokers
  // overwhelmingly use Description for the security name. Use Notes/Memo
  // columns for actual notes.
  const HEADER_ALIASES = {
    date: ['date', 'trade date', 'transaction date', 'datetime'],
    type: ['type', 'transaction type', 'action', 'side'],
    asset: ['asset', 'name', 'description', 'security'],
    symbol: ['symbol', 'ticker', 'code'],
    class: ['class', 'asset class', 'category'],
    currency: ['currency', 'ccy'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'amount'],
    price: ['price', 'unit price', 'rate'],
    totalValue: ['total value', 'totalvalue', 'amount', 'total', 'value', 'gross amount'],
    notes: ['notes', 'note', 'memo'],
    tags: ['tags', 'tag', 'labels'],
  }
  const indexOf = (canonical) => {
    for (const alias of HEADER_ALIASES[canonical]) {
      const i = headerCells.indexOf(alias)
      if (i !== -1) return i
    }
    return -1
  }
  const colIdx = {
    date: indexOf('date'), type: indexOf('type'),
    asset: indexOf('asset'), symbol: indexOf('symbol'),
    class: indexOf('class'), currency: indexOf('currency'),
    quantity: indexOf('quantity'), price: indexOf('price'),
    totalValue: indexOf('totalValue'), notes: indexOf('notes'),
    tags: indexOf('tags'),
  }
  const errors = []
  if (colIdx.date === -1) errors.push('Missing required column: Date')
  if (colIdx.type === -1) errors.push('Missing required column: Type')

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const get = (k) => colIdx[k] !== -1 ? (cells[colIdx[k]] || '').trim() : ''
    rows.push({
      date: get('date'),
      type: get('type').toLowerCase().replace(/\s+/g, '_'),
      asset: get('asset'),
      symbol: get('symbol').toUpperCase(),
      class: get('class').toLowerCase(),
      currency: get('currency').toUpperCase() || 'USD',
      quantity: parseFloat(get('quantity')) || 0,
      price: parseFloat(get('price')) || 0,
      totalValue: parseFloat(get('totalValue')) || 0,
      notes: get('notes'),
      tags: get('tags').split(/[,;]/).map(s => s.trim()).filter(Boolean),
    })
  }
  return { rows, errors }
}

function splitCsvLine(line) {
  // RFC 4180-ish CSV splitter: handles quoted fields with embedded commas
  // and escaped quotes ("").
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') { out.push(cur); cur = '' }
      else if (ch === '"') { inQuotes = true }
      else { cur += ch }
    }
  }
  out.push(cur)
  return out
}
