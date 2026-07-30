import * as THREE        from 'three';
import { Renderer }      from './renderer.js';
import { World }         from './world.js';
import { Boat }          from './boat.js';
import { ChunkManager }  from './chunks.js';
import { RouteBoatManager } from './routes.js';

const canvas = document.getElementById('c');

// ── Start screen ──────────────────────────────────────────────────────────────
let selectedBoat = 'classic';
let selectedMode = 'mission';

document.querySelectorAll('.boat-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.boat-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedBoat = card.dataset.type;
  });
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMode = btn.dataset.mode;
  });
});

document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-screen').style.display = 'none';
  startGame(selectedBoat, selectedMode);
});

document.getElementById('menu-btn').addEventListener('click', () => {
  document.getElementById('end-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'flex';
});

// ── Game ──────────────────────────────────────────────────────────────────────
function formatTime(sec) {
  const total = Math.ceil(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function startGame(boatType, gameMode) {
  const renderer     = new Renderer(canvas);
  const world        = new World(gameMode);
  const boat         = new Boat(renderer.scene, boatType);
  const chunkManager = new ChunkManager(renderer.scene);
  const hudEl    = document.getElementById('mission-hud');
  const hudTimer = document.getElementById('hud-timer');
  const hudScore = document.getElementById('hud-score');
  const hudBoat  = document.getElementById('hud-boat');

  let gameRunning = true;

  const routeBoats = gameMode === 'freeplay'
    ? null
    : new RouteBoatManager(renderer.scene, world, chunkManager, {
        onTick(secondsLeft, totalScore, boatsCrossed) {
          hudTimer.textContent = formatTime(secondsLeft);
          hudScore.textContent = `SCORE: ${totalScore}`;
          hudBoat.textContent  = `BOAT ${boatsCrossed + 1} OF 5`;
        },
        onGameOver(totalScore) {
          gameRunning = false;
          hudEl.style.display = 'none';
          document.getElementById('final-score').textContent = `SCORE: ${totalScore}`;
          document.getElementById('end-screen').style.display = 'flex';
        },
      });

  if (gameMode === 'mission') hudEl.style.display = 'flex';

  renderer.initIceMesh(world);

  // ── Horn ────────────────────────────────────────────────────────────────────
  let audioCtx = null;

  function playHorn() {
    if (!audioCtx) audioCtx = new AudioContext();

    const ctx = audioCtx;
    const now = ctx.currentTime;
    const duration = 1.2;

    // Low-pass to round off harshness
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;

    // Amplitude envelope
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.35, now + 0.08);
    masterGain.gain.setValueAtTime(0.35, now + duration - 0.15);
    masterGain.gain.linearRampToValueAtTime(0, now + duration);

    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Open 5th harmonic stack: root, 5th, octave, octave+5th, 2nd octave
    const harmonics = [
      { freq: 110,  amp: 0.55 },  // root          (A2)
      { freq: 165,  amp: 0.45 },  // perfect 5th   (E3)
      { freq: 220,  amp: 0.25 },  // octave        (A3)
      { freq: 330,  amp: 0.18 },  // octave + 5th  (E4)
      { freq: 440,  amp: 0.10 },  // 2nd octave    (A4)
    ];

    for (const { freq, amp } of harmonics) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const oscGain = ctx.createGain();
      oscGain.gain.value = amp;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(now);
      osc.stop(now + duration);
    }
  }

  // ── Horn touch button ──────────────────────────────────────────────────────
  const hornBtn = document.getElementById('horn-btn');
  if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
    hornBtn.style.display = 'flex';
    hornBtn.style.alignItems = 'center';
    hornBtn.style.justifyContent = 'center';
    hornBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      playHorn();
    }, { passive: false });
  }

  // ── Mouse click-to-move ───────────────────────────────────────────────────
  const _raycaster   = new THREE.Raycaster();
  const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hitPoint    = new THREE.Vector3();
  let   mouseTarget  = null; // { x, z } world-space target while LMB held

  function updateMouseTarget(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndcX =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((clientY - rect.top)  / rect.height) * 2 + 1;
    _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), renderer.camera);
    if (_raycaster.ray.intersectPlane(_groundPlane, _hitPoint)) {
      mouseTarget = { x: _hitPoint.x, z: _hitPoint.z };
    }
  }

  // Mouse
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    updateMouseTarget(e.clientX, e.clientY);
  });
  canvas.addEventListener('mousemove', e => {
    if (e.buttons & 1) updateMouseTarget(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 0) mouseTarget = null;
  });

  // Touch
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    updateMouseTarget(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    updateMouseTarget(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', () => { mouseTarget = null; });

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const keys = {};
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat) { playHorn(); e.preventDefault(); return; }
    keys[e.code] = true;
    // Prevent arrow keys from scrolling the page
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  // ── Game loop ──────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();

  function loop() {
    if (!gameRunning) return;
    const delta = clock.getDelta();

    // Move boat; get all grid cells covered by the hull width
    const footprint = boat.update(keys, delta, mouseTarget);

    // Keep the camera centred on the boat
    renderer.setCameraTarget(boat.x, boat.z);

    // Carve ice across the full hull footprint
    for (const { gx, gz } of footprint) {
      if (world.breakIce(gx, gz)) renderer.hideIceTile(gx, gz);
    }

    // Also carve through any separated ice chunks the boat overlaps
    chunkManager.carveTiles(footprint);

    // Check for newly enclosed ice islands and spawn drifting chunks
    const newChunks = world.getNewChunks();
    if (newChunks.length) {
      // Hide the InstancedMesh tiles (chunk has its own separate mesh)
      for (const cells of newChunks) {
        for (const { gx: cx, gz: cz } of cells) renderer.hideIceTile(cx, cz);
      }
      chunkManager.spawnChunks(newChunks);
    }

    chunkManager.update(delta);
    if (routeBoats) routeBoats.update(delta);

    renderer.render();
    requestAnimationFrame(loop);
  }

  loop();
}
