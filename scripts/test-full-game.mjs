#!/usr/bin/env node
// scripts/test-full-game.mjs
// Simulates a complete 2-player Fill Axis game against blob storage.
// No browser required — runs in Node.js using the same engine modules.
//
// Usage:
//   node scripts/test-full-game.mjs
//   node scripts/test-full-game.mjs --size 4 --strategy greedy
//   node scripts/test-full-game.mjs --code TESTX1  (resume existing game)

import { createHash } from 'crypto';
// Node 25+ has globalThis.crypto built in — only polyfill if missing
if (!globalThis.crypto) {
  const { webcrypto } = await import('crypto');
  globalThis.crypto = webcrypto;
}

// Node 25+ has built-in fetch — no polyfill needed

// ─── INLINE ENGINE (copy key functions from engine/*.js) ──────────────────────
const STORAGE_BASE = 'https://belongtouspublic.blob.core.windows.net/fill-axis-games';
const STORAGE_SAS  = '?sp=racw&st=2026-03-29T14:46:43Z&se=2026-04-30T23:01:43Z&sv=2024-11-04&sr=c&sig=rPtuETV6xm0%2Fux%2FfzfG1ubNNAYgOFKX2iuyTzd9hUwA%3D';

async function blobWrite(name, data) {
  const res = await fetch(`${STORAGE_BASE}/${name}${STORAGE_SAS}`, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`blobWrite ${name}: ${res.status}`);
}

async function blobRead(name) {
  const res = await fetch(`${STORAGE_BASE}/${name}${STORAGE_SAS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blobRead ${name}: ${res.status}`);
  return res.json();
}

async function sha256(str) {
  const buf = createHash('sha256').update(str).digest();
  return buf.toString('hex');
}

function generateSalt() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
}

function boardStateString(pieces) {
  return pieces.map(p => `${p.team}:${p.type}:${p.x},${p.y}`).sort().join('|');
}

function getPieceCountsForSize(size) {
  if (size === 4) return { KING:1, VERT:1, HORZ:1, X:1 };
  if (size === 6) return { KING:2, VERT:2, HORZ:2, X:2 };
  return               { KING:4, VERT:4, HORZ:4, X:4 };
}
function getTilesPerTurn(size) { return size === 4 ? 1 : size === 6 ? 2 : 4; }

function getAttackedCells(x, y, type, size) {
  const cells = [];
  const add = (cx, cy) => { if (cx>=0&&cx<size&&cy>=0&&cy<size) cells.push([cx,cy]); };
  if (type === 'VERT') for (let r=0;r<size;r++) add(x,r);
  else if (type === 'HORZ') for (let c=0;c<size;c++) add(c,y);
  else if (type === 'KING') { const reach=size<=4?2:4; for(let d=1;d<=reach;d++){add(x+d,y);add(x-d,y);add(x,y+d);add(x,y-d);} }
  else if (type === 'X') { const reach=size<=4?1:2; for(let d=1;d<=reach;d++){add(x+d,y+d);add(x-d,y-d);add(x+d,y-d);add(x-d,y+d);} }
  return cells;
}

function buildAttackMap(pieces, size) {
  const map = Array.from({length:size},()=>Array.from({length:size},()=>({0:0,1:0})));
  for (const p of pieces) {
    if (p.dead) continue;
    for (const [cx,cy] of getAttackedCells(p.x,p.y,p.type,size)) map[cx][cy][p.team]++;
  }
  return map;
}

function getTerritoryCount(map, size) {
  let c={0:0,1:0};
  for(let x=0;x<size;x++) for(let y=0;y<size;y++){
    if(map[x][y][0]>map[x][y][1])c[0]++; else if(map[x][y][1]>map[x][y][0])c[1]++;
  }
  return c;
}

function resolveBattleRound(pieces, size) {
  const map = buildAttackMap(pieces, size);
  const elim=[];
  for(const p of pieces){
    if(p.dead)continue;
    if(map[p.x][p.y][1-p.team]>map[p.x][p.y][p.team]){p.dead=true;elim.push(p);}
  }
  return elim;
}

// ─── BLOB NAME ────────────────────────────────────────────────────────────────
const blobName = code => `game-async-${code}-state.json`;

// ─── SIMPLE RANDOM BOT ────────────────────────────────────────────────────────
function randomPlacement(existingPieces, tray, size, team) {
  const occupied = new Set(existingPieces.map(p=>`${p.x},${p.y}`));
  const available = [];
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) if(!occupied.has(`${x},${y}`)) available.push({x,y});
  const types = Object.entries(tray).filter(([,n])=>n>0).map(([t])=>t);
  if(!available.length||!types.length) return null;
  const type = types[Math.floor(Math.random()*types.length)];
  const cell = available[Math.floor(Math.random()*available.length)];
  return {...cell, type, team, dead:false};
}

// ─── GAME SIMULATION ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i=args.indexOf(flag); return i>=0 ? args[i+1] : def; };
const SIZE   = parseInt(getArg('--size','4'));
const CODE   = (getArg('--code', null) || Math.random().toString(36).substr(2,6).toUpperCase()).toUpperCase();
const DELAY  = parseInt(getArg('--delay','300'));
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11,23);
  console.log(`[${ts}] [${tag.padEnd(8)}] ${msg}`);
}

async function runGame() {
  log('START', `Game code: ${CODE}  size: ${SIZE}x${SIZE}`);
  
  const counts = getPieceCountsForSize(SIZE);
  const tilesPerTurn = getTilesPerTurn(SIZE);
  const totalPieces = Object.values(counts).reduce((a,b)=>a+b,0);
  
  // Two simulated players
  const players = [
    { name:'Bot-Alpha', deviceId:'test-device-0', salt: generateSalt(), pieces:[], tray:{...counts} },
    { name:'Bot-Beta',  deviceId:'test-device-1', salt: generateSalt(), pieces:[], tray:{...counts} },
  ];

  // ── CREATE GAME ──
  log('P1', 'Creating game...');
  const initBlob = {
    code: CODE, boardSize: SIZE, phase: 'PLACEMENT',
    players: players.map(p => ({
      deviceId: p.deviceId, name: p.name,
      publicKeyB64: 'test-no-sig', commitment: null, pieceCount: null
    })),
    currentTeam: 0, turnNumber: 0, moves: [],
    winningTeam: null, winReason: null, updatedAt: new Date().toISOString(),
  };
  await blobWrite(blobName(CODE), initBlob);
  log('P1', 'Game created');

  // ── PLACEMENT PHASE ──
  let blob = initBlob;
  let turn = 0;
  const maxTurns = (totalPieces * 2) + 4;

  while (turn < maxTurns) {
    blob = await blobRead(blobName(CODE));
    if (!blob || blob.phase !== 'PLACEMENT') break;
    
    const team = blob.currentTeam;
    const p = players[team];
    const allPlaced = p.pieces.length >= totalPieces;
    
    if (allPlaced && !blob.players[team].commitment) {
      // Commit
      const bss = boardStateString(p.pieces);
      const commitment = await sha256(bss + p.salt);
      blob.players[team].commitment = commitment;
      blob.players[team].pieceCount = p.pieces.length;
      log(`P${team+1}`, `Committing: ${commitment.slice(0,16)}...`);
      
      const bothCommitted = blob.players[0]?.commitment && blob.players[1]?.commitment;
      if (bothCommitted) { blob.phase = 'COMMITTED'; log('GAME', 'Both committed → COMMITTED'); }
      blob.updatedAt = new Date().toISOString();
      await blobWrite(blobName(CODE), blob);
      await sleep(DELAY);
      continue;
    }
    
    if (allPlaced) { blob.currentTeam = 1-team; blob.updatedAt=new Date().toISOString(); await blobWrite(blobName(CODE),blob); await sleep(DELAY); continue; }
    
    // Place tilesPerTurn pieces
    let placed = 0;
    while (placed < tilesPerTurn && p.pieces.length < totalPieces) {
      const piece = randomPlacement([...p.pieces, ...players[1-team].pieces], p.tray, SIZE, team);
      if (!piece) break;
      p.pieces.push(piece);
      p.tray[piece.type]--;
      placed++;
      log(`P${team+1}`, `Place ${piece.type} @ (${piece.x},${piece.y}) [${p.pieces.length}/${totalPieces}]`);
    }
    
    blob.currentTeam = 1-team;
    blob.turnNumber++;
    blob.updatedAt = new Date().toISOString();
    await blobWrite(blobName(CODE), blob);
    await sleep(DELAY);
    turn++;
  }

  // ── REVEAL PHASE ──
  blob = await blobRead(blobName(CODE));
  if (blob?.phase !== 'COMMITTED') { log('ERROR', `Unexpected phase: ${blob?.phase}`); process.exit(1); }

  for (const [i, p] of players.entries()) {
    log(`P${i+1}`, `Revealing ${p.pieces.length} pieces + salt ${p.salt.slice(0,12)}...`);
    blob.players[i].revealedPieces = p.pieces;
    blob.players[i].revealedSalt   = p.salt;
  }
  blob.phase = 'REVEALED';
  blob.updatedAt = new Date().toISOString();
  await blobWrite(blobName(CODE), blob);
  await sleep(DELAY);

  // ── VERIFY ──
  log('VERIFY', 'Verifying commitments...');
  for (const [i, p] of players.entries()) {
    const bss = boardStateString(p.pieces);
    const hash = await sha256(bss + p.salt);
    const expected = blob.players[i].commitment;
    const ok = hash === expected;
    log('VERIFY', `P${i+1}: ${ok ? '✅ PASS' : '❌ FAIL'} hash=${hash.slice(0,16)}...`);
    if (!ok) { log('ERROR', 'Commitment mismatch — aborting'); process.exit(1); }
  }

  // ── BATTLE ──
  log('BATTLE', 'Resolving...');
  let allPieces = [
    ...players[0].pieces.map(p=>({...p,team:0,dead:false})),
    ...players[1].pieces.map(p=>({...p,team:1,dead:false})),
  ];
  let round=0;
  while(round<20){const elim=resolveBattleRound(allPieces,SIZE);if(!elim.length)break;log('BATTLE',`Round ${++round}: ${elim.length} eliminated`);} 
  
  const map = buildAttackMap(allPieces, SIZE);
  const territory = getTerritoryCount(map, SIZE);
  const kings = [0,1].map(t=>allPieces.filter(p=>p.type==='KING'&&p.team===t&&!p.dead).length);
  const threshold = getPieceCountsForSize(SIZE).KING === 1 ? 1 : 2;
  let winner=null, reason='by Territory';
  if(kings[0]-kings[1]>=threshold||(kings[1]===0&&kings[0]>0)){winner=0;reason='by General';}
  else if(kings[1]-kings[0]>=threshold||(kings[0]===0&&kings[1]>0)){winner=1;reason='by General';}
  else if(territory[0]>territory[1])winner=0;
  else if(territory[1]>territory[0])winner=1;

  // ── FINAL ──
  blob.phase = 'FINAL';
  blob.winningTeam = winner;
  blob.winReason = reason;
  blob.territory = territory;
  blob.updatedAt = new Date().toISOString();
  await blobWrite(blobName(CODE), blob);

  // ── AUDIT ──
  await blobWrite(`audit-${CODE}.json`, {
    roomCode: CODE, names: players.map(p=>p.name), boardSize: SIZE,
    winner, winReason: reason,
    p1Commitment: blob.players[0].commitment, p2Commitment: blob.players[1].commitment,
    p1Salt: players[0].salt, p2Salt: players[1].salt,
    pieces: allPieces.map(p=>({x:p.x,y:p.y,type:p.type,team:p.team,dead:p.dead})),
    savedAt: new Date().toISOString(),
  });

  log('FINAL', `Winner: ${winner !== null ? players[winner].name : 'Draw'} ${reason}`);
  log('FINAL', `Territory: P1=${territory[0]} P2=${territory[1]}`);
  log('FINAL', `Audit: https://andrewboudreau.github.io/fill-axis/audit.html?game=${CODE}`);
  log('DONE', `Game ${CODE} complete ✅`);
}

runGame().catch(e => { console.error('FATAL:', e); process.exit(1); });
