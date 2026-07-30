import * as THREE from 'three';
import { BORDER, GRID_SIZE, TILE_SIZE } from './world.js';

const WORLD_HALF = (GRID_SIZE * TILE_SIZE) / 2;
const BOAT_Y = 0.35;
const TRAVEL_SPEED = 3.5;
const RESPAWN_DELAY = 2.0;
const LANE_MARGIN = BORDER + 8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function gridToWorld(gx, gz) {
  return {
    x: (gx + 0.5) * TILE_SIZE - WORLD_HALF,
    z: (gz + 0.5) * TILE_SIZE - WORLD_HALF,
  };
}

function pushCell(cells, gx, gz) {
  const last = cells[cells.length - 1];
  if (!last || last.gx !== gx || last.gz !== gz) cells.push({ gx, gz });
}

function buildCrossingPath(horizontal = true) {
  const minLane = LANE_MARGIN;
  const maxLane = GRID_SIZE - LANE_MARGIN - 1;

  let primary = BORDER;
  let secondary = randInt(minLane, maxLane);
  let targetSecondary = secondary;
  let stepsUntilTurn = 0;
  const cells = [];

  pushCell(cells, horizontal ? primary : secondary, horizontal ? secondary : primary);

  while (primary < GRID_SIZE - BORDER - 1) {
    if (stepsUntilTurn <= 0) {
      targetSecondary = clamp(secondary + randInt(-18, 18), minLane, maxLane);
      stepsUntilTurn = randInt(7, 15);
    }

    if (secondary !== targetSecondary && Math.random() < 0.65) {
      secondary += Math.sign(targetSecondary - secondary);
      pushCell(cells, horizontal ? primary : secondary, horizontal ? secondary : primary);
    }

    primary += 1;
    stepsUntilTurn -= 1;
    pushCell(cells, horizontal ? primary : secondary, horizontal ? secondary : primary);
  }

  return cells;
}

function buildTravelCells(pathCells, horizontal, reverse = false) {
  const route = reverse ? [...pathCells].reverse() : [...pathCells];
  const first = route[0];
  const last = route[route.length - 1];
  const travel = [];

  if (horizontal) {
    const dir = route[0].gx < route[route.length - 1].gx ? 1 : -1;
    pushCell(travel, first.gx - dir * 2, first.gz);
    pushCell(travel, first.gx - dir, first.gz);
  } else {
    const dir = route[0].gz < route[route.length - 1].gz ? 1 : -1;
    pushCell(travel, first.gx, first.gz - dir * 2);
    pushCell(travel, first.gx, first.gz - dir);
  }

  for (const cell of route) pushCell(travel, cell.gx, cell.gz);

  if (horizontal) {
    const dir = travel[travel.length - 1].gx > travel[travel.length - 2].gx ? 1 : -1;
    pushCell(travel, last.gx + dir, last.gz);
    pushCell(travel, last.gx + dir * 2, last.gz);
  } else {
    const dir = travel[travel.length - 1].gz > travel[travel.length - 2].gz ? 1 : -1;
    pushCell(travel, last.gx, last.gz + dir);
    pushCell(travel, last.gx, last.gz + dir * 2);
  }

  return travel;
}

export class RouteBoatManager {
  constructor(scene, world, chunkManager) {
    this._scene = scene;
    this._world = world;
    this._chunkManager = chunkManager;
    this._routeCells = [];
    this._travelPoints = [];
    this._state = 'cooldown';
    this._respawnTimer = 0;
    this._segmentIndex = 0;
    this._segmentDistance = 0;
    this._dotMaterial = new THREE.MeshBasicMaterial({ color: 0xF2C14E });

    this._routeDots = new THREE.Group();
    this._scene.add(this._routeDots);

    this._boat = this._createBoat();
    this._scene.add(this._boat);

    this._spawnRoute();
  }

  update(delta) {
    if (this._state === 'waiting') {
      this._boat.position.y = BOAT_Y + Math.sin(performance.now() * 0.004) * 0.03;
      if (this._isRouteClear()) {
        this._state = 'traveling';
        this._dotMaterial.color.setHex(0x7FE7CC);
      }
      return;
    }

    if (this._state === 'traveling') {
      this._advanceBoat(delta);
      return;
    }

    this._respawnTimer -= delta;
    if (this._respawnTimer <= 0) this._spawnRoute();
  }

  _spawnRoute() {
    this._clearRouteDots();
    this._dotMaterial.color.setHex(0xF2C14E);

    const horizontal = Math.random() < 0.5;
    const reverse = Math.random() < 0.5;
    this._routeCells = buildCrossingPath(horizontal);
    this._travelPoints = buildTravelCells(this._routeCells, horizontal, reverse).map(({ gx, gz }) => gridToWorld(gx, gz));
    this._segmentIndex = 0;
    this._segmentDistance = 0;
    this._state = 'waiting';

    for (let i = 0; i < this._routeCells.length; i += 2) {
      const { gx, gz } = this._routeCells[i];
      const dot = new THREE.Mesh(
        new THREE.CylinderGeometry(TILE_SIZE * 0.14, TILE_SIZE * 0.14, 0.06, 8),
        this._dotMaterial
      );
      const { x, z } = gridToWorld(gx, gz);
      dot.position.set(x, 0.24, z);
      this._routeDots.add(dot);
    }

    const start = this._travelPoints[0];
    const next = this._travelPoints[1];
    this._boat.visible = true;
    this._boat.position.set(start.x, BOAT_Y, start.z);
    this._boat.rotation.set(0, Math.atan2(next.x - start.x, next.z - start.z), 0);
  }

  _advanceBoat(delta) {
    let remaining = delta;

    while (remaining > 0 && this._segmentIndex < this._travelPoints.length - 1) {
      const from = this._travelPoints[this._segmentIndex];
      const to = this._travelPoints[this._segmentIndex + 1];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz) || 1;
      const step = Math.min(length - this._segmentDistance, TRAVEL_SPEED * remaining);

      this._segmentDistance += step;
      remaining -= step / TRAVEL_SPEED;

      const t = this._segmentDistance / length;
      this._boat.position.set(
        THREE.MathUtils.lerp(from.x, to.x, t),
        BOAT_Y,
        THREE.MathUtils.lerp(from.z, to.z, t)
      );
      this._boat.rotation.set(0, Math.atan2(dx, dz), 0);

      if (this._segmentDistance >= length - 1e-6) {
        this._segmentIndex += 1;
        this._segmentDistance = 0;
      }
    }

    if (this._segmentIndex >= this._travelPoints.length - 1) {
      this._boat.visible = false;
      this._state = 'cooldown';
      this._respawnTimer = RESPAWN_DELAY;
    }
  }

  _isRouteClear() {
    return this._routeCells.every(({ gx, gz }) =>
      !this._world.isIce(gx, gz) && !this._chunkManager.hasTile(gx, gz)
    );
  }

  _clearRouteDots() {
    for (const dot of this._routeDots.children) {
      dot.geometry.dispose();
    }
    this._routeDots.clear();
  }

  _createBoat() {
    const boat = new THREE.Group();

    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.25, 1.6),
      new THREE.MeshBasicMaterial({ color: 0xB3472D })
    );
    boat.add(hull);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.28, 0.55),
      new THREE.MeshBasicMaterial({ color: 0xF3E9C9 })
    );
    cabin.position.set(0, 0.26, -0.1);
    boat.add(cabin);

    const bow = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.2, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x1C3A5E })
    );
    bow.position.set(0, 0.02, 0.69);
    boat.add(bow);

    boat.visible = false;
    return boat;
  }
}
