import React, { useState, useRef, useEffect } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { CURRENCIES, formatCurrency } from '../utils/calculations.js'
import FxCalculator from './FxCalculator.jsx'
import ToggleTile from './ToggleTile.jsx'
import { useTheme, THEMES } from '../hooks/useTheme.js'

// Two-tone preview swatches for the theme picker. The first stop is the
// page background, the second is the accent — gives an instant sense of
// each theme's mood without rendering a full mockup.
const THEME_PREVIEW = {
  light:  { bg: '#F1ECDF', accent: '#1F6C58' },
  modern: { bg: '#F7F8FA', accent: '#4F46E5' },
  dark:   { bg: '#0F1115', accent: '#4FBE9A' },
}

export default function Settings() {
  const {
    data, updateSettings, exportJson, exportCsvFile, importJson, importTransactionsCSV, resetData,
    refreshPrices, priceLoading
  } = usePortfolio()

  const [apiKey, setApiKey] = useState(data.settings.apiKey || '')
  const [baseCurrency, setBaseCurrency] = useState(data.settings.baseCurrency || 'USD')
  const [autoRefresh, setAutoRefresh] = useState(data.settings.autoRefresh || false)
  const [saved, setSaved] = useState(false)
  // Re-sync local form state when the underlying settings change from
  // elsewhere (CurrencyToggle in the header, the FX calculator embedded on
  // this page, etc.). Without this, clicking "Save Settings" with stale
  // local state would overwrite an externally-applied change.
  useEffect(() => { setApiKey(data.settings.apiKey || '') }, [data.settings.apiKey])
  useEffect(() => { setBaseCurrency(data.settings.baseCurrency || 'USD') }, [data.settings.baseCurrency])
  useEffect(() => { setAutoRefresh(data.settings.autoRefresh || false) }, [data.settings.autoRefresh])
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmResetFinal, setConfirmResetFinal] = useState(false)
  const [resetText, setResetText] = useState('')
  const [importStatus, setImportStatus] = useState(null)
  const [csvImportResult, setCsvImportResult] = useState(null)
  const fileRef = useRef(null)
  const csvFileRef = useRef(null)

  function handleSave(e) {
    e.preventDefault()
    updateSettings({ apiKey: apiKey.trim(), baseCurrency, autoRefresh })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const ok = importJson(ev.target.result)
      setImportStatus(ok ? 'success' : 'error')
      setTimeout(() => setImportStatus(null), 3000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleCsvImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = importTransactionsCSV(ev.target.result)
      setCsvImportResult(result)
      setTimeout(() => setCsvImportResult(null), 8000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const stats = {
    assets: data.assets.length,
    transactions: data.transactions.length,
    liabilities: data.liabilities.length,
    snapshots: data.snapshots.length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">API keys, currency, data management</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Main settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <ThemePicker />
          <div className="card">
            <div className="card-header">
              <span className="card-title">API & Currency</span>
            </div>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Twelve Data API Key <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="Leave blank — Yahoo Finance is used by default"
                  autoComplete="off"
                />
                <div className="form-hint">
                  ✓ <strong>Live prices work without a key</strong> via Yahoo Finance (free, unlimited).
                  Optionally add a{' '}
                  <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    Twelve Data key
                  </a>{' '}
                  for ticker search + international exchanges (paid plan required for some symbols).
                </div>
              </div>

              <div className="form-group">
                <label>Base Display Currency</label>
                <select value={baseCurrency} onChange={e => setBaseCurrency(e.target.value)}>
                  {CURRENCIES.filter(c => c !== 'BTC').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <div className="form-hint">All values are converted to this currency for display</div>
              </div>

              <div className="form-group mb-0">
                <ToggleTile
                  checked={autoRefresh}
                  onChange={next => {
                    setAutoRefresh(next)
                    updateSettings({ autoRefresh: next })
                  }}
                  label="Auto-refresh prices every hour"
                />
                <div className="form-hint" style={{ marginTop: 4 }}>Refreshes market prices in the background every hour.</div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" className="btn btn-primary">Save Settings</button>
                {saved && <span style={{ fontSize: 12, color: 'var(--gain)' }}>✓ Saved</span>}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => refreshPrices({ force: true })}
                  disabled={priceLoading}
                >
                  {priceLoading
                    ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Refreshing…</>
                    : '↻ Refresh Prices Now'}
                </button>
              </div>
            </form>
          </div>

          {/* FX calculator — lets user sanity-check FX rates */}
          <FxCalculator />

          {/* Data info */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Data Overview</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {Object.entries(stats).map(([key, val]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize', marginBottom: 2 }}>{key}</div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Data file: <code style={{ background: 'var(--surface)', padding: '2px 5px', borderRadius: 3 }}>data/portfolio.json</code>
            </div>
          </div>
        </div>

        {/* Data management */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Export Data</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Export your complete portfolio data for backup or migration.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={exportJson}>
                ↓ Export JSON
              </button>
              <button className="btn btn-secondary" onClick={exportCsvFile}>
                ↓ Export Transactions CSV
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Import Data</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Import a JSON backup (replaces everything) or a CSV of transactions
              (appends; auto-creates assets it doesn't recognize).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvImport}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                ↑ Import JSON (replace)
              </button>
              <button className="btn btn-secondary" onClick={() => csvFileRef.current?.click()}>
                ↑ Import CSV (append)
              </button>
            </div>
            {importStatus === 'success' && (
              <div className="alert alert-info" style={{ marginTop: 10, marginBottom: 0 }}>✓ Data imported successfully</div>
            )}
            {importStatus === 'error' && (
              <div className="alert alert-error" style={{ marginTop: 10, marginBottom: 0 }}>✕ Invalid JSON file</div>
            )}
            {csvImportResult && (
              <div
                className={csvImportResult.errors.length ? 'alert alert-error' : 'alert alert-info'}
                style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}
              >
                {csvImportResult.errors.length ? (
                  <>
                    <div style={{ fontWeight: 600 }}>✕ CSV import failed</div>
                    {csvImportResult.errors.slice(0, 3).map((e, i) => <div key={i}>· {e}</div>)}
                  </>
                ) : (
                  <>
                    ✓ Imported <strong>{csvImportResult.added}</strong> transaction{csvImportResult.added !== 1 ? 's' : ''}
                    {csvImportResult.created > 0 && <> · auto-created <strong>{csvImportResult.created}</strong> asset{csvImportResult.created !== 1 ? 's' : ''}</>}
                    {csvImportResult.skipped > 0 && <> · skipped {csvImportResult.skipped} (missing date/type)</>}
                  </>
                )}
              </div>
            )}
            <div className="form-hint" style={{ marginTop: 10, fontSize: 11 }}>
              CSV columns recognized: Date, Type, Asset/Name, Symbol, Class,
              Currency, Quantity, Price, Total Value, Notes, Tags. Common broker
              header variants (Trade Date, Action, Ticker, etc.) also work.
            </div>
          </div>

          <div className="card" style={{ borderColor: 'var(--loss)' }}>
            <div className="card-header">
              <span className="card-title" style={{ color: 'var(--loss)' }}>Danger Zone</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Permanently delete all portfolio data. This cannot be undone. Export a backup first.
            </p>
            <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>
              Reset All Data
            </button>
          </div>

          {/* First confirmation modal */}
          {confirmReset && !confirmResetFinal && (
            <div className="modal-backdrop" onClick={() => setConfirmReset(false)}>
              <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span className="modal-title" style={{ color: 'var(--loss)' }}>⚠ Reset All Data?</span>
                  <button className="modal-close" onClick={() => setConfirmReset(false)}>×</button>
                </div>
                <div className="modal-body">
                  <p style={{ fontSize: 14, marginBottom: 10 }}>
                    This will permanently delete <strong>everything</strong>:
                  </p>
                  <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, marginBottom: 12 }}>
                    <li>All assets, holdings, and prices</li>
                    <li>All transactions and income history</li>
                    <li>All liabilities and expenses</li>
                    <li>All net worth snapshots and FX cache</li>
                  </ul>
                  <p style={{ fontSize: 13, color: 'var(--loss)' }}>
                    This action cannot be undone. Export a backup first if you haven't already.
                  </p>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
                  <button className="btn btn-danger" onClick={() => { setConfirmResetFinal(true); setResetText('') }}>
                    Continue →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Second (final) confirmation — requires typing DELETE */}
          {confirmResetFinal && (
            <div className="modal-backdrop" onClick={() => { setConfirmResetFinal(false); setConfirmReset(false); setResetText('') }}>
              <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span className="modal-title" style={{ color: 'var(--loss)' }}>Final Confirmation</span>
                  <button className="modal-close" onClick={() => { setConfirmResetFinal(false); setConfirmReset(false); setResetText('') }}>×</button>
                </div>
                <div className="modal-body">
                  <p style={{ fontSize: 14, marginBottom: 12 }}>
                    To confirm, type <strong style={{ color: 'var(--loss)' }}>DELETE</strong> below:
                  </p>
                  <input
                    autoFocus
                    value={resetText}
                    onChange={e => setResetText(e.target.value)}
                    placeholder="Type DELETE to confirm"
                    style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}
                  />
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => { setConfirmResetFinal(false); setConfirmReset(false); setResetText('') }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={resetText !== 'DELETE'}
                    onClick={() => {
                      resetData()
                      setConfirmReset(false)
                      setConfirmResetFinal(false)
                      setResetText('')
                    }}
                  >
                    Permanently Delete Everything
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* About */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <span className="card-title">About</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <p><strong>Portfolio Tracker</strong> — Local-first personal finance app</p>
          <p>All data stored in <code style={{ background: 'var(--surface)', padding: '1px 4px', borderRadius: 3 }}>data/portfolio.json</code> on your machine. No cloud sync, no login required.</p>
          <p style={{ marginTop: 8 }}>Prices via Yahoo Finance (free) + optional <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Twelve Data</a> · Built with React + Vite + Express</p>
        </div>
      </div>
    </div>
  )
}

// Theme picker — shows all three themes side-by-side with a two-tone swatch
// per option (page background + accent). Selected theme gets an accent ring.
// Clicking applies immediately so the user sees the change in-context; we
// don't make them hit Save first because theme is a personal preference
// that should be reversible with a single click.
function ThemePicker() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Appearance</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {THEMES.map(t => {
          const active = theme === t.id
          const swatch = THEME_PREVIEW[t.id]
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              style={{
                background: 'transparent',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: 10,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color var(--transition), transform var(--transition)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                color: 'var(--text)',
              }}
            >
              {/* Two-tone preview: page bg on the left, accent on the right */}
              <div style={{
                height: 36, borderRadius: 4, overflow: 'hidden',
                display: 'flex',
              }}>
                <div style={{ flex: 1, background: swatch.bg }} />
                <div style={{ flex: 1, background: swatch.accent }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {t.label}
                  {active && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {t.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="form-hint" style={{ marginTop: 10, fontSize: 11 }}>
        Applies instantly. The sidebar toggle cycles through these in order.
      </div>
    </div>
  )
}
