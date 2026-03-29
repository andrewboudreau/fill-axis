// engine/bot.js
// Bot player — auto-plays the game when ?bot=<strategy> is in the URL.
// Strategies: random | greedy | corner
//
// Usage: open game.html?game=XXXX&bot=random
// The bot will auto-place pieces when it's the bot's turn, then auto-commit/reveal.
//
// BOT_DELAY: ms between bot actions (default 800ms — visible but fast)

const BOT_STRATEGY = new URLSearchParams(location.search).get('bot');
const BOT_ACTIVE = !!BOT_STRATEGY;
const BOT_DELAY = parseInt(new URLSearchParams(location.search).get('botDelay') || '900');

if (BOT_ACTIVE) {
  console.log(`[bot] Active — strategy: ${BOT_STRATEGY}, delay: ${BOT_DELAY}ms`);
}

// ─── STRATEGY IMPLEMENTATIONS ────────────────────────────────────────────────

/**
 * Pick a random empty cell.
 */
function strategyRandom(availableCells, pieces, size) {
  if (!availableCells.length) return null;
  return availableCells[Math.floor(Math.random() * availableCells.length)];
}

/**
 * Pick the cell that maximizes this piece's attack coverage
 * (cells attacked that aren't already attacked by own pieces).
 */
function strategyGreedy(availableCells, pieces, size, pieceType) {
  let bestCell = null, bestScore = -1;
  for (const cell of availableCells) {
    const attacked = getAttackedCells(cell.x, cell.y, pieceType, size);
    // Score = number of unique cells this adds to coverage
    const existingCoverage = new Set(
      pieces.flatMap(p => getAttackedCells(p.x, p.y, p.type, size).map(c => `${c[0]},${c[1]}`))
    );
    const newCoverage = attacked.filter(([cx,cy]) => !existingCoverage.has(`${cx},${cy}`)).length;
    if (newCoverage > bestScore) { bestScore = newCoverage; bestCell = cell; }
  }
  return bestCell || strategyRandom(availableCells, pieces, size);
}

/**
 * Prefer corner and edge cells (maximises KING's cross-shaped attack reach).
 */
function strategyCorner(availableCells, pieces, size) {
  const priority = availableCells.filter(c => c.x === 0 || c.x === size-1 || c.y === 0 || c.y === size-1);
  const pool = priority.length ? priority : availableCells;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickCell(availableCells, placedPieces, size, pieceType) {
  switch (BOT_STRATEGY) {
    case 'greedy': return strategyGreedy(availableCells, placedPieces, size, pieceType);
    case 'corner': return strategyCorner(availableCells, placedPieces, size);
    default:       return strategyRandom(availableCells, placedPieces, size);
  }
}

// ─── BOT TURN RUNNER ─────────────────────────────────────────────────────────

/**
 * Called by game.html when it's the bot's turn.
 * Returns true if the bot took action (caller should re-render).
 */
async function botTakeTurn() {
  if (!BOT_ACTIVE) return false;

  // Access game state from game.html globals
  const G_blob = window.blob;
  const G_local = window.localState;
  const G_myTeam = window.myTeam;
  const G_code = window.GAME_CODE;

  if (!G_blob || !G_local) return false;
  if (G_blob.phase !== 'PLACEMENT') return false;
  if (G_blob.currentTeam !== G_myTeam) return false;

  // Check if already committed
  if (G_blob.players[G_myTeam]?.commitment) return false;

  const size = G_blob.boardSize;
  const tilesPerTurn = G_local.tilesPerTurn;
  const tilesLeft = tilesPerTurn - G_local.tilesPlaced;

  if (tilesLeft <= 0) {
    // Call end turn
    window.__debug.event('BOT', `Ending turn, ${G_local.pieces.length} pieces placed`);
    if (typeof window.endPlacementTurn === 'function') {
      await window.endPlacementTurn();
    }
    return true;
  }

  // Find empty cells
  const occupied = window.getOccupiedCells ? window.getOccupiedCells() : new Set();
  const available = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!occupied.has(`${x},${y}`)) available.push({x, y});
    }
  }

  if (!available.length) return false;

  // Pick piece type from tray
  const tray = G_local.tray;
  const availableTypes = Object.entries(tray).filter(([,n]) => n > 0).map(([t]) => t);
  if (!availableTypes.length) return false;

  const pieceType = availableTypes[Math.floor(Math.random() * availableTypes.length)];
  const cell = pickCell(available, G_local.pieces, size, pieceType);
  if (!cell) return false;

  // Place the piece (call game.html's internal place logic)
  window.__debug.event('BOT', `${BOT_STRATEGY}: placing ${pieceType} at (${cell.x},${cell.y})`);

  G_local.pieces.push({x: cell.x, y: cell.y, type: pieceType, team: G_myTeam, dead: false});
  G_local.tray[pieceType]--;
  G_local.tilesPlaced++;

  if (typeof saveLocalGameState === 'function') saveLocalGameState(G_code, G_local);

  return true;
}

/**
 * Bot reveal — called when phase is COMMITTED and it's time to reveal.
 */
async function botAutoReveal() {
  if (!BOT_ACTIVE) return false;
  const G_blob = window.blob;
  const G_myTeam = window.myTeam;
  if (!G_blob) return false;
  if (G_blob.phase !== 'COMMITTED') return false;
  if (G_blob.players[G_myTeam]?.revealedPieces) return false; // already revealed
  window.__debug.event('BOT', 'Auto-revealing board');
  if (typeof window.doReveal === 'function') {
    await window.doReveal();
    return true;
  }
  return false;
}

// ─── BOT INDICATOR UI ────────────────────────────────────────────────────────

if (BOT_ACTIVE) {
  document.addEventListener('DOMContentLoaded', () => {
    const badge = document.createElement('div');
    badge.style.cssText = `position:fixed;top:8px;left:50%;transform:translateX(-50%);
      background:rgba(233,69,96,.9);color:#fff;padding:4px 14px;border-radius:12px;
      font-size:.78rem;font-weight:700;font-family:monospace;letter-spacing:1px;z-index:9997;pointer-events:none;`;
    badge.textContent = `🤖 BOT: ${BOT_STRATEGY.toUpperCase()}`;
    document.body.appendChild(badge);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { botTakeTurn, botAutoReveal, BOT_ACTIVE, BOT_STRATEGY };
}
