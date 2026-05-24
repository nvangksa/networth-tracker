import React from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { useTheme } from '../hooks/useTheme.js'

// Minimal inline icons (stroked, uniform 18px, currentColor). No icon lib dependency.
const Icon = ({ d, size = 18, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

const ICONS = {
  dashboard:    <Icon d={<><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>} />,
  holdings:     <Icon d={<><path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M3 7.5l9 4.5 9-4.5"/><path d="M12 12v9"/></>} />,
  stocks:       <Icon d={<><path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h7v7"/></>} />,
  transactions: <Icon d={<><path d="M4 7h14l-3-3"/><path d="M20 17H6l3 3"/></>} />,
  property:     <Icon d={<><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></>} />,
  cash:         <Icon d={<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v.01M18 14v.01"/></>} />,
  expenses:     <Icon d={<><path d="M3 6h18l-2 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 6z"/><path d="M8 6V4a4 4 0 0 1 8 0v2"/><path d="M10 11v5M14 11v5"/></>} />,
  income:       <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15.5 9.5c-.5-1.2-1.9-2-3.5-2s-3 .8-3 2 1.5 1.8 3 2 3 .8 3 2-1.5 2-3 2-3-.8-3.5-2"/></>} />,
  liabilities:  <Icon d={<><path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></>} />,
  history:      <Icon d={<><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 8v5l3 2"/></>} />,
  reports:      <Icon d={<><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></>} />,
  planning:     <Icon d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M12 3v2M21 12h-2M12 21v-2M3 12h2"/></>} />,
  settings:     <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />,
  sun:          <Icon d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>} />,
  moon:         <Icon d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>} />,
  chevronL:     <Icon d={<path d="M15 18l-6-6 6-6"/>} size={16} />,
  chevronR:     <Icon d={<path d="M9 6l6 6-6 6"/>} size={16} />,
  menu:         <Icon d={<><path d="M3 6h18M3 12h18M3 18h18"/></>} />,
}

// Nav grouped into thematic sections. Same 13 destinations, but a flat
// 13-item list reads as a wall of links — grouping into 5 themed clusters
// lets the eye scan by purpose first ("I want to look at my spending →
// Cashflow") rather than memorizing positions in a list. Sections render
// with a small uppercase caption between groups; in the collapsed sidebar
// the captions disappear and only the icons show, so it doesn't add bulk.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard',    label: 'Dashboard'    },
      { id: 'history',      label: 'Net Worth'    },
    ],
  },
  {
    label: 'Assets',
    items: [
      { id: 'holdings',     label: 'Holdings'     },
      { id: 'stocks',       label: 'Markets'      },
      { id: 'property',     label: 'Property'     },
      { id: 'cash',         label: 'Cash & Savings' },
    ],
  },
  {
    label: 'Cashflow',
    items: [
      { id: 'income',       label: 'Income'       },
      { id: 'expenses',     label: 'Expenses'     },
      { id: 'liabilities',  label: 'Liabilities'  },
    ],
  },
  {
    label: 'Activity',
    items: [
      { id: 'transactions', label: 'Transactions' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { id: 'reports',      label: 'Reports'      },
      { id: 'planning',     label: 'Planning'     },
    ],
  },
]

// Minimal monogram logo — solid accent circle with a clean serif "P" inside.
// Matches the Fraunces display font used across headings for a unified mark.
function Logo() {
  return (
    <svg className="sidebar-logo-icon" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="var(--accent)" />
      <text
        x="20" y="20"
        textAnchor="middle" dominantBaseline="central"
        fontFamily="Fraunces, Georgia, serif"
        fontSize="24" fontWeight="500"
        fill="var(--bg)"
        style={{ letterSpacing: '-0.02em' }}
      >P</text>
    </svg>
  )
}

export default function Sidebar({ active, onNavigate, collapsed, onToggleCollapse, mobileOpen }) {
  const { saveStatus } = usePortfolio()
  const { theme, toggle } = useTheme()

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-logo">
        <Logo />
        {!collapsed && <span className="sidebar-logo-text">Portfolio</span>}
        <button className="sidebar-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? ICONS.chevronR : ICONS.chevronL}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section, si) => (
          <React.Fragment key={section.label}>
            {/* Section caption — hidden when sidebar is collapsed. A small
                top-margin separates the caption from the previous group
                without needing a horizontal rule. */}
            {!collapsed && (
              <div
                className="sidebar-nav-section"
                style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text-muted)',
                  padding: '14px 16px 4px',
                  marginTop: si === 0 ? 0 : 4,
                }}
              >
                {section.label}
              </div>
            )}
            {/* Collapsed mode: subtle divider line between groups so the
                icon stack still parses as clusters at a glance. */}
            {collapsed && si > 0 && (
              <div style={{
                height: 1, background: 'var(--border)',
                margin: '6px 12px', opacity: 0.6,
              }} />
            )}
            {section.items.map(item => (
              <div
                key={item.id}
                className={`sidebar-nav-item${active === item.id ? ' active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon">{ICONS[item.id]}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </div>
            ))}
          </React.Fragment>
        ))}
      </nav>

      {/* Settings + theme toggle sit at the bottom in their own small group
          so they're predictable utility actions, not part of the navigation. */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
        <div
          className={`sidebar-nav-item${active === 'settings' ? ' active' : ''}`}
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
        >
          <span className="nav-icon">{ICONS.settings}</span>
          {!collapsed && <span className="nav-label">Settings</span>}
        </div>
        {/* Sidebar theme toggle cycles through all four themes (Paper Light
            → Modern Light → Dark → Midnight Library → Paper Light). Icon +
            label reflect the current theme so users always see what's active
            rather than what tapping will do. Settings has a proper picker for
            finer control. */}
        {(() => {
          const isDarkFamily = theme === 'dark' || theme === 'midnight'
          const fullLabel = theme === 'dark' ? 'Dark'
            : theme === 'midnight' ? 'Midnight Library'
            : theme === 'modern' ? 'Modern Light'
            : 'Paper Light'
          const shortLabel = theme === 'dark' ? 'Dark'
            : theme === 'midnight' ? 'Midnight'
            : theme === 'modern' ? 'Modern'
            : 'Paper'
          return (
            <div
              className="sidebar-nav-item"
              onClick={toggle}
              title={`Theme: ${fullLabel} — click to cycle`}
            >
              <span className="nav-icon">{isDarkFamily ? ICONS.moon : ICONS.sun}</span>
              {!collapsed && <span className="nav-label">{shortLabel}</span>}
            </div>
          )
        })()}
      </div>

      {!collapsed && (
        <div className="sidebar-footer">
          {saveStatus === 'saving' && '● Saving…'}
          {saveStatus === 'saved'  && '● Saved'}
          {saveStatus === 'error'  && '● Save failed'}
          {saveStatus === 'idle'   && 'Auto-synced'}
        </div>
      )}
    </aside>
  )
}
