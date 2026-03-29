// engine/identity.js
// Device identity — persisted in localStorage.
// Every device gets a unique random ID + ECDSA keypair on first visit.
// Clearing localStorage destroys the identity. This is intentional.
// Share your deviceId with another player so they can address you.

const ID_KEYS = {
  deviceId:    'fillaxis_deviceId',
  privKeyJwk:  'fillaxis_privKey',
  pubKeyB64:   'fillaxis_pubKey',
  displayName: 'fillaxis_name',
  games:       'fillaxis_games',
};

// ─── DEVICE ID ───────────────────────────────────────────────────────────────

function _newDeviceId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
}

function getDeviceId() {
  let id = localStorage.getItem(ID_KEYS.deviceId);
  if (!id) { id = _newDeviceId(); localStorage.setItem(ID_KEYS.deviceId, id); }
  return id;
}

// ─── KEYPAIR ─────────────────────────────────────────────────────────────────

async function _generateAndStoreKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pubSpki  = await crypto.subtle.exportKey('spki', kp.publicKey);
  const pubB64   = btoa(String.fromCharCode(...new Uint8Array(pubSpki)));
  localStorage.setItem(ID_KEYS.privKeyJwk, JSON.stringify(privJwk));
  localStorage.setItem(ID_KEYS.pubKeyB64,  pubB64);
  return { privateKey: kp.privateKey, publicKeyB64: pubB64 };
}

async function getKeyPair() {
  const privRaw = localStorage.getItem(ID_KEYS.privKeyJwk);
  const pubB64  = localStorage.getItem(ID_KEYS.pubKeyB64);
  if (!privRaw || !pubB64) return _generateAndStoreKeyPair();
  const privJwk = JSON.parse(privRaw);
  const privateKey = await crypto.subtle.importKey(
    'jwk', privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
  );
  return { privateKey, publicKeyB64: pubB64 };
}

// ─── DISPLAY NAME ────────────────────────────────────────────────────────────

function getDisplayName() {
  return localStorage.getItem(ID_KEYS.displayName) || 'Player';
}
function setDisplayName(name) {
  localStorage.setItem(ID_KEYS.displayName, name);
}

// ─── ACTIVE GAMES (max 5) ────────────────────────────────────────────────────

function getActiveGames() {
  try { return JSON.parse(localStorage.getItem(ID_KEYS.games) || '[]'); }
  catch { return []; }
}

function addActiveGame(code) {
  const games = getActiveGames().filter(c => c !== code);
  games.unshift(code);
  localStorage.setItem(ID_KEYS.games, JSON.stringify(games.slice(0, 5)));
}

function removeActiveGame(code) {
  const games = getActiveGames().filter(c => c !== code);
  localStorage.setItem(ID_KEYS.games, JSON.stringify(games));
}

// ─── PER-GAME LOCAL STATE ────────────────────────────────────────────────────
// Stored separately from identity; contains private piece positions + salt

function getLocalGameState(code) {
  try { return JSON.parse(localStorage.getItem('fillaxis_game_' + code) || 'null'); }
  catch { return null; }
}

function saveLocalGameState(code, state) {
  localStorage.setItem('fillaxis_game_' + code, JSON.stringify(state));
}

function clearLocalGameState(code) {
  localStorage.removeItem('fillaxis_game_' + code);
}

if (typeof module !== 'undefined') {
  module.exports = {
    getDeviceId, getKeyPair, getDisplayName, setDisplayName,
    getActiveGames, addActiveGame, removeActiveGame,
    getLocalGameState, saveLocalGameState, clearLocalGameState,
  };
}
