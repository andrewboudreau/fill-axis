// engine/game.js
// Game state machine: init, placement, turn management, end conditions
// Depends on: engine/pieces.js, engine/board.js

// initGame(p1name, p2name, size, mode) → game state object G
function initGame(p1name, p2name, size, mode) {
  const counts = getPieceCountsForSize(size);
  return {
    size,
    mode,           // 'local' | 'p2p'
    phase: 'PLACEMENT', // PLACEMENT | REVEAL | BATTLE | FINAL
    currentTeam: 0,
    names: [p1name, p2name],
    pieces: [],     // { x, y, type, team, dead, hidden }
    tray: [
      { ...counts },
      { ...counts },
    ],
    tilesPerTurn: getTilesPerTurn(size),
    tilesPlacedThisTurn: 0,
    winner: null,
    winReason: '',
  };
}

// placePiece(G, x, y, type, team) → bool (mutates G on success)
function placePiece(G, x, y, type, team) {
  const occupied = new Set(
    G.pieces.filter(p => !p.dead).map(p => `${p.x},${p.y}`)
  );
  if (occupied.has(`${x},${y}`)) return false;
  if (G.tray[team][type] <= 0) return false;
  G.tray[team][type]--;
  G.pieces.push({ x, y, type, team, dead: false, hidden: true });
  G.tilesPlacedThisTurn++;
  return true;
}

// allPiecesPlaced(G) → bool
function allPiecesPlaced(G) {
  return ['KING', 'VERT', 'HORZ', 'X'].every(
    t => G.tray[0][t] === 0 && G.tray[1][t] === 0
  );
}

// endTurn(G) → 'REVEAL' if all pieces placed, otherwise undefined (mutates G)
function endTurn(G) {
  G.tilesPlacedThisTurn = 0;
  if (allPiecesPlaced(G)) {
    G.phase = 'REVEAL';
    for (const p of G.pieces) p.hidden = false;
    return 'REVEAL';
  }
  G.currentTeam = 1 - G.currentTeam;
}

// evaluateWinner(G) → { winner: 0|1|null, reason: string, territory: {0:n,1:n} }
// Call after battle resolution is complete (all pieces resolved).
function evaluateWinner(G) {
  const map = buildAttackMap(G.pieces, G.size);
  const territory = getTerritoryCount(map, G.size);

  const kings = [0, 1].map(t =>
    G.pieces.filter(p => p.type === 'KING' && p.team === t && !p.dead).length
  );
  const kingsPerPlayer = getPieceCountsForSize(G.size).KING;
  const kingThreshold  = kingsPerPlayer === 1 ? 1 : 2;

  let winner = null;
  let reason  = 'by Territory';

  if (kings[0] - kings[1] >= kingThreshold || (kings[1] === 0 && kings[0] > 0)) {
    winner = 0; reason = 'by General';
  } else if (kings[1] - kings[0] >= kingThreshold || (kings[0] === 0 && kings[1] > 0)) {
    winner = 1; reason = 'by General';
  } else {
    if      (territory[0] > territory[1]) winner = 0;
    else if (territory[1] > territory[0]) winner = 1;
    else                                   winner = null;
  }

  return { winner, reason, territory };
}

if (typeof module !== 'undefined') module.exports = { initGame, placePiece, endTurn, allPiecesPlaced, evaluateWinner };
