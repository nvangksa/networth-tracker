# Net Worth Tracker

A local-first personal net worth and portfolio tracker. All data is saved on your machine — no cloud, no login, no subscription, no analytics.

Works out of the box with **free Yahoo Finance prices** — no API key required.

> **Personal project.** Built for personal interest and use. Made with [Claude](https://claude.ai).

## Download

> **Easiest way to use it — no Node.js or terminal required.**

Head to the [**Releases**](../../releases) page and download the Windows installer:

**`Net Worth Tracker Setup 1.1.0.exe`**

Install it, open it, done. Your data is stored in your OS user-data folder and survives app reinstalls.

## Features

- **14 asset classes**: stocks, crypto, property, vehicles, cash & savings, commodities, bonds, private equity, jewelry, art, collectibles, business, banknotes, other
- **Live market prices** via Yahoo Finance (free) with optional Twelve Data fallback for ticker search
- **Multi-currency** with live FX (8 currencies — USD, IDR, SGD, EUR, GBP, JPY, AUD, CAD)
- **Cost basis & P&L** — unrealized, realized, per-sale FIFO, with long-term/short-term tax split
- **Income tracking** — dividends, rent, interest, staking rewards, salary (with source attribution)
- **Recurring expenses** — weekly / monthly / yearly / one-time, with 6-month cashflow forecast
- **Liabilities** — mortgages, loans, credit cards, with payoff projections
- **Auto-depreciation** for vehicles
- **Net worth history** — reconstructed from transactions + saved daily snapshots
- **Property** — track mortgage, net equity, rental income, LTV, gross yield
- **Cash** — APY-based compound interest projection per account
- **Reports** — balance sheet, income statement, MoM/YoY comparisons, CSV export, print-ready PDF
- **Planning** — retirement income stress test, asset rebalancing, bond/compound interest calculator
- **Dark / light mode**
- **Undo** (last 10 destructive actions)
- **Import / export** — JSON backup, CSV transactions (broker-aware header mapping)

## Run from Source

If you prefer to run from source (or want to contribute):

**Requirements:** [Node.js 18+](https://nodejs.org) (LTS version)

```
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. The app runs two processes:
- `localhost:3001` — Express API server (reads/writes `data/portfolio.json`)
- `localhost:5173` — Vite dev server (the React frontend)

## Build the Desktop App

To package your own installer:

```
npm install
npm run electron:build
```

Output goes to `release/` as a Windows `.exe` installer.

## First Time

On first run you'll see a welcome modal with two options:
- **Start fresh** — empty portfolio, add assets manually
- **Try with sample data** — a realistic example portfolio you can explore (clear it later via Settings → Reset Data)

## Optional: Twelve Data API key

Live prices work via Yahoo Finance with no setup. If you want richer ticker search (better international coverage, instrument metadata), add a free Twelve Data key:

1. Sign up at [twelvedata.com](https://twelvedata.com) (free tier: 8 req/min, 800 req/day)
2. Settings → paste key → Save

The key is stored locally in `data/portfolio.json` and never leaves your machine.

## Data

| Mode | Data location |
|---|---|
| Desktop app | `%AppData%\networth-tracker\` |
| Run from source | `data/portfolio.json` in the project folder |

- **Export**: Settings → Export JSON / Export CSV
- **Import**: Settings → Import JSON (replaces everything) or Import CSV (appends transactions, auto-creates assets)
- **Backup**: Just copy `portfolio.json` somewhere safe — the app will remind you every 30 days

## Asset Symbols

| Asset Type | Symbol Format | Example |
|---|---|---|
| US Stocks | Ticker | AAPL, MSFT, TSLA |
| Indonesian Stocks | Ticker.JK | BBCA.JK, TLKM.JK |
| European Stocks | Ticker.Exchange | SAP.DE, ASML.AS |
| UK Stocks | Ticker.L | BARC.L, HSBA.L |
| Crypto | SYMBOL-USD | BTC-USD, ETH-USD |
| Commodities | XAU/USD (gold), XAG/USD (silver) | XAU/USD |

The Add Asset modal has a ticker search box that auto-suggests symbols as you type.

## Privacy & Security

- All data lives on your machine in a JSON file. The Express server binds to `127.0.0.1` only — nothing on your LAN can read it.
- Outbound requests: Yahoo Finance (prices + FX), open.er-api.com (FX fallback), and Twelve Data (only if you've set a key). All are anonymous price lookups — no identifying data leaves your machine.
- No analytics, no error reporting service, no telemetry.

## Tech Stack

- React 18 + Vite 5
- Chart.js + react-chartjs-2 + date-fns
- Express 4 (local API server)
- Vanilla CSS (no UI framework)
