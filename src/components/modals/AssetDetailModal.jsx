import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import {
  formatCurrency, formatPct, formatNumber,
  ASSET_CLASSES, TXN_SHORT,
} from '../../utils/calculations.js'
import AssetModal from './AssetModal.jsx'
import TransactionModal from './TransactionModal.jsx'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))

// Friendly labels for the bond-specific enum fields stored on the asset.
const BOND_TYPE_LABELS = {
  treasury:  'Treasury',
  corporate: 'Corporate',
  municipal: 'Municipal',
  agency:    'Agency',
  foreign:   'Foreign / Sovereign',
  other:     'Other',
}
const TAX_STATUS_LABELS = {
  taxable:    'Taxable',
  tax_exempt: 'Tax-Exempt',
}
const COUPON_FREQ_LABELS = {
  1:  'Annual',
  2:  'Semi-annual',
  4:  'Quarterly',
  12: 'Monthly',
}

// A single click-through details pop-up used on Holdings, Markets, and Property
// pages. Shows the full derived holding (cost basis, unrealized, income),
// every transaction for the asset, plus quick actions (edit asset, add txn).
//
// `onEdit(holding)` — optional. When provided, the "✎ Edit Asset" button
// closes this modal and hands the holding back to the parent so the page's
// own AssetModal opens at the page level — preferred on pages that already
// manage an `editingAsset` slot, so a single edit flow stays uniform.
// When omitted, the nested AssetModal still opens correctly (rendered as a
// sibling of this backdrop, not a child, so its clicks don't bubble into
// our backdrop's onClose).
export default function AssetDetailModal({ holding, onClose, onEdit }) {
  const { data, deleteTransaction } = usePortfolio()
  const [editAsset, setEditAsset] = useState(false)
  const [addTxn, setAddTxn] = useState(false)
  const [editTxn, setEditTxn] = useState(null)
  const [confirmDelTxn, setConfirmDelTxn] = useState(null)

  const cur = data.settings.baseCurrency
  const txns = useMemo(
    () => (data.transactions || [])
      .filter(t => t.assetId === holding.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [data.transactions, holding.id]
  )

  const totalTxns = txns.length
  const buys = txns.filter(t => t.type === 'buy' || t.type === 'deposit')
  const sells = txns.filter(t => t.type === 'sell' || t.type === 'withdrawal')
  const revals = txns.filter(t => t.type === 'revaluation')
  const income = txns.filter(t => ['rental_income','dividend','staking_reward','interest_income','salary'].includes(t.type))

  const pnlCls = (holding.unrealizedPnLBase || 0) >= 0 ? 'gain' : 'loss'

  return (
    // Fragment so the nested modals below (AssetModal / TransactionModal /
    // delete-txn confirm) are SIBLINGS of this backdrop, not children. When
    // they were children, every click inside them bubbled up to our backdrop
    // onClick and dismissed both modals before the user could interact —
    // and patching that with stopPropagation at every nested layer is
    // fragile. As siblings, their clicks never reach our onClose.
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 780, width: '92vw' }}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title" style={{ marginBottom: 2 }}>
              {holding.name}
              {holding.symbol && <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 500 }}>{holding.symbol}</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <span className={`badge badge-${holding.class}`} style={{ marginRight: 6 }}>
                {CLASS_LABEL[holding.class] || holding.class}
              </span>
              Priced in {holding.currency}
              {holding.priceSource && <span style={{ marginLeft: 8 }}>· price source: {holding.priceSource}</span>}
              {holding.latestRevalDate && <span style={{ marginLeft: 8 }}>· last revalued {holding.latestRevalDate}</span>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* KPIs */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10, marginBottom: 16,
          }}>
            <Kpi label="Current Value" value={formatCurrency(holding.currentValueBase, cur, true)} />
            <Kpi label="Cost Basis" value={formatCurrency(holding.costBasisBase, cur, true)} />
            <Kpi
              label="Unrealized P&L"
              value={formatCurrency(holding.unrealizedPnLBase, cur, true)}
              sub={formatPct(holding.unrealizedPnLPct)}
              cls={pnlCls}
            />
            <Kpi label="Quantity" value={formatNumber(holding.quantity)} />
            <Kpi label="Avg Cost" value={holding.avgCostNative ? formatCurrency(holding.avgCostNative, holding.currency) : '—'} />
            <Kpi label="Current Price" value={holding.currentPrice ? formatCurrency(holding.currentPrice, holding.currency) : '—'} />
            {holding.totalIncomeBase > 0 && (
              <Kpi label="Income Collected" value={formatCurrency(holding.totalIncomeBase, cur, true)} cls="accent" />
            )}
            {holding.realizedPnLBase !== 0 && holding.realizedPnLBase != null && (
              <Kpi label="Realized P&L" value={formatCurrency(holding.realizedPnLBase, cur, true)} cls={holding.realizedPnLBase >= 0 ? 'gain' : 'loss'} />
            )}
            {holding.class === 'property' && holding.netEquityBase != null && (
              <Kpi label="Net Equity" value={formatCurrency(holding.netEquityBase, cur, true)} />
            )}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setAddTxn(true)}>+ Add Transaction</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (onEdit) { onEdit(holding); onClose() }
                else setEditAsset(true)
              }}
            >
              ✎ Edit Asset
            </button>
          </div>

          {/* Bond Details — visible only for class==='bonds' and only if the
              user entered at least one structured field. Read-only display of
              the reference data captured in AssetModal so the bond's structure
              stays visible alongside its transactions. */}
          {holding.class === 'bonds' && (
            holding.faceValue != null || holding.couponRate != null ||
            holding.maturityDate || holding.issuer ||
            holding.bondType || holding.creditRating ||
            holding.taxStatus || holding.callable
          ) && (
            <div className="card card-sm" style={{
              padding: 12, fontSize: 12, marginBottom: 14,
              background: 'var(--bg-secondary)',
              borderLeft: '3px solid var(--accent)',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)',
                marginBottom: 8,
              }}>Bond Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                {holding.issuer && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Issuer: </span><strong>{holding.issuer}</strong></div>
                )}
                {holding.bondType && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Type: </span><strong>{BOND_TYPE_LABELS[holding.bondType] || holding.bondType}</strong></div>
                )}
                {holding.creditRating && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Rating: </span><strong>{holding.creditRating}</strong></div>
                )}
                {holding.faceValue != null && holding.faceValue !== '' && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Face value: </span>
                    <strong>{formatCurrency(parseFloat(holding.faceValue) || 0, holding.currency)}</strong>
                    <span style={{ color: 'var(--text-muted)' }}> per unit</span>
                  </div>
                )}
                {holding.couponRate != null && holding.couponRate !== '' && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Coupon: </span>
                    <strong>{parseFloat(holding.couponRate).toFixed(2)}%</strong>
                    {holding.couponFrequency != null && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}· {COUPON_FREQ_LABELS[holding.couponFrequency] || `${holding.couponFrequency}×/yr`}
                      </span>
                    )}
                  </div>
                )}
                {holding.maturityDate && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Maturity: </span><strong>{holding.maturityDate}</strong></div>
                )}
                {holding.issueDate && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Issued: </span><strong>{holding.issueDate}</strong></div>
                )}
                {holding.taxStatus && (
                  <div><span style={{ color: 'var(--text-muted)' }}>Tax status: </span><strong>{TAX_STATUS_LABELS[holding.taxStatus] || holding.taxStatus}</strong></div>
                )}
                {holding.callable && (
                  <div><span style={{ color: 'var(--accent)' }}>⚠ Callable</span></div>
                )}
              </div>
            </div>
          )}

          {/* Meta notes / extras */}
          {(holding.notes || holding.sector || holding.industry || (holding.class === 'property' && parseFloat(holding.mortgageBalance) > 0)) && (
            <div className="card card-sm" style={{ padding: 10, fontSize: 12, marginBottom: 14, background: 'var(--bg-secondary)' }}>
              {holding.sector && <div><strong>Sector:</strong> {holding.sector}{holding.industry && ` · ${holding.industry}`}</div>}
              {holding.class === 'property' && parseFloat(holding.mortgageBalance) > 0 && (
                <div><strong>Mortgage:</strong> {formatCurrency(parseFloat(holding.mortgageBalance) || 0, holding.currency)}</div>
              )}
              {holding.ownershipPct != null && holding.ownershipPct !== 100 && (
                <div>
                  <strong>Ownership:</strong> {holding.ownershipPct.toFixed(1)}%
                  {(holding.class === 'business' || holding.class === 'private_equity')
                    ? ' of the company (value above is your stake)'
                    : ' (values scaled to your share)'}
                </div>
              )}
              {holding.notes && <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>{holding.notes}</div>}
            </div>
          )}

          {/* Txn summary counts */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {totalTxns} transaction{totalTxns !== 1 ? 's' : ''}
            {buys.length > 0 && ` · ${buys.length} buy${buys.length !== 1 ? 's' : ''}`}
            {sells.length > 0 && ` · ${sells.length} sell${sells.length !== 1 ? 's' : ''}`}
            {revals.length > 0 && ` · ${revals.length} revaluation${revals.length !== 1 ? 's' : ''}`}
            {income.length > 0 && ` · ${income.length} income`}
          </div>

          {totalTxns === 0 ? (
            <div className="empty-state" style={{ padding: 20, fontSize: 13 }}>
              No transactions for this asset yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Total</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map(t => (
                    <tr key={t.id}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td><span className={`badge badge-${t.type}`}>{TXN_SHORT[t.type] || t.type}</span></td>
                      <td className="text-right muted">{t.quantity ? formatNumber(t.quantity) : '—'}</td>
                      <td className="text-right muted">{t.price ? formatCurrency(t.price, holding.currency) : '—'}</td>
                      <td className="text-right fw-600">
                        {formatCurrency(parseFloat(t.totalValue) || t.price, holding.currency)}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11, maxWidth: 160 }}>
                        <div className="truncate" title={t.notes}>{t.notes || '—'}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                          <button className="btn btn-xs btn-ghost" title="Edit" onClick={() => setEditTxn(t)}>✎</button>
                          <button className="btn btn-xs btn-danger" title="Delete"
                            onClick={() => setConfirmDelTxn(t)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>

    {editAsset && <AssetModal asset={holding} onClose={() => setEditAsset(false)} />}
    {addTxn && <TransactionModal preselectedAssetId={holding.id} onClose={() => setAddTxn(false)} />}
    {editTxn && <TransactionModal transaction={editTxn} onClose={() => setEditTxn(null)} />}
    {confirmDelTxn && (
      <div className="modal-backdrop" onClick={() => setConfirmDelTxn(null)}>
        <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-title">Delete Transaction</span>
            <button className="modal-close" onClick={() => setConfirmDelTxn(null)}>×</button>
          </div>
          <div className="modal-body">
            <p>Delete this <strong>{confirmDelTxn.type}</strong> entry from {confirmDelTxn.date}?</p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => setConfirmDelTxn(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { deleteTransaction(confirmDelTxn.id); setConfirmDelTxn(null) }}>Delete</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Kpi({ label, value, sub, cls }) {
  return (
    <div style={{
      padding: 10, background: 'var(--bg-secondary)',
      border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div className={cls} style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
      {sub && <div className={cls} style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  )
}
