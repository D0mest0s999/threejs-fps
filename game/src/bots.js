// The defenders: four bots who hold posts around the Vault, patrol the lanes, investigate
// noise, and shoot back. Each bot is a box-built figure (legs, torso, head, gun) with a small
// state machine: post, patrol, investigate, engage, defuse, dead. They path over the world's
// waypoint graph, see through a field-of-view plus line-of-sight test, hear gunfire through
// the noise events main.js passes in, and fire in bursts that stop while they move, the way
// the player's own spread punishes motion.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const RADIUS = 0.34;
const HEIGHT = 1.78;
const EYE = 1.62;
const WALK_SPEED = 3.3;
const HUNT_SPEED = 4.4;
const SIGHT_RANGE = 36;
const SIGHT_COS = Math.cos(1.25); // about 72 degrees either side of the facing
const LOSE_SIGHT_AFTER = 3.5;
const BURST_GAP = 0.62;
const SHOT_GAP = 0.13;

export function createBots(scene, world, random) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.7, metalness: 0.05 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.3 });
  const torsoGeometry = new THREE.BoxGeometry(0.54, 0.74, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 16, 12);
  const legGeometry = new THREE.BoxGeometry(0.19, 0.78, 0.24);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.62);

  const bots = [];
  const hitMeshes = [];
  const probe = new THREE.Box3();
  const ray = new THREE.Ray();
  const hitPoint = new THREE.Vector3();

  // Tracer pool: a fired round is a bright line that lives for a frame or two.
  const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let index = 0; index < 24; index += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, tracerMaterial);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, left: 0 });
  }
  let tracerCursor = 0;

  function tracer(from, to) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    const positions = slot.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    slot.line.visible = true;
    slot.left = 0.05;
  }

  function overlaps(x, y, z) {
    probe.min.set(x - RADIUS, y + 0.04, z - RADIUS);
    probe.max.set(x + RADIUS, y + HEIGHT - 0.04, z + RADIUS);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveBot(bot, dx, dz) {
    const nextX = bot.position.x + dx;
    if (!overlaps(nextX, bot.position.y, bot.position.z)) bot.position.x = nextX;
    const nextZ = bot.position.z + dz;
    if (!overlaps(bot.position.x, bot.position.y, nextZ)) bot.position.z = nextZ;
  }

  // Line of sight: the segment from the bot's eye to the target must clear every collider.
  function lineOfSight(from, to) {
    ray.origin.copy(from);
    ray.direction.copy(to).sub(from);
    const length = ray.direction.length();
    if (length < 0.001) return true;
    ray.direction.divideScalar(length);
    for (const collider of world.colliders) {
      if (ray.intersectBox(collider, hitPoint)) {
        if (from.distanceTo(hitPoint) < length - 0.3) return false;
      }
    }
    return true;
  }

  // Pathfinding: breadth-first over the waypoint graph, nearest node to nearest node.
  const neighbours = world.waypoints.map(() => []);
  for (const [a, b] of world.edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  function nearestNode(position) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < world.waypoints.length; index += 1) {
      const distance = world.waypoints[index].distanceToSquared(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }
  function findPath(from, to) {
    const start = nearestNode(from);
    const goal = nearestNode(to);
    if (start === goal) return [goal];
    const previous = new Map([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      if (node === goal) break;
      for (const next of neighbours[node]) {
        if (!previous.has(next)) {
          previous.set(next, node);
          queue.push(next);
        }
      }
    }
    if (!previous.has(goal)) return [goal];
    const path = [];
    for (let node = goal; node !== -1; node = previous.get(node)) path.push(node);
    return path.reverse();
  }

  function buildFigure() {
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeometry, bodyMaterial);
    legL.position.set(-0.14, 0.39, 0);
    const legR = new THREE.Mesh(legGeometry, bodyMaterial);
    legR.position.set(0.14, 0.39, 0);
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial);
    torso.position.y = 1.13;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.64;
    head.userData.part = 'head';
    const gun = new THREE.Mesh(gunGeometry, gunMaterial);
    gun.position.set(0.18, 1.28, -0.3);
    legL.userData.part = 'legs';
    legR.userData.part = 'legs';
    group.add(legL, legR, torso, head, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group, legL, legR, torso, head };
  }

  for (let index = 0; index < world.botSpawns.length; index += 1) {
    const figure = buildFigure();
    const spawn = world.botSpawns[index];
    figure.group.position.copy(spawn);
    scene.add(figure.group);
    const bot = {
      ...figure,
      index,
      position: figure.group.position,
      yaw: world.posts[index].yaw,
      health: 100,
      alive: true,
      state: 'post',
      post: world.posts[index],
      path: [],
      pathStep: 0,
      target: null,
      lastSeen: null,
      lastSeenAt: -99,
      investigateAt: null,
      burstLeft: 0,
      nextShotAt: 0,
      nextBurstAt: 0,
      aim: 0,
      strafeDir: 1,
      strafeFlipAt: 0,
      defusing: false,
      fall: 0,
      walkPhase: index * 1.3,
      patrolNode: index * 3,
    };
    for (const mesh of [figure.torso, figure.head, figure.legL, figure.legR]) {
      mesh.userData.bot = bot;
      hitMeshes.push(mesh);
    }
    bots.push(bot);
  }

  function setPath(bot, destination) {
    bot.path = findPath(bot.position, destination);
    bot.pathStep = 0;
    bot.target = destination.clone();
  }

  function followPath(bot, dt, speed) {
    if (!bot.target) return true;
    let goal = bot.target;
    if (bot.pathStep < bot.path.length) goal = world.waypoints[bot.path[bot.pathStep]];
    const dx = goal.x - bot.position.x;
    const dz = goal.z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    const atFinal = bot.pathStep >= bot.path.length;
    if (distance < (atFinal ? 0.25 : 0.7)) {
      if (atFinal) {
        bot.target = null;
        return true;
      }
      bot.pathStep += 1;
      return false;
    }
    bot.yaw = Math.atan2(-dx, -dz);
    const stepLength = Math.min(distance, speed * dt);
    moveBot(bot, (dx / distance) * stepLength, (dz / distance) * stepLength);
    bot.walkPhase += dt * speed * 2.6;
    return false;
  }

  function faceTowards(bot, point, dt, rate = 6) {
    const want = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function canSee(bot, ctx) {
    if (!ctx.playerAlive) return false;
    const eye = new THREE.Vector3(bot.position.x, EYE, bot.position.z);
    const chest = new THREE.Vector3(ctx.playerPos.x, ctx.playerPos.y + (ctx.playerCrouch ? 0.8 : 1.25), ctx.playerPos.z);
    const dx = chest.x - eye.x;
    const dz = chest.z - eye.z;
    const distance = Math.hypot(dx, dz, chest.y - eye.y);
    if (distance > SIGHT_RANGE) return false;
    if (distance > 3) {
      const facingX = -Math.sin(bot.yaw);
      const facingZ = -Math.cos(bot.yaw);
      if ((dx * facingX + dz * facingZ) / (Math.hypot(dx, dz) || 1) < SIGHT_COS) return false;
    }
    return lineOfSight(eye, chest);
  }

  function shootAt(bot, ctx, now) {
    const muzzle = new THREE.Vector3(bot.position.x - Math.sin(bot.yaw) * 0.55, 1.3, bot.position.z - Math.cos(bot.yaw) * 0.55);
    const target = new THREE.Vector3(ctx.playerPos.x, ctx.playerPos.y + (ctx.playerCrouch ? 0.75 : 1.15), ctx.playerPos.z);
    const distance = muzzle.distanceTo(target);
    // Accuracy: the first aimed shot is the best; running and range both spoil it.
    let chance = 0.52 - distance * 0.006 - ctx.playerSpeed * 0.028 + bot.aim * 0.05;
    if (ctx.playerCrouch) chance -= 0.05;
    chance = Math.max(0.06, Math.min(0.62, chance));
    const hit = random() < chance;
    if (!hit) {
      target.x += (random() * 2 - 1) * 1.4;
      target.y += (random() * 2 - 1) * 0.8;
      target.z += (random() * 2 - 1) * 1.4;
    }
    tracer(muzzle, target);
    ctx.onBotShot(bot, hit, muzzle);
    bot.nextShotAt = now + SHOT_GAP;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.nextBurstAt = now + BURST_GAP * (0.8 + random() * 0.7);
  }

  function step(dt, now, ctx) {
    for (const slot of tracers) {
      if (slot.left > 0) {
        slot.left -= dt;
        if (slot.left <= 0) slot.line.visible = false;
      }
    }
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.5;
        bot.group.position.y = -bot.fall * 0.1;
        continue;
      }
      const sees = canSee(bot, ctx);
      if (sees) {
        bot.lastSeen = ctx.playerPos.clone();
        bot.lastSeenAt = now;
        if (bot.state !== 'defuse' && bot.state !== 'engage') {
          // A human reaction beat before the first burst: acquisition is not instant fire.
          bot.state = 'engage';
          bot.nextBurstAt = Math.max(bot.nextBurstAt, now + 0.45);
          bot.burstLeft = 0;
        }
      } else if (bot.state === 'engage' && now - bot.lastSeenAt > LOSE_SIGHT_AFTER) {
        bot.state = 'investigate';
        bot.investigateAt = bot.lastSeen ? bot.lastSeen.clone() : null;
        if (bot.investigateAt) setPath(bot, bot.investigateAt);
      }
      if (ctx.noise && ctx.noise.at > bot.lastSeenAt && bot.state !== 'engage' && bot.state !== 'defuse') {
        if (bot.position.distanceTo(ctx.noise.pos) < 22) {
          bot.state = 'investigate';
          bot.investigateAt = ctx.noise.pos.clone();
          setPath(bot, bot.investigateAt);
        }
      }
      if (ctx.planted && bot.state !== 'engage') {
        bot.state = 'defuse';
        if (!bot.target) setPath(bot, ctx.chargePos);
      }

      bot.defusing = false;
      if (bot.state === 'post') {
        if (!bot.target && bot.position.distanceTo(bot.post.at) > 0.4) setPath(bot, bot.post.at);
        if (bot.target) followPath(bot, dt, WALK_SPEED);
        else {
          bot.yaw += (bot.post.yaw - bot.yaw) * Math.min(1, dt * 3);
          bot.walkPhase = 0;
        }
      } else if (bot.state === 'patrol') {
        if (!bot.target) {
          bot.patrolNode = (bot.patrolNode + 5) % world.waypoints.length;
          setPath(bot, world.waypoints[bot.patrolNode]);
        }
        if (followPath(bot, dt, WALK_SPEED)) bot.target = null;
      } else if (bot.state === 'investigate') {
        if (!bot.target) {
          bot.state = 'post';
        } else if (followPath(bot, dt, HUNT_SPEED)) {
          bot.state = 'post';
        }
      } else if (bot.state === 'defuse') {
        const atCharge = bot.position.distanceTo(ctx.chargePos) < 1.6;
        if (!atCharge) {
          if (!bot.target) setPath(bot, ctx.chargePos);
          followPath(bot, dt, HUNT_SPEED);
        } else {
          bot.defusing = true;
          faceTowards(bot, ctx.chargePos, dt);
        }
      } else if (bot.state === 'engage') {
        const anchor = bot.lastSeen ?? ctx.playerPos;
        faceTowards(bot, anchor, dt);
        const distance = bot.position.distanceTo(anchor);
        bot.aim = Math.min(3, bot.aim + dt);
        if (!sees) {
          if (!bot.target) setPath(bot, anchor);
          followPath(bot, dt, HUNT_SPEED);
        } else if (distance > 16) {
          if (!bot.target) setPath(bot, anchor);
          followPath(bot, dt, HUNT_SPEED);
        } else {
          bot.target = null;
          // Strafe in short steps between bursts, the way a careful player does.
          if (now >= bot.strafeFlipAt) {
            bot.strafeDir = random() < 0.5 ? -1 : 1;
            bot.strafeFlipAt = now + 0.7 + random() * 0.9;
          }
          if (bot.burstLeft <= 0 && now < bot.nextBurstAt) {
            const side = new THREE.Vector3(Math.cos(bot.yaw), 0, -Math.sin(bot.yaw));
            moveBot(bot, side.x * bot.strafeDir * 1.6 * dt, side.z * bot.strafeDir * 1.6 * dt);
            bot.walkPhase += dt * 4;
          }
          if (bot.burstLeft <= 0 && now >= bot.nextBurstAt) bot.burstLeft = 3 + Math.floor(random() * 3);
          if (bot.burstLeft > 0 && now >= bot.nextShotAt) shootAt(bot, ctx, now);
        }
      }

      // Dress the figure: legs swing with the walk, the group turns to the bot's yaw.
      const swing = Math.sin(bot.walkPhase) * 0.5;
      bot.legL.rotation.x = swing;
      bot.legR.rotation.x = -swing;
      bot.group.rotation.y = bot.yaw;
      bot.group.position.y = Math.abs(Math.sin(bot.walkPhase)) * 0.03;
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    return true;
  }

  function reset() {
    for (let index = 0; index < bots.length; index += 1) {
      const bot = bots[index];
      bot.alive = true;
      bot.health = 100;
      bot.state = 'post';
      bot.position.copy(world.botSpawns[index]);
      bot.yaw = world.posts[index].yaw;
      bot.target = null;
      bot.path = [];
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.burstLeft = 0;
      bot.nextShotAt = 0;
      bot.nextBurstAt = 0;
      bot.aim = 0;
      bot.defusing = false;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
    }
    for (const slot of tracers) slot.line.visible = false;
  }

  return {
    bots,
    hitMeshes,
    step,
    damage,
    reset,
    aliveCount() {
      return bots.filter((bot) => bot.alive).length;
    },
    defuser() {
      return bots.find((bot) => bot.alive && bot.defusing) ?? null;
    },
    // Where a bot's chest is, for staging screenshots and aim helpers.
    aimPoint(bot) {
      return new THREE.Vector3(bot.position.x, 1.15, bot.position.z);
    },
  };
}
