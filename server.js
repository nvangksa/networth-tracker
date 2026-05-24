import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const express = require('express')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { fileURLToPath } = require('url')

const app = express()
// Disable ETag globally. Yahoo/FX proxy responses change on every fetch (or
// MUST be re-fetched on every refresh), so a 304 short-circuit is never the
// right behavior here — it just makes the client appear to refresh while
// silently replaying the old body. /api/data writes don't benefit from ETag
// either since it's single-user and the client always wants the latest.
app.disable('etag')
app.use(express.json({ limit: '20mb' }))

const DATA_DIR = process.env.PORTFOLIO_DATA_DIR
  ? path.join(process.env.PORTFOLIO_DATA_DIR, 'networth-tracker')
  : path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'portfolio.json')

const DEFAULT_DATA = {
  assets: [],
  transactions: [],
  liabilities: [],
  snapshots: [],
  settings: {
    apiKey: '',
    baseCurrency: 'USD',
    autoRefresh: false,
    lastSnapshotDate: null
  },
  pricesCache: {},
  fxCache: {}
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8')
    console.log('Created data/portfolio.json with default structure')
  }
}

app.get('/api/data', async (req, res) => {
  try {
    ensureData()
    const raw = await fsp.readFile(DATA_FILE, 'utf-8')
    const data = JSON.parse(raw)
    // Merge any missing top-level keys from DEFAULT_DATA
    const merged = { ...DEFAULT_DATA, ...data }
    res.json(merged)
  } catch (err) {
    console.error('Error reading data:', err)
    res.status(500).json({ error: 'Failed to read data file' })
  }
})

// Serialize concurrent saves so two near-simultaneous POSTs can't interleave
// each other's data on disk. Writes go to a temp file then rename — atomic on
// POSIX, near-atomic on Windows — so a crash mid-write can never leave a
// truncated portfolio.json that fails to parse on next load.
let writeChain = Promise.resolve()
async function atomicWrite(file, body) {
  // Async I/O so a 20 MB body (the express.json limit) doesn't block the
  // event loop and stall concurrent /api/price proxy requests.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fsp.writeFile(tmp, body, 'utf-8')
    await fsp.rename(tmp, file)
  } catch (err) {
    try { await fsp.unlink(tmp) } catch {/* ignore */}
    throw err
  }
}

app.post('/api/data', (req, res) => {
  ensureData()
  const body = JSON.stringify(req.body, null, 2)
  // Keep `writeChain` as the pure I/O sequence so a failure to send the
  // response (e.g. client disconnected) doesn't poison subsequent writes
  // or trigger "Cannot set headers after they are sent" double-replies.
  const myWrite = writeChain.then(() => atomicWrite(DATA_FILE, body))
  writeChain = myWrite.catch(() => {/* swallow so chain stays alive */})
  myWrite.then(
    () => { try { res.json({ ok: true }) } catch {/* socket gone */} },
    (err) => {
      console.error('Error writing data:', err)
      try { res.status(500).json({ error: 'Failed to write data file' }) } catch {/* socket gone */}
    }
  )
})

// Every Yahoo-proxy response must declare `no-store` so a transparent HTTP
// cache (browser heuristic freshness, an antivirus content filter, a corporate
// proxy) can't replay a stale body. We also force ETag off — even with
// no-store, ETag triggers a 304 round-trip whose only effect is delay.
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
}

// Symbol normalization. Users naturally type things like "XAU/USD",
// "EUR/USD", "BTC/USD" — Yahoo's actual ticker for each varies.
// We return a list of candidate tickers to try in order. The original
// symbol is always first so already-canonical symbols are untouched.
//
// Verified empirically against the Yahoo chart API:
//
//   PRECIOUS METALS — Yahoo does NOT host XAUUSD=X / XAGUSD=X (they 404).
//     The actual working spellings are the futures contracts:
//       XAU/USD, GOLD       → GC=F  (gold futures, tracks spot ≈ ±0.5%)
//       XAG/USD, SILVER     → SI=F
//       XPT/USD, PLATINUM   → PL=F
//       XPD/USD, PALLADIUM  → PA=F
//     If users want a "more spot-like" tracker, GLD / IAU (ETFs) or
//     PAXG-USD (gold-backed crypto) are also live on Yahoo — they show
//     up in the ticker search autocomplete when the user types "gold".
//
//   STANDARD FOREX — Yahoo's =X form works (verified GBPUSD=X, USDJPY=X).
//       EUR/USD, GBP/USD, USD/JPY, etc. → EURUSD=X, etc.
//
//   CRYPTO — Yahoo uses dash form (verified BTC-USD).
//       BTC/USD, ETH/USD → BTC-USD, ETH-USD
//
//   COMMODITY ALIASES — OIL → CL=F (crude futures).
//
// The candidate list lets us try multiple spellings transparently so
// users can type whatever's natural without learning Yahoo's quirks.
const PRECIOUS_METAL_FUTURES = {
  XAU: 'GC=F',  // gold
  XAG: 'SI=F',  // silver
  XPT: 'PL=F',  // platinum
  XPD: 'PA=F',  // palladium
}
const FOREX_CCY = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNY','HKD','SGD','NZD','SEK','NOK','MXN','INR','IDR','KRW','BRL','ZAR','TRY']
const CRYPTO_BASES = ['BTC','ETH','SOL','XRP','ADA','DOGE','DOT','MATIC','LTC','BCH','TRX','LINK','UNI','AVAX','ATOM','BNB']

function normalizeSymbol(rawSym) {
  const sym = String(rawSym || '').trim()
  if (!sym) return [sym]
  const out = [sym] // always try the original first
  const upper = sym.toUpperCase()

  // No single-word aliases (e.g. GOLD → GC=F) — we deliberately don't add
  // those because Yahoo serves "GOLD" as Barrick Gold (the mining equity,
  // ~$41) which then masks the alias. Users who want a commodity should
  // type the slash form (XAU/USD), the canonical futures ticker (GC=F),
  // or a gold ETF (GLD, IAU). All three are surfaced in the placeholder.

  // Try to parse as a CCY/CCY (or CCY-CCY, or CCYCCY) pair. Both sides
  // must be 3–4 chars to plausibly be a currency or precious-metal code.
  let base = null, quote = null
  const slashMatch = sym.match(/^([A-Za-z]{3,4})\s*[\/\-]\s*([A-Za-z]{3,4})$/)
  if (slashMatch) {
    base = slashMatch[1].toUpperCase()
    quote = slashMatch[2].toUpperCase()
  } else if (/^[A-Za-z]{6,8}$/.test(sym)) {
    // Concatenated form like XAUUSD or EURUSD — split first 3 vs last 3.
    base = upper.slice(0, 3)
    quote = upper.slice(3)
  }

  if (base && quote) {
    // Precious metals: route to the futures contract because Yahoo does
    // NOT host the synthetic XAUUSD=X / XAGUSD=X tickers — they 404.
    // GC=F (gold futures) is what every spot-gold proxy actually maps to.
    if (PRECIOUS_METAL_FUTURES[base]) {
      out.push(PRECIOUS_METAL_FUTURES[base])
    }
    // Standard fiat forex — Yahoo's =X form is the canonical spelling.
    else if (FOREX_CCY.includes(base) && FOREX_CCY.includes(quote)) {
      out.push(`${base}${quote}=X`)
    }
    // Crypto pairs — Yahoo uses dash form.
    else if (CRYPTO_BASES.includes(base) && FOREX_CCY.includes(quote)) {
      out.push(`${base}-${quote}`)
    }
    // Unknown pair — try the =X form anyway in case it's an exotic forex
    // pair Yahoo happens to support.
    else {
      out.push(`${base}${quote}=X`)
    }
  }

  // Deduplicate while preserving order
  return [...new Set(out)]
}

// Bare `Mozilla/5.0` is increasingly often refused by Yahoo's edge with a
// 429/403 — they treat it as bot traffic. A realistic desktop browser UA
// gets through reliably across regions. This is the same UA modern Chrome
// sends, sans Chrome version (so we don't have to update it).
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Hit Yahoo's chart endpoint once. Returns { ok, status, price, currency } —
// extracted so we can probe a list of candidate symbols in turn.
async function tryYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
  const response = await fetch(url, { headers: YAHOO_HEADERS })
  if (!response.ok) return { ok: false, status: response.status }
  const json = await response.json()
  const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
  const currency = json?.chart?.result?.[0]?.meta?.currency || 'USD'
  if (!price) return { ok: false, status: 404 }
  return { ok: true, status: 200, price, currency }
}

// Yahoo Finance price proxy (avoids browser CORS).
// We try the original symbol first, then any normalized candidates (XAU/USD
// → XAUUSD=X etc.) so users can type natural forms and still get prices.
app.get('/api/price/:symbol', async (req, res) => {
  noStore(res)
  const { symbol } = req.params
  const candidates = normalizeSymbol(symbol)
  let lastStatus = 404
  try {
    for (const candidate of candidates) {
      const r = await tryYahooPrice(candidate)
      if (r.ok) {
        return res.json({ symbol, resolvedSymbol: candidate, price: r.price, currency: r.currency })
      }
      lastStatus = r.status
    }
    return res.status(lastStatus).json({
      error: `No price data for ${symbol}${candidates.length > 1 ? ` (tried: ${candidates.join(', ')})` : ''}`,
    })
  } catch (err) {
    console.error('Price proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance sector/industry proxy via the (public) search endpoint.
// The quoteSummary endpoint now requires an authenticated crumb; search does not.
app.get('/api/quote/:symbol', async (req, res) => {
  noStore(res)
  const { symbol } = req.params
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`
    const response = await fetch(url, { headers: YAHOO_HEADERS })
    if (!response.ok) return res.status(response.status).json({ error: `Yahoo ${response.status}` })
    const json = await response.json()
    // Find an EQUITY match whose symbol matches (case-insensitive)
    const quotes = json?.quotes || []
    const match = quotes.find(q => q.symbol?.toUpperCase() === symbol.toUpperCase() && q.quoteType === 'EQUITY')
      || quotes.find(q => q.quoteType === 'EQUITY')
    if (!match) return res.status(404).json({ error: 'No sector data' })
    res.json({
      symbol,
      longName: match.longname || match.shortname || null,
      sector:   match.sector || match.sectorDisp || null,
      industry: match.industry || match.industryDisp || null,
      exchange: match.exchDisp || match.exchange || null,
    })
  } catch (err) {
    console.error('Quote proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance symbol search proxy — works without an API key so the
// AssetModal ticker autocomplete is usable for everyone, not just users
// who entered a Twelve Data key.
app.get('/api/search/:query', async (req, res) => {
  noStore(res)
  const { query } = req.params
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`
    const response = await fetch(url, { headers: YAHOO_HEADERS })
    if (!response.ok) return res.status(response.status).json({ error: `Yahoo ${response.status}` })
    const json = await response.json()
    const quotes = (json?.quotes || [])
      .filter(q => q.symbol)
      .slice(0, 10)
      .map(q => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange || '',
        country: q.exchange || '',
        // Yahoo doesn't return currency on the search endpoint; default to USD
        // and let users override on the Asset modal.
        currency: q.currency || 'USD',
        type: q.quoteType || '',
      }))
    res.json({ results: quotes })
  } catch (err) {
    console.error('Search proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance FX proxy — e.g. /api/fx/USD/IDR returns { rate }
app.get('/api/fx/:from/:to', async (req, res) => {
  noStore(res)
  const { from, to } = req.params
  if (from === to) return res.json({ from, to, rate: 1 })
  try {
    const pair = `${from.toUpperCase()}${to.toUpperCase()}=X`
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?interval=1d&range=1d`
    const response = await fetch(url, { headers: YAHOO_HEADERS })
    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo returned ${response.status}` })
    }
    const json = await response.json()
    const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    if (!rate) return res.status(404).json({ error: 'No FX data' })
    res.json({ from, to, rate, source: 'yahoo' })
  } catch (err) {
    console.error('FX proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// In packaged Electron builds the frontend is pre-built into dist/.
// Express serves it here so the app loads from http://localhost:3001 with no
// Vite dev server needed.
if (process.env.ELECTRON_PRODUCTION) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const distPath = path.join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

// In Electron production mode use port 0 so the OS picks any free port,
// avoiding conflicts if the user has something else on 3001. Dev mode keeps
// 3001 so the Vite proxy config continues to work unchanged.
const PORT = process.env.ELECTRON_PRODUCTION ? 0 : 3001
ensureData()
// Bind to localhost only — this is a single-user local-first app and the data
// file has no auth. Binding to 0.0.0.0 would let anyone on the LAN read or
// overwrite the user's portfolio.
//
// IMPORTANT: we explicitly bind to the IPv4 loopback (`127.0.0.1`). Some
// Windows machines resolve `localhost` to `::1` (IPv6) first; if we bound
// only there the renderer's fetch('/api/...') from `http://localhost:<port>`
// would silently fail and Yahoo data never loaded. The main process now also
// uses the literal `127.0.0.1` in `mainWindow.loadURL` so this binding and
// the renderer origin always match.
export const serverReady = new Promise((resolve, reject) => {
  const httpServer = app.listen(PORT, '127.0.0.1', () => {
    const port = httpServer.address().port
    console.log(`Portfolio API server running on http://127.0.0.1:${port}`)
    console.log(`Data file: ${DATA_FILE}`)
    resolve(port)
  })
  httpServer.on('error', reject)
})
