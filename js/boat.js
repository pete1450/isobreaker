import * as THREE from 'three';
import { GRID_SIZE, TILE_SIZE } from './world.js';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MOVE_SPEED = 6.0;  // world units per second (forward / backward)
const TURN_SPEED = 2.5;  // radians per second     (left / right)

// Keep the boat inside the world bounds (world is always 80 wu wide)
const HALF       = GRID_SIZE / 2;              // grid half-cell count = 80
const WORLD_HALF = HALF * TILE_SIZE;           // world half-size = 40 wu
const MIN_POS    = -WORLD_HALF + TILE_SIZE;    // -39.5
const MAX_POS    =  WORLD_HALF - TILE_SIZE;    //  39.5

// ── Palette ───────────────────────────────────────────────────────────────────

const BOAT_STYLES = {
  classic: { hull: 0x8B4513, cabin: 0xF4A460, bow: 0xCC3300 },
  arctic:  { hull: 0xCCE4F8, cabin: 0x1a3a6e, bow: 0xFF6600 },
};

const SMOKE_INTERVAL = 0.12; // seconds between smoke puff spawns
const SMOKE_LIFE     = 3.5;  // seconds for a puff to fully fade

// ── SmokeParticle ─────────────────────────────────────────────────────────────

class SmokeParticle {
  constructor(scene, x, y, z) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 1.0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, y, z);
    scene.add(this.mesh);
    this._scene   = scene;
    this._elapsed = 0;
    this._vx      = (Math.random() - 0.5) * 0.5; // gentle random horizontal drift
    this._vz      = (Math.random() - 0.5) * 0.5;
    this.dead     = false;
  }

  update(delta) {
    this._elapsed += delta;
    const t = Math.min(this._elapsed / SMOKE_LIFE, 1);
    this.mesh.material.opacity = 1 - t;
    this.mesh.position.y += 1.2 * delta;      // rise upward
    this.mesh.position.x += this._vx * delta;
    this.mesh.position.z += this._vz * delta;
    this.mesh.scale.setScalar(1 + t * 2.5);   // expand as it rises
    if (t >= 1) this._dispose();
  }

  _dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._scene.remove(this.mesh);
    this.dead = true;
  }
}

// ── Boat ──────────────────────────────────────────────────────────────────────

export class Boat {
  /**
   * @param {THREE.Scene} scene    game scene to add the mesh to
   * @param {string}      boatType 'classic' | 'arctic' | 'tugboat'
   */
  constructor(scene, boatType = 'classic') {
    // World-space position and facing angle (radians, Y-axis)
    this.x     = 0;
    this.z     = 0;
    this.angle = 0; // 0 = facing +Z (isometric lower-left)
    this._scene = scene;

    // ── Three.js mesh ─────────────────────────────────────────────────────────
    this.group = new THREE.Group();

    if (boatType === 'tugboat') {
      // ── Tugboat: wide, boxy harbour tug ────────────────────────────────────
      const C_HULL  = 0xCC2200;   // red hull body
      const C_BAND  = 0x4488CC;   // blue upper-hull stripe
      const C_CABIN = 0xF5C540;   // yellow superstructure
      const C_ROOF  = 0xBB2233;   // red cabin roof
      const C_STACK = 0xEEE8D0;   // cream smokestack
      const C_FEND  = 0x222222;   // dark rubber fenders

      // Hull — wide and short
      const tHull = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.3, 1.9),
        new THREE.MeshBasicMaterial({ color: C_HULL })
      );
      this.group.add(tHull);

      // Blue upper-hull band (sits on top half of hull sides)
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(1.42, 0.12, 1.92),
        new THREE.MeshBasicMaterial({ color: C_BAND })
      );
      band.position.set(0, 0.09, 0);
      this.group.add(band);

      // Yellow cabin / wheelhouse
      // Hull top = 0.15; cabin half-height = 0.24 → centre at 0.39
      const tCabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.48, 0.88),
        new THREE.MeshBasicMaterial({ color: C_CABIN })
      );
      tCabin.position.set(0, 0.39, 0.12);
      this.group.add(tCabin);

      // Red cabin roof (slightly wider than cabin)
      // Cabin top = 0.63; roof half = 0.045 → centre at 0.675
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.90, 0.09, 0.95),
        new THREE.MeshBasicMaterial({ color: C_ROOF })
      );
      roof.position.set(0, 0.675, 0.12);
      this.group.add(roof);

      // Cream smokestack — tapered cylinder, placed aft of cabin
      // Roof top = 0.72; stack half = 0.30 → centre at 1.02; top at 1.32
      const tStack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.10, 0.13, 0.60, 8),
        new THREE.MeshBasicMaterial({ color: C_STACK })
      );
      tStack.position.set(0, 1.02, -0.08);
      this.group.add(tStack);

      // Red stripe ring near stack top
      const ringTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.103, 0.103, 0.07, 8),
        new THREE.MeshBasicMaterial({ color: C_ROOF })
      );
      ringTop.position.set(0, 1.285, -0.08);
      this.group.add(ringTop);

      // Red stripe ring at stack base
      const ringBot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.132, 0.132, 0.07, 8),
        new THREE.MeshBasicMaterial({ color: C_ROOF })
      );
      ringBot.position.set(0, 0.755, -0.08);
      this.group.add(ringBot);

      // Two portholes on cabin front face (cabin front local z = 0.12 + 0.44 = 0.56)
      for (const px of [-0.22, 0.22]) {
        const porthole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12),
          new THREE.MeshBasicMaterial({ color: 0x334477 })
        );
        porthole.rotation.x = Math.PI / 2;
        porthole.position.set(px, 0.39, 0.565);
        this.group.add(porthole);

        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.075, 0.018, 6, 12),
          new THREE.MeshBasicMaterial({ color: 0x999999 })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.set(px, 0.39, 0.565);
        this.group.add(rim);
      }

      // Rubber fenders along port and starboard sides
      for (const fz of [-0.7, -0.1, 0.5, 0.9]) {
        for (const fx of [-0.72, 0.72]) {
          const fender = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.038, 6, 12),
            new THREE.MeshBasicMaterial({ color: C_FEND })
          );
          fender.rotation.y = Math.PI / 2;
          fender.position.set(fx, 0, fz);
          this.group.add(fender);
        }
      }

      // Stack top local y = 1.32; world top = group.y(0.35) + 1.32 = 1.67
      this._stackLocalZ    = -0.08;
      this._stackWorldTopY = 1.67;
      this._groupY         = 0.35;

    } else {
      // ── Classic / Arctic ────────────────────────────────────────────────────
      const { hull: COLOR_HULL, cabin: COLOR_CABIN, bow: COLOR_BOW } =
        BOAT_STYLES[boatType] ?? BOAT_STYLES.classic;

      // Hull — long axis along local Z (direction of travel)
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.3, 2.2),
        new THREE.MeshBasicMaterial({ color: COLOR_HULL })
      );
      this.group.add(hull);

      // Wheelhouse cabin — sits on top, slightly aft of centre
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.35, 0.65),
        new THREE.MeshBasicMaterial({ color: COLOR_CABIN })
      );
      cabin.position.set(0, 0.325, -0.25); // 0.325 = hull half-height + cabin half-height
      this.group.add(cabin);

      // Bow accent — thin red wedge at the front tip
      const bow = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.32, 0.25),
        new THREE.MeshBasicMaterial({ color: COLOR_BOW })
      );
      bow.position.set(0, 0, 1.0); // front of hull
      this.group.add(bow);

      // Smokestack — tapered hexagonal cylinder on top of the cabin
      // Cabin top = 0.325 + 0.175 = 0.5; stack centre = 0.5 + 0.175 = 0.675
      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.10, 0.35, 6),
        new THREE.MeshBasicMaterial({ color: 0x222222 })
      );
      stack.position.set(0, 0.675, -0.25);
      this.group.add(stack);

      // Stack top local y = 0.85; world top = group.y(0.35) + 0.85 = 1.20
      this._stackLocalZ    = -0.25;
      this._stackWorldTopY = 1.20;
      this._groupY         = 0.35;
    }

    // Lift the whole group so the hull bottom sits just above the tile surface
    // Ice slab top is at y = 0.2; hull half-height = 0.15 → centre at y = 0.35
    this.group.position.set(this.x, this._groupY, this.z);

    this._smokeParticles = [];
    this._smokeTimer     = 0;

    scene.add(this.group);
  }

  // ── Update ────────────────────────────────────────────────────────────────────

  /**
   * Process input and advance boat state for one frame.
   *
   * Movement convention:
   *   local +Z = forward (bow direction).
   *   rotation.y = angle → local +Z maps to world (sin(angle), 0, cos(angle)).
   *   This keeps rotation.y and the movement vector in sync.
   *
   * @param {Record<string, boolean>} keys  live key-state map
   * @param {number}                  delta seconds since last frame
   * @returns {{ gx: number, gz: number }}  grid cell the boat currently occupies
   */
  update(keys, delta, mouseTarget = null) {
    // Rotation — ArrowLeft turns counter-clockwise (decreasing angle),
    // ArrowRight turns clockwise (increasing angle) when viewed from above.
    if (keys['ArrowLeft'])  this.angle += TURN_SPEED * delta;
    if (keys['ArrowRight']) this.angle -= TURN_SPEED * delta;

    // Translation — forward along local +Z = (sin(angle), 0, cos(angle))
    let keyMoving = false;
    if (keys['ArrowUp']) {
      this.x += Math.sin(this.angle) * MOVE_SPEED * delta;
      this.z += Math.cos(this.angle) * MOVE_SPEED * delta;
      keyMoving = true;
    }
    if (keys['ArrowDown']) {
      this.x -= Math.sin(this.angle) * MOVE_SPEED * delta;
      this.z -= Math.cos(this.angle) * MOVE_SPEED * delta;
      keyMoving = true;
    }

    // Mouse click-to-move — auto-steer and advance toward world target
    let mouseMoving = false;
    if (mouseTarget !== null) {
      const dx   = mouseTarget.x - this.x;
      const dz   = mouseTarget.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.3) {
        const desired = Math.atan2(dx, dz);
        const diff    = Math.atan2(Math.sin(desired - this.angle),
                                   Math.cos(desired - this.angle));
        const maxTurn = TURN_SPEED * delta;
        this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        this.x += Math.sin(this.angle) * MOVE_SPEED * delta;
        this.z += Math.cos(this.angle) * MOVE_SPEED * delta;
        mouseMoving = true;
      }
    }

    // Clamp inside grid bounds
    this.x = Math.max(MIN_POS, Math.min(MAX_POS, this.x));
    this.z = Math.max(MIN_POS, Math.min(MAX_POS, this.z));

    // Sync Three.js transform
    this.group.position.set(this.x, this._groupY, this.z);
    this.group.rotation.y = this.angle;

    // Smoke — emit while moving, update all active particles
    if (keyMoving || mouseMoving) {
      this._smokeTimer += delta;
      while (this._smokeTimer >= SMOKE_INTERVAL) {
        this._smokeTimer -= SMOKE_INTERVAL;
        this._spawnSmoke();
      }
    }
    for (const p of this._smokeParticles) p.update(delta);
    this._smokeParticles = this._smokeParticles.filter(p => !p.dead);

    // Return all grid cells within the boat's hull width (3 tiles wide,
    // perpendicular to the heading — matches the 0.8 wu hull at 0.5 wu/tile).
    const perpX  = Math.cos(this.angle);
    const perpZ  = -Math.sin(this.angle);
    const cells  = [];
    for (const d of [-TILE_SIZE, 0, TILE_SIZE]) {
      const gx = Math.floor((this.x + perpX * d + WORLD_HALF) / TILE_SIZE);
      const gz = Math.floor((this.z + perpZ * d + WORLD_HALF) / TILE_SIZE);
      if (!cells.some(c => c.gx === gx && c.gz === gz)) cells.push({ gx, gz });
    }
    return cells;
  }

  _spawnSmoke() {
    // Rotate local stack offset by boat angle to get world position.
    // local (0, stackTopY, stackLocalZ) → world dx = lz*sin(a), dz = lz*cos(a)
    const lz = this._stackLocalZ;
    const sx = this.x + lz * Math.sin(this.angle);
    const sy = this._stackWorldTopY;
    const sz = this.z + lz * Math.cos(this.angle);
    this._smokeParticles.push(new SmokeParticle(this._scene, sx, sy, sz));
  }
}
