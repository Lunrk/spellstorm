/* ═══════════════════════════════════════════════════════════════
   SPELL STORM — main.js
   ═══════════════════════════════════════════════════════════════ */

/* ── LANGUAGE ─────────────────────────────────────────────────── */
const LANG = {
  en: {
    spells: {
      shield: ['shield', 'protect', 'barrier'],
      fire: ['fire', 'burn', 'ignite', 'flame'],
      lightning: ['lightning', 'thunder', 'bolt', 'zap'],
      poison: ['poison', 'toxic', 'venom'],
      heal: ['heal', 'health', 'cure', 'restore'],
      freeze: ['freeze', 'ice', 'frost', 'cold'],
    },
    ui: {
      shield: 'SHIELD',
      fire: 'FIRE',
      lightning: 'LIGHTNING',
      poison: 'POISON',
      freeze: 'FREEZE',
      heal: 'HEAL',
      gesture_pointing: 'POINTING',
      gesture_open: 'OPEN HAND',
      wave: 'WAVE',
      gameover: 'GAME OVER',
      newrecord: 'NEW RECORD',
    },
  },
  fr: {
    spells: {
      shield: ['bouclier', 'protection', 'barriere'],
      fire: ['flamme', 'feu', 'brulure', 'bruler', 'incendie'],
      lightning: ['eclair', 'foudre', 'tonnerre'],
      poison: ['poison', 'toxique', 'venin'],
      heal: ['soin', 'guerir', 'sante', 'soigner'],
      freeze: ['gel', 'geler', 'glace', 'froid', 'congeler'],
    },
    ui: {
      shield: 'BOUCLIER',
      fire: 'BRULURE',
      lightning: 'ÉCLAIR',
      poison: 'POISON',
      freeze: 'GEL',
      heal: 'SOIN',
      gesture_pointing: 'POINTAGE',
      gesture_open: 'MAIN OUVERTE',
      wave: 'VAGUE',
      gameover: 'PARTIE TERMINÉE',
      newrecord: 'NOUVEAU RECORD',
    },
  },
};
let currentLang = 'en';
function t(k) {
  return LANG[currentLang].ui[k] || k;
}
function tSpell(k) {
  const v = LANG[currentLang].spells[k];
  return Array.isArray(v) ? v[0] : v || k;
}

/* ── BG MODE ──────────────────────────────────────────────────── */
let bgMode = 'virtual';

/* ── CANVAS ───────────────────────────────────────────────────── */
const gameCanvas = document.getElementById('gameCanvas');
const handCanvas = document.getElementById('handCanvas');
const gCtx = gameCanvas.getContext('2d');
const hCtx = handCanvas.getContext('2d');
const video = document.getElementById('video');

function resizeCanvases() {
  gameCanvas.width = handCanvas.width = window.innerWidth;
  gameCanvas.height = handCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

/* ── STATE ────────────────────────────────────────────────────── */
const STATE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
};
let gameState = STATE.TITLE;
let hp = 100,
  score = 0,
  kills = 0,
  gameTime = 0,
  startTime = 0;
let wave = 1,
  waveTimer = 0;
let bestScore = parseInt(localStorage.getItem('spellstorm_best') || '0');
let raf = null;

/* ── LEVEL ────────────────────────────────────────────────────── */
let level = 1,
  levelKills = 0;
const killsToLevel = (lvl) => 2 + lvl * 3 + Math.floor(lvl * lvl * 0.5);

function addKill() {
  kills++;
  levelKills++;
  if (levelKills >= killsToLevel(level)) {
    level++;
    levelKills = 0;
    hp = 100; // FIX 1: full heal on level-up
    showLevelUp(); // FIX 1: was a TODO
  }
  score += Math.floor(10 * wave * (1 + level * 0.1));
}

/* ── ENTITIES ─────────────────────────────────────────────────── */
let targets = [],
  projectiles = [],
  drops = [],
  particles = [],
  spellFX = [],
  poisonTrail = [],
  dmgNumbers = [];

/* ── COOLDOWNS ────────────────────────────────────────────────── */
const CD = {
  shield: 4000,
  fire: 3000,
  lightning: 5000,
  poison: 6000,
  heal: 5000,
  freeze: 8000,
};
const cdTimer = {
  shield: 0,
  fire: 0,
  lightning: 0,
  poison: 0,
  heal: 0,
  freeze: 0,
};
function isReady(s) {
  return Date.now() >= cdTimer[s] && !isBlocked(s);
}
function triggerCD(s) {
  cdTimer[s] = Date.now() + CD[s];
}
function cdLeft(s) {
  return Math.max(0, cdTimer[s] - Date.now());
}

/* ── SPECIAL ENEMIES ─────────────────────────────────────────── */
const MAX_WAVE = 20;
// Which special types are unlocked per wave threshold
// healer: wave 1+, bomb: wave 6+, accelerator: wave 11+, blocker: wave 16+
// Shuffle special types at load so unlock order is random each run
const SPECIAL_TYPES = (() => {
  const arr = ['healer', 'bomb', 'accelerator', 'blocker'];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
})();
const SPECIAL_UNLOCK = [1, 6, 11, 16]; // min wave to appear (paired by index with shuffled SPECIAL_TYPES)
const SPECIAL_CHANCE = 0.18; // probability per spawn that it's a special

// Blocked spells: { spellKey: timestamp when block expires }
let blockedSpells = {};
function isBlocked(s) {
  return blockedSpells[s] && Date.now() < blockedSpells[s];
}
function blockSpell(s, dur = 10000) {
  blockedSpells[s] = Date.now() + dur;
  flash('🔒 ' + s.toUpperCase() + ' BLOQUÉ !', '#c084fc');
}
function updateBlockedSpells() {
  const now = Date.now();
  for (const k of Object.keys(blockedSpells))
    if (now >= blockedSpells[k]) delete blockedSpells[k];
}

/* ── HAND TRACKING ────────────────────────────────────────────── */
let handLandmarks = null,
  currentGesture = 'NONE';
let indexTip = null,
  indexDir = null,
  palmCenter = null,
  palmRadius = 0;
let poisonActive = false,
  _poisonTimeout = null;
let handLost = false; // true when hand is off-screen during gameplay
const HAND_LOST_DELAY = 1.2; // seconds before overlay appears — increase to be less sensitive
let _handLostTimer = 0; // counts up while hand is missing
let _pGesture = 'NONE',
  _pFrames = 0,
  _sGesture = 'NONE',
  _lost = 0;
const _sweepHist = [];

/* ── SPEECH ───────────────────────────────────────────────────── */
let recognition = null,
  speechRunning = false,
  speechStatus = 'idle';

/* ═══════════════════════════════════════════════════════════════
   GESTURE DETECTION
   ═══════════════════════════════════════════════════════════════ */
function d3(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function ang3(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)],
    cb = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const dot = ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2];
  return (
    (Math.acos(
      Math.min(
        1,
        Math.max(
          -1,
          dot / Math.max(Math.hypot(...ab) * Math.hypot(...cb), 1e-6),
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}
function palmSz(lm) {
  return d3(lm[0], lm[9]);
}
function palmCtr(lm) {
  const p = [lm[0], lm[5], lm[9], lm[13], lm[17]];
  return {
    x: p.reduce((s, v) => s + v.x, 0) / 5,
    y: p.reduce((s, v) => s + v.y, 0) / 5,
  };
}
function fingerExt(lm, mcp, pip, dip, tip) {
  const pA = ang3(lm[mcp], lm[pip], lm[dip]),
    dA = ang3(lm[pip], lm[dip], lm[tip]);
  return (
    pA > 150 &&
    dA > 145 &&
    (d3(lm[tip], lm[0]) > d3(lm[pip], lm[0]) * 1.01 ||
      d3(lm[tip], lm[mcp]) > d3(lm[dip], lm[mcp]) * 1.05)
  );
}
function fingerFold(lm, mcp, pip, dip, tip) {
  const pc = palmCtr(lm),
    psz = palmSz(lm);
  const pA = ang3(lm[mcp], lm[pip], lm[dip]),
    dA = ang3(lm[pip], lm[dip], lm[tip]);
  return (
    (pA < 145 && dA < 150 && d3(lm[tip], lm[0]) < d3(lm[pip], lm[0]) * 1.02) ||
    d3(lm[tip], pc) < psz * 0.8
  );
}
function idxPoint(lm) {
  const mcp = lm[5],
    pip = lm[6],
    dip = lm[7],
    tip = lm[8],
    psz = Math.max(palmSz(lm), 1e-6);
  return (
    ang3(mcp, pip, dip) > 140 &&
    ang3(pip, dip, tip) > 135 &&
    Math.hypot(tip.x - mcp.x, tip.y - mcp.y) > psz * 0.35 &&
    Math.hypot(tip.x - lm[0].x, tip.y - lm[0].y) >
      Math.hypot(pip.x - lm[0].x, pip.y - lm[0].y) * 1.05
  );
}
function detectGesture(lm) {
  if (
    fingerExt(lm, 1, 2, 3, 4) &&
    fingerExt(lm, 5, 6, 7, 8) &&
    fingerExt(lm, 9, 10, 11, 12) &&
    fingerExt(lm, 13, 14, 15, 16) &&
    fingerExt(lm, 17, 18, 19, 20)
  )
    return 'OPEN_HAND';
  if (
    idxPoint(lm) &&
    (fingerFold(lm, 9, 10, 11, 12) ||
      fingerFold(lm, 13, 14, 15, 16) ||
      fingerFold(lm, 17, 18, 19, 20))
  )
    return 'POINTING';
  return 'NONE';
}
function detectSweep(pc) {
  _sweepHist.push({ x: pc.x, y: pc.y, t: Date.now() });
  if (_sweepHist.length > 8) _sweepHist.shift();
  if (_sweepHist.length < 4) return false;
  const o = _sweepHist[0],
    c = _sweepHist[_sweepHist.length - 1],
    dt = (c.t - o.t) / 1000;
  return dt > 0.01 && Math.hypot(c.x - o.x, c.y - o.y) / dt > 0.28;
}
function smoothGesture(raw) {
  if (raw === 'NONE' && _sGesture !== 'NONE' && _lost < 5) {
    _lost++;
    return _sGesture;
  }
  if (raw !== 'NONE') _lost = 0;
  if (raw === _pGesture) _pFrames++;
  else {
    _pGesture = raw;
    _pFrames = 1;
  }
  if (_pFrames >= 3) _sGesture = raw;
  return _sGesture;
}

/* ═══════════════════════════════════════════════════════════════
   AUDIO ENGINE
   ═══════════════════════════════════════════════════════════════ */
let _ac = null,
  _masterGain = null,
  _musicNodes = [],
  _musicPlaying = false;

function getAC() {
  if (!_ac) {
    _ac = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ac.createGain();
    _masterGain.gain.value = 0.55;
    _masterGain.connect(_ac.destination);
  }
  if (_ac.state === 'suspended') _ac.resume();
  return _ac;
}
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  nodes[nodes.length - 1].connect(_masterGain);
  return nodes[0];
}
function makeNoise(ac, dur, color = 'white') {
  const sr = ac.sampleRate,
    len = Math.ceil(sr * dur);
  const buf = ac.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
    } else {
      d[i] = w;
    }
  }
  return buf;
}
function sndShield() {
  const ac = getAC(),
    now = ac.currentTime;
  const osc1 = ac.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(320, now);
  osc1.frequency.exponentialRampToValueAtTime(880, now + 0.08);
  osc1.frequency.exponentialRampToValueAtTime(440, now + 0.35);
  const osc2 = ac.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(80, now);
  osc2.frequency.exponentialRampToValueAtTime(160, now + 0.15);
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.4, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.5, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.3);
  const nsf = ac.createBiquadFilter();
  nsf.type = 'bandpass';
  nsf.frequency.value = 4000;
  nsf.Q.value = 2;
  const nsg = ac.createGain();
  nsg.gain.setValueAtTime(0.15, now);
  nsg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  chain(osc1, g1);
  chain(osc2, g2);
  chain(ns, nsf, nsg);
  osc1.start(now);
  osc1.stop(now + 0.4);
  osc2.start(now);
  osc2.stop(now + 0.3);
  ns.start(now);
  ns.stop(now + 0.3);
}
function sndFire() {
  const ac = getAC(),
    now = ac.currentTime;
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.6, 'pink');
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.setValueAtTime(800, now);
  f1.frequency.exponentialRampToValueAtTime(200, now + 0.5);
  f1.Q.value = 1.5;
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.6, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  const ns2 = ac.createBufferSource();
  ns2.buffer = makeNoise(ac, 0.3);
  const f2 = ac.createBiquadFilter();
  f2.type = 'highpass';
  f2.frequency.value = 3000;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.2, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
  const g3 = ac.createGain();
  g3.gain.setValueAtTime(0.25, now);
  g3.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  chain(ns, f1, g1);
  chain(ns2, f2, g2);
  chain(osc, g3);
  ns.start(now);
  ns.stop(now + 0.6);
  ns2.start(now);
  ns2.stop(now + 0.3);
  osc.start(now);
  osc.stop(now + 0.5);
}
function sndLightning() {
  const ac = getAC(),
    now = ac.currentTime;
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.05);
  const f1 = ac.createBiquadFilter();
  f1.type = 'highpass';
  f1.frequency.value = 1000;
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(1.0, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.3);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.3, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(1200, now);
  osc2.frequency.exponentialRampToValueAtTime(200, now + 0.2);
  const g3 = ac.createGain();
  g3.gain.setValueAtTime(0.4, now);
  g3.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  chain(ns, f1, g1);
  chain(osc, g2);
  chain(osc2, g3);
  ns.start(now);
  ns.stop(now + 0.05);
  osc.start(now);
  osc.stop(now + 0.35);
  osc2.start(now);
  osc2.stop(now + 0.2);
}
function sndPoison() {
  const ac = getAC(),
    now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.setValueAtTime(180, now + 0.1);
  osc.frequency.setValueAtTime(260, now + 0.2);
  osc.frequency.setValueAtTime(200, now + 0.3);
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.25, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.5, 'pink');
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 600;
  f1.Q.value = 3;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.3, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  chain(osc, g1);
  chain(ns, f1, g2);
  osc.start(now);
  osc.stop(now + 0.5);
  ns.start(now);
  ns.stop(now + 0.5);
}
function sndFreeze() {
  const ac = getAC(),
    now = ac.currentTime;
  for (let i = 0; i < 5; i++) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    const baseF = 800 + i * 300;
    osc.frequency.setValueAtTime(baseF, now + i * 0.02);
    osc.frequency.exponentialRampToValueAtTime(
      baseF * 0.3,
      now + 0.5 + i * 0.02,
    );
    const g = ac.createGain();
    g.gain.setValueAtTime(0.12, now + i * 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.5 + i * 0.02);
    chain(osc, g);
    osc.start(now + i * 0.02);
    osc.stop(now + 0.6 + i * 0.02);
  }
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.12);
  const f1 = ac.createBiquadFilter();
  f1.type = 'highpass';
  f1.frequency.value = 5000;
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.3, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  chain(ns, f1, g1);
  ns.start(now);
  ns.stop(now + 0.12);
}
function sndHeal() {
  const ac = getAC(),
    now = ac.currentTime;
  [261, 329, 392, 523].forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now + i * 0.07);
    g.gain.linearRampToValueAtTime(0.3, now + i * 0.07 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.4);
    chain(osc, g);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.4);
  });
}
function sndProjectileDestroy() {
  const ac = getAC(),
    now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.2, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  chain(osc, g);
  osc.start(now);
  osc.stop(now + 0.15);
}
function sndTargetDeath() {
  const ac = getAC(),
    now = ac.currentTime;
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.2, 'pink');
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 300;
  f1.Q.value = 2;
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.4, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  chain(ns, f1, g1);
  ns.start(now);
  ns.stop(now + 0.2);
}
function sndDamage() {
  const ac = getAC(),
    now = ac.currentTime;
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.1);
  const f1 = ac.createBiquadFilter();
  f1.type = 'lowpass';
  f1.frequency.value = 400;
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.5, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 60;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.4, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  chain(ns, f1, g1);
  chain(osc, g2);
  ns.start(now);
  ns.stop(now + 0.1);
  osc.start(now);
  osc.stop(now + 0.2);
}
function sndLevelUp() {
  const ac = getAC(),
    now = ac.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.2, now + i * 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.2);
    chain(osc, g);
    osc.start(now + i * 0.05);
    osc.stop(now + i * 0.05 + 0.2);
  });
}
function sndWave() {
  const ac = getAC(),
    now = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.6);
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(0.5, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  const ns = ac.createBufferSource();
  ns.buffer = makeNoise(ac, 0.3, 'pink');
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 200;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.3, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  chain(osc, g1);
  chain(ns, f1, g2);
  osc.start(now);
  osc.stop(now + 0.7);
  ns.start(now);
  ns.stop(now + 0.3);
}

/* ═══════════════════════════════════════════════════════════════
   AMBIENT MUSIC
   ═══════════════════════════════════════════════════════════════ */
function startMusic() {
  if (_musicPlaying) return;
  _musicPlaying = true;
  const ac = getAC();
  _musicNodes = [];
  const musicGain = ac.createGain();
  musicGain.gain.value = 0.22;
  musicGain.connect(_masterGain);
  _musicNodes.push(musicGain);
  [55, 82.4, 110].forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = f;
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.3 + i * 0.07;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const g = ac.createGain();
    g.gain.value = i === 0 ? 0.18 : 0.08;
    osc.connect(g);
    g.connect(musicGain);
    osc.start();
    lfo.start();
    _musicNodes.push(osc, lfo, lfoGain, g);
  });
  [220, 277.2, 329.6, 440].forEach((f, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f + (Math.random() - 0.5) * 2;
    const g = ac.createGain();
    g.gain.value = 0.04;
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15 + i * 0.04;
    const lfoG = ac.createGain();
    lfoG.gain.value = 0.03;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    osc.connect(g);
    g.connect(musicGain);
    osc.start();
    lfo.start();
    _musicNodes.push(osc, lfo, lfoG, g);
  });
  const arpNotes = [
    220, 261.6, 293.7, 329.6, 392, 440, 392, 329.6, 293.7, 261.6,
  ];
  const arpSpeed = 0.35;
  let arpStep = 0;
  function scheduleArp() {
    if (!_musicPlaying) return;
    const now = ac.currentTime,
      freq = arpNotes[arpStep++ % arpNotes.length];
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + arpSpeed * 0.85);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(now);
    osc.stop(now + arpSpeed);
    setTimeout(scheduleArp, arpSpeed * 1000 * 0.98);
  }
  scheduleArp();
  function scheduleBass() {
    if (!_musicPlaying) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(now);
    osc.stop(now + 0.4);
    setTimeout(scheduleBass, 800 + Math.random() * 400);
  }
  scheduleBass();
}
function stopMusic() {
  _musicPlaying = false;
  _musicNodes.forEach((n) => {
    try {
      n.stop ? n.stop() : n.disconnect();
    } catch (e) {}
  });
  _musicNodes = [];
}

/* ═══════════════════════════════════════════════════════════════
   ENTITIES
   ═══════════════════════════════════════════════════════════════ */
function spawnTarget() {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  let x, y;
  const s = Math.floor(Math.random() * 4);
  // Determine type — maybe spawn a special
  let specialType = null;
  if (Math.random() < SPECIAL_CHANCE) {
    const available = SPECIAL_TYPES.filter((_, i) => wave >= SPECIAL_UNLOCK[i]);
    if (available.length)
      specialType = available[Math.floor(Math.random() * available.length)];
  }
  const r = specialType ? 32 : 28 + Math.random() * 16;
  const hp =
    specialType === 'healer'
      ? Math.round((20 + wave * 15) * 2)
      : specialType
        ? Math.round((20 + wave * 15) * 1.3)
        : 20 + wave * 15;
  const spd =
    (specialType === 'accelerator' ? 1.2 : 1) *
    (0.6 + wave * 0.15) *
    (0.8 + Math.random() * 0.6);
  if (s === 0) {
    x = Math.random() * W;
    y = -r;
  } else if (s === 1) {
    x = W + r;
    y = Math.random() * H;
  } else if (s === 2) {
    x = Math.random() * W;
    y = H + r;
  } else {
    x = -r;
    y = Math.random() * H;
  }
  const cx = W / 2 + (Math.random() - 0.5) * W * 0.4,
    cy = H / 2 + (Math.random() - 0.5) * H * 0.4;
  const dir = Math.atan2(cy - y, cx - x);
  const base = {
    x,
    y,
    r,
    hp,
    maxHp: hp,
    speed: spd,
    vx: Math.cos(dir) * spd,
    vy: Math.sin(dir) * spd,
    wanderAngle: Math.random() * Math.PI * 2,
    wanderTimer: 0,
    burning: false,
    burnTimer: 0,
    burnDps: 0,
    poisoned: false,
    poisonTimer: 0,
    frozen: false,
    freezeTimer: 0,
    freezeDmgBonus: 0,
  };
  if (specialType === 'bomb') {
    targets.push({
      ...base,
      specialType: 'bomb',
      bombTimer: 10,
      bombArmed: true,
    });
  } else if (specialType === 'healer') {
    targets.push({ ...base, specialType: 'healer', healTimer: 3 }); // heals every 3s
  } else if (specialType === 'accelerator') {
    targets.push({ ...base, specialType: 'accelerator', accelTimer: 4 });
  } else if (specialType === 'blocker') {
    targets.push({ ...base, specialType: 'blocker', blockTimer: 5 }); // tries to block every 5s
  } else {
    targets.push(base);
  }
}
function updateTargets(dt) {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  for (let i = targets.length - 1; i >= 0; i--) {
    const tgt = targets[i];
    tgt.wanderTimer -= dt;
    if (tgt.wanderTimer <= 0) {
      tgt.wanderAngle += (Math.random() - 0.5) * 1.2;
      tgt.wanderTimer = 1 + Math.random() * 2;
    }
    if (!tgt.frozen) {
      tgt.vx += Math.cos(tgt.wanderAngle) * 0.3 * dt;
      tgt.vy += Math.sin(tgt.wanderAngle) * 0.3 * dt;
      const spd = Math.hypot(tgt.vx, tgt.vy);
      if (spd > tgt.speed) {
        tgt.vx *= tgt.speed / spd;
        tgt.vy *= tgt.speed / spd;
      }
      tgt.x += tgt.vx * dt * 60;
      tgt.y += tgt.vy * dt * 60;
    }
    if (tgt.x < tgt.r) {
      tgt.x = tgt.r;
      tgt.vx = Math.abs(tgt.vx);
    }
    if (tgt.x > W - tgt.r) {
      tgt.x = W - tgt.r;
      tgt.vx = -Math.abs(tgt.vx);
    }
    if (tgt.y < tgt.r) {
      tgt.y = tgt.r;
      tgt.vy = Math.abs(tgt.vy);
    }
    if (tgt.y > H - tgt.r) {
      tgt.y = H - tgt.r;
      tgt.vy = -Math.abs(tgt.vy);
    }
    if (tgt.burning) {
      tgt.burnTimer -= dt;
      const dm = 1 + (tgt.freezeDmgBonus || 0);
      const fireDmg = tgt.burnDps * dm * dt;
      tgt.hp -= fireDmg;
      tgt._fireDmgAcc = (tgt._fireDmgAcc || 0) + fireDmg;
      if (tgt._fireDmgAcc >= 5) {
        spawnDmg(tgt.x, tgt.y, tgt._fireDmgAcc, '#ff6b2b');
        tgt._fireDmgAcc = 0;
      }
      if (tgt.burnTimer <= 0) tgt.burning = false;
    }
    if (tgt.poisoned) {
      tgt.poisonTimer -= dt;
      const poisDmg = 8 * level * dt;
      tgt.hp -= poisDmg;
      tgt._poisDmgAcc = (tgt._poisDmgAcc || 0) + poisDmg;
      if (tgt._poisDmgAcc >= 5) {
        spawnDmg(tgt.x, tgt.y, tgt._poisDmgAcc, '#a855f7');
        tgt._poisDmgAcc = 0;
      }
      if (tgt.poisonTimer <= 0) tgt.poisoned = false;
    }
    if (tgt.frozen) {
      tgt.freezeTimer -= dt;
      if (tgt.freezeTimer <= 0) {
        tgt.frozen = false;
        tgt.freezeDmgBonus = 0;
      }
    }
    // ── Special enemy behaviors ──────────────────────────────────
    if (!tgt.isBoss && tgt.specialType === 'bomb' && tgt.bombArmed) {
      tgt.bombTimer -= dt;
      if (tgt.bombTimer <= 0) {
        // BOOM — damage player, big explosion
        const dist = Math.hypot(
          tgt.x - gameCanvas.width / 2,
          tgt.y - gameCanvas.height / 2,
        );
        takeDamage(Math.min(40, 15 + wave * 2));
        for (let _i = 0; _i < 3; _i++)
          spawnFX(
            tgt.x + (Math.random() - 0.5) * tgt.r * 2,
            tgt.y + (Math.random() - 0.5) * tgt.r * 2,
            '#f97316',
            20,
          );
        spawnFX(tgt.x, tgt.y, '#ffe066', 30);
        flash(
          '💣 BOOM ! ' +
            (currentLang === 'fr' ? 'Dégâts explosion!' : 'Bomb exploded!'),
          '#f97316',
        );
        sndDamage();
        tgt.bombArmed = false;
        tgt.hp = 0; // dies after exploding
      }
    }
    if (!tgt.isBoss && tgt.specialType === 'healer') {
      tgt.healTimer -= dt;
      if (tgt.healTimer <= 0) {
        tgt.healTimer = 3;
        // Heal ALL targets on the map (no distance filter)
        for (const other of targets) {
          if (other !== tgt && !other.isBoss) {
            const healAmt = Math.round(other.maxHp * 0.15);
            const actual = Math.min(healAmt, other.maxHp - other.hp);
            if (actual > 0) {
              other.hp += actual;
              spawnFX(other.x, other.y, '#4ade80', 5);
              spawnDmg(
                other.x,
                other.y - other.r - 10,
                actual,
                '#4ade80',
                true,
              );
            }
          }
        }
      }
    }
    if (!tgt.isBoss && tgt.specialType === 'accelerator') {
      tgt.accelTimer -= dt;
      if (tgt.accelTimer <= 0) {
        tgt.accelTimer = 4;
        // Speed up all projectiles on screen
        for (const p of projectiles) {
          p.vx *= 1.4;
          p.vy *= 1.4;
          p.life *= 0.7;
        }
        flash(
          '⚡ ' +
            (currentLang === 'fr'
              ? 'Projectiles accélérés!'
              : 'Projectiles sped up!'),
          '#38bdf8',
        );
      }
    }
    if (!tgt.isBoss && tgt.specialType === 'blocker') {
      tgt.blockTimer -= dt;
      if (tgt.blockTimer <= 0) {
        tgt.blockTimer = 8;
        // Block a random available spell for 10s
        const spells = [
          'shield',
          'fire',
          'lightning',
          'poison',
          'heal',
          'freeze',
        ];
        const avail = spells.filter((s) => !isBlocked(s));
        if (avail.length) {
          const chosen = avail[Math.floor(Math.random() * avail.length)];
          blockSpell(chosen, 10000);
        }
      }
    }
    if (tgt.hp <= 0) {
      if (tgt.isBoss) {
        // Epic death explosion
        for (let _i = 0; _i < 5; _i++)
          spawnFX(
            tgt.x + (Math.random() - 0.5) * tgt.r,
            tgt.y + (Math.random() - 0.5) * tgt.r,
            '#f97316',
            20,
          );
        spawnFX(tgt.x, tgt.y, '#ffe066', 30);
        onBossDeath();
      } else {
        spawnFX(tgt.x, tgt.y, '#a855f7', 14);
        tryDrop(tgt.x, tgt.y);
      }
      sndTargetDeath();
      addKill();
      targets.splice(i, 1);
    }
  }
}
function spawnProjectile() {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  let x, y;
  const s = Math.floor(Math.random() * 4);
  if (s === 0) {
    x = Math.random() * W;
    y = -10;
  } else if (s === 1) {
    x = W + 10;
    y = Math.random() * H;
  } else if (s === 2) {
    x = Math.random() * W;
    y = H + 10;
  } else {
    x = -10;
    y = Math.random() * H;
  }
  const tx = W / 2 + (Math.random() - 0.5) * W * 0.5,
    ty = H / 2 + (Math.random() - 0.5) * H * 0.5;
  const angle = Math.atan2(ty - y, tx - x),
    spd = 1.2 + wave * 0.2 + Math.random() * 0.8,
    life = 6 + Math.random() * 4;
  projectiles.push({
    x,
    y,
    r: 8,
    vx: Math.cos(angle) * spd,
    vy: Math.sin(angle) * spd,
    life,
    maxLife: life,
    age: 0,
  });
}
function projColor(p) {
  const t = p.age / p.maxLife;
  if (t < 0.4) {
    const f = t / 0.4;
    return `rgb(${Math.round(56 + f * 199)},${Math.round(189 - f * 49)},${Math.round(248 - f * 248)})`;
  }
  const f = (t - 0.4) / 0.6;
  return `rgb(255,${Math.round(140 - f * 140)},0)`;
}
function updateProjectiles(dt) {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.age += dt;
    p.life -= dt;
    if (p.life <= 0) {
      if (p.age / p.maxLife >= 0.4) {
        const dmg = bossActive
          ? Math.min(25, (8 + wave * 2) | 0)
          : Math.min(15, (5 + wave * 1.5) | 0);
        takeDamage(dmg);
      }
      spawnFX(p.x, p.y, '#f87171', 6);
      projectiles.splice(i, 1);
      continue;
    }
    if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50)
      projectiles.splice(i, 1);
  }
}
function tryDrop(x, y) {
  if (Math.random() < 0.35)
    drops.push({ x, y, r: 10, life: 8, maxLife: 8, collected: false });
}
function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    drops[i].life -= dt;
    if (drops[i].life <= 0 || drops[i].collected) drops.splice(i, 1);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SPELLS
   ═══════════════════════════════════════════════════════════════ */
function n2c(nx, ny) {
  return { x: (1 - nx) * gameCanvas.width, y: ny * gameCanvas.height };
}
function stopPoison() {
  poisonActive = false;
  if (_poisonTimeout) {
    clearTimeout(_poisonTimeout);
    _poisonTimeout = null;
  }
}

function castShield() {
  if (!isReady('shield') || !palmCenter || currentGesture !== 'OPEN_HAND')
    return;
  stopPoison();
  triggerCD('shield');
  const pos = n2c(palmCenter.x, palmCenter.y),
    rad = palmRadius * 2.2;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    if (
      proj.age / proj.maxLife >= 0.25 &&
      Math.hypot(proj.x - pos.x, proj.y - pos.y) < rad
    ) {
      spawnFX(proj.x, proj.y, '#38bdf8', 8);
      projectiles.splice(i, 1);
      score += 10;
      sndProjectileDestroy();
    }
  }
  spellFX.push({
    type: 'shield',
    x: pos.x,
    y: pos.y,
    r: 0,
    maxR: rad,
    life: 0.6,
    maxLife: 0.6,
  });
  flash('🛡️ ' + t('shield'), '#38bdf8');
  markActive('shield');
  sndShield();
}
function castFire() {
  if (!isReady('fire') || !indexTip || currentGesture !== 'POINTING') return;
  stopPoison();
  const pos = n2c(indexTip.x, indexTip.y);
  const fireRad = 80 + level * 20;
  let hitCount = 0;
  for (const tgt of targets) {
    if (Math.hypot(tgt.x - pos.x, tgt.y - pos.y) < tgt.r + fireRad) {
      tgt.burning = true;
      tgt.burnDps = 2.5 * level;
      tgt.burnTimer = 3 + level * 0.5;
      if (tgt.frozen) {
        tgt.frozen = false;
        tgt.freezeTimer = 0;
        tgt.freezeDmgBonus = 0;
      }
      spellFX.push({
        type: 'fire',
        x: pos.x,
        y: pos.y,
        tx: tgt.x,
        ty: tgt.y,
        life: 0.8,
        maxLife: 0.8,
      });
      hitCount++;
    }
  }
  // Range indicator — always shown regardless of hit/miss
  spellFX.push({
    type: 'fire_range',
    x: pos.x,
    y: pos.y,
    r: fireRad,
    life: 0.5,
    maxLife: 0.5,
  });
  if (hitCount > 0) {
    triggerCD('fire');
    spawnFireParts(pos.x, pos.y);
    flash(
      '🔥 ' + t('fire') + (hitCount > 1 ? ' (×' + hitCount + ')' : ''),
      '#ff6b2b',
    );
    markActive('fire');
    sndFire();
  } else {
    spellFX.push({
      type: 'fire_miss',
      x: pos.x,
      y: pos.y,
      life: 0.4,
      maxLife: 0.4,
    });
    flash('🔥 ' + t('fire') + ' — miss', '#ff6b2b55');
  }
}
function castLightning() {
  if (
    !isReady('lightning') ||
    !indexTip ||
    !indexDir ||
    currentGesture !== 'POINTING'
  )
    return;
  stopPoison();
  triggerCD('lightning');
  const s = n2c(indexTip.x, indexTip.y);
  let dx = indexDir.x,
    dy = indexDir.y,
    l = Math.hypot(dx, dy);
  if (l < 1e-6) return;
  dx /= l;
  dy /= l;
  spellFX.push({
    type: 'lightning',
    segments: [{ x: s.x, y: s.y }],
    x: s.x,
    y: s.y,
    dx,
    dy,
    bouncesLeft: level,
    life: 1.5,
    maxLife: 1.5,
    active: true,
    speed: 18,
  });
  flash('⚡ ' + t('lightning'), '#ffe066');
  markActive('lightning');
  sndLightning();
}
function castPoison() {
  if (!isReady('poison')) return;
  stopPoison();
  triggerCD('poison');
  poisonActive = true;
  _poisonTimeout = setTimeout(stopPoison, (4 + level) * 1000);
  flash('☠️ ' + t('poison'), '#a855f7');
  markActive('poison');
  sndPoison();
}
function castFreeze() {
  if (!isReady('freeze') || !palmCenter || currentGesture !== 'OPEN_HAND')
    return;
  stopPoison();
  triggerCD('freeze');
  const pos = n2c(palmCenter.x, palmCenter.y),
    radius = palmRadius * 3.5;
  const freezeDur = 5 + (level - 1) * 1,
    dmgBonus = 0.3 + (level - 1) * 0.1;
  let frozeCount = 0;
  for (const tgt of targets) {
    if (Math.hypot(tgt.x - pos.x, tgt.y - pos.y) < radius) {
      tgt.frozen = true;
      tgt.freezeTimer = freezeDur;
      tgt.freezeDmgBonus = dmgBonus;
      tgt.vx = 0;
      tgt.vy = 0;
      frozeCount++;
    }
  }
  spellFX.push({
    type: 'freeze',
    x: pos.x,
    y: pos.y,
    r: 0,
    maxR: radius,
    life: 0.7,
    maxLife: 0.7,
  });
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2,
      spd = 2 + Math.random() * 5,
      l = 0.5 + Math.random() * 0.6;
    particles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      r: 2 + Math.random() * 3,
      color: Math.random() < 0.5 ? '#a5f3fc' : '#7dd3fc',
      life: l,
      maxLife: l,
    });
  }
  flash(
    '❄️ ' +
      t('freeze') +
      (frozeCount ? ' (' + frozeCount + ')' : ' — no targets'),
    '#a5f3fc',
  );
  markActive('freeze');
  sndFreeze();
}
function castHeal() {
  if (!isReady('heal') || !palmCenter) return;
  triggerCD('heal');
  const pos = n2c(palmCenter.x, palmCenter.y);
  let healed = false;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (Math.hypot(d.x - pos.x, d.y - pos.y) < d.r + palmRadius + 40) {
      hp = Math.min(100, hp + 25);
      d.collected = true;
      spawnFX(d.x, d.y, '#4ade80', 10);
      score += 20;
      healed = true;
    }
  }
  if (healed) sndHeal();
  flash(
    healed ? '💚 ' + t('heal') + ' +25' : '💚 ' + t('heal') + ' — no drops',
    '#4ade80',
  );
}

/* ═══════════════════════════════════════════════════════════════
   FX UPDATE
   ═══════════════════════════════════════════════════════════════ */
function updateSpellFX(dt) {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  for (let i = spellFX.length - 1; i >= 0; i--) {
    const fx = spellFX[i];
    fx.life -= dt;
    if (fx.life <= 0) {
      spellFX.splice(i, 1);
      continue;
    }
    if (fx.type === 'shield' || fx.type === 'freeze')
      fx.r = (1 - fx.life / fx.maxLife) * fx.maxR;
    if (fx.type === 'lightning' && fx.active) {
      for (let s = 0; s < 3; s++) {
        fx.x += fx.dx * fx.speed;
        fx.y += fx.dy * fx.speed;
        fx.segments.push({
          x: fx.x + (Math.random() - 0.5) * 6,
          y: fx.y + (Math.random() - 0.5) * 6,
        });
        let hit = false;
        for (const tgt of targets) {
          if (Math.hypot(tgt.x - fx.x, tgt.y - fx.y) < tgt.r + 8) {
            const ldmg = fx.bouncesLeft < level ? 18 * level * 0.5 : 18 * level;
            tgt.hp -= ldmg;
            spawnDmg(tgt.x, tgt.y, ldmg, '#ffe066');
            spawnFX(tgt.x, tgt.y, '#ffe066', 10);
            if (fx.bouncesLeft > 0) {
              fx.bouncesLeft--;
              const next = targets.find((t2) => t2 !== tgt);
              if (next) {
                const bx = next.x - fx.x,
                  by = next.y - fx.y,
                  bl = Math.hypot(bx, by);
                fx.dx = bx / bl;
                fx.dy = by / bl;
              } else {
                if (fx.x < 80 || fx.x > W - 80) fx.dx *= -1;
                else fx.dy *= -1;
              }
              fx.segments.push({ x: fx.x, y: fx.y, bounce: true });
            } else fx.active = false;
            hit = true;
            break;
          }
        }
        if (hit) break;
        if (fx.x < 0) {
          fx.x = 0;
          fx.dx *= -1;
          fx.bouncesLeft > 0 ? fx.bouncesLeft-- : (fx.active = false);
        }
        if (fx.x > W) {
          fx.x = W;
          fx.dx *= -1;
          fx.bouncesLeft > 0 ? fx.bouncesLeft-- : (fx.active = false);
        }
        if (fx.y < 0) {
          fx.y = 0;
          fx.dy *= -1;
          fx.bouncesLeft > 0 ? fx.bouncesLeft-- : (fx.active = false);
        }
        if (fx.y > H) {
          fx.y = H;
          fx.dy *= -1;
          fx.bouncesLeft > 0 ? fx.bouncesLeft-- : (fx.active = false);
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════════════════════════════ */
function spawnFX(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2,
      spd = 1 + Math.random() * 4,
      l = 0.4 + Math.random() * 0.5;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      r: 2 + Math.random() * 3,
      color,
      life: l,
      maxLife: l,
    });
  }
}
// Spawn a floating damage number at (x,y)
function spawnDmg(x, y, amount, color, isHeal = false) {
  dmgNumbers.push({
    x: x + (Math.random() - 0.5) * 20,
    y: y,
    vy: -(1.2 + Math.random() * 0.8),
    text: (isHeal ? '+' : '-') + Math.round(amount),
    color,
    life: 1.0,
    maxLife: 1.0,
    size: Math.min(22, 12 + Math.round(amount / 8)),
  });
}

function spawnFireParts(x, y) {
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2,
      spd = 2 + Math.random() * 3,
      l = 0.3 + Math.random() * 0.4;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      r: 3 + Math.random() * 4,
      color: Math.random() < 0.5 ? '#ff6b2b' : '#ffe066',
      life: l,
      maxLife: l,
    });
  }
}
function updateDmgNumbers(dt) {
  for (let i = dmgNumbers.length - 1; i >= 0; i--) {
    const n = dmgNumbers[i];
    n.y += n.vy * dt * 60;
    n.life -= dt;
    if (n.life <= 0) dmgNumbers.splice(i, 1);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.vy += 0.05 * dt * 60;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ═══════════════════════════════════════════════════════════════
   POISON TRAIL
   ═══════════════════════════════════════════════════════════════ */
function updatePoisonTrail(dt) {
  const dur = 4 + level,
    cost = Math.max(1.5, 5 - level * 0.8);
  for (let i = poisonTrail.length - 1; i >= 0; i--) {
    poisonTrail[i].life -= dt;
    if (poisonTrail[i].life <= 0) poisonTrail.splice(i, 1);
  }
  if (poisonActive && palmCenter) {
    const pos = n2c(palmCenter.x, palmCenter.y);
    poisonTrail.push({ x: pos.x, y: pos.y, life: dur, maxLife: dur });
    hp -= cost * dt;
    if (hp < 0) hp = 0;
    for (const tgt of targets)
      for (const pt of poisonTrail)
        if (Math.hypot(tgt.x - pt.x, tgt.y - pt.y) < tgt.r + 18) {
          tgt.poisoned = true;
          tgt.poisonTimer = 2;
          break;
        }
  }
}
function takeDamage(amount) {
  hp -= amount;
  sndDamage();
  // Boss regens when it damages the player: +20 × wave HP per hit
  if (bossActive) {
    const boss = targets.find((t) => t.isBoss);
    if (boss) {
      const bHeal = 20 * wave;
      const actual = Math.min(bHeal, boss.maxHp - boss.hp);
      if (actual > 0) {
        boss.hp += actual;
        spawnFX(boss.x, boss.y, '#f97316', 3);
        spawnDmg(boss.x, boss.y - boss.r - 10, actual, '#f97316', true); // orange +X
      }
    }
  }
  if (hp <= 0) {
    hp = 0;
    endGame();
    return;
  }
  gCtx.save();
  gCtx.fillStyle = 'rgba(248,113,113,0.14)';
  gCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  gCtx.restore();
}

/* ═══════════════════════════════════════════════════════════════
   WAVE / DIFFICULTY
   ═══════════════════════════════════════════════════════════════ */
const BASE_PROJ_INT = 3.5;
let tSpawnTimer = 0,
  pSpawnTimer = 0,
  tSpawnInt = 6,
  pInt = BASE_PROJ_INT;

/* ── BOSS ─────────────────────────────────────────────────────── */
let bossActive = false,
  bossSpawnPending = false;

const BOSS_WAVE = 5; // boss every 5 waves

function isBossWave(w) {
  return w > 0 && w % BOSS_WAVE === 0;
}

function spawnBoss() {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  const r = 55 + wave * 2; // big boi
  const hp = 200 + wave * 200;
  const spd = (0.5 + wave * 0.08) * (0.9 + Math.random() * 0.2);
  // Spawn from top center for dramatic entrance
  const x = W / 2 + (Math.random() - 0.5) * 100,
    y = -r;
  const cx = W / 2,
    cy = H / 2;
  const dir = Math.atan2(cy - y, cx - x);
  targets.push({
    x,
    y,
    r,
    hp,
    maxHp: hp,
    speed: spd,
    vx: Math.cos(dir) * spd,
    vy: Math.sin(dir) * spd,
    wanderAngle: 0,
    wanderTimer: 0,
    burning: false,
    burnTimer: 0,
    burnDps: 0,
    poisoned: false,
    poisonTimer: 0,
    frozen: false,
    freezeTimer: 0,
    freezeDmgBonus: 0,
    isBoss: true,
  });
  bossActive = true;
  bossSpawnPending = false;
  // Dramatic announcement
  announceBoss();
}

function announceBoss() {
  const el = document.getElementById('waveAnnounce');
  el.textContent = '⚠ BOSS ⚠';
  el.style.color = '#f97316';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'waveIn 3s ease forwards';
  sndWave();
}

function onBossDeath() {
  bossActive = false;
  // Full heal on boss kill
  hp = 100;
  // Big score bonus
  score += Math.floor(500 * wave);
  flash('💀 BOSS VAINCU ! +' + Math.floor(500 * wave), '#f97316');
  // Spawn a bunch of drops
  for (let i = 0; i < 5; i++)
    drops.push({
      x: gameCanvas.width / 2 + (Math.random() - 0.5) * 200,
      y: gameCanvas.height / 2 + (Math.random() - 0.5) * 200,
      r: 10,
      life: 12,
      maxLife: 12,
      collected: false,
    });
  sndLevelUp();
}
function updateWave(dt) {
  // Freeze wave timer while boss is alive
  if (!bossActive) {
    waveTimer += dt;
    if (waveTimer >= 35) {
      waveTimer = 0;
      wave++;
      tSpawnInt = Math.max(2, 6 - wave * 0.4);
      pInt = Math.max(1, BASE_PROJ_INT - wave * 0.15);
      document.getElementById('waveBadge').textContent = t('wave') + ' ' + wave;
      if (wave > MAX_WAVE) {
        // Victory after wave 20 (boss 4 killed)
        victoryGame();
        return;
      }
      if (isBossWave(wave)) {
        // Boss wave: clear all regular targets and spawn boss
        targets.length = 0;
        projectiles.length = 0;
        bossSpawnPending = true;
        setTimeout(spawnBoss, 1500); // slight delay for drama
        announceWave(); // shows WAVE X first, then boss announcement
        return;
      }
      announceWave();
    }
  }
  // Regular target spawning — suppressed during boss wave
  if (!bossActive) {
    tSpawnTimer -= dt;
    if (tSpawnTimer <= 0) {
      tSpawnTimer = tSpawnInt;
      if (targets.length < 3 + wave) spawnTarget();
    }
  }
  // Projectiles always spawn (boss also fires extra)
  pSpawnTimer -= dt;
  if (pSpawnTimer <= 0) {
    pSpawnTimer = Math.max(0.8, pInt / Math.max(1, targets.length * 0.4));
    spawnProjectile();
  }
  // During boss wave: spawn projectiles more aggressively
  if (bossActive) {
    pSpawnTimer -= dt;
    if (pSpawnTimer <= 0) {
      pSpawnTimer = Math.max(
        0.4,
        (pInt * 0.4) / Math.max(1, targets.length * 0.3),
      );
      spawnProjectile();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════ */
function drawBg() {
  const W = gameCanvas.width,
    H = gameCanvas.height;
  if (bgMode === 'camera') {
    gCtx.save();
    gCtx.translate(W, 0);
    gCtx.scale(-1, 1);
    gCtx.drawImage(video, 0, 0, W, H);
    gCtx.restore();
    gCtx.fillStyle = 'rgba(6,8,16,0.55)';
    gCtx.fillRect(0, 0, W, H);
  } else {
    gCtx.fillStyle = '#060810';
    gCtx.fillRect(0, 0, W, H);
    gCtx.strokeStyle = 'rgba(255,255,255,0.025)';
    gCtx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 60) {
      gCtx.beginPath();
      gCtx.moveTo(x, 0);
      gCtx.lineTo(x, H);
      gCtx.stroke();
    }
    for (let y = 0; y < H; y += 60) {
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(W, y);
      gCtx.stroke();
    }
  }
}
function drawTargets() {
  for (const tgt of targets) {
    const ratio = tgt.hp / tgt.maxHp;
    // Boss gets special colors — pulsing red/gold
    let col,
      icon = null;
    if (tgt.isBoss) {
      const pulse = 0.5 + Math.sin(Date.now() / 200) * 0.5;
      col = `rgb(255,${Math.round(80 + pulse * 60)},0)`;
    } else if (tgt.specialType === 'bomb') {
      const t2 = tgt.bombTimer || 0,
        urgency =
          t2 < 3 ? 0.5 + Math.sin(Date.now() / (100 + t2 * 30)) * 0.5 : 0;
      col = tgt.frozen
        ? '#7dd3fc'
        : `rgb(255,${Math.round(80 - urgency * 80)},0)`;
      icon = '💣';
    } else if (tgt.specialType === 'healer') {
      col = tgt.frozen ? '#7dd3fc' : '#4ade80';
      icon = '💚';
    } else if (tgt.specialType === 'accelerator') {
      const pulse = 0.5 + Math.sin(Date.now() / 150) * 0.5;
      col = tgt.frozen
        ? '#7dd3fc'
        : `rgb(${Math.round(56 + pulse * 100)},${Math.round(189 + pulse * 40)},248)`;
      icon = '⚡';
    } else if (tgt.specialType === 'blocker') {
      col = tgt.frozen ? '#7dd3fc' : '#c084fc';
      icon = '🔒';
    } else {
      col = tgt.frozen
        ? '#7dd3fc'
        : tgt.burning
          ? '#ff6b2b'
          : tgt.poisoned
            ? '#a855f7'
            : '#e879f9';
    }
    gCtx.save();
    gCtx.shadowBlur = tgt.isBoss ? 40 : 16;
    gCtx.shadowColor = col;
    gCtx.beginPath();
    gCtx.arc(tgt.x, tgt.y, tgt.r, 0, Math.PI * 2);
    if (tgt.isBoss) {
      // Boss: pulsing fill + double ring
      const pulse = 0.5 + Math.sin(Date.now() / 200) * 0.5;
      gCtx.fillStyle = `rgba(255,${Math.round(60 + pulse * 40)},0,0.2)`;
      gCtx.fill();
      gCtx.strokeStyle = col;
      gCtx.lineWidth = 3;
      gCtx.stroke();
      // Outer ring
      gCtx.beginPath();
      gCtx.arc(tgt.x, tgt.y, tgt.r + 6 + pulse * 4, 0, Math.PI * 2);
      gCtx.strokeStyle = `rgba(255,200,0,${0.3 + pulse * 0.3})`;
      gCtx.lineWidth = 1.5;
      gCtx.stroke();
      // ☠ skull icon
      gCtx.globalAlpha = 0.9;
      gCtx.shadowBlur = 0;
      gCtx.font = `bold ${Math.round(tgt.r * 0.7)}px serif`;
      gCtx.textAlign = 'center';
      gCtx.textBaseline = 'middle';
      gCtx.fillStyle = '#fff';
      gCtx.fillText('☠', tgt.x, tgt.y);
    } else {
      gCtx.fillStyle = `rgba(${tgt.frozen ? '125,211,252' : tgt.burning ? '255,107,43' : tgt.poisoned ? '168,85,247' : '232,121,249'},0.15)`;
      gCtx.fill();
      gCtx.strokeStyle = col;
      gCtx.lineWidth = 1.5;
      gCtx.stroke();
    }
    gCtx.restore();
    // HP bar — wider for boss
    const bw = tgt.r * 2,
      bx = tgt.x - tgt.r,
      by = tgt.y - tgt.r - (tgt.isBoss ? 18 : 10);
    gCtx.fillStyle = 'rgba(0,0,0,0.5)';
    gCtx.beginPath();
    gCtx.roundRect(bx, by, bw, tgt.isBoss ? 6 : 4, 2);
    gCtx.fill();
    gCtx.fillStyle =
      ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#facc15' : '#f87171';
    gCtx.beginPath();
    gCtx.roundRect(bx, by, bw * ratio, tgt.isBoss ? 6 : 4, 2);
    gCtx.fill();
    if (tgt.isBoss) {
      // BOSS label above HP bar
      gCtx.font = 'bold 11px Orbitron,sans-serif';
      gCtx.textAlign = 'center';
      gCtx.textBaseline = 'bottom';
      gCtx.fillStyle = '#f97316';
      gCtx.shadowBlur = 8;
      gCtx.shadowColor = '#f97316';
      gCtx.fillText('BOSS', tgt.x, by - 2);
      gCtx.shadowBlur = 0;
    }
    if (!tgt.isBoss) {
      // Icon for special enemies
      if (icon) {
        gCtx.save();
        gCtx.globalAlpha = 1;
        gCtx.shadowBlur = 0;
        gCtx.font = `${Math.round(tgt.r * 0.75)}px serif`;
        gCtx.textAlign = 'center';
        gCtx.textBaseline = 'middle';
        gCtx.fillStyle = '#fff';
        gCtx.fillText(icon, tgt.x, tgt.y);
        gCtx.restore();
      }
      // Bomb countdown timer
      if (tgt.specialType === 'bomb' && tgt.bombArmed) {
        gCtx.save();
        gCtx.font = 'bold 10px Orbitron,sans-serif';
        gCtx.textAlign = 'center';
        gCtx.textBaseline = 'top';
        gCtx.fillStyle = '#fff';
        gCtx.fillText(Math.ceil(tgt.bombTimer) + 's', tgt.x, tgt.y + tgt.r + 2);
        gCtx.restore();
      }
      // Healer radius ring (subtle)
      if (tgt.specialType === 'healer') {
        gCtx.save();
        gCtx.globalAlpha = 0.08;
        gCtx.beginPath();
        gCtx.arc(tgt.x, tgt.y, 400, 0, Math.PI * 2);
        gCtx.strokeStyle = '#4ade80';
        gCtx.lineWidth = 1;
        gCtx.setLineDash([6, 6]);
        gCtx.stroke();
        gCtx.setLineDash([]);
        gCtx.restore();
      }
      // Cross/snowflake pattern (skip for specials — icon is enough)
      if (!tgt.specialType) {
        gCtx.lineWidth = 1;
        gCtx.globalAlpha = 0.55;
        gCtx.beginPath();
        if (tgt.frozen) {
          for (let _a = 0; _a < 6; _a++) {
            const _ang = (_a * Math.PI) / 3;
            gCtx.moveTo(tgt.x, tgt.y);
            gCtx.lineTo(
              tgt.x + Math.cos(_ang) * tgt.r * 0.52,
              tgt.y + Math.sin(_ang) * tgt.r * 0.52,
            );
          }
        } else {
          gCtx.moveTo(tgt.x - tgt.r * 0.4, tgt.y);
          gCtx.lineTo(tgt.x + tgt.r * 0.4, tgt.y);
          gCtx.moveTo(tgt.x, tgt.y - tgt.r * 0.4);
          gCtx.lineTo(tgt.x, tgt.y + tgt.r * 0.4);
        }
        gCtx.strokeStyle = col;
        gCtx.stroke();
        gCtx.globalAlpha = 1;
      }
    }
  }
}
function drawProjectiles() {
  for (const p of projectiles) {
    const col = projColor(p);
    const pulse = 0.7 + Math.sin(p.age * 6) * 0.3;
    gCtx.save();
    gCtx.shadowBlur = (p.isBossProj ? 28 : 14) * pulse;
    gCtx.shadowColor = col;
    gCtx.beginPath();
    gCtx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
    gCtx.fillStyle = col;
    gCtx.fill();
    gCtx.globalAlpha = 0.3;
    gCtx.beginPath();
    gCtx.arc(p.x - p.vx * 4, p.y - p.vy * 4, p.r * 0.6, 0, Math.PI * 2);
    gCtx.fill();
    gCtx.restore();
  }
}
function drawDrops() {
  const pulse = 0.8 + Math.sin(Date.now() / 300) * 0.2;
  for (const d of drops) {
    gCtx.save();
    gCtx.shadowBlur = 18 * pulse;
    gCtx.shadowColor = '#4ade80';
    gCtx.beginPath();
    gCtx.arc(d.x, d.y, d.r * pulse, 0, Math.PI * 2);
    gCtx.fillStyle = 'rgba(74,222,128,0.25)';
    gCtx.fill();
    gCtx.strokeStyle = '#4ade80';
    gCtx.lineWidth = 1.5;
    gCtx.stroke();
    gCtx.lineWidth = 2;
    gCtx.beginPath();
    gCtx.moveTo(d.x - 5, d.y);
    gCtx.lineTo(d.x + 5, d.y);
    gCtx.moveTo(d.x, d.y - 5);
    gCtx.lineTo(d.x, d.y + 5);
    gCtx.stroke();
    gCtx.restore();
  }
}
function drawPoisonTrail() {
  for (const pt of poisonTrail) {
    gCtx.save();
    gCtx.globalAlpha = (pt.life / pt.maxLife) * 0.5;
    gCtx.shadowBlur = 20;
    gCtx.shadowColor = '#a855f7';
    gCtx.beginPath();
    gCtx.arc(pt.x, pt.y, 22, 0, Math.PI * 2);
    gCtx.fillStyle = 'rgba(168,85,247,0.35)';
    gCtx.fill();
    gCtx.restore();
  }
}
function drawDmgNumbers() {
  for (const n of dmgNumbers) {
    const alpha = n.life / n.maxLife;
    gCtx.save();
    gCtx.globalAlpha = alpha;
    gCtx.shadowBlur = 6;
    gCtx.shadowColor = n.color;
    gCtx.fillStyle = n.color;
    gCtx.font = `bold ${n.size}px Orbitron,sans-serif`;
    gCtx.textAlign = 'center';
    gCtx.textBaseline = 'middle';
    gCtx.fillText(n.text, n.x, n.y);
    gCtx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    gCtx.save();
    gCtx.globalAlpha = p.life / p.maxLife;
    gCtx.shadowBlur = 8;
    gCtx.shadowColor = p.color;
    gCtx.beginPath();
    gCtx.arc(p.x, p.y, p.r * (p.life / p.maxLife), 0, Math.PI * 2);
    gCtx.fillStyle = p.color;
    gCtx.fill();
    gCtx.restore();
  }
}
function drawSpellFX() {
  for (const fx of spellFX) {
    const alpha = fx.life / fx.maxLife;
    if (fx.type === 'shield') {
      gCtx.save();
      gCtx.globalAlpha = alpha * 0.7;
      gCtx.shadowBlur = 30;
      gCtx.shadowColor = '#38bdf8';
      gCtx.beginPath();
      gCtx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
      gCtx.strokeStyle = '#38bdf8';
      gCtx.lineWidth = 3;
      gCtx.stroke();
      gCtx.globalAlpha = alpha * 0.1;
      gCtx.fillStyle = '#38bdf8';
      gCtx.fill();
      gCtx.restore();
    }
    if (fx.type === 'fire') {
      gCtx.save();
      gCtx.globalAlpha = alpha;
      const g = gCtx.createLinearGradient(fx.x, fx.y, fx.tx, fx.ty);
      g.addColorStop(0, '#ffe066');
      g.addColorStop(0.4, '#ff6b2b');
      g.addColorStop(1, 'rgba(255,107,43,0)');
      gCtx.shadowBlur = 24;
      gCtx.shadowColor = '#ff6b2b';
      gCtx.beginPath();
      gCtx.moveTo(fx.x, fx.y);
      gCtx.lineTo(fx.tx, fx.ty);
      gCtx.strokeStyle = g;
      gCtx.lineWidth = 4;
      gCtx.stroke();
      gCtx.restore();
    }
    if (fx.type === 'fire_miss') {
      gCtx.save();
      gCtx.globalAlpha = alpha;
      gCtx.shadowBlur = 20;
      gCtx.shadowColor = '#ff6b2b';
      gCtx.beginPath();
      gCtx.arc(fx.x, fx.y, 12 * (1 - alpha), 0, Math.PI * 2);
      gCtx.strokeStyle = '#ff6b2b';
      gCtx.lineWidth = 2;
      gCtx.stroke();
      gCtx.restore();
    }
    if (fx.type === 'fire_range') {
      // Expanding ring showing the fire radius
      const expand = 1 - fx.life / fx.maxLife; // 0→1 as it fades
      gCtx.save();
      gCtx.globalAlpha = alpha * 0.55;
      gCtx.shadowBlur = 20;
      gCtx.shadowColor = '#ff6b2b';
      gCtx.beginPath();
      gCtx.arc(fx.x, fx.y, fx.r * (0.85 + expand * 0.15), 0, Math.PI * 2);
      gCtx.strokeStyle = '#ffe066';
      gCtx.lineWidth = 2;
      gCtx.stroke();
      // Dashed inner fill hint
      gCtx.globalAlpha = alpha * 0.06;
      gCtx.fillStyle = '#ff6b2b';
      gCtx.fill();
      gCtx.restore();
    }
    if (fx.type === 'freeze') {
      gCtx.save();
      gCtx.globalAlpha = alpha * 0.8;
      gCtx.shadowBlur = 40;
      gCtx.shadowColor = '#a5f3fc';
      gCtx.beginPath();
      gCtx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
      gCtx.strokeStyle = '#a5f3fc';
      gCtx.lineWidth = 3;
      gCtx.stroke();
      gCtx.globalAlpha = alpha * 0.12;
      gCtx.fillStyle = '#a5f3fc';
      gCtx.fill();
      gCtx.globalAlpha = alpha * 0.4;
      gCtx.shadowBlur = 20;
      gCtx.beginPath();
      gCtx.arc(fx.x, fx.y, fx.r * 0.7, 0, Math.PI * 2);
      gCtx.strokeStyle = '#e0f2fe';
      gCtx.lineWidth = 1.5;
      gCtx.stroke();
      gCtx.restore();
    }
    if (fx.type === 'lightning' && fx.segments.length > 1) {
      gCtx.save();
      gCtx.globalAlpha = alpha;
      gCtx.shadowBlur = 20;
      gCtx.shadowColor = '#ffe066';
      gCtx.beginPath();
      gCtx.moveTo(fx.segments[0].x, fx.segments[0].y);
      for (let s = 1; s < fx.segments.length; s++)
        gCtx.lineTo(fx.segments[s].x, fx.segments[s].y);
      gCtx.strokeStyle = '#ffe066';
      gCtx.lineWidth = 2;
      gCtx.stroke();
      gCtx.strokeStyle = 'rgba(167,139,250,0.5)';
      gCtx.lineWidth = 1;
      gCtx.stroke();
      gCtx.restore();
    }
  }
}
function drawHands() {
  hCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  if (!handLandmarks) return;
  const lm = handLandmarks;
  const pts = lm.map((p) => ({
    x: (1 - p.x) * handCanvas.width,
    y: p.y * handCanvas.height,
  }));
  let cc, dc, gc, tc;
  if (poisonActive) {
    cc = '#c084fc';
    dc = '#a855f7';
    gc = '#9333ea';
    tc = '#c084fc';
  } else if (currentGesture === 'POINTING') {
    cc = '#38bdf8';
    dc = '#7dd3fc';
    gc = '#38bdf8';
    tc = '#ffffff';
  } else if (currentGesture === 'OPEN_HAND') {
    cc = '#fde68a';
    dc = '#fbbf24';
    gc = '#f59e0b';
    tc = '#fbbf24';
  } else {
    cc = 'rgba(148,163,184,0.7)';
    dc = 'rgba(203,213,225,0.8)';
    gc = 'rgba(148,163,184,0.3)';
    tc = '#cbd5e1';
  }
  hCtx.save();
  [
    [0, 5],
    [0, 9],
    [0, 13],
    [0, 17],
    [5, 9],
    [9, 13],
    [13, 17],
  ].forEach(([a, b]) => {
    hCtx.globalAlpha = 0.4;
    hCtx.lineWidth = 1.5;
    hCtx.strokeStyle = cc;
    hCtx.shadowBlur = 6;
    hCtx.shadowColor = gc;
    hCtx.beginPath();
    hCtx.moveTo(pts[a].x, pts[a].y);
    hCtx.lineTo(pts[b].x, pts[b].y);
    hCtx.stroke();
  });
  [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20],
  ].forEach((f) => {
    for (let s = 1; s < f.length; s++) {
      hCtx.globalAlpha = 1;
      hCtx.lineWidth = [3.5, 2.8, 2.2, 1.6][s - 1] ?? 1.6;
      hCtx.shadowBlur = 12;
      hCtx.shadowColor = gc;
      hCtx.strokeStyle = cc;
      hCtx.lineCap = 'round';
      hCtx.beginPath();
      hCtx.moveTo(pts[f[s - 1]].x, pts[f[s - 1]].y);
      hCtx.lineTo(pts[f[s]].x, pts[f[s]].y);
      hCtx.stroke();
    }
  });
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      isTip = [4, 8, 12, 16, 20].includes(i),
      isK = [1, 2, 5, 9, 13, 17].includes(i);
    const r = isTip ? 6 : i === 0 ? 5 : isK ? 4 : 3;
    if (isTip) {
      hCtx.save();
      hCtx.beginPath();
      hCtx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      hCtx.strokeStyle = cc;
      hCtx.globalAlpha = 0.25;
      hCtx.lineWidth = 1;
      hCtx.shadowBlur = 0;
      hCtx.stroke();
      hCtx.restore();
    }
    hCtx.beginPath();
    hCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    hCtx.shadowBlur = isTip ? 16 : 8;
    hCtx.shadowColor = gc;
    hCtx.fillStyle = isTip ? tc : dc;
    hCtx.fill();
    if (isK || i === 0) {
      hCtx.beginPath();
      hCtx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
      hCtx.fillStyle = 'rgba(6,8,16,0.6)';
      hCtx.shadowBlur = 0;
      hCtx.fill();
    }
  }
  if (!poisonActive && currentGesture === 'POINTING') {
    const tip = pts[8],
      pulse = 0.6 + Math.sin(Date.now() / 180) * 0.4;
    hCtx.save();
    hCtx.shadowBlur = 28 * pulse;
    hCtx.shadowColor = '#38bdf8';
    hCtx.beginPath();
    hCtx.arc(tip.x, tip.y, 12 * pulse, 0, Math.PI * 2);
    hCtx.strokeStyle = '#38bdf8';
    hCtx.lineWidth = 1.5;
    hCtx.globalAlpha = pulse * 0.8;
    hCtx.stroke();
    hCtx.beginPath();
    hCtx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
    hCtx.fillStyle = '#fff';
    hCtx.globalAlpha = 1;
    hCtx.shadowBlur = 10;
    hCtx.fill();
    hCtx.restore();
  }
  if (!poisonActive && currentGesture === 'OPEN_HAND' && palmCenter) {
    const pc = n2c(palmCenter.x, palmCenter.y),
      phase = (Date.now() % 1400) / 1400;
    hCtx.save();
    hCtx.globalAlpha = 0.2 + Math.sin(phase * Math.PI * 2) * 0.12;
    hCtx.beginPath();
    hCtx.arc(pc.x, pc.y, palmRadius * 1.6, 0, Math.PI * 2);
    hCtx.strokeStyle = '#fbbf24';
    hCtx.lineWidth = 2;
    hCtx.shadowBlur = 24;
    hCtx.shadowColor = '#f59e0b';
    hCtx.stroke();
    hCtx.globalAlpha = 0.05;
    hCtx.fillStyle = '#fbbf24';
    hCtx.fill();
    hCtx.restore();
  }
  if (poisonActive && handLandmarks) {
    const wrist = pts[0];
    for (let w = 0; w < 3; w++) {
      const angle = Date.now() / 400 + w * 2.1,
        wr = 20 + w * 8;
      hCtx.save();
      hCtx.beginPath();
      hCtx.arc(
        wrist.x + Math.cos(angle) * wr,
        wrist.y + Math.sin(angle) * wr,
        3,
        0,
        Math.PI * 2,
      );
      hCtx.fillStyle = '#c084fc';
      hCtx.globalAlpha = 0.5 - w * 0.12;
      hCtx.shadowBlur = 14;
      hCtx.shadowColor = '#9333ea';
      hCtx.fill();
      hCtx.restore();
    }
  }
  hCtx.restore();
}

/* ═══════════════════════════════════════════════════════════════
   GAME LOOP
   ═══════════════════════════════════════════════════════════════ */
let lastTime = 0;
function gameLoop(ts) {
  if (gameState !== STATE.PLAYING) return;
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  gameTime = (Date.now() - startTime) / 1000;
  updateWave(dt);
  updateTargets(dt);
  updateBlockedSpells();
  updateProjectiles(dt);
  updateDrops(dt);
  updateParticles(dt);
  updateDmgNumbers(dt);
  updatePoisonTrail(dt);
  updateSpellFX(dt);
  if (hp <= 0) {
    endGame();
    return;
  }
  drawBg();
  drawPoisonTrail();
  drawDrops();
  drawTargets();
  drawProjectiles();
  drawParticles();
  drawSpellFX();
  drawDmgNumbers();
  drawHands();
  updateHUD();
  raf = requestAnimationFrame(gameLoop);
}
function updateHUD() {
  document.getElementById('hpNumber').textContent = Math.ceil(hp) + ' / 100';
  const bar = document.getElementById('hpBar');
  bar.style.width = hp + '%';
  bar.style.background =
    hp > 50 ? 'var(--hp-full)' : hp > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  document.getElementById('hudScore').textContent = score.toLocaleString();
  const secs = Math.floor(gameTime);
  document.getElementById('hudTimer').textContent =
    Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  const cv = document.getElementById('levelVal');
  cv.textContent = 'LVL ' + level;
  cv.className =
    'level-value' +
    (level >= 4 ? ' x4' : level >= 3 ? ' x3' : level >= 2 ? ' x2' : '');
  const prog = document.getElementById('levelProgress');
  if (prog) prog.style.width = (levelKills / killsToLevel(level)) * 100 + '%';
  for (const s of ['shield', 'fire', 'lightning', 'poison', 'heal', 'freeze']) {
    const left = cdLeft(s),
      el = document.getElementById('cd-' + s),
      slot = document.getElementById('slot-' + s);
    const blocked = isBlocked(s);
    if (blocked) {
      const bleft = Math.ceil((blockedSpells[s] - Date.now()) / 1000);
      el.textContent = '🔒' + bleft;
      el.classList.remove('done');
      slot.classList.remove('ready');
      slot.classList.add('blocked');
    } else if (left > 0) {
      el.textContent = Math.ceil(left / 1000);
      el.classList.remove('done');
      slot.classList.remove('ready');
      slot.classList.remove('blocked');
    } else {
      el.classList.add('done');
      slot.classList.add('ready');
      slot.classList.remove('blocked');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   SPEECH
   ═══════════════════════════════════════════════════════════════ */
function updateMicUI() {
  const dot = document.getElementById('micDot'),
    badge = document.getElementById('micStatusBadge');
  dot.className = 'mic-dot';
  badge.style.display = 'none';
  if (speechStatus === 'running' || speechStatus === 'requesting')
    dot.classList.add('listening');
  else if (speechStatus === 'denied') {
    dot.style.background = '#f87171';
    badge.textContent = '🎤 Mic blocked — check browser permissions';
    badge.style.display = 'block';
  } else if (speechStatus === 'unsupported') {
    dot.style.background = '#f59e0b';
    badge.textContent = '⚠️ Voice not supported — use Chrome or Edge';
    badge.style.display = 'block';
  }
}
async function requestMicPermission() {
  speechStatus = 'requesting';
  updateMicUI();
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    speechStatus = 'granted';
    updateMicUI();
    return true;
  } catch (e) {
    console.warn('Mic denied:', e);
    speechStatus = 'denied';
    updateMicUI();
    return false;
  }
}
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speechStatus = 'unsupported';
    updateMicUI();
    return false;
  }
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {}
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = currentLang === 'fr' ? 'fr-FR' : 'en-US';
  recognition.maxAlternatives = 3;
  const scd = {};
  recognition.onstart = () => {
    speechStatus = 'running';
    updateMicUI();
  };
  recognition.onresult = (e) => {
    document.getElementById('micDot').classList.add('active');
    for (let i = e.resultIndex; i < e.results.length; i++) {
      // Only act on final results for pause/resume — avoids double-trigger from interim
      const isFinal = e.results[i].isFinal;
      for (let a = 0; a < e.results[i].length; a++) {
        const norm = (s) =>
          s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        const tx = norm(e.results[i][a].transcript.trim());
        const spellEntries = [];
        for (const [k, words] of Object.entries(LANG[currentLang].spells))
          for (const w of words) spellEntries.push({ k, w: norm(w) });
        // Pause/resume — final results only + debounce 2s
        if (isFinal) {
          const pauseTriggers =
            currentLang === 'fr'
              ? ['pause', 'stop', 'reprendre']
              : ['pause', 'stop', 'resume'];
          const now = Date.now();
          if (
            (tx.includes(pauseTriggers[0]) || tx.includes(pauseTriggers[1])) &&
            gameState === STATE.PLAYING &&
            now - (scd['_pause'] || 0) > 2000
          ) {
            scd['_pause'] = now;
            pauseGame();
            break;
          }
          if (
            tx.includes(pauseTriggers[2]) &&
            gameState === STATE.PAUSED &&
            now - (scd['_pause'] || 0) > 2000
          ) {
            scd['_pause'] = now;
            resumeGame();
            break;
          }
          // "pause" also resumes if already paused (toggle)
          if (
            (tx.includes('pause') || tx.includes('stop')) &&
            gameState === STATE.PAUSED &&
            now - (scd['_pause'] || 0) > 2000
          ) {
            scd['_pause'] = now;
            resumeGame();
            break;
          }
        }
        if (gameState !== STATE.PLAYING) continue;
        spellEntries.sort((a, b) => b.w.length - a.w.length);
        for (const { k, w } of spellEntries) {
          if (tx.includes(w)) {
            const now = Date.now();
            if (now - (scd[k] || 0) < 1500) continue;
            scd[k] = now;
            executeSpell(k);
            break;
          }
        }
      }
    }
    setTimeout(
      () => document.getElementById('micDot').classList.remove('active'),
      500,
    );
  };
  recognition.onend = () => {
    if (speechRunning)
      setTimeout(() => {
        try {
          recognition.start();
        } catch (e) {}
      }, 300);
    else {
      speechStatus = 'granted';
      updateMicUI();
    }
  };
  recognition.onerror = (e) => {
    console.warn('Speech:', e.error);
    if (
      ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)
    ) {
      speechStatus = 'denied';
      speechRunning = false;
      updateMicUI();
    }
  };
  return true;
}
async function startSpeech() {
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    speechStatus = 'unsupported';
    updateMicUI();
    return;
  }
  if (!(await requestMicPermission())) return;
  if (!recognition && !initSpeech()) return;
  else if (recognition)
    recognition.lang = currentLang === 'fr' ? 'fr-FR' : 'en-US';
  speechRunning = true;
  try {
    recognition.start();
  } catch (e) {
    if (e.name !== 'InvalidStateError') {
      speechStatus = 'denied';
      updateMicUI();
    }
  }
}
function stopSpeech() {
  speechRunning = false;
  if (!recognition) return;
  try {
    recognition.stop();
  } catch (e) {}
  speechStatus = 'idle';
  updateMicUI();
}
function executeSpell(k) {
  if (gameState !== STATE.PLAYING) return;
  if (k === 'shield') castShield();
  else if (k === 'fire') castFire();
  else if (k === 'lightning') castLightning();
  else if (k === 'poison') castPoison();
  else if (k === 'heal') castHeal();
  else if (k === 'freeze') castFreeze();
}

/* ═══════════════════════════════════════════════════════════════
   MEDIAPIPE
   ═══════════════════════════════════════════════════════════════ */
let mpCamera = null,
  mpHands = null;
function initMediaPipe() {
  mpHands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  mpHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence: 0.55,
  });
  mpHands.onResults(onHandResults);
  mpCamera = new Camera(video, {
    onFrame: async () => {
      await mpHands.send({ image: video });
    },
    width: 640,
    height: 480,
  });
  mpCamera.start();
}
function onHandResults(results) {
  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    handLandmarks = null;
    currentGesture = smoothGesture('NONE');
    indexTip = null;
    indexDir = null;
    palmCenter = null;
    updateGestureBadge();
    if (gameState === STATE.PLAYING) {
      _handLostTimer += 1 / 30; // MediaPipe runs ~30fps — increment by one frame
      if (_handLostTimer >= HAND_LOST_DELAY) showHandLost();
    }
    return;
  }
  const lm = results.multiHandLandmarks[0];
  handLandmarks = lm;
  _handLostTimer = 0;
  if (gameState === STATE.PLAYING && handLost) hideHandLost();
  const W = gameCanvas.width,
    H = gameCanvas.height;
  const tip8x = (1 - lm[8].x) * W,
    tip8y = lm[8].y * H,
    dip7x = (1 - lm[7].x) * W,
    dip7y = lm[7].y * H;
  const cdx = tip8x - dip7x,
    cdy = tip8y - dip7y,
    dl = Math.hypot(cdx, cdy);
  indexDir = dl > 1e-6 ? { x: cdx / dl, y: cdy / dl } : null;
  indexTip = { x: lm[8].x, y: lm[8].y };
  const pc = palmCtr(lm);
  palmCenter = pc;
  palmRadius = palmSz(lm) * gameCanvas.width * 1.4;
  detectSweep(pc);
  currentGesture = smoothGesture(detectGesture(lm));
  updateGestureBadge();
}
function updateGestureBadge() {
  if (gameState !== STATE.PLAYING) return;
  const b = document.getElementById('gestureBadge');
  if (poisonActive) {
    b.textContent = '☠️ POISON ACTIVE';
    b.style.color = '#a855f7';
  } else if (currentGesture === 'POINTING') {
    b.textContent = t('gesture_pointing');
    b.style.color = '#38bdf8';
  } else if (currentGesture === 'OPEN_HAND') {
    b.textContent = t('gesture_open');
    b.style.color = '#fbbf24';
  } else {
    b.textContent = '—';
    b.style.color = '';
  }
}

/* ═══════════════════════════════════════════════════════════════
   LIFECYCLE
   ═══════════════════════════════════════════════════════════════ */
function startGame() {
  hp = 100;
  score = 0;
  kills = 0;
  gameTime = 0;
  startTime = Date.now();
  wave = 1;
  waveTimer = 0;
  level = 1;
  levelKills = 0;
  bossActive = false;
  bossSpawnPending = false;
  blockedSpells = {};
  handLost = false;
  _handLostTimer = 0;
  document.getElementById('hand-lost-overlay').style.display = 'none';
  targets = [];
  projectiles = [];
  drops = [];
  particles = [];
  spellFX = [];
  poisonTrail = [];
  dmgNumbers = [];
  stopPoison();
  for (const k of Object.keys(cdTimer)) cdTimer[k] = 0;
  tSpawnTimer = 2;
  pSpawnTimer = 3;
  tSpawnInt = 6;
  pInt = BASE_PROJ_INT;
  handLandmarks = null;
  currentGesture = 'NONE';
  indexTip = null;
  indexDir = null;
  palmCenter = null;
  _pGesture = 'NONE';
  _pFrames = 0;
  _sGesture = 'NONE';
  _lost = 0;
  _sweepHist.length = 0;
  showScreen(null);
  ['hud', 'waveBadge', 'gestureBadge', 'spellsBar', 'hpWrap'].forEach((id) =>
    document.getElementById(id).classList.remove('hidden'),
  );
  document.getElementById('waveBadge').textContent = t('wave') + ' 1';
  updateSpellNames();
  gameState = STATE.PLAYING;
  if (!mpHands) initMediaPipe();
  startSpeech();
  startMusic();
  lastTime = performance.now();
  raf = requestAnimationFrame(gameLoop);
  for (let i = 0; i < 3; i++) setTimeout(spawnTarget, i * 600);
  announceWave(true);
}
function victoryGame() {
  gameState = STATE.GAMEOVER; // reuse gameover screen
  cancelAnimationFrame(raf);
  stopSpeech();
  stopPoison();
  stopMusic();
  ['hud', 'spellsBar', 'gestureBadge', 'waveBadge', 'hpWrap'].forEach((id) =>
    document.getElementById(id).classList.add('hidden'),
  );
  const isRec = score > bestScore;
  if (isRec) {
    bestScore = score;
    localStorage.setItem('spellstorm_best', bestScore);
  }
  const secs = Math.floor(gameTime);
  document.getElementById('go-title').textContent =
    currentLang === 'fr' ? '🏆 VICTOIRE !' : '🏆 VICTORY!';
  document.getElementById('go-title').className = 'go-title new-record';
  document.getElementById('go-record').className = 'go-record-badge show';
  document.getElementById('go-record').textContent =
    currentLang === 'fr' ? '✦ BOSS 4 VAINCU ✦' : '✦ BOSS 4 DEFEATED ✦';
  document.getElementById('go-score').textContent = score.toLocaleString();
  document.getElementById('go-time').textContent =
    Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  document.getElementById('go-kills').textContent = kills;
  document.getElementById('go-level').textContent = 'LVL ' + level;
  document.getElementById('go-best').textContent = bestScore.toLocaleString();
  showScreen('gameover');
}
function endGame() {
  gameState = STATE.GAMEOVER;
  cancelAnimationFrame(raf);
  stopSpeech();
  stopPoison();
  stopMusic();
  ['hud', 'spellsBar', 'gestureBadge', 'waveBadge', 'hpWrap'].forEach((id) =>
    document.getElementById(id).classList.add('hidden'),
  );
  const isRec = score > bestScore;
  if (isRec) {
    bestScore = score;
    localStorage.setItem('spellstorm_best', bestScore);
  }
  const secs = Math.floor(gameTime);
  document.getElementById('go-title').textContent = isRec
    ? t('newrecord')
    : t('gameover');
  document.getElementById('go-title').className =
    'go-title' + (isRec ? ' new-record' : '');
  document.getElementById('go-record').className =
    'go-record-badge' + (isRec ? ' show' : '');
  document.getElementById('go-score').textContent = score.toLocaleString();
  document.getElementById('go-time').textContent =
    Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  document.getElementById('go-kills').textContent = kills;
  document.getElementById('go-level').textContent = 'LVL ' + level;
  document.getElementById('go-best').textContent = bestScore.toLocaleString();
  showScreen('gameover');
}
function restartGame() {
  showScreen(null);
  setTimeout(startGame, 100);
}
function showScreen(name) {
  ['screen-title', 'screen-rules', 'screen-gameover', 'screen-pause'].forEach(
    (id) => document.getElementById(id).classList.add('hidden'),
  );
  if (name)
    document.getElementById('screen-' + name).classList.remove('hidden');
}
function showHandLost() {
  if (handLost) return;
  handLost = true;
  cancelAnimationFrame(raf);
  stopPoison();
  const el = document.getElementById('hand-lost-overlay');
  const msg = document.getElementById('hand-lost-msg');
  const en = currentLang === 'en';
  if (msg) msg.textContent = en ? 'HAND NOT DETECTED' : 'MAIN NON DÉTECTÉE';
  const sub = el.querySelector('div:last-child');
  if (sub)
    sub.textContent = en
      ? 'Place your hand in front of the camera'
      : 'Replacez votre main devant la caméra';
  el.style.display = 'flex';
}
function hideHandLost() {
  if (!handLost) return;
  handLost = false;
  document.getElementById('hand-lost-overlay').style.display = 'none';
  lastTime = performance.now();
  raf = requestAnimationFrame(gameLoop);
}
function showRules() {
  showScreen('rules');
}
function hideRules() {
  showScreen('title');
}

function pauseGame() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.PAUSED;
  cancelAnimationFrame(raf);
  stopPoison();
  document.getElementById('screen-pause').classList.remove('hidden');
}
function resumeGame() {
  if (gameState !== STATE.PAUSED) return;
  gameState = STATE.PLAYING;
  document.getElementById('screen-pause').classList.add('hidden');
  lastTime = performance.now();
  raf = requestAnimationFrame(gameLoop);
}
function quitToMenu() {
  gameState = STATE.TITLE;
  cancelAnimationFrame(raf);
  stopSpeech();
  stopPoison();
  stopMusic();
  document.getElementById('screen-pause').classList.add('hidden');
  ['hud', 'spellsBar', 'gestureBadge', 'waveBadge', 'hpWrap'].forEach((id) =>
    document.getElementById(id).classList.add('hidden'),
  );
  showScreen('title');
}

/* ── Lang ─────────────────────────────────────────────────────── */
function selectLang(lang) {
  currentLang = lang;
  localStorage.setItem('ss_lang', lang);
  document
    .querySelectorAll('.lang-btn')
    .forEach((b) => b.classList.toggle('selected', b.dataset.lang === lang));
  updateRulesText();
}
function updateRulesText() {
  const en = currentLang === 'en';
  document.querySelector('.btn-rules').textContent = en
    ? 'How to play'
    : 'Comment jouer';
  document.querySelector('#screen-title .btn-primary').textContent = en
    ? 'START'
    : 'JOUER';
  const texts = {
    'r-shield-name': en ? 'SHIELD' : 'BOUCLIER',
    'r-fire-name': en ? 'FIRE' : 'BRULURE',
    'r-lightning-name': en ? 'LIGHTNING' : 'ÉCLAIR',
    'r-poison-name': en ? 'POISON' : 'POISON',
    'r-freeze-name': en ? 'FREEZE' : 'GEL',
    'r-shield-desc': en
      ? 'Open hand + say "shield" (or protect/barrier). Destroys projectiles near your palm.'
      : 'Main ouverte + dire "bouclier" (ou protection/barriere). Détruit les projectiles proches.',
    'r-fire-desc': en
      ? 'Point near a target + say "fire". Burns all targets in range. Scales with level.'
      : 'Pointer près d\'une cible + dire "flamme". Brûle les cibles dans le rayon. Scale avec le niveau.',
    'r-lightning-desc': en
      ? 'Point + say "lightning" (or thunder/bolt/zap). Bounces off targets & walls. More bounces with higher level.'
      : 'Pointer + dire "eclair" (ou foudre/tonnerre). Rebondit sur cibles/murs. Plus de rebonds avec le niveau.',
    'r-poison-desc': en
      ? 'Say "poison" (or toxic/venom). Toxic trail wherever your hand moves. Costs HP (reduced by level). Recast or use another spell to stop.'
      : 'Dire "poison" (ou toxique/venin). Traînée toxique partout. Coûte des PV (réduit par niveau). Relancer ou autre sort pour stopper.',
    'r-heal-desc': en
      ? 'Say "heal" (or health/cure/restore) to collect green drops from killed targets.'
      : 'Dire "soin" (ou guerir/sante) pour ramasser les drops verts.',
    'r-freeze-desc': en
      ? 'Open hand + say "freeze" (or ice/frost/cold). Freezes nearby targets 5s — they stop and take +30% damage. Scales with level.'
      : 'Main ouverte + dire "gel" (ou geler/glace/froid). Gèle les cibles proches 5s — +30% dégâts reçus. Scale avec le niveau.',
    'r-level-desc': en
      ? 'Kill enemies to level up. Each level-up fully heals you and powers up your spells.'
      : 'Tuez des ennemis pour monter de niveau. Chaque montée vous soigne à fond et renforce vos sorts.',
    'r-boss-title': en ? '☠️ BOSS' : '☠️ BOSS',
    'r-boss-desc': en
      ? "A boss appears every 5 waves. The next wave won't start until it's dead. Killing it fully heals you and drops bonus loot."
      : "Un boss apparaît toutes les 5 vagues. La vague suivante ne commence pas tant qu'il est vivant. Le tuer vous soigne à fond et fait tomber du butin bonus.",
    'r-proj-desc': en
      ? 'Blue → orange → red. Shield when red, before they vanish.'
      : 'Bleu → orange → rouge. Bouclier quand rouge.',
    'r-warning-desc': en
      ? 'Voice requires Chrome or Edge. Allow camera & microphone.'
      : 'Voix : Chrome ou Edge. Autoriser caméra et micro.',
  };
  for (const [id, txt] of Object.entries(texts)) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
  for (const s of ['shield', 'fire', 'lightning', 'poison', 'freeze']) {
    const el = document.getElementById('r-' + s + '-cmd');
    if (!el) continue;
    const words = LANG[currentLang].spells[s];
    el.textContent = words.map((w) => '"' + w + '"').join('  /  ');
  }
  const healWords = LANG[currentLang].spells['heal'];
  const healEl = document.getElementById('r-heal-title');
  if (healEl)
    healEl.textContent =
      '💚 ' +
      (en ? 'HEAL' : 'SOIN') +
      ' — ' +
      healWords.map((w) => '"' + w + '"').join(' / ');
  document.getElementById('rules-title').textContent = en
    ? 'HOW TO PLAY'
    : 'COMMENT JOUER';
  document.querySelector('#screen-rules .btn-primary').textContent = en
    ? 'GOT IT'
    : 'COMPRIS';
  updateSpellNames();
}
function updateSpellNames() {
  for (const s of ['shield', 'fire', 'lightning', 'poison', 'heal', 'freeze'])
    document.getElementById('sn-' + s).textContent = t(s);
  const en = currentLang === 'en';
  const lbl = {
    'go-l-score': 'Score',
    'go-l-time': en ? 'Time' : 'Durée',
    'go-l-kills': 'Kills',
    'go-l-level': en ? 'Final level' : 'Niveau final',
    'go-l-record': en ? 'Best score' : 'Record',
    'go-btn': en ? 'PLAY AGAIN' : 'REJOUER',
  };
  for (const [id, txt] of Object.entries(lbl)) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
}

/* ── BG selector ──────────────────────────────────────────────── */
function selectBg(mode) {
  bgMode = mode;
  localStorage.setItem('ss_bg', mode); // FIX 2: persist bg choice
  document
    .querySelectorAll('.bg-btn')
    .forEach((b) => b.classList.toggle('selected', b.dataset.bg === mode));
}

/* ── UI helpers ───────────────────────────────────────────────── */
let _vt = null;
function flash(text, color) {
  const el = document.getElementById('voiceFlash');
  el.textContent = text;
  el.style.color = color;
  el.style.background = 'rgba(6,8,16,0.7)';
  el.style.border = '1px solid ' + color;
  el.classList.add('show');
  clearTimeout(_vt);
  _vt = setTimeout(() => el.classList.remove('show'), 1400);
}
function markActive(s) {
  const sl = document.getElementById('slot-' + s);
  sl.classList.add('active');
  setTimeout(() => sl.classList.remove('active'), 400);
}
function showLevelUp() {
  const cv = document.getElementById('levelVal');
  cv.style.transform = 'scale(1.5)';
  setTimeout(() => (cv.style.transform = ''), 400);
  flash(
    '⬆️ LEVEL ' + level + '!',
    level >= 4 ? '#f97316' : level >= 3 ? '#f59e0b' : '#38bdf8',
  );
  sndLevelUp();
}
function announceWave(silent) {
  if (silent) return;
  sndWave();
  const el = document.getElementById('waveAnnounce');
  el.textContent = (t('wave') + ' ' + wave).toUpperCase();
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'waveIn 2s ease forwards';
}

/* ── INIT ─────────────────────────────────────────────────────── */
(function () {
  const savedLang = localStorage.getItem('ss_lang');
  if (savedLang === 'fr' || savedLang === 'en') currentLang = savedLang;
  const savedBg = localStorage.getItem('ss_bg');
  if (savedBg === 'camera' || savedBg === 'virtual') bgMode = savedBg;
})();
showScreen('title');
updateRulesText();
// Escape key toggles pause
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (gameState === STATE.PLAYING) pauseGame();
    else if (gameState === STATE.PAUSED) resumeGame();
  }
});
document
  .querySelectorAll('.lang-btn')
  .forEach((b) =>
    b.classList.toggle('selected', b.dataset.lang === currentLang),
  );
document
  .querySelectorAll('.bg-btn')
  .forEach((b) => b.classList.toggle('selected', b.dataset.bg === bgMode));
handCanvas.style.display = 'block';
