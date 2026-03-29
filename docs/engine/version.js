// engine/version.js
// Build version + live "baked N ago" ticker.
// Update BUILD_TIME on every release (UTC ISO string).
// Inject <div id="version-badge"></div> anywhere in the page to get the badge.

const VERSION = '0.5.3';
const BUILD_TIME = '2026-03-29T19:54:10Z';  // updated each release

function timeAgo(isoStr) {
  const then = new Date(isoStr).getTime();
  const now  = Date.now();
  const sec  = Math.floor((now - then) / 1000);

  if (sec < 10)   return 'just now';
  if (sec < 60)   return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ${min % 60}m ago`;
  const day = Math.floor(hr  / 24);
  if (day < 7)    return `${day}d ${hr % 24}h ago`;
  const wk  = Math.floor(day / 7);
  if (wk  < 5)    return `${wk}w ago`;
  const mo  = Math.floor(day / 30);
  if (mo  < 12)   return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function renderVersionBadge() {
  const el = document.getElementById('version-badge');
  if (!el) return;
  const ago = timeAgo(BUILD_TIME);
  const d = new Date(BUILD_TIME);
  const dateStr = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  el.innerHTML =
    `<span style="color:var(--accent,#e94560);font-weight:700;">v${VERSION}</span>` +
    `<span style="color:var(--muted,#778);margin:0 4px;">·</span>` +
    `<span id="version-ago" style="color:var(--muted,#778);" title="${dateStr}">baked ${ago}</span>`;
}

// Tick every 5 seconds — also called by nav.js after it injects the badge span
function startVersionTicker() {
  renderVersionBadge();
  if (window._versionTickerRunning) return;
  window._versionTickerRunning = true;
  setInterval(() => {
    const agoEl = document.getElementById('version-ago');
    if (agoEl) {
      agoEl.textContent = 'baked ' + timeAgo(BUILD_TIME);
      agoEl.title = new Date(BUILD_TIME).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
  }, 5000);
}

// Initial render — retry a few times to handle nav.js async injection
(function init() {
  function tryRender(attempts) {
    if (document.getElementById('version-badge')) {
      startVersionTicker();
    } else if (attempts > 0) {
      setTimeout(() => tryRender(attempts - 1), 100);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryRender(10));
  } else {
    tryRender(10);
  }
})();
