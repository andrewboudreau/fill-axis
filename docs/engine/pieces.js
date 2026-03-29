// engine/pieces.js
// Piece type definitions and attack zone calculations

const PIECE_TYPES = {
  KING:  { icon: '♛', name: 'General',    desc: 'Cross (+4 cells each dir)', color: '#e94560' },
  VERT:  { icon: '|',  name: 'Vertical',   desc: 'Entire column',             color: '#aaa'    },
  HORZ:  { icon: '—',  name: 'Horizontal', desc: 'Entire row',                color: '#aaa'    },
  X:     { icon: '✕',  name: 'Diagonal',   desc: 'Diagonals (2 cells out)',   color: '#aaa'    },
};

// Returns array of [x,y] cells attacked by a piece at (px,py) of given type on a board of `size`
function getAttackedCells(px, py, type, size) {
  const cells = [];
  const add = (cx, cy) => {
    if (cx >= 0 && cx < size && cy >= 0 && cy < size) cells.push([cx, cy]);
  };

  if (type === 'VERT') {
    for (let r = 0; r < size; r++) add(px, r);
  } else if (type === 'HORZ') {
    for (let c = 0; c < size; c++) add(c, py);
  } else if (type === 'KING') {
    const reach = size <= 4 ? 2 : 4;
    for (let d = 1; d <= reach; d++) {
      add(px + d, py); add(px - d, py); add(px, py + d); add(px, py - d);
    }
  } else if (type === 'X') {
    const reach = size <= 4 ? 1 : 2;
    for (let d = 1; d <= reach; d++) {
      add(px + d, py + d); add(px - d, py - d);
      add(px + d, py - d); add(px - d, py + d);
    }
  }
  return cells;
}

// Returns { KING:n, VERT:n, HORZ:n, X:n } for given board size
function getPieceCountsForSize(size) {
  if (size === 4) return { KING: 1, VERT: 1, HORZ: 1, X: 1 };
  if (size === 6) return { KING: 2, VERT: 2, HORZ: 2, X: 2 };
  return                  { KING: 4, VERT: 4, HORZ: 4, X: 4 };
}

// Returns number of tiles placed per turn for given board size
function getTilesPerTurn(size) {
  if (size === 4) return 1;
  if (size === 6) return 2;
  return 4;
}

if (typeof module !== 'undefined') module.exports = { PIECE_TYPES, getAttackedCells, getPieceCountsForSize, getTilesPerTurn };
