// engine/debug.js
// Debug overlay — exposes all live game state, crypto secrets, network messages.
// Toggle with: Ctrl+Shift+D  or  window.__debug.toggle()
// Disable entirely: set DEBUG_MODE = false before loading this script,
//   or add ?nodebug to the URL.
//
// ⚠ THIS FILE EXPOSES PRIVATE SALTS AND KEYS IN PLAINTEXT.
//   Never ship with debug mode on in production.

const DEBUG_MODE = !new URLSearchParams(location.search).has('nodebug');

window.__debug = (() => {
  if (!DEBUG_MODE) return { log:()=>{}, toggle:()=>{}, panel:null };

  // ─── STATE ──────────────────────────────────────────────────────────────────
  let visible = false;
  let msgLog = [];   // all PeerJS / blob messages captured
  let eventLog = []; // game phase transitions, crypto events

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #dbg-panel {
      position: fixed; bottom: 0; right: 0; width: 480px; max-height: 70vh;
      background: rgba(10,12,24,0.97); border: 1px solid #e94560; border-radius: 10px 0 0 0;
      font-family: 'Fira Mono','Consolas',monospace; font-size: 11px; z-index: 9999;
      display: flex; flex-direction: column; overflow: hidden; box-shadow: -4px -4px 24px rgba(0,0,0,0.6);
      transition: transform .15s;
    }
    #dbg-panel.hidden { transform: translateY(calc(100% - 28px)); }
    #dbg-header {
      display: flex; align-items: center; gap: 8px; padding: 4px 10px;
      background: #e94560; color: #fff; font-weight: 700; font-size: 11px; cursor: pointer;
      user-select: none; flex-shrink: 0;
    }
    #dbg-header .dbg-title { flex: 1; letter-spacing: 1px; }
    #dbg-header .dbg-close { background: none; border: none; color: #fff; cursor: pointer; font-size: 14px; padding: 0 4px; }
    #dbg-tabs {
      display: flex; background: #0d1b2a; border-bottom: 1px solid #1a3050; flex-shrink: 0;
    }
    .dbg-tab {
      padding: 5px 12px; cursor: pointer; color: #556; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 1px; border: none; background: none;
    }
    .dbg-tab:hover { color: #aaa; }
    .dbg-tab.active { color: #4fc3f7; border-bottom: 2px solid #4fc3f7; }
    #dbg-body {
      flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px;
    }
    .dbg-section { background: #0d1b2a; border: 1px solid #1a3050; border-radius: 5px; padding: 8px 10px; }
    .dbg-section h4 {
      font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #556;
      margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
    }
    .dbg-row { display: flex; gap: 8px; margin-bottom: 3px; align-items: flex-start; }
    .dbg-key { color: #778; min-width: 120px; flex-shrink: 0; font-size: 10px; }
    .dbg-val { color: #e0e0e0; word-break: break-all; font-size: 10px; flex: 1; }
    .dbg-val.secret { color: #ff5252; }
    .dbg-val.public { color: #69f0ae; }
    .dbg-val.hash { color: #ffd54f; }
    .dbg-val.null { color: #445; font-style: italic; }
    .dbg-val.bool-t { color: #69f0ae; }
    .dbg-val.bool-f { color: #ff8a65; }
    .dbg-copy { background: #1a3050; border: none; color: #778; cursor: pointer; padding: 1px 5px;
      border-radius: 3px; font-size: 9px; font-family: inherit; }
    .dbg-copy:hover { color: #4fc3f7; background: #1e3a5c; }
    .dbg-msg { border-left: 2px solid #1a3050; padding: 4px 8px; margin-bottom: 4px; }
    .dbg-msg.sent { border-color: #4fc3f7; }
    .dbg-msg.recv { border-color: #ff8a65; }
    .dbg-msg.event { border-color: #ffd54f; }
    .dbg-msg.err { border-color: #ff5252; }
    .dbg-ts { color: #445; font-size: 9px; }
    .dbg-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; }
    .badge-sent { background: rgba(79,195,247,.15); color: #4fc3f7; }
    .badge-recv { background: rgba(255,138,101,.15); color: #ff8a65; }
    .badge-event { background: rgba(255,213,79,.12); color: #ffd54f; }
    .badge-err { background: rgba(255,82,82,.12); color: #ff5252; }
    .dbg-json { white-space: pre-wrap; color: #aaa; margin-top: 4px; max-height: 120px; overflow-y: auto; }
    .dbg-pieces-grid { display: grid; grid-template-columns: repeat(auto-fill, 38px); gap: 3px; margin-top: 6px; }
    .dbg-pcell { width: 38px; height: 38px; background: #0a0f1e; border: 1px solid #1a3050;
      border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 12px; }
    .dbg-pcell.p1 { border-color: #4fc3f7; background: rgba(79,195,247,.08); }
    .dbg-pcell.p2 { border-color: #ff8a65; background: rgba(255,138,101,.08); }
    .dbg-pcell.dead { opacity: .25; }
    #dbg-toggle-btn {
      position: fixed; bottom: 8px; right: 8px; z-index: 9998;
      background: #e94560; color: #fff; border: none; border-radius: 20px;
      padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
      font-family: 'Fira Mono','Consolas',monospace; letter-spacing: 1px;
      box-shadow: 0 2px 8px rgba(0,0,0,.5);
    }
    #dbg-toggle-btn:hover { background: #c73050; }
  `;
  document.head.appendChild(style);

  // Panel HTML
  const panel = document.createElement('div');
  panel.id = 'dbg-panel';
  panel.className = 'hidden';
  panel.innerHTML = `
    <div id="dbg-header">
      <span class="dbg-title">⚙ DEBUG</span>
      <span id="dbg-phase-badge" style="font-size:9px;opacity:.8">—</span>
      <button class="dbg-close" onclick="window.__debug.toggle()">▼</button>
    </div>
    <div id="dbg-tabs">
      <button class="dbg-tab active" onclick="window.__debug.showTab('state')">State</button>
      <button class="dbg-tab" onclick="window.__debug.showTab('crypto')">Crypto</button>
      <button class="dbg-tab" onclick="window.__debug.showTab('network')">Network</button>
      <button class="dbg-tab" onclick="window.__debug.showTab('board')">Board</button>
    </div>
    <div id="dbg-body"></div>
  `;
  // Defer DOM injection until body is ready
  function injectPanel() {
    if (document.body) {
      document.body.appendChild(panel);
      document.body.appendChild(toggleBtn);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(panel);
        document.body.appendChild(toggleBtn);
      });
    }
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dbg-toggle-btn';
  toggleBtn.textContent = '⚙ DBG';
  toggleBtn.onclick = () => toggle();
  injectPanel();

  let currentTab = 'state';

  // ─── TAB RENDERER ───────────────────────────────────────────────────────────
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.dbg-tab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === tab));
    render();
  }

  function render() {
    if (!visible) return;
    const body = document.getElementById('dbg-body');
    body.innerHTML = '';

    if (currentTab === 'state')   renderState(body);
    if (currentTab === 'crypto')  renderCrypto(body);
    if (currentTab === 'network') renderNetwork(body);
    if (currentTab === 'board')   renderBoard(body);

    // Update phase badge
    const G = window.G;
    const phase = G?.phase || (window.blob?.phase) || '—';
    document.getElementById('dbg-phase-badge').textContent = phase;
  }

  // ─── STATE TAB ──────────────────────────────────────────────────────────────
  function renderState(body) {
    // Try both index.html G and async.html variables
    const G = window.G;
    const blob = window.blob;
    const localState = window.localState;

    section(body, '🎮 Game Object (G)', () => {
      if (!G) return row('G', null);
      row('phase', G.phase, 'public');
      row('mode', G.mode);
      row('currentTeam', G.currentTeam);
      row('boardSize', G.size);
      row('tilesPerTurn', G.tilesPerTurn);
      row('tilesPlacedThisTurn', G.tilesPlacedThisTurn);
      row('names', JSON.stringify(G.names));
      row('winner', G.winner);
      row('winReason', G.winReason);
      row('pieces count', G.pieces?.length);
      row('tray[0]', JSON.stringify(G.tray?.[0]));
      row('tray[1]', JSON.stringify(G.tray?.[1]));
    });

    section(body, '🔌 P2P / Connection', () => {
      row('myTeam', window.myTeam);
      row('currentRoomCode', window.currentRoomCode);
      row('peer open', window.peer?.open, window.peer?.open ? 'bool-t':'bool-f');
      row('conn open', window.conn?.open, window.conn?.open ? 'bool-t':'bool-f');
    });

    section(body, '📦 Async Blob State', () => {
      if (!blob) return row('blob', null);
      row('code', blob.code);
      row('phase', blob.phase, 'public');
      row('currentTeam', blob.currentTeam);
      row('turnNumber', blob.turnNumber);
      row('boardSize', blob.boardSize);
      row('p1 name', blob.players?.[0]?.name);
      row('p2 name', blob.players?.[1]?.name);
      row('p1 deviceId', blob.players?.[0]?.deviceId);
      row('p2 deviceId', blob.players?.[1]?.deviceId);
      row('winningTeam', blob.winningTeam);
      row('updatedAt', blob.updatedAt);
    });

    section(body, '💾 Local Game State (async)', () => {
      if (!localState) return row('localState', null);
      row('pieces count', localState.pieces?.length);
      row('tilesPlaced', localState.tilesPlaced);
      row('tilesPerTurn', localState.tilesPerTurn);
      row('tray', JSON.stringify(localState.tray));
    });

    function row(k, v, cls) {
      const el = document.createElement('div');
      el.className = 'dbg-row';
      const valCls = v === null || v === undefined ? 'null'
        : cls || (typeof v === 'boolean' ? (v ? 'bool-t' : 'bool-f') : '');
      el.innerHTML = `<span class="dbg-key">${k}</span>
        <span class="dbg-val ${valCls}">${v === null || v === undefined ? 'null' : String(v)}</span>`;
      body.__cur?.appendChild(el);
    }
    body.__row = row;
  }

  // ─── CRYPTO TAB ─────────────────────────────────────────────────────────────
  function renderCrypto(body) {
    section(body, '🔑 Device Identity', () => {
      const id = typeof getDeviceId !== 'undefined' ? getDeviceId() : localStorage.getItem('fillaxis_deviceId') || '—';
      const pub = localStorage.getItem('fillaxis_pubKey') || '—';
      const name = localStorage.getItem('fillaxis_name') || '—';
      copyRow(body.__cur, 'device ID', id, 'secret');
      copyRow(body.__cur, 'display name', name);
      copyRow(body.__cur, 'public key (b64)', pub.slice(0,48)+'...', 'public');
      const hasPriv = !!localStorage.getItem('fillaxis_privKey');
      addRow(body.__cur, 'private key stored', hasPriv ? 'YES (JWK in localStorage)' : 'NO', hasPriv ? 'secret' : 'null');
    });

    section(body, '🔒 Commitment (this session)', () => {
      copyRow(body.__cur, 'mySalt', window.mySalt || null, 'secret');
      copyRow(body.__cur, 'myCommitment', window.myCommitment || null, 'hash');
      copyRow(body.__cur, 'opponentCommitment', window.opponentCommitment || null, 'hash');

      // Async local state salt
      const ls = window.localState;
      if (ls?.salt) copyRow(body.__cur, 'async salt (local)', ls.salt, 'secret');

      // Blob commitments
      const blob = window.blob;
      if (blob?.players) {
        copyRow(body.__cur, 'p1 commitment (blob)', blob.players[0]?.commitment || null, 'hash');
        copyRow(body.__cur, 'p2 commitment (blob)', blob.players[1]?.commitment || null, 'hash');
        copyRow(body.__cur, 'p1 salt (blob)', blob.players[0]?.revealedSalt || null, 'secret');
        copyRow(body.__cur, 'p2 salt (blob)', blob.players[1]?.revealedSalt || null, 'secret');
      }
    });

    section(body, '🔁 Live Recompute', () => {
      const ls = window.localState;
      const G = window.G;
      const pieces = ls?.pieces || G?.pieces?.filter(p=>p.team===(window.myTeam||0)) || [];
      const salt = ls?.salt || window.mySalt;

      if (pieces.length && salt && typeof boardStateString !== 'undefined' && typeof sha256 !== 'undefined') {
        const bss = boardStateString(pieces);
        copyRow(body.__cur, 'boardStateString', bss, 'secret');
        // Async compute the hash
        sha256(bss + salt).then(h => {
          copyRow(body.__cur, 'SHA256(board+salt)', h, 'hash');
          const myComm = window.mySalt ? window.myCommitment : window.localState?.commitment;
          if (myComm) {
            const match = h === myComm;
            addRow(body.__cur, 'matches commitment?', match ? '✅ YES' : '❌ NO — MISMATCH', match ? 'public' : 'secret');
          }
        });
        addRow(body.__cur, 'pieces in set', pieces.length);
      } else {
        addRow(body.__cur, 'status', 'No pieces or salt yet', 'null');
      }
    });
  }

  // ─── NETWORK TAB ────────────────────────────────────────────────────────────
  function renderNetwork(body) {
    const el = document.createElement('div');
    if (msgLog.length === 0) {
      el.innerHTML = '<div style="color:#445;font-size:10px;padding:8px;">No messages yet. Messages appear here as they are sent/received.</div>';
    } else {
      // Show newest first
      [...msgLog].reverse().slice(0, 50).forEach(m => {
        const d = document.createElement('div');
        d.className = 'dbg-msg ' + m.dir;
        const badge = `<span class="dbg-badge badge-${m.dir}">${m.dir.toUpperCase()}</span>`;
        const ts = `<span class="dbg-ts">${new Date(m.ts).toLocaleTimeString()}</span>`;
        const type = `<strong style="color:#e0e0e0">${m.type || '?'}</strong>`;
        const json = JSON.stringify(m.data, null, 2);
        d.innerHTML = `<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px;">${badge} ${ts} ${type}</div>
          <div class="dbg-json">${escHtml(json)}</div>`;
        el.appendChild(d);
      });
    }
    body.appendChild(el);

    // Events
    section(body, '📋 Events', () => {
      [...eventLog].reverse().slice(0, 20).forEach(e => {
        const d = document.createElement('div');
        d.className = 'dbg-msg ' + (e.type === 'error' ? 'err' : 'event');
        d.innerHTML = `<span class="dbg-ts">${new Date(e.ts).toLocaleTimeString()}</span>
          <span class="dbg-badge badge-${e.type==='error'?'err':'event'}">${e.label}</span>
          <span style="color:#aaa;margin-left:6px;font-size:10px;">${escHtml(e.detail||'')}</span>`;
        body.__cur?.appendChild(d);
      });
    });
  }

  // ─── BOARD TAB ──────────────────────────────────────────────────────────────
  function renderBoard(body) {
    const G = window.G;
    const blob = window.blob;
    const ls = window.localState;

    const pieces = G?.pieces || ls?.pieces || [];
    const size = G?.size || blob?.boardSize || 4;

    section(body, '🗂 All Pieces', () => {
      if (!pieces.length) { addRow(body.__cur, 'pieces', 'none', 'null'); return; }
      const ICONS = {KING:'♛',VERT:'|',HORZ:'—',X:'✕'};
      const grid = document.createElement('div');
      grid.className = 'dbg-pieces-grid';
      grid.style.gridTemplateColumns = `repeat(${size}, 38px)`;
      for (let y = size-1; y>=0; y--) {
        for (let x=0; x<size; x++) {
          const cell = document.createElement('div');
          cell.className = 'dbg-pcell';
          const p = pieces.find(pc=>pc.x===x&&pc.y===y);
          if (p) {
            cell.classList.add('p'+(p.team+1));
            if (p.dead) cell.classList.add('dead');
            cell.textContent = ICONS[p.type]||'?';
            cell.title = `${p.type} T${p.team} (${x},${y})${p.dead?' DEAD':''}${p.hidden?' HIDDEN':''}`;
            cell.style.color = p.team===0 ? '#4fc3f7' : '#ff8a65';
          }
          grid.appendChild(cell);
        }
      }
      body.__cur?.appendChild(grid);
    });

    section(body, '📊 Piece List', () => {
      const ICONS = {KING:'♛',VERT:'|',HORZ:'—',X:'✕'};
      pieces.forEach(p => {
        const d = document.createElement('div');
        d.className = 'dbg-row';
        const col = p.team===0?'#4fc3f7':'#ff8a65';
        d.innerHTML = `<span class="dbg-key" style="color:${col}">${ICONS[p.type]} ${p.type}</span>
          <span class="dbg-val">(${p.x},${p.y}) T${p.team}${p.dead?' 💀':''}${p.hidden?' 🫥':''}</span>`;
        body.__cur?.appendChild(d);
      });
    });

    // Opponent blob pieces (async reveal)
    const opp = blob?.players?.[1-window.myTeam];
    if (opp?.revealedPieces?.length) {
      section(body, '👁 Opponent Revealed Pieces', () => {
        const ICONS = {KING:'♛',VERT:'|',HORZ:'—',X:'✕'};
        opp.revealedPieces.forEach(p => {
          addRow(body.__cur, `${ICONS[p.type]} (${p.x},${p.y})`, `salt was: ${opp.revealedSalt?.slice(0,12)}...`, 'secret');
        });
      });
    }
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function section(body, title, cb) {
    const s = document.createElement('div');
    s.className = 'dbg-section';
    s.innerHTML = `<h4>${title}</h4>`;
    body.__cur = s;
    body.appendChild(s);
    cb();
    body.__cur = null;
  }

  function addRow(parent, k, v, cls) {
    const el = document.createElement('div');
    el.className = 'dbg-row';
    const valCls = v === null || v === undefined ? 'null'
      : cls || (typeof v === 'boolean' ? (v ? 'bool-t' : 'bool-f') : '');
    el.innerHTML = `<span class="dbg-key">${k}</span>
      <span class="dbg-val ${valCls}">${v === null || v === undefined ? 'null' : String(v)}</span>`;
    parent?.appendChild(el);
  }

  function copyRow(parent, k, v, cls) {
    if (!parent) return;
    const el = document.createElement('div');
    el.className = 'dbg-row';
    const valCls = v === null || v === undefined ? 'null' : cls || '';
    const displayVal = v === null || v === undefined ? 'null' : String(v);
    const copyBtn = v ? `<button class="dbg-copy" onclick="navigator.clipboard.writeText('${String(v).replace(/'/g,"\\'")}')">copy</button>` : '';
    el.innerHTML = `<span class="dbg-key">${k}</span>
      <span class="dbg-val ${valCls}" style="flex:1">${displayVal}</span>${copyBtn}`;
    parent.appendChild(el);
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── PUBLIC API ─────────────────────────────────────────────────────────────
  function toggle() {
    visible = !visible;
    panel.classList.toggle('hidden', !visible);
    toggleBtn.textContent = visible ? '⚙ DBG ▲' : '⚙ DBG';
    if (visible) render();
  }

  function log(dir, type, data) {
    msgLog.push({ dir, type, data, ts: Date.now() });
    if (msgLog.length > 200) msgLog.shift();
    if (visible && currentTab === 'network') render();
  }

  function event(label, detail, type='event') {
    eventLog.push({ label, detail, type, ts: Date.now() });
    if (eventLog.length > 100) eventLog.shift();
    if (visible) render();
  }

  // Auto-refresh while open
  setInterval(() => { if (visible) render(); }, 1000);

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); toggle(); }
  });

  return { toggle, log, event, showTab, panel };
})();

// ─── INTERCEPT sendMsg (index.html) ──────────────────────────────────────────
// Must be called AFTER sendMsg is defined. Patches it if present.
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.sendMsg !== 'undefined') {
    const _orig = window.sendMsg;
    window.sendMsg = function(obj) {
      window.__debug.log('sent', obj.type, obj);
      return _orig(obj);
    };
  }
});
