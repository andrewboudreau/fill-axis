// engine/board.js
// Board state, attack map calculation, territory scoring, battle resolution
// Depends on: engine/pieces.js (PIECE_TYPES, getAttackedCells must be loaded first)

// buildAttackMap(pieces, size) → 2D array [x][y] = {0: n, 1: n}
function buildAttackMap(pieces, size) {
  const map = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ 0: 0, 1: 0 }))
  );
  for (const p of pieces) {
    if (p.dead) continue;
    const cells = getAttackedCells(p.x, p.y, p.type, size);
    for (const [cx, cy] of cells) {
      map[cx][cy][p.team]++;
    }
  }
  return map;
}

// getTerritoryCount(map, size) → {0: n, 1: n}
// Counts cells exclusively dominated by each team (higher attack count wins the cell)
function getTerritoryCount(map, size) {
  const counts = { 0: 0, 1: 0 };
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const c = map[x][y];
      if (c[0] > c[1]) counts[0]++;
      else if (c[1] > c[0]) counts[1]++;
    }
  }
  return counts;
}

// resolveBattleRound(pieces, size) → array of newly-dead pieces (mutates piece.dead)
// A piece is eliminated when the opponent's attack on its cell exceeds friendly attack.
// Call repeatedly until the returned array is empty (iterative resolution).
function resolveBattleRound(pieces, size) {
  const map = buildAttackMap(pieces, size);
  const eliminated = [];
  for (const p of pieces) {
    if (p.dead) continue;
    const cell = map[p.x][p.y];
    const myAtk    = cell[p.team];
    const theirAtk = cell[1 - p.team];
    if (theirAtk > myAtk) {
      p.dead = true;
      eliminated.push(p);
    }
  }
  return eliminated;
}

if (typeof module !== 'undefined') module.exports = { buildAttackMap, getTerritoryCount, resolveBattleRound };
