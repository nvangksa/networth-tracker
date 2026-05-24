// Persisted "last used" values so the user doesn't have to retype things they
// just entered. All reads/writes are localStorage-gated and safe in private
// browsing modes (catch swallows quota / SecurityError).
//
// Keep this module dependency-free — it's imported from both the modal and
// the quick-add bar, and we want it to stay cheap.

const KEY = 'portfolio-recents-v1'

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
}

// Read the full recents object.
export function getRecents() {
  return read()
}

// Convenience getters — fall back to undefined so callers can default-OR.
export function getRecent(key) {
  return read()[key]
}

// Store a single key. Trims strings, drops empties so we don't pin "" as a recent.
export function setRecent(key, value) {
  const v = typeof value === 'string' ? value.trim() : value
  if (v == null || v === '') return
  const cur = read()
  if (cur[key] === v) return // no-op if unchanged — avoid pointless writes
  cur[key] = v
  write(cur)
}

// Bulk set — used after a successful transaction submit so we don't make
// 3 separate localStorage writes for employer + category + cashAccount.
export function setRecents(updates) {
  if (!updates || typeof updates !== 'object') return
  const cur = read()
  let dirty = false
  for (const [k, val] of Object.entries(updates)) {
    const v = typeof val === 'string' ? val.trim() : val
    if (v == null || v === '') continue
    if (cur[k] === v) continue
    cur[k] = v
    dirty = true
  }
  if (dirty) write(cur)
}

// Known recent keys — centralized so callers don't typo. Plain strings, not
// an enum, so the module stays dependency-free.
export const RECENT_KEYS = {
  employer:        'employer',         // last salary employer
  expenseCategory: 'expenseCategory',  // last expense category label
  paidFromAssetId: 'paidFromAssetId',  // last cash account used for outflows
  depositToAssetId: 'depositToAssetId', // last cash account used for income
  transferFromAssetId: 'transferFromAssetId',
  transferToAssetId:   'transferToAssetId',
}
