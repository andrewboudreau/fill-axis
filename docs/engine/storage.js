// engine/storage.js
// Azure Blob Storage via SAS URL — no SDK, plain fetch
// Permissions: read, add, create, write (no list, no delete)
// Expires: 2026-04-30
//
// Blob naming convention:
//   game-{ROOMCODE}.json        — live game state / commitment exchange
//   audit-{ROOMCODE}.json       — post-game signed chain (append-safe copy)
//
// All blobs are JSON. No authentication beyond the SAS token.
// The SAS token is embedded in the client — this is intentional (public game, no secrets here).
// Board state blobs are encrypted before storage (see engine/crypto.js) so
// the storage layer never sees plaintext piece positions.

const STORAGE_BASE = 'https://belongtouspublic.blob.core.windows.net/fill-axis-games';
const STORAGE_SAS  = '?sp=racw&st=2026-03-29T14:46:43Z&se=2026-04-30T23:01:43Z&sv=2024-11-04&sr=c&sig=rPtuETV6xm0%2Fux%2FfzfG1ubNNAYgOFKX2iuyTzd9hUwA%3D';

function blobUrl(name) {
  return `${STORAGE_BASE}/${name}${STORAGE_SAS}`;
}

/**
 * Write (create or overwrite) a blob.
 * @param {string} name  — blob name, e.g. "game-AB3X9K.json"
 * @param {object} data  — will be JSON-serialized
 * @returns {Promise<boolean>} true on success
 */
async function blobWrite(name, data) {
  const body = JSON.stringify(data);
  const res = await fetch(blobUrl(name), {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`blobWrite failed: ${res.status} ${res.statusText}`);
  return true;
}

/**
 * Read a blob. Returns parsed JSON or null if not found.
 */
async function blobRead(name) {
  const res = await fetch(blobUrl(name));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blobRead failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Check whether a blob exists (HEAD request).
 * Returns true/false without downloading the body.
 */
async function blobExists(name) {
  const res = await fetch(blobUrl(name), { method: 'HEAD' });
  return res.ok;
}

/**
 * Poll a blob until it exists or timeout.
 * Useful for async fair exchange: wait for opponent's sealed blob.
 * @param {string} name
 * @param {number} intervalMs  — poll interval (default 3s)
 * @param {number} timeoutMs   — give up after this (default 120s)
 * @returns {Promise<boolean>} true if found, false if timed out
 */
async function blobWait(name, intervalMs = 3000, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await blobExists(name)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── GAME-LEVEL HELPERS ───────────────────────────────────────────────────────

/**
 * Publish a player's sealed commitment for async fair exchange.
 * The sealed blob is encrypted with the opponent's public key — blob store can't read it.
 *
 * name format: sealed-{ROOMCODE}-p{team}.json
 * contents:    { sealedData: base64, playerTeam: 0|1, timestamp: ms }
 */
async function publishSealedCommit(roomCode, team, sealedB64) {
  const name = `sealed-${roomCode}-p${team}.json`;
  return await blobWrite(name, {
    sealedData: sealedB64,
    playerTeam: team,
    timestamp: Date.now(),
  });
}

/**
 * Read an opponent's sealed commitment blob.
 */
async function readSealedCommit(roomCode, team) {
  const name = `sealed-${roomCode}-p${team}.json`;
  return await blobRead(name);
}

/**
 * Wait until opponent's sealed blob appears, then read it.
 */
async function waitAndReadSealedCommit(roomCode, team, onProgress) {
  const name = `sealed-${roomCode}-p${team}.json`;
  if (onProgress) onProgress(`Waiting for player ${team + 1} to deposit sealed commitment...`);
  const found = await blobWait(name);
  if (!found) throw new Error(`Timed out waiting for sealed-${roomCode}-p${team}.json`);
  return await blobRead(name);
}

/**
 * Save the complete post-game audit chain.
 * Written once, read-only after (don't overwrite — write a timestamped copy if needed).
 */
async function saveAuditChain(roomCode, chain, publicKeys) {
  const name = `audit-${roomCode}.json`;
  return await blobWrite(name, {
    roomCode,
    savedAt: new Date().toISOString(),
    publicKeys,  // { p1: b64, p2: b64 }
    chain,       // array of signed blocks
  });
}

/**
 * Read the audit chain for a completed game.
 */
async function loadAuditChain(roomCode) {
  return await blobRead(`audit-${roomCode}.json`);
}

if (typeof module !== 'undefined') {
  module.exports = {
    blobWrite, blobRead, blobExists, blobWait,
    publishSealedCommit, readSealedCommit, waitAndReadSealedCommit,
    saveAuditChain, loadAuditChain,
  };
}
