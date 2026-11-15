// The arsenal: three guns and a grenade, one set of numbers each. The pistol is free and
// semi-automatic, the SMG is cheap and forgiving on the move, the rifle hits hardest and
// asks you to stop for it. Spread grows with the shooter's speed on every gun, so moving
// fire is a spray and planted feet are a laser. main.js owns the rays and the damage;
// this module owns the view models, magazines, reloads and the switching.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'Sidearm P9', price: 0, magSize: 12, reserveMax: 48, damage: 26,
    fireGap: 0.26, reloadTime: 1.4, semi: true,
    spreadStill: 0.0035, spreadMoving: 0.02, moveReference: 5.2,
  },
  smg: {
    name: 'Rush SMG', price: 1400, magSize: 32, reserveMax: 96, damage: 18,
    fireGap: 0.07, reloadTime: 1.8, semi: false,
    spreadStill: 0.009, spreadMoving: 0.026, moveReference: 5.2,
  },
  rifle: {
    name: 'Vault Rifle', price: 2700, magSize: 30, reserveMax: 90, damage: 33,
    fireGap: 0.096, reloadTime: 1.9, semi: false,
    spreadStill: 0.0022, spreadMoving: 0.03, moveReference: 5.2,
  },
};
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

const MUZZLE_TIME = 0.06;

export function createArsenal(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  function buildModel(id) {
    const model = new THREE.Group();
    if (id === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.19), bodyMat);
      const gripBox = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.055), grip);
      gripBox.position.set(0, -0.075, 0.045);
      gripBox.rotation.x = 0.25;
      model.add(slide, gripBox);
      model.position.set(0.15, -0.16, -0.52);
    } else if (id === 'smg') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.36), bodyMat);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), grip);
      barrel.position.set(0, 0.02, -0.28);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.07), accentMat);
      mag.position.set(0, -0.13, -0.02);
      model.add(receiver, barrel, mag);
      model.position.set(0.22, -0.19, -0.4);
    } else {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), bodyMat);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
      barrel.position.set(0, 0.025, -0.38);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
      stock.position.set(0, -0.02, 0.3);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), accentMat);
      sight.position.set(0, 0.08, -0.05);
      model.add(receiver, barrel, stock, sight);
      model.position.set(0.24, -0.2, -0.42);
    }
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    models[id] = buildModel(id);
    ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: new Set(['pistol']),
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    drawLeft: 0,
  };
  models[state.current].visible = true;

  function def() {
    return WEAPONS[state.current];
  }
  function currentAmmo() {
    return ammo[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.drawLeft = Math.max(0, state.drawLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = (state.current === 'pistol' ? -0.52 : state.current === 'smg' ? -0.4 : -0.42) + state.kick;
    model.position.y = (state.current === 'pistol' ? -0.16 : state.current === 'smg' ? -0.19 : -0.2) - state.drawLeft * 0.7;
    model.rotation.x = state.kick * 2.2 + state.drawLeft * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      const defNow = def();
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (defNow.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = currentAmmo();
        const need = defNow.magSize - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    def,
    ammo: currentAmmo,
    ready() {
      return currentAmmo().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.drawLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      const slot = currentAmmo();
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = currentAmmo();
      if (state.reloadLeft > 0 || slot.mag === def().magSize || slot.reserve === 0) return;
      state.reloadLeft = def().reloadTime;
    },
    spread(speed) {
      const defNow = def();
      return defNow.spreadStill + Math.min(1, speed / defNow.moveReference) * defNow.spreadMoving;
    },
    switchTo(id) {
      if (!state.owned.has(id) || id === state.current) return false;
      state.current = id;
      state.reloadLeft = 0;
      state.cooldown = 0;
      state.drawLeft = 0.28;
      for (const key of Object.keys(models)) models[key].visible = key === id;
      return true;
    },
    give(id) {
      state.owned.add(id);
      ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
    },
    giveGrenade() {
      if (state.grenades >= GRENADE_MAX) return false;
      state.grenades += 1;
      return true;
    },
    throwGrenade() {
      if (state.grenades <= 0 || state.cooldown > 0) return false;
      state.grenades -= 1;
      state.cooldown = 0.5;
      return true;
    },
    // A new match: back to the free pistol and empty pockets.
    resetMatch() {
      state.owned = new Set(['pistol']);
      state.grenades = 0;
      state.current = 'pistol';
      for (const key of Object.keys(models)) models[key].visible = key === 'pistol';
      this.refillForRound();
    },
    // A new round: magazines and reserves are topped up, purchases are kept.
    refillForRound() {
      for (const id of state.owned) {
        ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.drawLeft = 0;
    },
  };
}
