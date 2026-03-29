// engine/async-game.js
// Turn-based async game protocol over Azure blob storage.
// Each game has one shared blob: game-{CODE}-state.json
// Only the current player can write new state (others poll + verify).
//
// Blob schema: AsyncGameBlob
// {
//   code:         string            — room code
//   boardSize:    4|6|8
//   phase:        'WAITING'|'PLACEMENT'|'COMMITTED'|'REVEALED'|'FINAL'
//   players: [
//     { deviceId, name, publicKeyB64,
//       commitment: hex|null,       — SHA-256(boardState+salt), set at COMMITTED phase
//       pieceCount: number|null,    — how many pieces placed (not positions)
//     },
//     { same for p2 }
//   ],
//   currentTeam:  0|1              — whose turn it is
//   turnNumber:   number
//   moves: [                       — signed turn records
//     { team, action, payload, timestamp, prevHash, signature }
//   ],
//   winningTeam:  0|1|null|'draw'
//   winReason:    string|null
//   updatedAt:    ISO string
// }
//
// Private data (never in blob):
//   pieces[], salt, myTeam — stored in localStorage via identity.js

const ASYNC_BLOB_PREFIX = 'game-async-';

function asyncBlobName(code) {
  return `${ASYNC_BLOB_PREFIX}${code}-state.json`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function timestamp() { return new Date().toISOString(); }

async function signTurn(data, privateKey) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyTurn(data, sigB64, publicKeyB64) {
  try {
    const binary = atob(publicKeyB64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    const pubKey = await crypto.subtle.importKey(
      'spki', buf, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const sigBin = atob(sigB64);
    const sigBuf = new Uint8Array(sigBin.length);
    for (let i = 0; i < sigBin.length; i++) sigBuf[i] = sigBin.charCodeAt(i);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sigBuf, encoded);
  } catch { return false; }
}

// ─── CREATE GAME ─────────────────────────────────────────────────────────────

/**
 * Host creates a new async game. Returns the initial blob written to storage.
 */
async function asyncCreateGame(code, boardSize, hostDeviceId, hostName, hostPubKeyB64) {
  const blob = {
    code,
    boardSize,
    phase: 'WAITING',
    players: [
      { deviceId: hostDeviceId, name: hostName, publicKeyB64: hostPubKeyB64, commitment: null, pieceCount: null },
      null,
    ],
    currentTeam: 0,
    turnNumber: 0,
    moves: [],
    winningTeam: null,
    winReason: null,
    updatedAt: timestamp(),
  };
  await blobWrite(asyncBlobName(code), blob);
  return blob;
}

/**
 * Guest joins an existing game.
 */
async function asyncJoinGame(code, guestDeviceId, guestName, guestPubKeyB64) {
  const blob = await blobRead(asyncBlobName(code));
  if (!blob) throw new Error('Game not found: ' + code);
  if (blob.phase !== 'WAITING') throw new Error('Game already started');
  if (blob.players[1]) throw new Error('Game already has two players');
  blob.players[1] = { deviceId: guestDeviceId, name: guestName, publicKeyB64: guestPubKeyB64, commitment: null, pieceCount: null };
  blob.phase = 'PLACEMENT';
  blob.updatedAt = timestamp();
  await blobWrite(asyncBlobName(code), blob);
  return blob;
}

/**
 * Load current game state from blob.
 */
async function asyncLoadGame(code) {
  return await blobRead(asyncBlobName(code));
}

// ─── PLACEMENT PHASE ─────────────────────────────────────────────────────────

/**
 * Record that current player has finished placing pieces.
 * Writes piece count (not positions) + commitment to blob.
 * myPieces and mySalt are kept LOCAL — never sent to blob at this point.
 * commitment = SHA-256(boardStateString(pieces) + salt)
 */
async function asyncSubmitCommitment(code, team, commitment, pieceCount, privateKey) {
  const blob = await blobRead(asyncBlobName(code));
  if (!blob) throw new Error('Game not found');

  blob.players[team].commitment = commitment;
  blob.players[team].pieceCount = pieceCount;

  // Both committed? Advance to next phase.
  const bothCommitted = blob.players[0]?.commitment && blob.players[1]?.commitment;
  if (bothCommitted) {
    blob.phase = 'COMMITTED';
    blob.currentTeam = 0; // host reveals first
  }

  // Sign the move
  const moveData = { team, action: 'COMMIT', payload: { commitment, pieceCount },
    prevHash: blob.moves.length ? await _hashMove(blob.moves[blob.moves.length - 1]) : '0'.repeat(64),
    timestamp: Date.now() };
  moveData.signature = await signTurn(moveData, privateKey);
  blob.moves.push(moveData);
  blob.updatedAt = timestamp();

  await blobWrite(asyncBlobName(code), blob);
  return blob;
}

/**
 * Submit reveal: board state string + salt + pieces.
 * This is the moment the secret becomes public.
 * Opponent will verify commitment hash against this.
 */
async function asyncSubmitReveal(code, team, pieces, salt, privateKey) {
  const blob = await blobRead(asyncBlobName(code));
  if (!blob) throw new Error('Game not found');
  if (blob.phase !== 'COMMITTED') throw new Error('Not in reveal phase');

  // Attach reveal data directly to player record
  blob.players[team].revealedPieces = pieces;
  blob.players[team].revealedSalt   = salt;  // salt is now public — game is over for this player's secret

  const bothRevealed = blob.players[0]?.revealedPieces && blob.players[1]?.revealedPieces;
  if (bothRevealed) blob.phase = 'REVEALED';

  const moveData = { team, action: 'REVEAL', payload: { pieces, salt },
    prevHash: blob.moves.length ? await _hashMove(blob.moves[blob.moves.length - 1]) : '0'.repeat(64),
    timestamp: Date.now() };
  moveData.signature = await signTurn(moveData, privateKey);
  blob.moves.push(moveData);
  blob.updatedAt = timestamp();

  await blobWrite(asyncBlobName(code), blob);
  return blob;
}

/**
 * Finalize game (called by either player after REVEALED, writes result).
 */
async function asyncFinalizeGame(code, winningTeam, winReason, territory) {
  const blob = await blobRead(asyncBlobName(code));
  blob.phase = 'FINAL';
  blob.winningTeam = winningTeam;
  blob.winReason = winReason;
  blob.territory = territory;
  blob.updatedAt = timestamp();
  await blobWrite(asyncBlobName(code), blob);
  return blob;
}

async function _hashMove(move) {
  const enc = new TextEncoder().encode(JSON.stringify(move));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ─── VERIFICATION ────────────────────────────────────────────────────────────

/**
 * Verify opponent's reveal against their stored commitment.
 * Returns { valid, error }
 */
async function asyncVerifyReveal(blob, opponentTeam) {
  const p = blob.players[opponentTeam];
  if (!p?.revealedPieces || !p?.revealedSalt || !p?.commitment) {
    return { valid: false, error: 'Missing reveal data' };
  }
  // boardStateString is defined in engine/pieces.js
  const boardStr = boardStateString(p.revealedPieces);
  const hash = await sha256(boardStr + p.revealedSalt);
  const valid = hash === p.commitment;
  return { valid, boardStr, hash, expected: p.commitment,
    error: valid ? null : `Hash mismatch.\nExpected: ${p.commitment}\nGot:      ${hash}` };
}

/**
 * Verify the entire move chain signatures.
 * Returns array of { index, team, action, valid }
 */
async function asyncVerifyChain(blob) {
  const results = [];
  for (let i = 0; i < blob.moves.length; i++) {
    const move = blob.moves[i];
    const { signature, ...data } = move;
    const pubKeyB64 = blob.players[move.team]?.publicKeyB64;
    const valid = pubKeyB64 ? await verifyTurn(data, signature, pubKeyB64) : false;
    results.push({ index: i, team: move.team, action: move.action, valid });
  }
  return results;
}

if (typeof module !== 'undefined') {
  module.exports = {
    asyncCreateGame, asyncJoinGame, asyncLoadGame,
    asyncSubmitCommitment, asyncSubmitReveal,
    asyncFinalizeGame, asyncVerifyReveal, asyncVerifyChain,
  };
}
