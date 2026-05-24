import React from 'react'
import { formatCurrency, formatNumber } from '../../utils/calculations.js'

/**
 * Confirmation modal shown when a user clicks the ✕ delete button on a
 * holding. The original flow was a single "Delete" button that wiped the
 * asset AND all its transactions — destroying realized P&L history and
 * making it look in reports as if the position had never existed.
 *
 * This modal offers a safer first path:
 *
 *   1. "Sell/Withdraw remaining" — opens the TransactionModal pre-filled
 *      with the asset's full remaining quantity at the current price, so the
 *      user logs the disposition properly. Realized P&L stays on the books,
 *      the holding remains visible (now closed), and the user can choose to
 *      delete the asset record later if they actually want it gone.
 *
 *   2. "Delete without selling" — the existing destructive action, kept for
 *      users who entered an asset by mistake or want to start over. We're
 *      explicit that this wipes transactions and that undo is one-click.
 *
 * Props:
 *   holding  — the holding object from usePortfolio().holdings (has class,
 *              quantity, currentValueBase, etc.)
 *   onSellInstead({ type, quantity, price })  — parent opens the TransactionModal
 *   onDelete()  — parent calls deleteAsset(holding.id)
 *   onClose()   — dismiss
 */
export default function AssetDeleteModal({ holding, onSellInstead, onDelete, onClose }) {
  if (!holding) return null

  const isCash = holding.class === 'cash'
  const qty = parseFloat(holding.quantity) || 0
  const hasQty = qty > 0
  // Per-unit price in the asset's native currency. Falls back to 0 for
  // assets like vehicles/jewelry where the calculation layer may not have
  // a price; the TransactionModal still opens, the user just types it.
  const nativePrice = parseFloat(holding.currentPrice) || 0
  // For cash, the "price" is always 1 (each unit IS the currency) so the
  // withdrawal totalValue equals quantity. For everything else we use the
  // last known per-unit market price.
  const sellPrice = isCash ? 1 : nativePrice
  const sellType = isCash ? 'withdrawal' : 'sell'

  const sellLabel = isCash
    ? `Withdraw remaining ${formatNumber(qty, 2)} ${holding.currency || ''}`.trim()
    : `Sell remaining ${formatNumber(qty, 4)} units`

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Delete {holding.name}?</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12 }}>
            How would you like to remove <strong>{holding.name}</strong>?
          </p>

          {/* Option 1: log a sale first. Strongly recommended for any
              position that was actually sold/withdrawn — keeps P&L history. */}
          {hasQty && (
            <button
              type="button"
              className="card"
              onClick={() => onSellInstead({
                type: sellType,
                quantity: qty,
                price: sellPrice,
              })}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                marginBottom: 10, padding: '14px 16px',
                background: 'var(--card)', color: 'var(--text)',
                border: '1px solid var(--accent)',
                boxShadow: 'var(--shadow-soft)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ color: 'var(--accent)' }}>
                  {isCash ? 'Withdraw it first (recommended)' : 'Sell it first (recommended)'}
                </strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Opens a {isCash ? 'withdrawal' : 'sell'} transaction pre-filled with the full remaining
                {' '}{isCash ? 'balance' : 'quantity'}. Realized P&amp;L and history stay on your books.
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {sellLabel}
                {nativePrice > 0 && !isCash && (
                  <span> · current price {formatCurrency(nativePrice, holding.currency || 'USD')}</span>
                )}
              </div>
            </button>
          )}

          {/* Option 2: just delete. Destructive — wipes everything. */}
          <button
            type="button"
            className="card"
            onClick={onDelete}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '14px 16px',
              background: 'var(--card)', color: 'var(--text)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-soft)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ color: 'var(--loss)' }}>Delete without selling</strong>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Removes the asset and <strong>all</strong> its transactions. Use this if
              you added the asset by mistake. Undo from the toast that appears.
            </div>
          </button>

          {!hasQty && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Position is already at zero — there's nothing left to sell.
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
