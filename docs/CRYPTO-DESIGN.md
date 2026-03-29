# Fill Axis — Verifiable Hidden Placement Design

## The Problem

In a hidden-placement game played over P2P (no trusted server), either player could:
1. **Retroactively change their board** after seeing the opponent's reveal
2. **Lie about piece positions** — "I had my General there, not here"
3. **Deny a placement** — "I never placed that piece"

We need to prove board integrity without a referee.

---

## Solution: Cryptographic Commitment Scheme

### Core Primitive

A **commitment scheme** lets you lock in a value without revealing it:

```
commit(board) = SHA-256(boardState + randomSalt)
```

- **Binding:** You cannot change `board` without changing the hash
- **Hiding:** The hash reveals nothing about the board contents
- **Verifiable:** After reveal, anyone can recompute and check

### Properties We Get

| Property | How |
|----------|-----|
| Anti-cheat | Board state locked at commit time — cannot modify after |
| Hidden placement | Opponent sees only hash, not board |
| Post-game audit | Both salt + boardState published; anyone can verify |
| No server needed | Exchange commitments via PeerJS directly |

---

## Protocol (Full)

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: KEY SETUP (game start)                            │
│  Each player generates:                                     │
│    - ECDSA keypair (signs game blocks)                      │
│    - Random 32-byte salt (locks their commitment)           │
│  Players exchange public keys over PeerJS                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: PLACEMENT                                         │
│  Players place pieces normally (hidden from opponent)       │
│  Each turn creates a signed block in the game chain:        │
│    block = {                                                │
│      action: 'PLACE',                                       │
│      payload: { pieceCount: N },   ← count only, not pos   │
│      prevHash: previousBlockHash,                           │
│      timestamp: Date.now(),                                 │
│      signature: ECDSA_sign(above, myPrivateKey)             │
│    }                                                        │
│  Blocks broadcast in real-time via PeerJS                   │
│  Opponent cannot see pieces — only that you placed N pieces │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: COMMITMENT (all pieces placed)                    │
│  boardState = sort(pieces).map(p => "team:type:x,y").join() │
│  commitment = SHA-256(boardState + hexSalt)                 │
│  Broadcast commitment to opponent via PeerJS                │
│  ⚠ Board is now LOCKED — any change is detectable          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: REVEAL                                            │
│  Each player broadcasts: { pieces, salt }                   │
│  Each player verifies:                                      │
│    SHA-256(opponentBoardState + opponentSalt)               │
│    == stored opponent commitment                            │
│  ✅ Match → render board, run battle resolution             │
│  ❌ Mismatch → CHEAT DETECTED, game flagged                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 5: AUDIT (optional, post-game)                       │
│  Full chain + commitments + salts + public keys stored      │
│  Third party can verify entire game history                 │
│  Each block: check signature, check prevHash chain          │
└─────────────────────────────────────────────────────────────┘
```

---

## The Fair Exchange Problem

**Problem:** What if Player 2 sees Player 1's reveal and then disconnects (rage-quit)?

### Why It Doesn't Matter Here

Unlike financial protocols (where fair exchange is critical), in this game:

1. **P1 already committed.** If P1 reveals and P2 disconnects, P1's board is proven valid.
2. **Disconnect = forfeit.** The game rules can treat any disconnect after reveal starts as a loss.
3. **Both players are online simultaneously** (synchronous game). Unlike async turn-based games, they're both live at reveal time.

So we don't need the "both store encrypted reveals" complexity for a real-time game.

### If You Want Async Support (Future)

For an async version where players aren't online simultaneously:

```
Option: Two-round reveal with blob storage

Round 1 — Both store encrypted reveals:
  P1 encrypts (board+salt) with P2's public key → uploads to blob store
  P2 encrypts (board+salt) with P1's public key → uploads to blob store
  
Round 2 — Both confirm blobs exist → exchange decryption keys:
  Each sees both encrypted blobs exist
  Now safe to share private key / decrypt
  
Result: Neither can defect after Round 1 without leaving evidence
```

This requires a blob store (Azure, S3, etc.) but still no game server.

---

## The Signed Chain (Audit Trail)

Each game action is signed and chained:

```
Block 0: { action:'GAME_START', payload:{boardSize:4}, prevHash:'000...', sig:P1_sig }
Block 1: { action:'PLACE',      payload:{count:1},     prevHash:hash(B0), sig:P1_sig }
Block 2: { action:'PLACE',      payload:{count:1},     prevHash:hash(B1), sig:P2_sig }
Block 3: { action:'COMMIT',     payload:{hash:'abc…'}, prevHash:hash(B2), sig:P1_sig }
Block 4: { action:'COMMIT',     payload:{hash:'def…'}, prevHash:hash(B3), sig:P2_sig }
Block 5: { action:'REVEAL',     payload:{board,salt},  prevHash:hash(B4), sig:P1_sig }
Block 6: { action:'REVEAL',     payload:{board,salt},  prevHash:hash(B5), sig:P2_sig }
```

**Tamper-evident:** Changing any block invalidates all subsequent hashes.
**Non-repudiable:** Signatures prove which player sent each block.
**Auditable:** Anyone with both public keys can replay and verify.

---

## Implementation

### `engine/crypto.js` exports:

| Function | Purpose |
|----------|---------|
| `sha256(str)` | SHA-256 hash → hex |
| `generateSalt()` | Random 32-byte hex salt |
| `boardStateString(pieces)` | Canonical deterministic board string |
| `createCommitment(pieces)` | `{ commitment, salt, boardState }` |
| `verifyCommitment(pieces, salt, expected)` | `{ valid, error }` |
| `generateKeyPair()` | ECDSA P-256 keypair (Web Crypto) |
| `exportPublicKey(key)` | CryptoKey → base64 string |
| `importPublicKey(b64)` | base64 string → CryptoKey |
| `signBlock(data, privKey)` | Sign → base64 signature |
| `verifyBlock(data, sig, pubKey)` | Verify signature → bool |
| `createBlock(action, payload, prevHash, privKey)` | Create signed chain block |
| `hashBlock(block)` | Hash a block → hex |

All async. Uses browser Web Crypto API — no external dependencies.

---

## POC Status

- [x] `engine/crypto.js` — SHA-256, ECDSA sign/verify, commitment scheme
- [x] `crypto-demo.html` — interactive commitment + ECDSA chain demo
- [x] Commitment exchange wired into PeerJS P2P game flow (`index.html`)
- [x] Salt always included in audit records
- [x] `engine/storage.js` — Azure Blob Storage via SAS URL (no SDK)
- [x] `engine/identity.js` — device ID + ECDSA keypair, localStorage persistence
- [x] `engine/async-game.js` — full async turn-based state machine over blob storage
- [x] `lobby.html` — game overworld: identity, up to 5 active games, create/join
- [x] `async.html` — async game view: placement → commit → reveal → verify → result
- [x] `audit.html` — post-game audit viewer with commitment re-verification
- [ ] Wire commitment exchange into async game verify step (currently uses asyncVerifyReveal)
- [ ] Blob-encrypted fair exchange for async (documented, not yet built)
- [ ] Unit tests for engine modules

---

## Security Notes

- **Salt size:** 32 bytes = 256 bits of entropy. Brute-forcing the preimage is computationally infeasible.
- **SHA-256:** Collision-resistant. No known practical attacks.
- **ECDSA P-256:** Standard browser-native curve. Keys never leave the player's browser.
- **Trust model:** We trust the browser/JS environment. A malicious browser extension or modified page could still cheat — this isn't a full ZKP system. Suitable for "friendly competitive" play, not high-stakes.
- **Commitment timing:** The commit must happen *before* the opponent's board state is known. The PeerJS message ordering guarantees this in the current protocol.
