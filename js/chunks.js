import * as THREE from 'three';
import { GRID_SIZE, TILE_SIZE } from './world.js';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MELT_INTERVAL = .1; // seconds between tile removals
const FADE_DURATION  = 1.0; // seconds for a melted tile to fade to transparent

const HALF       = GRID_SIZE / 2;        // grid half = 80
const WORLD_HALF = HALF * TILE_SIZE;     // world half = 40 wu

// ── Shared module-level resources ─────────────────────────────────────────────

// Single geometry instance shared by all FadingTile meshes — never disposed.
const _FADING_GEO = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.2, TILE_SIZE);

// Scratch Object3D for building instance matrices without per-frame allocation.
const _DUMMY = new THREE.Object3D();

// Zero-scale matrix used to hide individual InstancedMesh instances.
const _ZERO_MAT4 = new THREE.Matrix4().makeScale(0, 0, 0);

// 4-connected neighbour offsets.
const _NEIGHBOURS = [[1,0],[-1,0],[0,1],[0,-1]];

// ── FadingTile ────────────────────────────────────────────────────────────────

class FadingTile {
  constructor(scene, gx, gz) {
    // Each tile gets its own material (opacity varies) but shares the geometry.
    const mat = new THREE.MeshBasicMaterial({ color: 0xA8D8EA, transparent: true, opacity: 1.0 });
    this.mesh = new THREE.Mesh(_FADING_GEO, mat);
    this.mesh.position.set(
      (gx + 0.5) * TILE_SIZE - WORLD_HALF,
      TILE_SIZE * 0.1,
      (gz + 0.5) * TILE_SIZE - WORLD_HALF
    );
    scene.add(this.mesh);
    this._scene   = scene;
    this._elapsed = 0;
    this.dead     = false;
  }

  update(delta) {
    this._elapsed += delta;
    const t = Math.min(this._elapsed / FADE_DURATION, 1);
    this.mesh.material.opacity = 1 - t;
    if (t >= 1) this._dispose();
  }

  _dispose() {
    this.mesh.material.dispose(); // geometry is shared — never dispose it here
    this._scene.remove(this.mesh);
    this.dead = true;
  }
}

// ── Chunk ─────────────────────────────────────────────────────────────────────

class Chunk {
  /**
   * @param {THREE.Scene}                  scene
   * @param {Array<{gx:number,gz:number}>} tiles  grid cells that form this island
   */
  constructor(scene, tiles) {
    this._scene = scene;

    // Map from "gx,gz" key → {gx, gz} — single source of truth for membership.
    this._tiles = new Map(tiles.map(t => [`${t.gx},${t.gz}`, t]));
    // Map from tile key → InstancedMesh instance index (index never changes).
    this._instanceIndex = new Map();
    // Set of border tile keys, maintained incrementally to avoid O(N) scans.
    this._border = new Set();

    this._meltTimer   = 0;
    this._fadingTiles = [];
    this.dead         = false;

    // ── InstancedMesh — one instance per tile ─────────────────────────────────
    // Removed tiles are hidden by zeroing their matrix; no geometry rebuild needed.
    const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.2, TILE_SIZE);
    const mat = new THREE.MeshBasicMaterial({ color: 0xA8D8EA });
    this.mesh = new THREE.InstancedMesh(geo, mat, tiles.length);

    tiles.forEach((t, i) => {
      const key = `${t.gx},${t.gz}`;
      _DUMMY.position.set(
        (t.gx + 0.5) * TILE_SIZE - WORLD_HALF,
        TILE_SIZE * 0.1,
        (t.gz + 0.5) * TILE_SIZE - WORLD_HALF
      );
      _DUMMY.scale.setScalar(1);
      _DUMMY.updateMatrix();
      this.mesh.setMatrixAt(i, _DUMMY.matrix);
      this._instanceIndex.set(key, i);
    });
    this.mesh.instanceMatrix.needsUpdate = true;

    scene.add(this.mesh);

    // ── Initialise border set (O(N) once at construction) ─────────────────────
    for (const [key, { gx, gz }] of this._tiles) {
      if (_NEIGHBOURS.some(([dx, dz]) => !this._tiles.has(`${gx + dx},${gz + dz}`))) {
        this._border.add(key);
      }
    }
  }

  // ── Per-frame update ──────────────────────────────────────────────────────────

  /** @param {number} delta  seconds since last frame */
  update(delta) {
    if (this.dead) return;

    // Tick and prune fading tiles
    for (const ft of this._fadingTiles) ft.update(delta);
    this._fadingTiles = this._fadingTiles.filter(ft => !ft.dead);

    // Once the mesh is gone (all tiles removed), wait for fades to finish
    if (!this.mesh) {
      if (this._fadingTiles.length === 0) this.dead = true;
      return;
    }

    // Melt — shed one border tile on each interval tick
    this._meltTimer += delta;
    if (this._meltTimer >= MELT_INTERVAL) {
      this._meltTimer -= MELT_INTERVAL;
      this._meltOneTile();
    }
  }

  // ── Internal tile removal ─────────────────────────────────────────────────────

  /**
   * Remove one tile: update data structures, zero its instance matrix,
   * spawn a fading ghost, and refresh the incremental border set.
   * Caller is responsible for disposing the mesh when _tiles becomes empty.
   * @param {string} key  "gx,gz"
   */
  _removeTile(key) {
    const { gx, gz } = this._tiles.get(key);
    this._tiles.delete(key);
    this._border.delete(key);

    // Hide the instance — O(1), no geometry rebuild.
    this.mesh.setMatrixAt(this._instanceIndex.get(key), _ZERO_MAT4);
    this.mesh.instanceMatrix.needsUpdate = true;

    // Ghost tile fades out at the removed position.
    this._fadingTiles.push(new FadingTile(this._scene, gx, gz));

    // Neighbours still in the chunk gain an exposed face → they are now border.
    for (const [dx, dz] of _NEIGHBOURS) {
      const nKey = `${gx + dx},${gz + dz}`;
      if (this._tiles.has(nKey)) this._border.add(nKey);
    }
  }

  _disposeMesh() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._scene.remove(this.mesh);
    this.mesh = null;
  }

  // ── Melt ──────────────────────────────────────────────────────────────────────

  _meltOneTile() {
    // Pick from the border set (O(√N) for compact shapes); fall back to all tiles.
    const pool = this._border.size > 0 ? this._border : this._tiles;
    const keys = [...pool];
    const key  = keys[Math.floor(Math.random() * keys.length)];

    this._removeTile(key);
    if (this._tiles.size === 0) this._disposeMesh();
  }

  // ── Boat carving ──────────────────────────────────────────────────────────────

  /**
   * Remove all tiles whose grid coords appear in cellSet (boat footprint).
   * @param {Set<string>} cellSet  keys of the form "gx,gz"
   */
  carve(cellSet) {
    if (this.dead || !this.mesh) return;

    let anyRemoved = false;
    for (const key of cellSet) {
      if (!this._tiles.has(key)) continue;
      this._removeTile(key);
      anyRemoved = true;
    }

    if (anyRemoved && this._tiles.size === 0) this._disposeMesh();
  }

  hasTile(gx, gz) {
    return this._tiles.has(`${gx},${gz}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  _destroy() {
    if (this.mesh) this._disposeMesh();
    for (const ft of this._fadingTiles) ft._dispose();
    this._fadingTiles = [];
    this.dead = true;
  }
}

// ── ChunkManager ──────────────────────────────────────────────────────────────

export class ChunkManager {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene  = scene;
    /** @type {Chunk[]} */
    this._chunks = [];
  }

  /**
   * Instantiate a Chunk for each newly enclosed ice region.
   * Call this with the array returned by World.getNewChunks().
   * @param {Array<Array<{gx:number,gz:number}>>} tileLists
   */
  spawnChunks(tileLists) {
    for (const tiles of tileLists) {
      if (tiles.length > 0) this._chunks.push(new Chunk(this._scene, tiles));
    }
  }

  /** @param {number} delta  seconds since last frame */
  update(delta) {
    for (const chunk of this._chunks) chunk.update(delta);
    // Prune fully-melted chunks each frame
    this._chunks = this._chunks.filter(c => !c.dead);
  }

  /**
   * Carve the boat's footprint through any chunks it overlaps.
   * Call once per frame with the footprint returned by Boat.update().
   * @param {Array<{gx:number,gz:number}>} footprint
   */
  carveTiles(footprint) {
    const cellSet = new Set(footprint.map(c => `${c.gx},${c.gz}`));
    for (const chunk of this._chunks) chunk.carve(cellSet);
  }

  hasTile(gx, gz) {
    return this._chunks.some(chunk => chunk.hasTile(gx, gz));
  }
}
