// The map: Nightshift Depot, an original walled yard of lanes and cover built from boxes.
// Two lanes (the Long Hall west, the Side Yard east) run from the attacker's south spawn to
// the Vault courtyard in the north, joined by a mid connector. Every box is a collider for
// movement and a surface a bullet stops on. The world also exports the site (where the charge
// is planted), both spawns, the defenders' posts and the waypoint graph the bots walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and the perimeter: a 40 x 40 m yard, walls 5 m high, open sky for one key light.
  box(40.4, 0.4, 40.4, 0, -0.2, 0, 'surface');
  box(0.4, 5, 40.4, -20.2, 2.5, 0, 'hairline');
  box(0.4, 5, 40.4, 20.2, 2.5, 0, 'hairline');
  box(40.4, 5, 0.4, 0, 2.5, -20.2, 'hairline');
  box(40.4, 5, 0.4, 0, 2.5, 20.2, 'hairline');

  // The Long Hall (west lane): a container spine with gaps, crates at its mouth.
  box(2.4, 2.6, 10, -13, 1.3, -6, 'hairline');
  box(2.4, 2.6, 6, -13, 1.3, 6, 'hairline');
  box(1.6, 1.1, 1.6, -16.4, 0.55, 12.4, 'hairline');
  box(1.6, 1.1, 1.6, -9.8, 0.55, 12.4, 'hairline');
  box(3.2, 1.1, 1.2, -13, 0.55, -13.4, 'hairline');

  // The Side Yard (east lane): staggered crates and a low platform overlooking the site.
  box(1.6, 1.6, 1.6, 13.4, 0.8, 10, 'hairline');
  box(1.6, 1.1, 1.6, 10.6, 0.55, 4.4, 'hairline');
  box(1.6, 1.6, 1.6, 14.6, 0.8, -2.4, 'hairline');
  box(1.6, 1.1, 1.6, 11.2, 0.55, -8.6, 'hairline');
  box(5.2, 0.5, 3, 14.8, 0.25, -13.6, 'surface');
  box(1.2, 1.1, 1.2, 12.4, 0.55, -13.2, 'hairline');

  // Mid: a cross wall with two doors, and the connector's cover.
  box(9.6, 3.4, 0.8, -11.2, 1.7, 0.8, 'surface');
  box(9.6, 3.4, 0.8, 11.2, 1.7, 0.8, 'surface');
  box(1.2, 2.2, 1.2, 0, 1.1, 0.8, 'hairline');
  box(2.4, 1.1, 1.2, -4.6, 0.55, -3.4, 'hairline');
  box(2.4, 1.1, 1.2, 4.6, 0.55, -3.4, 'hairline');

  // The Vault courtyard (the site): a raised accent plate, corner posts and inner cover.
  box(11, 0.24, 9, 0, 0.12, -14.6, 'accent');
  box(0.5, 2.6, 0.5, -5.2, 1.3, -18.6, 'ink');
  box(0.5, 2.6, 0.5, 5.2, 1.3, -18.6, 'ink');
  box(0.5, 2.6, 0.5, -5.2, 1.3, -10.6, 'ink');
  box(0.5, 2.6, 0.5, 5.2, 1.3, -10.6, 'ink');
  box(2.6, 1.1, 1.4, -2.8, 0.55, -14.2, 'hairline');
  box(2.6, 1.1, 1.4, 3.1, 0.55, -15.4, 'hairline');
  box(1.4, 1.6, 1.4, 0.2, 0.8, -12.2, 'hairline');
  // The vault block itself, at the courtyard's north edge: the charge goes at its feet.
  box(4.4, 3, 1.6, 0, 1.5, -18.8, 'surface');

  // Attacker spawn cover (south) and barrels for soft corners.
  box(2.6, 1.1, 1.2, -3.4, 0.55, 15.4, 'hairline');
  box(2.6, 1.1, 1.2, 3.4, 0.55, 15.4, 'hairline');
  box(1.2, 2.2, 1.2, 0, 1.1, 12.8, 'hairline');
  const barrelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14);
  for (const [x, z] of [[-7.4, -10.8], [7.8, 8.8], [-6.2, 6.4], [16.8, -6.4], [-17, 2.2]]) {
    const barrel = new THREE.Mesh(barrelGeometry, materials.muted);
    barrel.position.set(x, 0.53, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Light: a warm key from the front right, cool fills from behind and from the north,
  // and a bright sky/ground gradient so the yard reads at a glance.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.surface), 2.2);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.4);
  key.position.set(14, 20, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 64;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.85);
  fill.position.set(-12, 12, 14);
  scene.add(fill);
  const northFill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  northFill.position.set(4, 10, -18);
  scene.add(northFill);

  // The places the game is played over. The site is the accent plate in the courtyard.
  const site = { x: 0, z: -14.6, radius: 6.4 };
  const playerSpawn = new THREE.Vector3(0, 0, 17.6);
  const botSpawns = [
    new THREE.Vector3(-3.4, 0, -17.6),
    new THREE.Vector3(3.6, 0, -17.2),
    new THREE.Vector3(-8.6, 0, -11.4),
    new THREE.Vector3(8.8, 0, -11.8),
  ];
  // Where defenders hold when nothing is happening: post position and the yaw they watch.
  const posts = [
    { at: new THREE.Vector3(-3.4, 0, -17.4), yaw: Math.PI },
    { at: new THREE.Vector3(3.8, 0, -16.8), yaw: Math.PI * 0.9 },
    { at: new THREE.Vector3(-6.4, 0, -9.6), yaw: Math.PI * 0.75 },
    { at: new THREE.Vector3(6.6, 0, -9.8), yaw: Math.PI * 1.25 },
  ];
  // The waypoint graph: nodes on the lanes, edges walked both ways. Bots path over it.
  const waypoints = [
    [0, 17.6], [-6, 13], [6, 13], [-13, 12.6], [13, 11], [-13, 3], [12.6, 3.4],
    [-6.2, -0.6], [6.2, -0.6], [0, -4.4], [-13, -4.4], [13.4, -5.4], [-8.6, -9.4],
    [8.8, -9.6], [0, -9.8], [0, -14.6], [-3.4, -17.6], [3.6, -17.2],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edges = [
    [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [1, 7], [2, 8], [5, 7], [6, 8],
    [7, 9], [8, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14], [10, 12], [11, 13],
    [12, 14], [13, 14], [14, 15], [15, 16], [15, 17], [12, 16], [13, 17],
  ];

  return { colliders, shootables, group, site, playerSpawn, botSpawns, posts, waypoints, edges };
}
