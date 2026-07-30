// ── Constants ────────────────────────────────────────────────────────────────

export const GRID_SIZE = 160;
export const TILE_SIZE = 0.5; // world units per grid cell (board stays 80×80)

export const BORDER = 4;   // width of the pre-filled water border (ocean edge)

export const ICE   = 0;
export const WATER = 1;
export const CHUNK = 2; // cell detached from main mass; owned by ChunkManager

// 4-connected neighbour offsets [dgx, dgz]
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ── World ─────────────────────────────────────────────────────────────────────

export class World {
  constructor() {
    /** @type {Uint8Array}  flat row-major grid: index = gz * GRID_SIZE + gx */
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE); // default 0 = ICE

    // Pre-fill the border with water (the surrounding ocean)
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        if (gx < BORDER || gx >= GRID_SIZE - BORDER ||
            gz < BORDER || gz >= GRID_SIZE - BORDER) {
          this.grid[gz * GRID_SIZE + gx] = WATER;
        }
      }
    }

    this._dirty = false; // true whenever a cell changed since last getNewChunks()
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  /** @returns {boolean} */
  isIce(gx, gz) {
    return this.grid[gz * GRID_SIZE + gx] === ICE;
  }

  /** WATER and CHUNK both count as passable water for collision / rendering. */
  isWater(gx, gz) {
    return this.grid[gz * GRID_SIZE + gx] !== ICE;
  }

  inBounds(gx, gz) {
    return gx >= 0 && gx < GRID_SIZE && gz >= 0 && gz < GRID_SIZE;
  }

  // ── Mutation ─────────────────────────────────────────────────────────────────

  /**
   * Convert one ice cell to water (boat trail).
   * @returns {boolean}  true if the cell was ice and is now water
   */
  breakIce(gx, gz) {
    if (!this.inBounds(gx, gz)) return false;
    const i = gz * GRID_SIZE + gx;
    if (this.grid[i] !== ICE) return false;
    this.grid[i] = WATER;
    this._dirty = true;
    return true;
  }

  // ── Enclosed-region detection ─────────────────────────────────────────────

  /**
   * Runs 4-connected component labelling on all remaining ICE cells.
   * The largest component is considered the main ice mass and is left alone.
   * Every other component is a newly enclosed island → its cells are marked
   * CHUNK in the grid and returned as an array of { gx, gz } tile-lists.
   *
   * Returns [] and skips work if nothing has changed since last call.
   *
   * @returns {Array<Array<{gx:number, gz:number}>>}
   */
  getNewChunks() {
    if (!this._dirty) return [];
    this._dirty = false;

    const total  = GRID_SIZE * GRID_SIZE;
    const labels = new Int16Array(total).fill(-1); // -1 = unlabelled
    const components = []; // components[label] = [{gx, gz}, ...]

    for (let start = 0; start < total; start++) {
      if (this.grid[start] !== ICE || labels[start] !== -1) continue;

      // BFS flood-fill from this unlabelled ice cell
      const label = components.length;
      const cells = [];
      const queue = [start];
      labels[start] = label;
      let head = 0;

      while (head < queue.length) {
        const idx  = queue[head++];
        const gz   = (idx / GRID_SIZE) | 0;
        const gx   = idx % GRID_SIZE;
        cells.push({ gx, gz });

        for (const [dgx, dgz] of DIRS) {
          const nx = gx + dgx;
          const nz = gz + dgz;
          if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
          const n = nz * GRID_SIZE + nx;
          if (this.grid[n] === ICE && labels[n] === -1) {
            labels[n] = label;
            queue.push(n);
          }
        }
      }

      components.push(cells);
    }

    // With 0 or 1 components nothing is isolated
    if (components.length <= 1) return [];

    // Largest component = main ice mass; everything else is a new chunk
    let mainIdx = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].length > components[mainIdx].length) mainIdx = i;
    }

    const newChunks = [];
    for (let i = 0; i < components.length; i++) {
      if (i === mainIdx) continue;
      const cells = components[i];
      // Mark cells as CHUNK so they are excluded from future analysis
      for (const { gx, gz } of cells) {
        this.grid[gz * GRID_SIZE + gx] = CHUNK;
      }
      newChunks.push(cells);
    }

    return newChunks;
  }
}
