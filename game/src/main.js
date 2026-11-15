// Nightshift Depot: a round-based tactical FPS. You are the lone attacker against four
// defenders holding the Vault courtyard. Every round opens with a ten-second buy phase,
// then runs a hundred seconds: plant the charge on the glowing site plate and defend it
// for forty, or eliminate all four defenders. They win the round by dropping you, running
// the clock out, or defusing. Kills pay $300, rounds pay more, first to six rounds takes
// the depot. A fixed 60 Hz simulation feeds the render; ?shot=cover|combat|plant|buy with
// &seed=N stages a deterministic frame for a capture and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADE_PRICE } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 10;
const ROUND_SECONDS = 100;
const DETONATE_SECONDS = 40;
const PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS = 5;
const ROUND_END_SECONDS = 3.6;
const WIN_TARGET = 6;
const MAX_ROUNDS = 11;
const KILL_PAY = 300;
const WIN_PAY = 1400;
const PLANT_WIN_PAY = 1800;
const LOSS_PAY = 900;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 84);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world, random);
const arsenal = createArsenal(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const body = player.state;

// The charge: a small dark box with an accent lamp that blinks faster as detonation nears.
const charge = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.3 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.05, 0.1),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
chargeLamp.position.y = 0.13;
charge.add(chargeBody, chargeLamp);
charge.visible = false;
scene.add(charge);
const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26);
scene.add(blastLight);

// Grenades in flight: a sphere, gravity, one bounce, a 1.6 s fuse.
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 12, 10),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5 }),
);
grenadeMesh.visible = false;
scene.add(grenadeMesh);
const grenade = { live: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), fuse: 0 };

const match = {
  phase: 'buy', // buy, live, planted, roundEnd, matchEnd
  round: 1,
  won: 0,
  lost: 0,
  money: 800,
  health: 100,
  buyLeft: BUY_SECONDS,
  roundLeft: ROUND_SECONDS,
  detonateLeft: 0,
  endLeft: 0,
  plantProgress: 0,
  defuseProgress: 0,
  plantedWin: false,
  over: false,
};
let elapsed = 0;
let noise = null;
let shake = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
const prevKeys = new Set();
const markerHoldMs = shot ? 4000 : 90;

function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function buyRows() {
  return {
    smg: { price: WEAPONS.smg.price, owned: arsenal.state.owned.has('smg'), affordable: match.money >= WEAPONS.smg.price },
    rifle: { price: WEAPONS.rifle.price, owned: arsenal.state.owned.has('rifle'), affordable: match.money >= WEAPONS.rifle.price },
    grenade: { price: GRENADE_PRICE, owned: arsenal.state.grenades >= 2, affordable: match.money >= GRENADE_PRICE },
  };
}

function startRound() {
  match.phase = 'buy';
  match.buyLeft = BUY_SECONDS;
  match.roundLeft = ROUND_SECONDS;
  match.plantProgress = 0;
  match.defuseProgress = 0;
  match.plantedWin = false;
  match.health = 100;
  charge.visible = false;
  grenade.live = false;
  grenadeMesh.visible = false;
  body.position.copy(world.playerSpawn);
  body.velocity.set(0, 0, 0);
  body.yaw = 0; // facing north, up the yard toward the Vault
  body.pitch = 0;
  bots.reset();
  arsenal.refillForRound();
  hud.banner(`ROUND ${match.round}`, match.round === 1 ? 'Buy a gun, then take the Vault' : 'First to six rounds', 2400);
  hud.showBuy(buyRows());
  hud.hideProgress();
  syncHud();
}

function startMatch() {
  match.round = 1;
  match.won = 0;
  match.lost = 0;
  match.money = 800;
  match.over = false;
  arsenal.resetMatch();
  startRound();
}

function endRound(won, reason) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  match.phase = 'roundEnd';
  match.endLeft = ROUND_END_SECONDS;
  hud.hideProgress();
  hud.hideBuy();
  hud.hint(null);
  if (won) {
    match.won += 1;
    const pay = match.plantedWin ? PLANT_WIN_PAY : WIN_PAY;
    match.money += pay;
    hud.banner('ROUND WON', `${reason} — +$${pay}`, 3000);
  } else {
    match.lost += 1;
    match.money += LOSS_PAY;
    hud.banner('ROUND LOST', `${reason} — +$${LOSS_PAY}`, 3000);
  }
  syncHud();
}

function endMatch() {
  match.phase = 'matchEnd';
  match.over = true;
  const took = match.won > match.lost;
  hud.showOverlay('end', took
    ? `You took the depot ${match.won}–${match.lost}. The Vault is yours.`
    : `The crew holds the depot ${match.lost}–${match.won}. Run it back?`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function syncHud() {
  const slot = arsenal.ammo();
  hud.setAmmo(slot.mag, slot.reserve, arsenal.def().name.toUpperCase());
  hud.setHealth(match.health);
  hud.setMoney(match.money);
  hud.setRounds(match.won, match.lost);
  hud.setFoes(bots.aliveCount());
  if (match.phase === 'buy') hud.setTimer(`BUY ${formatClock(match.buyLeft)}`, false);
  else if (match.phase === 'planted') hud.setTimer(formatClock(match.detonateLeft), true);
  else hud.setTimer(formatClock(match.roundLeft), match.roundLeft <= 10 && match.phase === 'live');
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!match.over) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.over) startMatch();
  input.requestLock();
});

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0.003) {
    camera.position.x += (random() * 2 - 1) * shake;
    camera.position.y += (random() * 2 - 1) * shake;
    camera.rotation.z = (random() * 2 - 1) * shake * 0.4;
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function playerAlive() {
  return match.health > 0 && (match.phase === 'live' || match.phase === 'planted');
}

function shoot(spread) {
  if (!arsenal.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  noise = { pos: body.position.clone(), at: elapsed };
  if (hit && hit.object.userData.bot) {
    const part = hit.object.userData.part;
    const mult = part === 'head' ? 4 : part === 'legs' ? 0.7 : 1;
    const falloff = hit.distance > 25 ? 0.75 : 1;
    const killed = bots.damage(hit.object.userData.bot, arsenal.def().damage * mult * falloff);
    hud.hitMarker(killed, markerHoldMs);
    if (killed) {
      match.money += KILL_PAY;
      hud.feed(`Defender down — +$${KILL_PAY}`);
      hud.setFoes(bots.aliveCount());
      if (bots.aliveCount() === 0) endRound(true, 'All four defenders down');
    }
  }
  arsenal.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  syncHud();
  return true;
}

function throwGrenade() {
  if (!arsenal.throwGrenade()) return;
  camera.getWorldDirection(direction);
  grenade.position.copy(camera.position).addScaledVector(direction, 0.4);
  grenade.velocity.copy(direction).multiplyScalar(15);
  grenade.velocity.y += 3.5;
  grenade.fuse = 1.6;
  grenade.live = true;
  grenadeMesh.visible = true;
  noise = { pos: body.position.clone(), at: elapsed };
  syncHud();
}

function explodeGrenade() {
  grenade.live = false;
  grenadeMesh.visible = false;
  blastLight.position.copy(grenade.position).y += 0.6;
  blastLight.intensity = 260;
  shake = Math.max(shake, 0.14);
  noise = { pos: grenade.position.clone(), at: elapsed };
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const distance = bot.position.distanceTo(grenade.position);
    if (distance > 5.5) continue;
    const killed = bots.damage(bot, 95 - distance * 14);
    if (killed) {
      match.money += KILL_PAY;
      hud.feed(`Defender down — grenade +$${KILL_PAY}`);
      hud.setFoes(bots.aliveCount());
      if (bots.aliveCount() === 0) endRound(true, 'All four defenders down');
    }
  }
  const selfDistance = body.position.distanceTo(grenade.position);
  if (selfDistance < 4 && playerAlive()) hurtPlayer(42 - selfDistance * 9, 'Your own grenade caught you');
}

function hurtPlayer(amount, cause) {
  if (!playerAlive()) return;
  match.health -= amount;
  hud.damageFlash();
  hud.setHealth(match.health);
  shake = Math.max(shake, 0.05);
  if (match.health <= 0) {
    match.health = 0;
    hud.setHealth(0);
    endRound(false, cause ?? 'The crew dropped you');
  }
}

function stepGrenade(dt) {
  if (!grenade.live) return;
  grenade.fuse -= dt;
  grenade.velocity.y -= 13 * dt;
  grenade.position.addScaledVector(grenade.velocity, dt);
  if (grenade.position.y < 0.09) {
    grenade.position.y = 0.09;
    grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.38;
    grenade.velocity.x *= 0.7;
    grenade.velocity.z *= 0.7;
  }
  grenadeMesh.position.copy(grenade.position);
  if (grenade.fuse <= 0) explodeGrenade();
}

function buyKey(id) {
  if (id === 'grenade') {
    if (match.money >= GRENADE_PRICE && arsenal.giveGrenade()) {
      match.money -= GRENADE_PRICE;
      hud.feed('Grenade bought');
    }
  } else if (!arsenal.state.owned.has(id)) {
    if (match.money >= WEAPONS[id].price) {
      match.money -= WEAPONS[id].price;
      arsenal.give(id);
      arsenal.switchTo(id);
      hud.feed(`${WEAPONS[id].name} bought`);
    }
  } else {
    arsenal.switchTo(id);
  }
  hud.showBuy(buyRows());
  syncHud();
}

function handleKeys() {
  const keys = input.state.keys;
  const pressed = (code) => keys.has(code) && !prevKeys.has(code);
  if (match.phase === 'buy') {
    if (pressed('Digit2')) buyKey('smg');
    if (pressed('Digit3')) buyKey('rifle');
    if (pressed('Digit4')) buyKey('grenade');
    if (pressed('Digit1')) arsenal.switchTo('pistol');
  } else {
    if (pressed('Digit1')) arsenal.switchTo('pistol');
    if (pressed('Digit2')) arsenal.switchTo('smg');
    if (pressed('Digit3')) arsenal.switchTo('rifle');
    if (pressed('KeyQ')) {
      const order = ['pistol', 'smg', 'rifle'].filter((id) => arsenal.state.owned.has(id));
      const next = order[(order.indexOf(arsenal.state.current) + 1) % order.length];
      arsenal.switchTo(next);
    }
  }
  if (pressed('KeyG') && playerAlive()) throwGrenade();
  prevKeys.clear();
  for (const code of keys) prevKeys.add(code);
}

function step(dt) {
  elapsed += dt;
  shake = Math.max(0, shake - dt * 0.35);
  blastLight.intensity = Math.max(0, blastLight.intensity - dt * 900);
  player.step(dt, input.state.keys);
  arsenal.step(dt);
  stepGrenade(dt);

  const ctx = {
    playerPos: body.position,
    playerCrouch: body.crouching,
    playerSpeed: player.groundSpeed(),
    playerAlive: playerAlive(),
    noise,
    planted: match.phase === 'planted',
    chargePos: charge.position,
    onBotShot(bot, hit) {
      if (hit) hurtPlayer(10 + random() * 8, 'The crew dropped you');
    },
  };
  if (match.phase !== 'roundEnd' && match.phase !== 'matchEnd') bots.step(dt, elapsed, ctx);

  if (match.phase === 'buy') {
    match.buyLeft -= dt;
    if (match.buyLeft <= 0) {
      match.phase = 'live';
      hud.hideBuy();
      hud.banner('ROUND LIVE', 'Plant the charge on the glowing plate, or drop all four', 2200);
    }
  } else if (match.phase === 'live') {
    match.roundLeft -= dt;
    if (match.roundLeft <= 0) endRound(false, 'Time — the crew holds the Vault');
    const inSite = Math.hypot(body.position.x - world.site.x, body.position.z - world.site.z) < world.site.radius;
    const planting = inSite && input.state.keys.has('KeyE') && player.groundSpeed() < 1 && match.health > 0;
    if (planting) {
      match.plantProgress += dt / PLANT_SECONDS;
      hud.showProgress('PLANTING THE CHARGE', match.plantProgress);
      hud.hint(null);
      if (match.plantProgress >= 1) {
        match.phase = 'planted';
        match.plantedWin = true;
        match.detonateLeft = DETONATE_SECONDS;
        charge.position.set(body.position.x, 0.1, body.position.z);
        charge.visible = true;
        hud.hideProgress();
        hud.banner('CHARGE PLANTED', 'Defend it for forty seconds', 2400);
        hud.feed('The charge is planted');
      }
    } else {
      match.plantProgress = Math.max(0, match.plantProgress - dt / PLANT_SECONDS);
      if (match.plantProgress > 0) hud.showProgress('PLANTING THE CHARGE', match.plantProgress);
      else hud.hideProgress();
      hud.hint(inSite && match.health > 0 ? 'Hold E to plant the charge' : null);
    }
  } else if (match.phase === 'planted') {
    match.detonateLeft -= dt;
    chargeLamp.material.color.set(PALETTE.accent);
    chargeLamp.visible = Math.sin(elapsed * (match.detonateLeft < 10 ? 14 : 6)) > -0.2;
    const defuser = bots.defuser();
    if (defuser) {
      match.defuseProgress += dt / DEFUSE_SECONDS;
      hud.showProgress('THE CREW IS DEFUSING', match.defuseProgress);
      if (match.defuseProgress >= 1) {
        charge.visible = false;
        endRound(false, 'The crew defused the charge');
      }
    } else {
      match.defuseProgress = Math.max(0, match.defuseProgress - dt / DEFUSE_SECONDS);
      if (match.defuseProgress > 0) hud.showProgress('THE CREW IS DEFUSING', match.defuseProgress);
      else hud.hideProgress();
    }
    if (match.detonateLeft <= 0 && match.phase === 'planted') {
      blastLight.position.copy(charge.position).y += 1;
      blastLight.intensity = 400;
      shake = 0.3;
      endRound(true, 'The Vault is breached');
    }
  } else if (match.phase === 'roundEnd') {
    match.endLeft -= dt;
    if (match.endLeft <= 0) {
      if (match.won >= WIN_TARGET || match.lost >= WIN_TARGET || match.round >= MAX_ROUNDS) endMatch();
      else {
        match.round += 1;
        startRound();
      }
    }
  }
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && input.state.locked) {
    handleKeys();
    const look = input.takeLook();
    player.look(look.x, look.y);
    const firing = input.state.firing;
    const triggerEdge = firing && !wasFiring;
    wasFiring = firing;
    if (playerAlive() && (arsenal.def().semi ? triggerEdge : firing) && arsenal.ready()) {
      shoot(shot ? 0 : arsenal.spread(player.groundSpeed()));
    }
    if (input.state.keys.has('KeyR')) arsenal.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function stageLive() {
  match.phase = 'live';
  match.roundLeft = 76;
  hud.hideBuy();
  bots.reset();
}

function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = Math.PI;
  if (name === 'start') {
    body.position.set(0.6, 0, 16.4);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.4, -14));
    hud.showOverlay('start');
  } else if (name === 'cover') {
    stageLive();
    body.position.set(0, 0, -3.2);
    settle(30);
    // A quiet beat so no tracer is mid-flight in the establishing shot.
    match.phase = 'buy';
    settle(8);
    match.phase = 'live';
    match.health = 100;
    aimAt(new THREE.Vector3(0, 1.3, -15));
  } else if (name === 'combat') {
    stageLive();
    body.position.set(5.4, 0, -1.8);
    const foe = bots.bots[3];
    foe.position.set(1.2, 0, -8.6);
    foe.yaw = Math.atan2(-(body.position.x - foe.position.x), -(body.position.z - foe.position.z));
    settle(10);
    for (let round = 0; round < 3; round += 1) {
      aimAt(bots.aimPoint(foe));
      shoot(0);
      settle(9);
    }
    match.health = 64;
    aimAt(bots.aimPoint(foe));
  } else if (name === 'plant') {
    stageLive();
    match.phase = 'planted';
    match.plantedWin = true;
    match.detonateLeft = 31;
    charge.position.set(3.0, 0.1, -13.0);
    charge.visible = true;
    const defuser = bots.bots[0];
    defuser.position.set(3.8, 0, -12.4);
    defuser.state = 'defuse';
    body.position.set(-4.6, 0, -8.6);
    settle(6);
    match.health = 85;
    match.defuseProgress = 0.45;
    hud.showProgress('THE CREW IS DEFUSING', match.defuseProgress);
    aimAt(bots.aimPoint(defuser));
  } else if (name === 'buy') {
    match.round = 2;
    match.won = 1;
    match.money = 2450;
    match.phase = 'buy';
    match.buyLeft = 8;
    bots.reset();
    arsenal.give('smg');
    body.position.set(-2.5, 0, 17.6);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.4, -14));
    hud.showBuy(buyRows());
    hud.banner('ROUND 2', 'First to six rounds', 4000);
  }
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startRound();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
