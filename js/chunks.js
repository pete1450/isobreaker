import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID_SIZE, TILE_SIZE } from './world.js';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MELT_INTERVAL = .1; // seconds between tile removals
const FADE_DURATION  = 1.0; // seconds for a melted tile to fade to transparent

const HALF       = GRID_SIZE / 2;        // grid half = 80
const WORLD_HALF = HALF * TILE_SIZE;     // world half = 40 wu

// ── FadingTile ────────────────────────────────────────────────────────────────

class FadingTile {
  constructor(scene, gx, gz) {
    const geo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.2, TILE_SIZE);
    const mat = new THREE.MeshBasicMaterial({ color: 0xA8D8EA, transparent: true, opacity: 1.0 });
    this.mesh     = new THREE.Mesh(geo, mat);
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
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
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
    this.tiles  = [...tiles]; // own copy so caller can discard the original array

    // Fast O(1) membership test
    this._tileSet = new Set(this.tiles.map(t => `${t.gx},${t.gz}`));

    this._meltTimer  = 0;
    this._fadingTiles = [];
    this.dead         = false;

    this.mesh = new THREE.Mesh(
      this._buildGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xA8D8EA })
    );
    scene.add(this.mesh);
  }

  // ── Geometry ─────────────────────────────────────────────────────────────────

  /**
   * Merge individual tile boxes into one BufferGeometry.
   * Each tile is placed at the same world position the original ice tile occupied,
   * so the chunk appears exactly where the ice was when it detached.
   */
  _buildGeometry() {
    const geos = this.tiles.map(({ gx, gz }) => {
      const g = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.2, TILE_SIZE);
      g.translate((gx + 0.5) * TILE_SIZE - WORLD_HALF, TILE_SIZE * 0.1, (gz + 0.5) * TILE_SIZE - WORLD_HALF);
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach(g => g.dispose()); // release individual geometries immediately
    return merged;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────────

  /** @param {number} delta  seconds since last frame */
  update(delta) {
    if (this.dead) return;

    // Tick and prune fading tiles
    for (const ft of this._fadingTiles) ft.update(delta);
    this._fadingTiles = this._fadingTiles.filter(ft => !ft.dead);

    // Once the merged mesh is gone (all tiles melted), wait for fades to finish
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

  // ── Melt ──────────────────────────────────────────────────────────────────────

  _meltOneTile() {
    // Border = tiles that have at least one 4-connected neighbour outside the chunk
    const border = this.tiles.filter(({ gx, gz }) =>
      [[1,0],[-1,0],[0,1],[0,-1]].some(
        ([dx, dz]) => !this._tileSet.has(`${gx + dx},${gz + dz}`)
      )
    );

    // Fall back to the whole tile list if somehow all neighbours are inside
    // (only possible for a single isolated tile, which has no neighbours at all)
    const pool   = border.length > 0 ? border : this.tiles;
    const victim = pool[Math.floor(Math.random() * pool.length)];

    this._tileSet.delete(`${victim.gx},${victim.gz}`);
    this.tiles = this.tiles.filter(t => t !== victim);

    // Spawn a fade-out ghost at the removed tile's position
    this._fadingTiles.push(new FadingTile(this._scene, victim.gx, victim.gz));

    if (this.tiles.length === 0) {
      // No tiles left — remove the merged mesh now; update() waits for fades then dies
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this._scene.remove(this.mesh);
      this.mesh = null;
      return;
    }

    // Rebuild the merged geometry without the removed tile
    this.mesh.geometry.dispose();
    this.mesh.geometry = this._buildGeometry();
  }

  // ── Boat carving ──────────────────────────────────────────────────────────────

  /**
   * Remove all tiles whose grid coords appear in cellSet (boat footprint).
   * Rebuilds geometry once per call (not per tile) for efficiency.
   * @param {Set<string>} cellSet  keys of the form "gx,gz"
   */
  carve(cellSet) {
    if (this.dead || !this.mesh) return;

    const victims = this.tiles.filter(t => cellSet.has(`${t.gx},${t.gz}`));
    if (victims.length === 0) return;

    for (const v of victims) {
      this._tileSet.delete(`${v.gx},${v.gz}`);
      this._fadingTiles.push(new FadingTile(this._scene, v.gx, v.gz));
    }
    this.tiles = this.tiles.filter(t => !cellSet.has(`${t.gx},${t.gz}`));

    if (this.tiles.length === 0) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this._scene.remove(this.mesh);
      this.mesh = null;
      return;
    }

    this.mesh.geometry.dispose();
    this.mesh.geometry = this._buildGeometry();
  }

  hasTile(gx, gz) {
    return this._tileSet.has(`${gx},${gz}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  _destroy() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this._scene.remove(this.mesh);
      this.mesh = null;
    }
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
