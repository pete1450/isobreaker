# Plan: Three.js Icebreaker Browser Game

**TL;DR** — A single-page browser game with no build step. Three.js (loaded via CDN) renders an isometric view of an 80×80 ice sheet at pixel resolution using a low-res `WebGLRenderTarget` scaled up with nearest-neighbor filtering. The boat carves water, and a flood-fill algorithm detects enclosed ice regions that become drifting, melting chunks.

---

### Phase 1 — Project Shell & Renderer

1. Create `index.html` — canvas element, Three.js CDN import via `<script type="importmap">`, loads `js/main.js` as a module
2. Create `js/renderer.js` — `Renderer` class:
   - `THREE.WebGLRenderTarget` at **320×240** (pixel resolution)
   - Main scene + `THREE.OrthographicCamera` at `(60, 60, 60)` → `lookAt(0,0,0)` for true isometric
   - Display scene: fullscreen `PlaneGeometry` quad with the render target as a `NearestFilter` texture, drawn by a second ortho camera
   - CSS `image-rendering: pixelated` on the canvas
3. Add a water background plane (`#1C3A5E` flat color) at `y = 0` filling the whole grid

### Phase 2 — World Grid

4. Create `js/world.js` — `World` class:
   - `Uint8Array(80×80)` — `0 = ice`, `1 = water`
   - 2-cell-wide water border pre-filled; all interior cells start as ice
   - `breakIce(gx, gz)` — converts a cell to water, records it as dirty
   - `floodFill()` — BFS from all border water cells; any ice **not** reachable = enclosed
   - `getNewChunks()` — 4-connected component labeling of enclosed ice cells → returns array of tile-coordinate lists
5. Add `InstancedMesh(BoxGeometry(1, 0.2, 1), iceMaterial, 6400)` for ice tiles in `Renderer`; hide converted tiles by zeroing their instance scale

### Phase 3 — Boat

6. Create `js/boat.js` — `Boat` class:
   - State: `{ x, z, angle }`
   - `update(keys, delta)`: ArrowLeft/Right rotates at ±2.5 rad/s; ArrowUp/Down moves at ±6 units/s in `(sin(angle), cos(angle))` direction
   - Position clamped to grid interior bounds
   - Returns current grid cell `(gx, gz)` for the world to process
7. Boat mesh: two `BoxGeometry` objects (hull + cabin) in a `Group`, rotating on the Y axis

### Phase 4 — Ice Chunk Drift & Melt

8. Create `js/chunks.js` — `ChunkManager` class:
   - On chunk creation: tiles removed from world grid (marked water), merged into a single `BufferGeometry` mesh using `BufferGeometryUtils.mergeGeometries()` — color `#A8D8EA`
   - **Drift**: random slow XZ velocity (0.02–0.05 units/frame) applied to `mesh.position` each frame
   - **Melt**: every 2.5 s, identify the chunk's border tiles (adjacent to non-chunk positions), remove one at random, rebuild the merged geometry
   - When `tiles.length === 0`: dispose mesh + remove from scene

### Phase 5 — Game Loop Integration

9. Create `js/main.js`:
   - Init all modules, wire together
   - `requestAnimationFrame` loop: `boat.update()` → `world.breakIce()` → `world.getNewChunks()` → `chunkMgr.spawnChunks()` → `chunkMgr.update(delta)` → `renderer.syncIceMesh()` → `renderer.render()`
   - Keyboard state via `keydown`/`keyup` into a plain `keys` object

---

### File Structure

```
index.html
js/
  main.js       - game loop, orchestration
  world.js      - World: grid state, breakIce(), floodFill(), getNewChunks()
  renderer.js   - Renderer: scene, pixel render target, InstancedMesh, syncIceMesh(), createChunkMesh()
  boat.js       - Boat: controls and movement
  chunks.js     - ChunkManager: drift + melt lifecycle
```

### Pixel Color Palette

| Element          | Hex       |
|------------------|-----------|
| Ice (main sheet) | `#D8EEF5` |
| Water background | `#1C3A5E` |
| Boat hull        | `#8B4513` |
| Boat cabin       | `#F4A460` |
| Drifting chunk   | `#A8D8EA` |

### Verification

1. Open `index.html` directly in a browser — isometric ice sheet renders, no console errors
2. Arrow keys rotate and drive boat; a single-tile-wide water trail appears behind it
3. Completely encircle a region of ice — it detaches, begins drifting
4. Drifting chunk visibly shrinks tile by tile over ~25 seconds, then disappears
5. Boat cannot leave the grid bounds
6. Pixel rendering is visibly chunky — no bilinear smoothing artifacts

---

**Excluded scope**: no audio, no mobile/touch controls, no score display, no particle effects, no tile animations (water shimmer etc.) — all straightforward additions later if desired.
