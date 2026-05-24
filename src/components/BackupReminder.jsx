import React, { useState } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'

// Persistent reminder to back up the local data file. Local-first means there's
// nothing protecting users from a disk failure or accidental rm. We track when
// they last exported and show a soft banner if it's been > 30 days.
//
// Stored in localStorage so it doesn't pollute portfolio.json. Falls back to
// silent if localStorage is blocked.
const KEY = 'portfolio-last-backup'
const DAYS = 30

export default function BackupReminder() {
  const { data, exportJson } = usePortfolio()
  const [dismissed, setDismissed] = useState(false)

  // Hide on initial empty data — nothing to back up yet
  const hasData = (data.assets?.length || 0) + (data.transactions?.length || 0) > 0

  const lastBackup = (() => {
    try { return parseInt(localStorage.getItem(KEY)) || 0 } catch { return 0 }
  })()
  const daysSince = lastBackup ? Math.floor((Date.now() - lastBackup) / 86_400_000) : Infinity

  // Wrap exportJson to also stamp the backup timestamp
  function exportAndStamp() {
    exportJson()
    try { localStorage.setItem(KEY, String(Date.now())) } catch {}
    setDismissed(true)
  }

  function snooze() {
    // Snooze for 7 days by stamping a date 23 days ago instead of "now"
    try { localStorage.setItem(KEY, String(Date.now() - (DAYS - 7) * 86_400_000)) } catch {}
    setDismissed(true)
  }

  if (!hasData || dismissed || daysSince < DAYS) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'var(--card)', border: '1px solid var(--accent)',
        borderLeft: '4px solid var(--accent)',
        borderRadius: 8, padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
        display: 'flex', gap: 12, alignItems: 'center',
        fontSize: 13, zIndex: 100, maxWidth: 540,
      }}
    >
      <span style={{ fontSize: 18 }}>💾</span>
      <span style={{ flex: 1 }}>
        {lastBackup
          ? `It's been ${daysSince} days since your last backup.`
          : `You haven't backed up your portfolio data yet.`}
        {' '}<strong>Local files can be lost</strong> — export a quick JSON now.
      </span>
      <button className="btn btn-primary btn-xs" onClick={exportAndStamp}>
        ⬇ Backup
      </button>
      <button className="btn btn-ghost btn-xs" onClick={snooze} title="Remind me in a week">
        Later
      </button>
    </div>
  )
}
