# Changelog

## v1.1.0 — 2026-05-23

### Fixed

- **Yahoo Finance prices and FX now load on every Windows machine.** Some users reported blank / `$0` prices after installing — the bundled Express server bound to `127.0.0.1` (IPv4) while the renderer loaded via `localhost`, which on certain Windows machines resolves to `::1` (IPv6) first. Every internal fetch silently failed. The renderer now uses the IPv4 literal so the binding and origin always match. The Yahoo User-Agent was also upgraded to a full Chrome string because the bare `Mozilla/5.0` is increasingly rate-limited at Yahoo's edge.
- **Cash deposit / withdrawal / transfer no longer asks for "Quantity" and "Price per Unit" separately.** A single Amount field replaces both. The previous form saved with `price = 0` if the user only filled in Quantity, which then corrupted realized P&L on the withdrawal path. Matches the single-field flow that Expense and Liability Payment already used.

### Changed

- **Net Worth History page is cleaner.** The "All Points" table that dumped every reconstructed and saved snapshot was visually noisy. Replaced by a collapsed "Manage saved snapshots" disclosure that only lists deletable (saved) rows. Day-to-day reading of the page is now just chart + Year-over-Year.

### Added (since v1.0.0)

- **Financial Health summary** — runway, savings rate, debt-to-asset, and FIRE progress on the Dashboard, with a deeper breakdown under Planning → Health.
- **Safer asset deletion** — deleting an asset that still holds a balance offers a "Sell first" / "Withdraw first" shortcut so cost basis and realized P&L stay consistent.
- **CSV import with broker-aware header mapping** — accepts the column names most brokers actually use (Description, Trade Date, etc.) and auto-creates assets it doesn't recognize.
- **Transaction modal remembers your last-used values** — most recent employer (salary), source cash account (expense), and transfer destination pre-fill on the next open.

### Polish

- All FX cross-pairs now triangulate via USD (e.g. AUD → JPY) so non-USD base currencies don't fall back to a 1:1 rate when one direct pair is missing.
- Long-term capital gains flag on the Realized P&L view when a position was held ≥ 365 days.
- Per-asset annualized income surface for the retirement income planner.
- User-marked manual snapshots are no longer clobbered by the daily auto-snapshot.
- Stock split (`split`) transaction type — multiplies quantity, preserves total cost basis.
- DRIP (auto-reinvested dividends) properly mirror reinvested shares into cost basis math.
- Onboarding wizard, sidebar grouping, and many UI refinements across Dashboard, Holdings, Asset modal, and styles.

---

## v1.0.0 — 2026-05-13

Initial release.
