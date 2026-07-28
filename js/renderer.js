import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────────────────────────

export const PIXEL_W   = 640;   // low-res render target width
export const PIXEL_H   = 480;   // low-res render target height
export const GRID_SIZE = 160;   // world grid cells (board is always GRID_SIZE × TILE_SIZE = 80 wu)
const TILE_SIZE = 0.5;          // world units per grid cell

// Palette
const COLOR_WATER  = 0x1C3A5E;
const COLOR_ICE    = 0xD8EEF5;
const COLOR_BORDER = 0x0A1828; // darker navy frame around the map edge

// Isometric camera frustum for the zoomed-in follow-cam.
// fH = 12 ≈ 4× zoom vs. the original full-board value of 50;
// shows roughly a 20×20 tile window around the boat at any time.
const FRUSTUM_HALF_H = 12;

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;

    // ── WebGLRenderer ────────────────────────────────────────────────────────
    // Always renders at the canvas's CSS layout resolution so the display quad
    // fills the screen. setPixelRatio(1) prevents DPR scaling on the backing store.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.gl.setPixelRatio(1);

    // ── Low-resolution render target (pixel aesthetic) ───────────────────────
    // NearestFilter on both min and mag: no bilinear smoothing when upscaled.
    this.rt = new THREE.WebGLRenderTarget(PIXEL_W, PIXEL_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });

    // ── Game scene ───────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLOR_WATER);

    // Isometric orthographic camera — equal-distance on all three axes for a
    // true isometric projection. Position (60,60,60) → lookAt origin.
    const aspect = PIXEL_W / PIXEL_H;
    const fH = FRUSTUM_HALF_H;
    this.camera = new THREE.OrthographicCamera(
      -fH * aspect,   // left
       fH * aspect,   // right
       fH,            // top
      -fH,            // bottom
      0.1, 500
    );
    this.camera.position.set(60, 60, 60);
    this.camera.lookAt(0, 0, 0);

    // Water background plane — flat on XZ, slightly below ice tile level (y = 0).
    // Covers the full grid plus a margin so no background colour bleeds through.
    const waterGeo = new THREE.PlaneGeometry(GRID_SIZE * TILE_SIZE + 8, GRID_SIZE * TILE_SIZE + 8);
    const waterMat = new THREE.MeshBasicMaterial({ color: COLOR_WATER });
    const waterPlane = new THREE.Mesh(waterGeo, waterMat);
    waterPlane.rotation.x = -Math.PI / 2;
    waterPlane.position.y = -0.01; // just below ice slab surface
    this.scene.add(waterPlane);

    // ── Map border ───────────────────────────────────────────────────────────
    // Four dark navy strips forming a frame just outside the 80×80 grid so the
    // edge of the map is always visible even when all border ice is gone.
    {
      const borderMat   = new THREE.MeshBasicMaterial({ color: COLOR_BORDER });
      const half        = GRID_SIZE * TILE_SIZE / 2; // 40 wu — half the board width
      const thickness   = 1.0;                        // world units wide
      const borderY     = -0.005;                     // just above the water plane
      const outerOffset = half + thickness / 2;
      const innerLen    = half * 2;                   // 80 wu — parallel side length
      const outerLen    = innerLen + thickness * 2;   // 82 wu — includes corners

      [
        // [planeW, planeD, cx, cz]  — north, south, west, east
        [outerLen, thickness,  0,            -outerOffset],
        [outerLen, thickness,  0,             outerOffset],
        [thickness, innerLen, -outerOffset,   0           ],
        [thickness, innerLen,  outerOffset,   0           ],
      ].forEach(([w, d, cx, cz]) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), borderMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(cx, borderY, cz);
        this.scene.add(m);
      });
    }

    // ── Ice InstancedMesh (populated in Phase 2 by initIceMesh) ─────────────
    this._dummy    = new THREE.Object3D();
    this.iceMesh   = null; // set in initIceMesh()

    // ── Display scene — blits the low-res RT to the full-resolution canvas ───
    // A 2×2 plane covers NDC space exactly; OrthographicCamera(-1,1,1,-1) maps 1:1.
    this.displayScene  = new THREE.Scene();
    this.displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMat = new THREE.MeshBasicMaterial({ map: this.rt.texture });
    this.displayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

    // ── Resize handling ──────────────────────────────────────────────────────
    // ResizeObserver fires on initial layout and on every size change, keeping
    // the WebGLRenderer's backing store matched to the canvas CSS dimensions.
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) this.gl.setSize(w, h, false); // false = don't touch CSS
    });
    ro.observe(canvas);
  }

  // ── Camera follow ────────────────────────────────────────────────────────────

  /**
   * Re-centre the isometric camera on a world-space point each frame.
   * The camera keeps its (1,1,1) isometric angle; only the target moves.
   * @param {number} x  world X (boat position)
   * @param {number} z  world Z (boat position)
   */
  setCameraTarget(x, z) {
    this.camera.position.set(x + 60, 60, z + 60);
    this.camera.lookAt(x, 0, z);
  }

  // ── Phase 2: Ice InstancedMesh ─────────────────────────────────────────────

  /**
   * Build the ice InstancedMesh from the initial world grid.
   * Called once after World is ready.
   * @param {import('./world.js').World} world
   */
  initIceMesh(world) {
    const count  = GRID_SIZE * GRID_SIZE;
    const iceGeo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE * 0.2, TILE_SIZE);
    const iceMat = new THREE.MeshBasicMaterial({ color: COLOR_ICE });
    this.iceMesh = new THREE.InstancedMesh(iceGeo, iceMat, count);
    this.iceMesh.count = count;

    const half = GRID_SIZE / 2;
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const i = gz * GRID_SIZE + gx;
        const x = (gx + 0.5) * TILE_SIZE - half * TILE_SIZE;
        const z = (gz + 0.5) * TILE_SIZE - half * TILE_SIZE;
        this._dummy.position.set(x, TILE_SIZE * 0.1, z);
        this._dummy.scale.setScalar(world.isIce(gx, gz) ? 1 : 0);
        this._dummy.updateMatrix();
        this.iceMesh.setMatrixAt(i, this._dummy.matrix);
      }
    }
    this.iceMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.iceMesh);
  }

  /**
   * Convert one ice tile to water by zeroing its instance scale.
   * @param {number} gx  grid X (column)
   * @param {number} gz  grid Z (row)
   */
  hideIceTile(gx, gz) {
    if (!this.iceMesh) return;
    const i = gz * GRID_SIZE + gx;
    const half = GRID_SIZE / 2;
    this._dummy.position.set((gx + 0.5) * TILE_SIZE - half * TILE_SIZE, TILE_SIZE * 0.1, (gz + 0.5) * TILE_SIZE - half * TILE_SIZE);
    this._dummy.scale.setScalar(0);
    this._dummy.updateMatrix();
    this.iceMesh.setMatrixAt(i, this._dummy.matrix);
    this.iceMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    // Pass 1 — render the game world into the low-res pixel target
    this.gl.setRenderTarget(this.rt);
    this.gl.render(this.scene, this.camera);

    // Pass 2 — blit the pixel target onto the full-resolution canvas
    this.gl.setRenderTarget(null);
    this.gl.render(this.displayScene, this.displayCamera);
  }
}
