// engine/crypto.js
// Cryptographic commitment scheme for verifiable hidden placement
//
// Protocol summary:
//   1. Each player generates a salt before placement begins
//   2. After all pieces placed: commitment = SHA256(JSON(pieces) + salt)
//   3. Commitments exchanged over PeerJS — board is now "locked"
//   4. At reveal: share (pieces, salt) — opponent verifies hash matches
//   5. Optionally: ECDSA keypair signs each game block for full audit trail
//
// All functions are async and use the browser Web Crypto API.
// No external libraries required.

// ─── HASHING ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a string, returned as hex.
 */
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── SALT ────────────────────────────────────────────────────────────────────

/**
 * Generate a random 32-byte salt as a hex string.
 * This is the secret that locks the commitment — revealed only at game end.
 */
function generateSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── COMMITMENT ──────────────────────────────────────────────────────────────

/**
 * Canonical board state string from a pieces array.
 * Sorted for determinism — piece order must not matter.
 */
function boardStateString(pieces) {
  const canonical = pieces
    .filter(p => !p.dead)
    .map(p => `${p.team}:${p.type}:${p.x},${p.y}`)
    .sort()
    .join('|');
  return canonical;
}

/**
 * Create a commitment for a player's board state.
 * Returns: { commitment: hex, salt: hex, boardState: string }
 *
 * The commitment is broadcast to the opponent immediately.
 * The salt is kept secret until reveal time.
 */
async function createCommitment(pieces) {
  const salt = generateSalt();
  const boardState = boardStateString(pieces);
  const commitment = await sha256(boardState + salt);
  return { commitment, salt, boardState };
}

/**
 * Verify an opponent's revealed board matches their earlier commitment.
 * Returns: { valid: bool, error: string|null }
 */
async function verifyCommitment(pieces, salt, expectedCommitment) {
  const boardState = boardStateString(pieces);
  const actualHash = await sha256(boardState + salt);
  const valid = actualHash === expectedCommitment;
  return {
    valid,
    boardState,
    actualHash,
    expectedCommitment,
    error: valid ? null : `Board state does not match commitment.\nExpected: ${expectedCommitment}\nGot:      ${actualHash}`
  };
}

// ─── SIGNING (ECDSA) ─────────────────────────────────────────────────────────

/**
 * Generate an ECDSA P-256 keypair for a player.
 * Returns { publicKey, privateKey } as CryptoKey objects.
 * Store privateKey locally; export publicKey to share with opponent.
 */
async function generateKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

/**
 * Export a CryptoKey public key to a shareable base64 string.
 */
async function exportPublicKey(publicKey) {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(spki)));
}

/**
 * Import a base64 public key string back to a CryptoKey.
 */
async function importPublicKey(b64) {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return await crypto.subtle.importKey(
    'spki', buf,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

/**
 * Sign a data object with a private key.
 * Returns a base64 signature string.
 */
async function signBlock(data, privateKey) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoded
  );
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

/**
 * Verify a signed block.
 * Returns true if the signature is valid for the given data and public key.
 */
async function verifyBlock(data, signatureB64, publicKey) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const binary = atob(signatureB64);
  const sigBuf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) sigBuf[i] = binary.charCodeAt(i);
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBuf,
      encoded
    );
  } catch (e) {
    return false;
  }
}

// ─── GAME CHAIN ──────────────────────────────────────────────────────────────

/**
 * Create a new game chain block.
 * Each block links to the previous via prevHash, and is signed by the player.
 *
 * blockData = { turn, player (0|1), action ('PLACE'|'END_TURN'|'COMMIT'|'REVEAL'), payload, prevHash, timestamp }
 */
async function createBlock(action, payload, prevHash, privateKey) {
  const blockData = {
    action,
    payload,
    prevHash: prevHash || '0'.repeat(64),
    timestamp: Date.now(),
  };
  const signature = privateKey ? await signBlock(blockData, privateKey) : null;
  return { ...blockData, signature };
}

/**
 * Hash a block (to use as prevHash for the next block).
 */
async function hashBlock(block) {
  return await sha256(JSON.stringify(block));
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') {
  module.exports = {
    sha256, generateSalt, boardStateString,
    createCommitment, verifyCommitment,
    generateKeyPair, exportPublicKey, importPublicKey,
    signBlock, verifyBlock,
    createBlock, hashBlock,
  };
}
