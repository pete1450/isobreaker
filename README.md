
# Icebreaker

A browser-based isometric icebreaker game built with [Three.js](https://threejs.org/) — no build step required.

Drive a boat across an 80×80 ice sheet, carve water trails, and watch enclosed ice regions break off as drifting chunks that slowly melt away.

<img width="595" height="443" alt="Screenshot 2026-07-27 205827" src="https://github.com/user-attachments/assets/d07d22e3-7677-4199-b768-ab74003ecbf0" />
<img width="662" height="496" alt="Screenshot 2026-07-27 205802" src="https://github.com/user-attachments/assets/a818e8da-f3df-495a-8ab6-61b5bbf3d851" />

## Controls

| Key | Action |
|---|---|
| `↑` / `↓` | Move forward / reverse |
| `←` / `→` | Rotate left / right |
| `Space` | Sound horn |

Touch controls also work choose a destination for the boat.

## How to Play

1. Place `index.html` on a server and open it
2. Choose your boat type on the start screen.
3. Steer the boat to carve a water path through the ice.
4. Completely encircle a region of ice — it detaches and begins melting.
5. Watch for escort boats at the edge of the board and clear a wide enough path along their dotted route so they can cross.

## Project Structure

```
index.html          - Game page, Three.js CDN import map, start screen UI
js/
  main.js           - Game loop, orchestration, keyboard input
  routes.js         - Escort boat routes, dotted path markers, and crossing logic
  world.js          - 80×80 grid state, breakIce(), floodFill(), getNewChunks()
  renderer.js       - Three.js scene, pixel render target, InstancedMesh, syncIceMesh()
  boat.js           - Boat controls, movement, and mesh
  chunks.js         - ChunkManager: drift + melt lifecycle
```

## Technical Notes

- Renders at **640×480** into a `WebGLRenderTarget` scaled up with `NearestFilter` for a chunky pixel art look (`image-rendering: pixelated`).
- Isometric view via a `THREE.OrthographicCamera` positioned at `(60, 60, 60)` looking at the origin.
- Ice sheet uses a single `InstancedMesh` (`BoxGeometry 1×0.2×1`, up to 6 400 instances). Carved tiles are hidden by zeroing their scale.
- Enclosed ice detection uses a BFS flood-fill from all border water cells; unreachable ice cells form detached chunks.
- Drifting chunks are merged into a single `BufferGeometry` mesh and rebuilt as they melt tile by tile.
- Horn SFX is synthesised via the Web Audio API (no audio files required).

## Color Palette

| Element | Hex |
|---|---|
| Ice sheet | `#D8EEF5` |
| Water | `#1C3A5E` |
| Boat hull | `#8B4513` |
| Boat cabin | `#F4A460` |
| Drifting chunk | `#A8D8EA` |
