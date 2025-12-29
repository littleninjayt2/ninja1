// =========================
//  ZOMBIE RUNNER (2D) v2.1
//  - Moon in sky
//  - Helicopter flying
//  - Fewer zombies spawning + cap on-screen
//  - Cleaner file (no duplicates / stray calls)
// =========================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ----- Menu UI -----
const menuEl = document.getElementById("menu");
const homeEl = document.getElementById("menuHome");
const howEl = document.getElementById("menuHow");
const creditsEl = document.getElementById("menuCredits");

const nameInput = document.getElementById("nameInput");
const startBtn = document.getElementById("startBtn");
const howBtn = document.getElementById("howBtn");
const creditsBtn = document.getElementById("creditsBtn");
const backFromHow = document.getElementById("backFromHow");
const backFromCredits = document.getElementById("backFromCredits");

const soundToggle = document.getElementById("soundToggle");
const bestScoreEl = document.getElementById("bestScore");

// Platform selection
const platPC = document.getElementById("platPC");
const platMobile = document.getElementById("platMobile");

// Mobile controls
const mobileControls = document.getElementById("mobileControls");
const btnJump = document.getElementById("btnJump");
const btnShoot = document.getElementById("btnShoot");
const btnReload = document.getElementById("btnReload");

let platformMode = "pc"; // "pc" | "mobile"
const touchState = { shootHeld: false, jumpTap: false, reloadTap: false };

// Auto-detect mobile (preselect)
const isProbablyMobile =
  window.matchMedia("(pointer: coarse)").matches ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

if (isProbablyMobile) {
  platMobile.checked = true;
  platPC.checked = false;
}

// ----- Input -----
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

// Canvas click: shoot in PLAY, pick upgrade in UPGRADE (PC only)
canvas.addEventListener("mousedown", (e) => {
  if (platformMode === "pc") {
    if (state === State.PLAY) tryShoot();
    if (state === State.UPGRADE) handleUpgradeClick(e);
  } else {
    // On mobile we use buttons (so canvas tap doesn't shoot)
    if (state === State.UPGRADE) handleUpgradeClick(e);
  }
});

// ----- Helpers -----
function rand(a, b) { return a + Math.random() * (b - a); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
function circleRectHit(c, r) {
  const closestX = clamp(c.x, r.x, r.x + r.w);
  const closestY = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - closestX;
  const dy = c.y - closestY;
  return (dx * dx + dy * dy) <= (c.r * c.r);
}
function wrapText(text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else line = testLine;
  }
  ctx.fillText(line, x, y);
}

// =========================
//  ASSET LOADING (Sprites)
// =========================
function loadImg(src) {
  const img = new Image();
  img.src = src;
  img.loaded = false;
  img.onload = () => img.loaded = true;
  img.onerror = () => img.loaded = false;
  return img;
}
function loadFrames(prefix, count) {
  const frames = [];
  for (let i = 0; i < count; i++) frames.push(loadImg(`${prefix}${i}.png`));
  return frames;
}
function anyLoaded(frames) { return frames.some(f => f && f.loaded); }

// Sprites (optional)
const SPRITES = {
  playerRun: loadFrames("assets/sprites/player_run_", 4),
  playerJump: loadImg("assets/sprites/player_jump.png"),
  dog: loadFrames("assets/sprites/dog_", 2),

  zNormal: loadFrames("assets/sprites/z_normal_", 2),
  zRunner: loadFrames("assets/sprites/z_runner_", 2),
  zTank: loadFrames("assets/sprites/z_tank_", 2),
  zSpitter: loadFrames("assets/sprites/z_spitter_", 2),
  zBoss: loadFrames("assets/sprites/z_boss_", 2),
};

// Background images (optional)
const BG = {
  sky: loadImg("assets/bg/sky.png"),
  far: loadImg("assets/bg/city_far.png"),
  near: loadImg("assets/bg/city_near.png"),
  road: loadImg("assets/bg/road.png"),
};

// =========================
//  AUDIO
// =========================
class AudioManager {
  constructor() { this.enabled = true; this.ctx = null; this.musicOsc = null; this.musicGain = null; this._lfo = null; }
  setEnabled(on) { this.enabled = !!on; if (!this.enabled) this.stopMusic(); if (this.enabled) this.startMusic(); }
  ensure() {
    if (!this.enabled) return false;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return true;
  }
  beep(freq = 440, dur = 0.06, type = "sine", vol = 0.06) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(this.ctx.destination);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur);
  }
  startMusic() {
    if (!this.ensure()) return;
    if (this.musicOsc) return;
    const t0 = this.ctx.currentTime;
    this.musicOsc = this.ctx.createOscillator();
    this.musicGain = this.ctx.createGain();
    this.musicOsc.type = "triangle";
    this.musicOsc.frequency.value = 110;
    this.musicGain.gain.value = 0.02;
    this.musicOsc.connect(this.musicGain);
    this.musicGain.connect(this.ctx.destination);
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = "sine"; lfo.frequency.value = 0.35;
    lfoGain.gain.value = 10;
    lfo.connect(lfoGain); lfoGain.connect(this.musicOsc.frequency);
    this.musicOsc.start(t0); lfo.start(t0);
    this._lfo = lfo;
  }
  stopMusic() {
    if (this.musicOsc) { try { this.musicOsc.stop(); } catch {} this.musicOsc = null; }
    if (this._lfo) { try { this._lfo.stop(); } catch {} this._lfo = null; }
    this.musicGain = null;
  }
}
const audio = new AudioManager();
window.addEventListener("mousedown", () => audio.ensure(), { once: false });

// =========================
//  HIGH SCORE
// =========================
const STORAGE_KEY = "zr_best_v2";
let best = loadBest();
function loadBest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: "—", meters: 0 };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.meters !== "number") return { name: "—", meters: 0 };
    return { name: obj.name || "—", meters: obj.meters };
  } catch {
    return { name: "—", meters: 0 };
  }
}
function saveBest() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(best)); } catch {} }
function updateBestUI() { bestScoreEl.textContent = `Best: ${best.meters.toFixed(0)}m (${best.name})`; }
updateBestUI();

// =========================
//  STATE
// =========================
const State = { MENU: "MENU", CUTSCENE: "CUTSCENE", PLAY: "PLAY", UPGRADE: "UPGRADE", GAMEOVER: "GAMEOVER", WIN: "WIN" };
let state = State.MENU;
let playerName = "Runner";

// =========================
//  GAME SETTINGS
// =========================

// =========================
//  BIOMES (FAST SWITCHING)
// =========================
const BIOMES = [
  { name: "City Night",  skyTop: "#07101b", skyBot: "#111822", tint: "rgba(0,0,0,0)" },
  { name: "Forest",      skyTop: "#02110a", skyBot: "#0b2a17", tint: "rgba(20,60,30,0.12)" },
  { name: "Desert",      skyTop: "#1a0f07", skyBot: "#3a210e", tint: "rgba(120,70,20,0.10)" },
  { name: "Snow",        skyTop: "#0b1220", skyBot: "#21324a", tint: "rgba(220,240,255,0.10)" },
];

let biomeIndex = 0;
let biomeNextIndex = 1;
let biomeBlend = 0;               // 0 -> current biome, 1 -> next biome
let biomeMetersPerChange = 180;   // 🔥 LOWER = faster biome change (try 120, 90, 70)
let biomeBlendSpeed = 1.7;        // 🔥 HIGHER = faster transition (try 2.5 or 3.2)

function stepBiome() {
  biomeIndex = biomeNextIndex;
  biomeNextIndex = (biomeNextIndex + 1) % BIOMES.length;
  biomeBlend = 0;
}



const groundY = 430;
const HOME_DISTANCE = 2200;

// Difficulty (make zombies easier)
const DIFF = {
  zombieHpMult: 0.80,
  zombieSpeedMult: 0.85,
  zombieDamageMult: 0.65,

  // spawn control
  maxZombies: 6,            // hard cap on screen
  maxZombiesDuringBoss: 3,  // extra strict when boss alive
  spawnSlowdown: 1.35       // bigger = slower spawns
};

// Camera (screen shake + recoil)
const camera = { x: 0, y: 0, shake: 0, recoil: 0 };
function addShake(amount) { camera.shake = Math.min(1, camera.shake + amount); }
function addRecoil(amount) { camera.recoil = Math.min(1, camera.recoil + amount); }

// muzzle flash
let muzzleFlashT = 0;

// =========================
//  WEAPONS
// =========================
const WEAPONS = {
  PISTOL:  { name:"Pistol",  magSize:12, fireRate:0.22, bulletSpeed:760, damage:1, pellets:1, spread:0.00, recoil:0.08 },
  SMG:     { name:"SMG",     magSize:24, fireRate:0.08, bulletSpeed:820, damage:1, pellets:1, spread:0.08, recoil:0.05 },
  SHOTGUN: { name:"Shotgun", magSize:6,  fireRate:0.45, bulletSpeed:700, damage:1, pellets:5, spread:0.35, recoil:0.12 },
  RIFLE:   { name:"Rifle",   magSize:18, fireRate:0.14, bulletSpeed:900, damage:2, pellets:1, spread:0.02, recoil:0.09 },
};
const WEAPON_ORDER = ["PISTOL", "SMG", "SHOTGUN", "RIFLE"];
function nextWeaponKey(currentKey) {
  const i = WEAPON_ORDER.indexOf(currentKey);
  return WEAPON_ORDER[Math.min(WEAPON_ORDER.length - 1, i + 1)];
}

// =========================
//  PLAYER
// =========================
const player = {
  x: 140, y: groundY - 60,
  w: 40, h: 60,
  vy: 0,
  onGround: true,

  hp: 100,
  hpMax: 100,

  weaponKey: "PISTOL",
  ammoInMag: WEAPONS.PISTOL.magSize,
  ammoReserve: 60,

  fireCooldown: 0,
  isReloading: false,
  reloadT: 0,
  reloadTime: 1.0,

  animT: 0,
};

let distance = 0;
let speed = 260;

let bullets = [];
let zombies = [];
let enemyShots = [];
let pickups = [];

let dog = null;
let dogFound = false;

// dog upgrades
const dogStats = { collectRadius: 70, biteDamage: 2, biteCooldown: 2.2, healPerSec: 0, ammoFindBonus: 0 };

// boss logic
let nextBossAt = 500;
let bossAlive = false;

// upgrades screen
let currentUpgrades = [];
let upgradesReason = "";
let lastUpgradeAt = 0;

// =========================
//  HELICOPTER (NEW)
// =========================
let helicopters = [];
function resetHelicopters() {
  helicopters = [
    { x: rand(200, 900), y: rand(60, 120), vx: rand(40, 70), bob: rand(0, 10), rotor: 0 },
    { x: rand(700, 1200), y: rand(50, 110), vx: rand(30, 55), bob: rand(0, 10), rotor: 0 },
  ];
}
resetHelicopters();

// =========================
//  CUTSCENES (intro + ending)
// =========================
let cutsceneIndex = 0;
let cutsceneT = 0;

const CUTSCENES = [
  { dur: 2.2, text: "CRASH!!!", sub: "The car spins out…", draw: drawCrash },
  { dur: 2.6, text: "You crawl out.", sub: "Everything is quiet. Too quiet.", draw: drawAfterCrash },
  { dur: 3.0, text: "You: “Sis, I’m coming home… on foot.”", sub: "Sister: “Stay inside. Lock the doors.”", draw: drawCall },
  { dur: 2.2, text: "Zombies are everywhere.", sub: "Run. Survive. Find help.", draw: drawIntro },
  { dur: 999, text: "Press SPACE to start", sub: "Jump=W/↑  Shoot=Space/Click  Reload=R", draw: drawPressSpace },
];

const ENDING = [
  { dur: 2.2, text: "HOME", sub: "You made it.", draw: drawEnding1 },
  { dur: 2.8, text: "Sister runs to the door.", sub: "“I thought I lost you…”", draw: drawEnding2 },
  { dur: 2.4, text: "You: “I’m not alone.”", sub: "The dog wags its tail.", draw: drawEnding3 },
  { dur: 999, text: "THE END", sub: "Press ENTER to play again", draw: drawEnding4 },
];

// =========================
//  MENU NAV
// =========================
function showMenu(section) {
  homeEl.style.display = section === "home" ? "block" : "none";
  howEl.style.display = section === "how" ? "block" : "none";
  creditsEl.style.display = section === "credits" ? "block" : "none";
}

// =========================
//  MOBILE MODE SETUP
// =========================
function setMobileControlsVisible(on) {
  mobileControls.style.display = on ? "flex" : "none";
}
function preventScrollOnMobile(on) {
  document.body.style.overscrollBehavior = on ? "none" : "";
  document.body.style.touchAction = on ? "none" : "";
}
function applyPlatformMode() {
  platformMode = platMobile.checked ? "mobile" : "pc";
  setMobileControlsVisible(platformMode === "mobile");
  preventScrollOnMobile(platformMode === "mobile");
}
platPC.addEventListener("change", applyPlatformMode);
platMobile.addEventListener("change", applyPlatformMode);
applyPlatformMode();

// Shoot: hold
btnShoot.addEventListener("pointerdown", () => { touchState.shootHeld = true; });
btnShoot.addEventListener("pointerup", () => { touchState.shootHeld = false; });
btnShoot.addEventListener("pointercancel", () => { touchState.shootHeld = false; });
btnShoot.addEventListener("pointerleave", () => { touchState.shootHeld = false; });

// Jump: tap
btnJump.addEventListener("pointerdown", () => { touchState.jumpTap = true; });

// Reload: tap
btnReload.addEventListener("pointerdown", () => { touchState.reloadTap = true; });

// =========================
//  FULLSCREEN (optional)
// =========================
async function goFullscreen() {
  try {
    if (!document.fullscreenElement && canvas.requestFullscreen) {
      await canvas.requestFullscreen();
    }
  } catch {}
}

// =========================
//  RESET / START
// =========================
function resetRun() {
  distance = 0;
  speed = 260;
  bullets = [];
  zombies = [];
  enemyShots = [];
  pickups = [];

  dog = null;
  dogFound = false;

  dogStats.collectRadius = 70;
  dogStats.biteDamage = 2;
  dogStats.biteCooldown = 2.2;
  dogStats.healPerSec = 0;
  dogStats.ammoFindBonus = 0;

  nextBossAt = 500;
  bossAlive = false;

  currentUpgrades = [];
  upgradesReason = "";
  lastUpgradeAt = 0;

  player.y = groundY - player.h;
  player.vy = 0;
  player.onGround = true;

  player.hpMax = 100;
  player.hp = player.hpMax;

  player.weaponKey = "PISTOL";
  player.ammoInMag = WEAPONS.PISTOL.magSize;
  player.ammoReserve = 60;

  player.fireCooldown = 0;
  player.isReloading = false;
  player.reloadT = 0;

  player.animT = 0;

  camera.x = 0; camera.y = 0; camera.shake = 0; camera.recoil = 0;
  muzzleFlashT = 0;

  resetHelicopters();
  zombieSpawnT = 0;
  pickupSpawnT = 0;
}

function startGame() {
  playerName = (nameInput.value || "Runner").trim().slice(0, 16);
  menuEl.style.display = "none";

  resetRun();

  state = State.CUTSCENE;
  cutsceneIndex = 0;
  cutsceneT = 0;

  audio.startMusic();
  applyPlatformMode();

  // Try fullscreen only after user click (allowed)
  goFullscreen().catch(()=>{});
}

// =========================
//  SPAWNING
// =========================
let zombieSpawnT = 0;
let pickupSpawnT = 0;

function currentZombieCap() {
  return bossAlive ? DIFF.maxZombiesDuringBoss : DIFF.maxZombies;
}

function spawnZombie() {
  // NEW: cap zombies on screen
  if (zombies.length >= currentZombieCap()) return;

  const roll = Math.random();
  let type = "NORMAL";
  if (distance > 120 && roll < 0.18) type = "RUNNER";
  else if (distance > 200 && roll < 0.28) type = "TANK";
  else if (distance > 160 && roll < 0.38) type = "SPITTER";

  const baseSize = rand(45, 72);
  const z = {
    type,
    x: canvas.width + 60,
    y: 0,
    w: baseSize * 0.7,
    h: baseSize,
    hp: 2,
    hpMax: 2,
    speed: rand(40, 95),
    shootT: rand(1.2, 2.2),
    animT: 0,
  };

  if (type === "RUNNER") {
    z.hp = z.hpMax = 2;
    z.speed = rand(120, 170);
    z.h *= 0.9; z.w *= 0.9;
  } else if (type === "TANK") {
    z.hp = z.hpMax = 10;
    z.speed = rand(20, 55);
    z.h *= 1.15; z.w *= 1.15;
  } else if (type === "SPITTER") {
    z.hp = z.hpMax = 4;
    z.speed = rand(45, 85);
    z.shootT = rand(0.9, 1.6);
  }

  // NEW: make easier via multipliers
  z.hp = Math.max(1, Math.round(z.hp * DIFF.zombieHpMult));
  z.hpMax = z.hp;
  z.speed *= DIFF.zombieSpeedMult;

  z.y = groundY - z.h;
  zombies.push(z);
}

function spawnBoss() {
  if (bossAlive) return;
  bossAlive = true;

  const baseHp = 60 + Math.floor(distance / 10);
  const z = {
    type: "BOSS",
    x: canvas.width + 80,
    y: 0,
    w: 120,
    h: 170,
    hp: baseHp,
    hpMax: baseHp,
    speed: 15,
    shootT: 0.8,
    animT: 0,
  };

  // boss a bit easier too
  z.hp = Math.round(z.hp * 0.85);
  z.hpMax = z.hp;
  z.speed *= 0.90;

  z.y = groundY - z.h;
  zombies.push(z);

  audio.beep(90, 0.18, "sawtooth", 0.07);
  audio.beep(140, 0.18, "sawtooth", 0.05);
  addShake(0.22);
}

function spawnPickup() {
  if (bossAlive && Math.random() < 0.4) return;

  let kind = "AMMO";
  const r = Math.random();
  if (r < 0.23) kind = "MED";
  else if (r < 0.33 && distance > 80) kind = "WEAPON";

  pickups.push({
    kind,
    x: canvas.width + 60,
    y: groundY - 28,
    w: 26,
    h: 26,
  });
}

function enemyShoot(z) {
  if (z.type !== "SPITTER" && z.type !== "BOSS") return;
  const vx = z.type === "BOSS" ? -520 : -340;
  const damage = z.type === "BOSS" ? 14 : 10; // easier
  const r = z.type === "BOSS" ? 7 : 5;

  enemyShots.push({ x: z.x, y: z.y + z.h * 0.45, r, vx, vy: 0, damage });
  audio.beep(240, 0.04, "square", 0.04);
}

// =========================
//  RELOAD
// =========================
function startReload() {
  if (player.isReloading) return;
  const w = WEAPONS[player.weaponKey];
  if (player.ammoInMag >= w.magSize) return;
  if (player.ammoReserve <= 0) return;

  player.isReloading = true;
  player.reloadT = player.reloadTime;
  audio.beep(180, 0.05, "triangle", 0.04);
}
function finishReload() {
  const w = WEAPONS[player.weaponKey];
  const need = w.magSize - player.ammoInMag;
  const take = Math.min(need, player.ammoReserve);
  player.ammoInMag += take;
  player.ammoReserve -= take;

  player.isReloading = false;
  player.reloadT = 0;
  audio.beep(260, 0.05, "triangle", 0.04);
}

// =========================
//  SHOOTING + RECOIL
// =========================
function tryShoot() {
  if (player.isReloading) return;
  if (player.fireCooldown > 0) return;

  const w = WEAPONS[player.weaponKey];
  if (player.ammoInMag <= 0) { startReload(); return; }

  player.ammoInMag -= 1;
  player.fireCooldown = w.fireRate;

  const baseX = player.x + player.w;
  const baseY = player.y + player.h * 0.45;

  for (let i = 0; i < w.pellets; i++) {
    const angle = (Math.random() - 0.5) * w.spread;
    bullets.push({
      x: baseX,
      y: baseY,
      r: 4,
      vx: Math.cos(angle) * w.bulletSpeed,
      vy: Math.sin(angle) * w.bulletSpeed,
      damage: w.damage,
    });
  }

  addRecoil(w.recoil);
  addShake(0.05);     // slightly less shake
  muzzleFlashT = 0.06;

  audio.beep(420, 0.03, "square", 0.03);
}

// =========================
//  UPGRADES
// =========================
const UPGRADE_POOL = [
  { id:"DOG_BITE_DAMAGE", title:"Dog Bite +2", desc:"Dog does more bite damage.", apply: () => dogStats.biteDamage += 2 },
  { id:"DOG_BITE_SPEED", title:"Dog Bites Faster", desc:"Dog bites more often.", apply: () => dogStats.biteCooldown = Math.max(0.8, dogStats.biteCooldown - 0.35) },
  { id:"DOG_COLLECT", title:"Bigger Item Radius", desc:"Dog collects pickups from further away.", apply: () => dogStats.collectRadius += 25 },
  { id:"DOG_HEAL", title:"Dog Healing", desc:"+2 HP per second over time.", apply: () => dogStats.healPerSec += 2 },
  { id:"PLAYER_MAXHP", title:"+25 Max HP", desc:"Increase your max health.", apply: () => { player.hpMax += 25; player.hp += 25; } },
  { id:"AMMO_BONUS", title:"More Ammo Found", desc:"+10 ammo per ammo pickup.", apply: () => dogStats.ammoFindBonus += 10 },
];

function openUpgradeChoices(reason) {
  if (distance - lastUpgradeAt < 120 && reason !== "BOSS DOWN" && reason !== "DOG FOUND") return;
  upgradesReason = reason;
  currentUpgrades = pick3Upgrades();
  state = State.UPGRADE;
  lastUpgradeAt = distance;
}
function pick3Upgrades() {
  const pool = [...UPGRADE_POOL];
  const picks = [];
  while (picks.length < 3 && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}
function chooseUpgrade(index) {
  const choice = currentUpgrades[index];
  if (!choice) return;
  choice.apply();
  audio.beep(740, 0.06, "triangle", 0.05);
  currentUpgrades = [];
  upgradesReason = "";
  state = State.PLAY;
}
function getUpgradeCardRects() {
  const w = 260, h = 120, gap = 22;
  const startX = (canvas.width - (w * 3 + gap * 2)) / 2;
  const y = 270;
  return [
    { x: startX + 0 * (w + gap), y, w, h },
    { x: startX + 1 * (w + gap), y, w, h },
    { x: startX + 2 * (w + gap), y, w, h },
  ];
}
function handleUpgradeClick(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);

  const cards = getUpgradeCardRects();
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      chooseUpgrade(i);
      break;
    }
  }
}

// =========================
//  PICKUPS
// =========================
function applyPickup(p) {
  if (p.kind === "AMMO") {
    const bonus = dogStats.ammoFindBonus;
    player.ammoReserve = Math.min(260, player.ammoReserve + 20 + bonus);
    audio.beep(520, 0.04, "sine", 0.04);
  }
  if (p.kind === "MED") {
    player.hp = Math.min(player.hpMax, player.hp + 35);
    audio.beep(620, 0.05, "sine", 0.05);
  }
  if (p.kind === "WEAPON") {
    const next = nextWeaponKey(player.weaponKey);
    if (next !== player.weaponKey) {
      player.weaponKey = next;
      const w = WEAPONS[next];
      player.ammoInMag = w.magSize;
      player.ammoReserve = Math.min(260, player.ammoReserve + 50);
      player.isReloading = false;
      player.reloadT = 0;
      audio.beep(780, 0.06, "triangle", 0.05);
    } else {
      player.ammoReserve = Math.min(260, player.ammoReserve + 50);
      audio.beep(520, 0.04, "triangle", 0.04);
    }
  }
}

// =========================
//  DOG
// =========================
function dogUpdate(dt) {
  if (!dog) return;

  if (!dog.found) {
    dog.x -= speed * dt;
    if (dog.x < player.x + 60) {
      dog.found = true;
      openUpgradeChoices("DOG FOUND");
      audio.beep(520, 0.07, "sine", 0.05);
      audio.beep(660, 0.07, "sine", 0.05);
    }
  } else {
    dog.x += (player.x - 55 - dog.x) * dt * 6;
    dog.y = groundY - dog.h;

    if (dogStats.healPerSec > 0) {
      player.hp = Math.min(player.hpMax, player.hp + dogStats.healPerSec * dt);
    }

    // auto-collect
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (dist2(dog.x + dog.w / 2, dog.y + dog.h / 2, p.x + p.w / 2, p.y + p.h / 2) < dogStats.collectRadius * dogStats.collectRadius) {
        applyPickup(p);
        pickups.splice(i, 1);
      }
    }

    // bite
    dog.biteCooldown = Math.max(0, dog.biteCooldown - dt);
    if (dog.biteCooldown <= 0) {
      const target = zombies.find(z => z.type !== "BOSS" && z.x < player.x + 230 && z.x > player.x - 40);
      if (target) {
        target.hp -= dogStats.biteDamage;
        dog.biteCooldown = dogStats.biteCooldown;
        audio.beep(180, 0.04, "sawtooth", 0.03);
        addShake(0.02);
      }
    }
  }
}

// =========================
//  BACKGROUND (Parallax + Moon)
// =========================
let bgScroll = 0;

function drawMoon() {
  // nice moon glow
  const mx = 820;
  const my = 110;
  const glow = ctx.createRadialGradient(mx, my, 10, mx, my, 110);
  glow.addColorStop(0, "rgba(255,255,255,0.14)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(mx, my, 110, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "rgba(240,245,255,0.8)";
  ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill();

  // tiny craters
  ctx.fillStyle = "rgba(200,210,230,0.22)";
  ctx.beginPath(); ctx.arc(mx - 10, my - 6, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + 12, my + 8, 4, 0, Math.PI * 2); ctx.fill();
}

function drawParallax() {
  const w = canvas.width, h = canvas.height;

  // SKY
  if (BG.sky.loaded) {
    drawTiled(BG.sky, bgScroll * 0.10, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#07101b");
    g.addColorStop(1, "#111822");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Moon (NEW)
  drawMoon();

  // FAR CITY
  if (BG.far.loaded) {
    drawTiled(BG.far, bgScroll * 0.22, 120, w, 220);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 26; i++) {
      const bx = ((i * 90) - (bgScroll * 0.22) % 90);
      const bh = 60 + (i % 5) * 25;
      ctx.fillRect(bx, 250 - bh, 60, bh);
    }
  }

  // NEAR CITY
  if (BG.near.loaded) {
    drawTiled(BG.near, bgScroll * 0.45, 170, w, 260);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    for (let i = 0; i < 18; i++) {
      const bx = ((i * 140) - (bgScroll * 0.45) % 140);
      const bh = 90 + (i % 4) * 35;
      ctx.fillRect(bx, 310 - bh, 90, bh);
    }
  }

  // ROAD
  if (BG.road.loaded) {
    drawTiled(BG.road, bgScroll * 1.0, groundY - 10, w, 120);
  } else {
    // simple dashed lane marks
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 18; i++) {
      const x = ((i * 120) - (bgScroll * 1.0) % 120);
      ctx.fillRect(x, groundY + 8, 60, 3);
    }
  }
}

function drawTiled(img, scrollX, y, w, h) {
  const iw = img.width || w;
  const offset = - (scrollX % iw);
  for (let x = offset; x < w + iw; x += iw) {
    ctx.drawImage(img, x, y, iw, h);
  }
}

// =========================
//  DRAW HELPERS (fallbacks)
// =========================
function drawSpriteFrame(frame, x, y, w, h) {
  if (frame && frame.loaded) ctx.drawImage(frame, x, y, w, h);
  else ctx.fillRect(x, y, w, h);
}
function pickZombieFrames(type) {
  if (type === "RUNNER") return SPRITES.zRunner;
  if (type === "TANK") return SPRITES.zTank;
  if (type === "SPITTER") return SPRITES.zSpitter;
  if (type === "BOSS") return SPRITES.zBoss;
  return SPRITES.zNormal;
}

function drawHumanFallback(x, y, w, h) {
  // Head
  ctx.fillStyle = "rgba(240,240,255,0.95)";
  ctx.beginPath();
  ctx.arc(x + w*0.5, y + h*0.18, Math.min(w,h)*0.18, 0, Math.PI*2);
  ctx.fill();

  // Body
  ctx.fillStyle = "rgba(215,231,255,0.95)";
  ctx.fillRect(x + w*0.35, y + h*0.32, w*0.30, h*0.35);

  // Arms
  ctx.fillRect(x + w*0.18, y + h*0.36, w*0.18, h*0.10);
  ctx.fillRect(x + w*0.64, y + h*0.36, w*0.18, h*0.10);

  // Legs
  ctx.fillStyle = "rgba(180,200,230,0.95)";
  ctx.fillRect(x + w*0.38, y + h*0.67, w*0.10, h*0.28);
  ctx.fillRect(x + w*0.52, y + h*0.67, w*0.10, h*0.28);
}

function drawZombieFallback(z) {
  // Greenish body + head + arms
  let body = "rgba(124,255,138,0.90)";
  if (z.type === "RUNNER") body = "rgba(102,255,204,0.92)";
  if (z.type === "SPITTER") body = "rgba(155,255,107,0.92)";
  if (z.type === "BOSS") body = "rgba(255,209,102,0.92)";

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(z.x + z.w*0.5, z.y + z.h*0.18, Math.min(z.w,z.h)*0.20, 0, Math.PI*2);
  ctx.fill();

  ctx.fillRect(z.x + z.w*0.35, z.y + z.h*0.32, z.w*0.30, z.h*0.42);
  ctx.fillRect(z.x + z.w*0.12, z.y + z.h*0.40, z.w*0.20, z.h*0.10);
  ctx.fillRect(z.x + z.w*0.68, z.y + z.h*0.40, z.w*0.20, z.h*0.10);

  // Eyes
  ctx.fillStyle = "rgba(10,15,20,0.8)";
  ctx.fillRect(z.x + z.w*0.42, z.y + z.h*0.16, z.w*0.06, z.h*0.04);
  ctx.fillRect(z.x + z.w*0.54, z.y + z.h*0.16, z.w*0.06, z.h*0.04);

  if (z.type === "BOSS") {
    ctx.strokeStyle = "rgba(255,209,102,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.lineWidth = 1;
  }
}

function drawDogFallback(d) {
  ctx.fillStyle = "rgba(255,204,102,0.95)";
  ctx.fillRect(d.x, d.y + d.h*0.25, d.w, d.h*0.55);

  ctx.beginPath();
  ctx.arc(d.x + d.w*0.8, d.y + d.h*0.45, d.h*0.22, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = "rgba(190,140,70,0.8)";
  ctx.fillRect(d.x + d.w*0.15, d.y + d.h*0.70, d.w*0.12, d.h*0.25);
  ctx.fillRect(d.x + d.w*0.55, d.y + d.h*0.70, d.w*0.12, d.h*0.25);
}

// =========================
//  HELICOPTER DRAW/UPDATE (NEW)
// =========================
function updateHelicopters(dt) {
  for (const h of helicopters) {
    h.x += h.vx * dt;
    h.bob += dt * 3.2;
    h.rotor += dt * 18;

    if (h.x > canvas.width + 120) {
      h.x = -140;
      h.y = rand(55, 120);
      h.vx = rand(35, 70);
      h.bob = rand(0, 10);
    }
  }
}

function drawHelicopters() {
  for (const h of helicopters) {
    const y = h.y + Math.sin(h.bob) * 6;

    // body
    ctx.fillStyle = "rgba(210,220,240,0.16)";
    ctx.fillRect(h.x, y, 64, 18);

    // cabin
    ctx.fillStyle = "rgba(210,220,240,0.22)";
    ctx.fillRect(h.x + 10, y - 10, 22, 12);

    // tail
    ctx.fillStyle = "rgba(210,220,240,0.14)";
    ctx.fillRect(h.x + 58, y + 6, 22, 6);

    // rotor
    ctx.save();
    ctx.translate(h.x + 26, y - 12);
    ctx.rotate(Math.sin(h.rotor) * 0.15);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(-30, -2, 60, 4);
    ctx.restore();

    // tiny light
    ctx.fillStyle = "rgba(255,220,160,0.35)";
    ctx.fillRect(h.x + 4, y + 6, 4, 4);
  }
}

// =========================
//  MAIN LOOP
// =========================
let last = performance.now();
requestAnimationFrame(loop);

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  if (state === State.MENU) return;

  // Cutscene
  if (state === State.CUTSCENE) {
    cutsceneT += dt;
    const sc = CUTSCENES[cutsceneIndex];

    if (keys.has("Space")) {
      if (cutsceneIndex >= CUTSCENES.length - 1) {
        state = State.PLAY;
      } else { cutsceneIndex++; cutsceneT = 0; }
    } else if (cutsceneT > sc.dur && cutsceneIndex < CUTSCENES.length - 1) {
      cutsceneIndex++; cutsceneT = 0;
    }
    return;
  }

  // Upgrade
  if (state === State.UPGRADE) {
    if (keys.has("Digit1")) chooseUpgrade(0);
    if (keys.has("Digit2")) chooseUpgrade(1);
    if (keys.has("Digit3")) chooseUpgrade(2);
    return;
  }

  // Win (ending)
  if (state === State.WIN) {
    cutsceneT += dt;
    const sc = ENDING[cutsceneIndex];
    if (keys.has("Enter")) {
      resetRun();
      state = State.CUTSCENE;
      cutsceneIndex = 0;
      cutsceneT = 0;
      return;
    }
    if (keys.has("Space")) {
      if (cutsceneIndex < ENDING.length - 1) { cutsceneIndex++; cutsceneT = 0; }
    } else if (cutsceneT > sc.dur && cutsceneIndex < ENDING.length - 1) {
      cutsceneIndex++; cutsceneT = 0;
    }
    return;
  }

  // Gameover
  if (state === State.GAMEOVER) {
    if (keys.has("Enter")) {
      resetRun();
      state = State.CUTSCENE;
      cutsceneIndex = 0;
      cutsceneT = 0;
    }
    return;
  }

  // PLAY
  distance += speed * dt * 0.02;
  speed = Math.min(460, speed + dt * 4.5);

  if (distance >= HOME_DISTANCE) {
    state = State.WIN;
    cutsceneIndex = 0;
    cutsceneT = 0;
    audio.beep(880, 0.1, "sine", 0.06);
    audio.beep(660, 0.12, "sine", 0.05);
    return;
  }

  bgScroll += speed * dt;

  // NEW: helicopter update
  updateHelicopters(dt);

  // Input (PC / Mobile)
  if (platformMode === "pc") {
    if ((keys.has("KeyW") || keys.has("ArrowUp")) && player.onGround) {
      player.vy = -520;
      player.onGround = false;
    }
    if (keys.has("Space")) tryShoot();
    if (keys.has("KeyR")) startReload();
  } else {
    if (touchState.jumpTap && player.onGround) {
      player.vy = -520;
      player.onGround = false;
    }
    if (touchState.shootHeld) tryShoot();
    if (touchState.reloadTap) startReload();

    touchState.jumpTap = false;
    touchState.reloadTap = false;
  }

  // physics
  player.vy += 1300 * dt;
  player.y += player.vy * dt;
  if (player.y + player.h >= groundY) {
    player.y = groundY - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  player.animT += dt;

  player.fireCooldown = Math.max(0, player.fireCooldown - dt);

  if (player.isReloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) finishReload();
  }

  muzzleFlashT = Math.max(0, muzzleFlashT - dt);

  if (distance >= nextBossAt) {
    spawnBoss();
    nextBossAt += 500;
  }

  // Spawns (NEW: slower spawns + cap)
  zombieSpawnT -= dt;
  pickupSpawnT -= dt;

  // slower base spawn rate + difficulty slowdown
  const baseRate = Math.max(0.65, (1.55 - distance / 520) * DIFF.spawnSlowdown);

  if (zombieSpawnT <= 0) {
    zombieSpawnT = baseRate;
    spawnZombie(); // spawnZombie checks cap
  }

  if (pickupSpawnT <= 0) {
    pickupSpawnT = rand(1.0, 2.2);
    spawnPickup();
  }

  // Dog event
  if (!dogFound && distance > 160) {
    dogFound = true;
    dog = { x: canvas.width + 20, y: groundY - 30, w: 34, h: 24, found: false, biteCooldown: 1.2, animT: 0 };
  }
  if (dog) { dog.animT += dt; dogUpdate(dt); }

  // milestone upgrades
  if (dog && dog.found && distance > 250 && (distance - lastUpgradeAt) > 350 && !bossAlive) {
    openUpgradeChoices("MILESTONE");
  }

  // bullets
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  bullets = bullets.filter(b => b.x < canvas.width + 60 && b.x > -60);

  // zombies update
  for (const z of zombies) {
    z.animT += dt;
    z.x -= (speed + z.speed) * dt;

    // contact damage (NEW: easier)
    if (rectsOverlap(player, z)) {
      let dmg = z.type === "TANK" ? 40 : (z.type === "RUNNER" ? 28 : (z.type === "BOSS" ? 55 : 24));
      dmg *= DIFF.zombieDamageMult;
      player.hp -= dmg * dt;
      if (Math.random() < 0.015) audio.beep(120, 0.03, "square", 0.04);
      addShake(0.03);
    }

    // spitter / boss shooting
    if (z.type === "SPITTER" || z.type === "BOSS") {
      z.shootT -= dt;
      if (z.shootT <= 0 && z.x < canvas.width - 160) {
        z.shootT = (z.type === "BOSS") ? rand(0.5, 0.9) : rand(1.2, 2.0);
        enemyShoot(z);
      }
    }
  }

  // enemy shots
  for (const s of enemyShots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (circleRectHit(s, player)) {
      player.hp -= s.damage;
      s.x = -9999;
      audio.beep(95, 0.05, "sawtooth", 0.05);
      addShake(0.12);
    }
  }
  enemyShots = enemyShots.filter(s => s.x > -100);

  // bullet hits
  for (const b of bullets) {
    for (const z of zombies) {
      if (circleRectHit(b, z)) {
        z.hp -= b.damage;
        b.x = 99999;
        addShake(0.02);
        break;
      }
    }
  }

  // remove dead zombies + boss death logic
  let bossStillThere = false;
  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].hp <= 0) {
      const dead = zombies[i];
      zombies.splice(i, 1);

      if (dead.type === "BOSS") {
        bossAlive = false;
        audio.beep(60, 0.2, "sawtooth", 0.06);
        audio.beep(110, 0.2, "sawtooth", 0.05);
        addShake(0.25);

        pickups.push({ kind: "WEAPON", x: player.x + 260, y: groundY - 28, w: 26, h: 26 });
        openUpgradeChoices("BOSS DOWN");
      } else {
        if (Math.random() < 0.10) pickups.push({ kind: "AMMO", x: dead.x, y: groundY - 28, w: 26, h: 26 });
      }
    }
    if (zombies[i] && zombies[i].type === "BOSS") bossStillThere = true;
  }
  bossAlive = bossStillThere || bossAlive;

  zombies = zombies.filter(z => z.x + z.w > -120);

  // pickups move + collision
  for (const p of pickups) p.x -= speed * dt;
  pickups = pickups.filter(p => p.x + p.w > -60);

  for (let i = pickups.length - 1; i >= 0; i--) {
    if (rectsOverlap(player, pickups[i])) {
      applyPickup(pickups[i]);
      pickups.splice(i, 1);
    }
  }

  // camera decay
  camera.shake = Math.max(0, camera.shake - dt * 1.9);
  camera.recoil = Math.max(0, camera.recoil - dt * 3.2);

  // game over
  if (player.hp <= 0) {
    state = State.GAMEOVER;

    if (distance > best.meters) {
      best = { name: playerName, meters: distance };
      saveBest();
      updateBestUI();
    }

    audio.beep(70, 0.25, "sawtooth", 0.07);
  }
}

// =========================
//  DRAW
// =========================
function draw() {
  const shakeAmt = camera.shake * camera.shake * 6;
  const sx = rand(-shakeAmt, shakeAmt);
  const sy = rand(-shakeAmt, shakeAmt);
  const rx = -camera.recoil * 24;

  ctx.save();
  ctx.translate(Math.round(sx + rx), Math.round(sy));

  drawParallax();

  // NEW: helicopters draw on top of sky
  if (state === State.PLAY) drawHelicopters();

  // ground
  ctx.fillStyle = "#0c121a";
  ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

  if (state === State.CUTSCENE) {
    drawCutscene(CUTSCENES, cutsceneIndex, cutsceneT);
    ctx.restore();
    return;
  }
  if (state === State.WIN) {
    drawCutscene(ENDING, cutsceneIndex, cutsceneT);
    ctx.restore();
    return;
  }

  drawPlayer();

  if (muzzleFlashT > 0) drawMuzzleFlash();

  if (dog) drawDog();

  for (const z of zombies) drawZombie(z);

  // bullets
  ctx.fillStyle = "#fff";
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // enemy shots
  ctx.fillStyle = "#a6fffa";
  for (const s of enemyShots) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // pickups
  for (const p of pickups) {
    if (p.kind === "AMMO") ctx.fillStyle = "#66a6ff";
    else if (p.kind === "MED") ctx.fillStyle = "#ff6b6b";
    else ctx.fillStyle = "#ffd166";
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  drawHUD();

  if (state === State.UPGRADE) drawUpgradeOverlay();

  if (state === State.GAMEOVER) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "32px Arial";
    ctx.fillText("Game Over", 380, 220);
    ctx.font = "18px Arial";
    ctx.fillText(`Distance: ${distance.toFixed(0)}m`, 410, 260);
    ctx.fillText(`Best: ${best.meters.toFixed(0)}m (${best.name})`, 380, 288);
    ctx.fillText("Press ENTER to retry", 385, 320);
  }

  ctx.restore();
}

function drawPlayer() {
  const jump = !player.onGround;
  if (jump && SPRITES.playerJump.loaded) {
    ctx.drawImage(SPRITES.playerJump, player.x, player.y, player.w, player.h);
    return;
  }

  const frames = SPRITES.playerRun;
  if (anyLoaded(frames)) {
    const fps = 10;
    const idx = Math.floor(player.animT * fps) % frames.length;
    drawSpriteFrame(frames[idx], player.x, player.y, player.w, player.h);
  } else {
    drawHumanFallback(player.x, player.y, player.w, player.h);
  }
}

function drawDog() {
  const frames = SPRITES.dog;
  if (dog.found && anyLoaded(frames)) {
    const fps = 8;
    const idx = Math.floor(dog.animT * fps) % frames.length;
    drawSpriteFrame(frames[idx], dog.x, dog.y, dog.w, dog.h);
  } else {
    drawDogFallback(dog);
  }
}

function drawZombie(z) {
  const frames = pickZombieFrames(z.type);
  const has = anyLoaded(frames);

  if (!has) {
    drawZombieFallback(z);
    return;
  }

  const fps = (z.type === "RUNNER") ? 14 : 8;
  const idx = Math.floor(z.animT * fps) % frames.length;
  drawSpriteFrame(frames[idx], z.x, z.y, z.w, z.h);
}

function drawMuzzleFlash() {
  const gx = player.x + player.w;
  const gy = player.y + player.h * 0.45;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#fff2a6";
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + 26, gy - 10);
  ctx.lineTo(gx + 26, gy + 10);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(gx + 18, gy, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// =========================
//  HUD + UPGRADE OVERLAY
// =========================
function drawHUD() {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(12, 12, 660, 108);

  ctx.fillStyle = "#fff";
  ctx.font = "16px Arial";
  ctx.fillText(`Player: ${playerName}`, 24, 36);
  ctx.fillText(`Distance: ${distance.toFixed(0)}m / ${HOME_DISTANCE}m`, 24, 58);
  ctx.fillText(`Best: ${best.meters.toFixed(0)}m`, 24, 80);

  drawBar(24, 92, 240, 12, distance / HOME_DISTANCE, "Home", "home");

  const w = WEAPONS[player.weaponKey];
  ctx.fillText(`Weapon: ${w.name}`, 290, 36);

  drawBar(290, 52, 260, 16, player.hp / player.hpMax, `❤ HP ${Math.ceil(player.hp)}/${player.hpMax}`, "hp");

  const ammoLabel = player.isReloading
    ? `RELOADING...`
    : `🔫 AMMO ${player.ammoInMag}/${w.magSize} | RES ${player.ammoReserve}`;
  drawBar(290, 78, 260, 16, player.ammoInMag / w.magSize, ammoLabel, "ammo");

  if (dog && dog.found) {
    ctx.fillStyle = "#ffcc66";
    ctx.fillText(`Dog: collect ${dogStats.collectRadius}px | bite ${dogStats.biteDamage}`, 570, 64);
  }

  const boss = zombies.find(z => z.type === "BOSS");
  if (boss) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(12, 130, 660, 28);
    drawBar(24, 138, 636, 12, boss.hp / boss.hpMax, `BOSS HP ${Math.ceil(boss.hp)}/${boss.hpMax}`, "boss");
  }
}

function barColor(kind, pct) {
  pct = clamp01(pct);
  if (kind === "hp") {
    if (pct > 0.65) return "rgba(80,220,120,0.90)";
    if (pct > 0.35) return "rgba(255,210,90,0.90)";
    return "rgba(255,90,90,0.92)";
  }
  if (kind === "ammo") return "rgba(120,190,255,0.88)";
  if (kind === "boss") return "rgba(255,140,90,0.90)";
  return "rgba(255,255,255,0.85)";
}

function drawBar(x, y, w, h, pct, label, kind = "") {
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = barColor(kind, pct);
  ctx.fillRect(x, y, Math.max(0, w * clamp01(pct)), h);

  ctx.fillStyle = "#0b0f14";
  ctx.font = "12px Arial";
  ctx.fillText(label, x + 8, y + 11);
}

function drawUpgradeOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  ctx.font = "28px Arial";
  ctx.fillText("Choose an Upgrade", 320, 160);

  ctx.font = "14px Arial";
  ctx.fillText(`Reason: ${upgradesReason}  |  Pick 1 (Keys 1 / 2 / 3 or click)`, 250, 190);

  const rects = getUpgradeCardRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const u = currentUpgrades[i];

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText(`${i + 1}. ${u.title}`, r.x + 14, r.y + 34);

    ctx.font = "12px Arial";
    wrapText(u.desc, r.x + 14, r.y + 60, r.w - 28, 16);
  }
}

// =========================
//  CUTSCENE DRAWERS
// =========================
function drawCutscene(list, idx, t) {
  const scene = list[idx];

  const fadeIn = Math.min(1, t / 0.4);
  const fadeOut = idx < list.length - 1 ? Math.min(1, Math.max(0, (t - (scene.dur - 0.4)) / 0.4)) : 0;
  const alpha = fadeIn * (1 - fadeOut);

  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  scene.draw(t);

  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.font = "34px Arial";
  ctx.fillText(scene.text, 120, 360);
  ctx.font = "18px Arial";
  ctx.fillText(scene.sub, 120, 392);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// intro placeholder visuals
function drawCrash(t) { drawIntroBase(); if (t < 0.8) addShake(0.03); drawCar(320, 220); }
function drawAfterCrash() { drawIntroBase(); ctx.fillStyle="#d7e7ff"; ctx.fillRect(160, 250, 50, 90); }
function drawCall() {
  drawIntroBase();
  ctx.fillStyle="rgba(255,255,255,0.05)";
  ctx.fillRect(70,110,380,260);
  ctx.fillRect(510,110,380,260);
  ctx.fillStyle="#d7e7ff"; ctx.fillRect(220,240,60,110);
  ctx.fillStyle="#ffd166"; ctx.fillRect(650,220,70,130);
}
function drawIntro() { drawIntroBase(); }
function drawPressSpace() {
  drawIntroBase();
  const blink = (Math.floor(performance.now()/400)%2)===0;
  if (blink){
    ctx.fillStyle="rgba(255,255,255,0.18)";
    ctx.fillRect(110,410,740,40);
  }
}

function drawIntroBase() {
  drawParallax();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, 300, canvas.width, 60);
}

// ending scenes
function drawEnding1() { drawHouseScene(); }
function drawEnding2() { drawHouseScene(); ctx.fillStyle="#ffd166"; ctx.fillRect(680, 260, 60, 120); }
function drawEnding3() { drawHouseScene(); ctx.fillStyle="#d7e7ff"; ctx.fillRect(220, 260, 60, 120); ctx.fillStyle="#ffcc66"; ctx.fillRect(310, 335, 44, 30); }
function drawEnding4() { drawHouseScene(); }

function drawHouseScene() {
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // moon glow
  drawMoon();

  // house
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(580, 230, 260, 170);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(660, 300, 60, 100);
  ctx.fillStyle = "rgba(255,208,102,0.25)";
  ctx.fillRect(610, 260, 70, 50);
  ctx.fillRect(740, 260, 70, 50);

  ctx.fillStyle = "#0c121a";
  ctx.fillRect(0, groundY, canvas.width, canvas.height-groundY);
}

// Clean single car drawer (no duplicates)
function drawCar(x, y) {
  ctx.fillStyle = "rgba(232,238,246,0.95)";
  ctx.fillRect(x, y + 35, 320, 70);

  ctx.fillRect(x + 70, y + 10, 170, 40);

  ctx.fillStyle = "rgba(10,15,20,0.85)";
  ctx.fillRect(x + 85, y + 18, 70, 26);
  ctx.fillRect(x + 165, y + 18, 60, 26);

  ctx.fillStyle = "rgba(255,220,160,0.9)";
  ctx.fillRect(x + 305, y + 60, 12, 10);

  ctx.fillStyle = "rgba(255,80,80,0.8)";
  ctx.fillRect(x + 3, y + 60, 10, 10);

  ctx.fillStyle = "#0b0f14";
  ctx.beginPath(); ctx.arc(x + 80,  y + 110, 18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 250, y + 110, 18, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.arc(x + 80,  y + 110, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 250, y + 110, 8, 0, Math.PI * 2); ctx.fill();
}

// =========================
//  MENU WIRING
// =========================
startBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", (e) => e.key === "Enter" && startGame());

howBtn.addEventListener("click", () => showMenu("how"));
creditsBtn.addEventListener("click", () => showMenu("credits"));
backFromHow.addEventListener("click", () => showMenu("home"));
backFromCredits.addEventListener("click", () => showMenu("home"));

soundToggle.addEventListener("change", () => audio.setEnabled(soundToggle.checked));

// init
menuEl.style.display = "block";
showMenu("home");
audio.setEnabled(soundToggle.checked);






// biome blending based on distance (fast switching)
biomeBlend += dt * biomeBlendSpeed;
if (biomeBlend >= 1) biomeBlend = 1;

// change biome every X meters
if (distance > 0 && Math.floor(distance / biomeMetersPerChange) !== Math.floor((distance - speed * dt * 0.02) / biomeMetersPerChange)) {
  stepBiome();
}

 
biomeMetersPerChange = 90;   // changes constantly
biomeBlendSpeed = 3.0;       // blends fast

 
