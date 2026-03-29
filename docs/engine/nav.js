// engine/nav.js
// Injects the site-wide nav into any element with id="site-nav" or the first <nav>.
// Usage: add <nav id="site-nav"></nav> anywhere, then <script src="engine/nav.js"></script>
//
// To mark the current page active, add data-page="<key>" to the <nav> element,
// or the script will auto-detect from the current filename.

const NAV_LINKS = [
  { key: 'lobby',       href: 'lobby.html',       label: '🏠 Lobby'       },
  { key: 'game',        href: 'game.html',         label: '♟ Play'         },  // only shown when in a game (via ?game=)
  { key: 'attack',      href: 'attack-zones.html', label: '⚔ Attack Zones' },
  { key: 'scoring',     href: 'scoring.html',      label: '📊 Scoring'      },
  { key: 'rules',       href: 'rules.html',        label: '📖 Rules'        },
  { key: 'crypto',      href: 'crypto-demo.html',  label: '🔐 Crypto'       },
  { key: 'audit',       href: 'audit.html',        label: '📋 Audit'        },
  { key: 'nuke',        href: 'nuke.html',         label: '💥 Nuke'         },
];

// Pages that show the full nav (all links)
const FULL_NAV_PAGES = ['lobby', 'game', 'nuke'];

// Pages that are "docs" — show docs subset + lobby
const DOCS_NAV_PAGES = ['attack', 'scoring', 'rules', 'crypto', 'audit'];

// Pages to show per context
const PAGE_LINKS = {
  lobby:   ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit', 'nuke'],
  game:    ['lobby', 'rules', 'crypto', 'audit', 'nuke'],
  nuke:    ['lobby', 'rules', 'crypto', 'audit', 'nuke'],
  attack:  ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit'],
  scoring: ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit'],
  rules:   ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit'],
  crypto:  ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit'],
  audit:   ['lobby', 'attack', 'scoring', 'rules', 'crypto', 'audit'],
};

function detectCurrentPage() {
  const file = location.pathname.split('/').pop().replace('.html','') || 'lobby';
  const map = {
    'lobby': 'lobby', 'game': 'game', 'nuke': 'nuke',
    'attack-zones': 'attack', 'scoring': 'scoring',
    'rules': 'rules', 'crypto-demo': 'crypto', 'audit': 'audit',
  };
  return map[file] || 'lobby';
}

function buildNav() {
  const navEl = document.getElementById('site-nav') || document.querySelector('nav');
  if (!navEl) return;

  const currentPage = navEl.dataset.page || detectCurrentPage();
  const linkKeys = PAGE_LINKS[currentPage] || PAGE_LINKS['lobby'];

  // Get the game code if we're in game view
  const gameCode = new URLSearchParams(location.search).get('game');

  // Build links
  const linksHtml = linkKeys.map(key => {
    const link = NAV_LINKS.find(l => l.key === key);
    if (!link) return '';
    const isActive = key === currentPage;
    const href = (key === 'game' && gameCode) ? `game.html?game=${gameCode}` : link.href;
    return `<a href="${href}"${isActive ? ' class="active"' : ''}>${link.label}</a>`;
  }).join('\n  ');

  // Code badge for game pages
  const codeBadge = gameCode
    ? `<span id="nav-code" style="font-family:monospace;font-weight:800;letter-spacing:3px;color:var(--accent,#e94560);font-size:.9rem;">${gameCode}</span>`
    : '';

  navEl.innerHTML = `
  ${linksHtml}
  ${codeBadge}
  <span id="version-badge" style="margin-left:auto;font-size:.75rem;font-family:monospace;padding:4px 10px;"></span>
`;

  // Trigger version ticker now that the badge span exists
  if (typeof startVersionTicker === 'function') startVersionTicker();

  // Ensure nav CSS exists (inject if missing)
  if (!document.getElementById('nav-css')) {
    const style = document.createElement('style');
    style.id = 'nav-css';
    style.textContent = `
      nav {
        display: flex; gap: 6px; align-items: center;
        background: var(--panel, #16213e); padding: 10px 16px;
        border-bottom: 1px solid var(--border, #0f3460); flex-wrap: wrap;
      }
      nav a {
        color: var(--muted, #778); text-decoration: none;
        padding: 5px 12px; border-radius: 4px; font-size: .88rem;
      }
      nav a:hover, nav a.active {
        background: rgba(233,69,96,.15); color: var(--accent, #e94560);
      }
    `;
    document.head.appendChild(style);
  }
}

// Run after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildNav);
} else {
  buildNav();
}
