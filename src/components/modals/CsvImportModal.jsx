import React, { useState, useMemo, useRef } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import { parseCSV } from '../../utils/api.js'

// 3-step CSV import for transactions.
//   1. Upload — drop or pick a file. We parse client-side, no server hop.
//   2. Preview — show first 20 parsed rows + counts. User reviews columns.
//   3. Confirm — call importTransactionsCSV which auto-creates missing assets.
//
// The parser in utils/api.js already handles broker header aliases (Robinhood,
// Schwab, Fidelity, our own export, etc.) so most files Just Work. When it
// can't map something the row goes into the `skipped` bucket with a reason.
export default function CsvImportModal({ onClose }) {
  const { importTransactionsCSV } = usePortfolio()
  const [step, setStep] = useState('upload') // upload | preview | done
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Parse on the fly so the preview is live as soon as the user picks a file.
  const parsed = useMemo(() => {
    if (!text) return null
    try { return parseCSV(text) } catch (err) { return { rows: [], errors: [String(err.message || err)] } }
  }, [text])

  function readFile(file) {
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      setText(String(e.target?.result || ''))
      setStep('preview')
    }
    reader.onerror = () => {
      alert('Couldn\'t read that file. Try saving it as plain CSV and try again.')
    }
    reader.readAsText(file)
  }

  function onPick(e) {
    const f = e.target.files?.[0]
    if (f) readFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) readFile(f)
  }

  function commit() {
    const res = importTransactionsCSV(text)
    setResult(res)
    setStep('done')
  }

  const previewRows = parsed?.rows?.slice(0, 20) || []
  const totalRows = parsed?.rows?.length || 0
  const parseErrors = parsed?.errors || []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {step === 'upload' ? 'Import Transactions from CSV'
              : step === 'preview' ? `Preview · ${fileName}`
              : 'Import complete'}
          </span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 'upload' && (
            <>
              <p style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.55 }}>
                Drop in a CSV from your broker (Schwab, Fidelity, Robinhood, etc.) or
                an export from this app. We'll detect common column names automatically.
              </p>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  padding: '32px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragging ? 'var(--accent-dim)' : 'var(--bg-secondary, var(--surface))',
                  transition: 'all 0.18s ease',
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {dragging ? 'Drop the file here' : 'Drop a CSV here or click to pick one'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Plain text, comma-separated. We try to map columns automatically.
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onPick}
                style={{ display: 'none' }}
              />
              <div style={{
                marginTop: 14, padding: 10, fontSize: 11, lineHeight: 1.55,
                background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
              }}>
                <strong>Expected columns</strong> (any of these names work):<br />
                date · type/action · asset/description · symbol · quantity · price · total ·
                currency · notes/memo · class
              </div>
            </>
          )}

          {step === 'preview' && parsed && (
            <>
              {parseErrors.length > 0 && (
                <div style={{
                  padding: 10, marginBottom: 12,
                  background: 'var(--loss-dim)', color: 'var(--loss)',
                  borderRadius: 'var(--radius-sm)', fontSize: 12,
                }}>
                  <strong>Couldn't read the file:</strong>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {totalRows > 0 && (
                <>
                  <div style={{
                    fontSize: 12, color: 'var(--text-muted)', marginBottom: 8,
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>
                      Parsed <strong style={{ color: 'var(--text)' }}>{totalRows}</strong> row{totalRows === 1 ? '' : 's'}
                      {totalRows > previewRows.length && ` · showing first ${previewRows.length}`}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => { setStep('upload'); setText(''); setFileName('') }}
                    >
                      ← Pick a different file
                    </button>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto', marginBottom: 12 }}>
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Asset</th>
                          <th>Symbol</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Price</th>
                          <th className="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.date || '—'}</td>
                            <td>{r.type || '—'}</td>
                            <td>{r.asset || '—'}</td>
                            <td>{r.symbol || '—'}</td>
                            <td className="text-right">{r.quantity || '—'}</td>
                            <td className="text-right">{r.price || '—'}</td>
                            <td className="text-right">{r.totalValue || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)',
                    padding: 10, background: 'var(--surface)',
                    borderRadius: 'var(--radius-sm)', lineHeight: 1.55,
                  }}>
                    Rows referencing assets you don't have yet will be created automatically
                    (using the row's symbol or description). You can rename them later from Holdings.
                  </div>
                </>
              )}
            </>
          )}

          {step === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
              <h3 style={{ margin: 0, marginBottom: 12 }}>Import finished</h3>
              <div style={{
                display: 'inline-grid', gridTemplateColumns: 'auto auto', gap: '4px 16px',
                fontSize: 13, textAlign: 'left',
              }}>
                <span>Transactions added</span>
                <strong style={{ color: 'var(--gain)' }}>{result.added}</strong>
                <span>Assets created</span>
                <strong>{result.created}</strong>
                <span>Rows skipped</span>
                <strong style={{ color: result.skipped ? 'var(--loss)' : 'var(--text)' }}>{result.skipped}</strong>
              </div>
              {result.errors?.length > 0 && (
                <div style={{
                  marginTop: 14, padding: 10, fontSize: 11,
                  background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)', textAlign: 'left',
                }}>
                  Skip reasons: {result.errors.slice(0, 5).join('; ')}
                  {result.errors.length > 5 && ` (+${result.errors.length - 5} more)`}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {step === 'upload' && (
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          )}
          {step === 'preview' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={commit}
                disabled={!totalRows || parseErrors.length > 0}
              >
                Import {totalRows} transaction{totalRows === 1 ? '' : 's'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
