// Bygger terrängmeshen, färgar den efter höjd och lutning, och strör ut
// träd, klippor och kristaller (som också fungerar som hinder).
import { SEASON, WORLD_SIZE, WATER_LEVEL, terrainHeight, terrainNormal, fbm,
         cityBuildings, CITY_CELL } from './noise.js';
import { clamp, lerp, smoothstep, rand, randInt, TAU } from './math.js';

const SAND = [0.62, 0.55, 0.36];
// Gräsets färg kommer från årstiden (noise.js) — de här är sommarens.
const GRASS = [0.20, 0.40, 0.20];
const GRASS2 = [0.28, 0.47, 0.24];
const ROCK = [0.34, 0.33, 0.37];
const SNOW = [0.90, 0.93, 0.99];
const MUD = [0.10, 0.16, 0.16];

function mix3(a, b, t, out) {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

/** Neotropolis marknivå: platt asfalt med svag tonvariation. Husen ritas som
 *  egna lådor och ingår inte i meshen (fysiken hanterar taken separat). */
export function buildCityGroundMesh(res = 60) {
  const n = res + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const step = WORLD_SIZE / res;
  const half = WORLD_SIZE / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = (j * n + i) * 3;
      const x = -half + i * step, z = -half + j * step;
      positions[idx] = x; positions[idx + 1] = 0; positions[idx + 2] = z;
      normals[idx] = 0; normals[idx + 1] = 1; normals[idx + 2] = 0;
      const v = 0.85 + (fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5) * 0.3;
      colors[idx] = 0.052 * v; colors[idx + 1] = 0.058 * v; colors[idx + 2] = 0.082 * v;
    }
  }
  const indices = new Uint32Array(res * res * 6);
  let k = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + n;
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
  }
  return { positions, normals, colors, indices };
}

/** Terrängmesh med vertexfärger (Vildheim). */
export function buildTerrainMesh(res = 200) {
  const n = res + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const step = WORLD_SIZE / res;
  const half = WORLD_SIZE / 2;
  const tmp = [0, 0, 0];
  const nrm = { x: 0, y: 1, z: 0 };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = (j * n + i) * 3;
      const x = -half + i * step, z = -half + j * step;
      const h = terrainHeight(x, z);
      positions[idx] = x; positions[idx + 1] = h; positions[idx + 2] = z;

      terrainNormal(x, z, nrm);
      normals[idx] = nrm.x; normals[idx + 1] = nrm.y; normals[idx + 2] = nrm.z;

      const slope = clamp(1 - nrm.y, 0, 1);
      const variation = fbm(x * 0.09, z * 0.09, 2) * 0.5 + 0.5;
      mix3(SEASON.grass, SEASON.grass2, variation, tmp);
      // sten på branta sidor
      mix3(tmp, ROCK, smoothstep(0.22, 0.55, slope), tmp);
      // strand vid vattenlinjen
      mix3(tmp, SAND, smoothstep(1.6, 0.15, h - WATER_LEVEL), tmp);
      // sjöbotten
      mix3(tmp, MUD, smoothstep(0.0, -2.5, h - WATER_LEVEL), tmp);
      // snö på topparna
      const snowLine = SEASON.snow > 0 ? 1.5 : 30;
      mix3(tmp, SNOW, smoothstep(snowLine, snowLine + 16, h) * (1 - smoothstep(0.55, 0.8, slope)), tmp);
      // lite kornighet
      const g = 0.94 + variation * 0.12;
      colors[idx] = tmp[0] * g; colors[idx + 1] = tmp[1] * g; colors[idx + 2] = tmp[2] * g;
    }
  }

  const indices = new Uint32Array(res * res * 6);
  let k = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + n;
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
  }
  return { positions, normals, colors, indices };
}

/** Enkel rutnäts-hash för hinder, så kollisionen inte blir O(n). */
export class ColliderGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
  }
  /** Cirklar {x,z,r} eller rektanglar {rect:true,x,z,hx,hz,top}. Stora hinder
   *  registreras i alla celler de täcker så 3x3-sökningen alltid hittar dem. */
  add(c) {
    const rx = c.rect ? c.hx : c.r, rz = c.rect ? c.hz : c.r;
    const i0 = Math.floor((c.x - rx) / this.cell), i1 = Math.floor((c.x + rx) / this.cell);
    const j0 = Math.floor((c.z - rz) / this.cell), j1 = Math.floor((c.z + rz) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = ((i + 512) << 10) | (j + 512);
        let list = this.map.get(k);
        if (!list) { list = []; this.map.set(k, list); }
        list.push(c);
      }
    }
  }
  /** Puttar ut en position ur alla hinder den överlappar. */
  resolve(pos, radius) {
    let hit = false;
    const cx = Math.floor(pos.x / this.cell), cz = Math.floor(pos.z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.map.get((((cx + i) + 512) << 10) | ((cz + j) + 512));
        if (!list) continue;
        for (const c of list) {
          if (c.rect) {
            // hus: väggarna gäller bara under taknivån (flygande passerar ovanför)
            if (c.top !== undefined && pos.y > c.top - 0.5) continue;
            const dx = pos.x - c.x, dz = pos.z - c.z;
            const px = c.hx + radius - Math.abs(dx);
            const pz = c.hz + radius - Math.abs(dz);
            if (px > 0 && pz > 0) {
              if (px < pz) pos.x = c.x + (dx < 0 ? -1 : 1) * (c.hx + radius);
              else pos.z = c.z + (dz < 0 ? -1 : 1) * (c.hz + radius);
              hit = true;
            }
            continue;
          }
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const min = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
            hit = true;
          }
        }
      }
    }
    return hit;
  }
}

/**
 * Strör ut världens objekt. Returnerar ritbara listor plus kollisionsrutnätet.
 */
export function scatterProps() {
  const trees = [], rocks = [], crystals = [], grassTufts = [];
  const flowers = [], bushes = [], logs = [], mushrooms = [], reeds = [];
  const grid = new ColliderGrid(8);
  const R = 104;

  const place = (tries, fn) => {
    for (let i = 0; i < tries; i++) {
      const a = rand(TAU), d = Math.sqrt(Math.random()) * R;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x, z) < 14) continue;            // håll startplatsen fri
      const h = terrainHeight(x, z);
      const nrm = terrainNormal(x, z);
      fn(x, z, h, 1 - nrm.y);
    }
  };

  // Skogen har fyra arter, fördelade efter höjd: lövträd och björk nere vid
  // vattnet, gran längre upp, och döda stammar högst där det är kargt. En
  // skog av ett enda träd sett tusen gånger är det som får en värld att
  // kännas gjord i stället för växt.
  place(760, (x, z, h, slope) => {
    if (h < WATER_LEVEL + 0.8 || h > 34 || slope > 0.34) return;
    if (Math.random() > 0.72) return;
    const alt = clamp((h - WATER_LEVEL) / 32, 0, 1);
    const r = Math.random();
    let kind;
    if (alt < 0.32) kind = r < 0.5 ? 'broadleaf' : r < 0.74 ? 'birch' : 'pine';
    else if (alt < 0.68) kind = r < 0.62 ? 'pine' : r < 0.88 ? 'broadleaf' : 'birch';
    else kind = r < 0.78 ? 'pine' : 'dead';

    // Höst och vinter fäller löven på lövträden — granen står grön året om.
    if (kind !== 'pine' && kind !== 'dead' && Math.random() < SEASON.bare) kind = 'dead';
    const scale = rand(0.8, 1.5) * (kind === 'broadleaf' ? 1.1 : 1);
    const hue = rand(0.6, 1.0);
    const trunk = kind === 'birch'
      ? [0.78, 0.76, 0.70]
      : kind === 'dead'
        ? [0.34, 0.31, 0.28]
        : [0.24 * hue, 0.16 * hue, 0.11 * hue];
    // lövverket skiftar mot gult och rost på höjden, som en höstsida
    const warm = alt * 0.5 + rand(0, 0.3);
    const seasonLeaf = (c) => [c[0] * SEASON.leaf[0], c[1] * SEASON.leaf[1], c[2] * SEASON.leaf[2]];
    trees.push({
      x, y: h, z, kind, scale, rot: rand(TAU), trunk,
      leaf: seasonLeaf(kind === 'broadleaf'
        ? [lerp(0.18, 0.52, warm), lerp(0.42, 0.50, hue), lerp(0.12, 0.16, Math.random())]
        : kind === 'birch'
          ? [lerp(0.35, 0.62, warm), lerp(0.60, 0.68, hue), 0.22]
          : [lerp(0.10, 0.24, Math.random()), lerp(0.30, 0.52, hue), lerp(0.14, 0.26, Math.random())]),
      tiers: randInt(2, 3),
      lean: rand(-0.09, 0.09),
    });
    grid.add({ x, z, r: 0.6 * scale });

    // svampar och nedfallna stammar hör hemma vid trädens fötter
    if (Math.random() < 0.16) {
      const a = rand(TAU), d = rand(1.2, 2.6);
      const mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
      mushrooms.push({ x: mx, y: terrainHeight(mx, mz), z: mz, scale: rand(0.5, 1.0),
        col: Math.random() < 0.55 ? [0.78, 0.20, 0.18] : [0.85, 0.72, 0.45] });
    }
    if (Math.random() < 0.05) {
      logs.push({ x, y: h, z, rot: rand(TAU), len: rand(2.4, 4.4), r: rand(0.28, 0.45),
        col: [0.26 * hue, 0.19 * hue, 0.13 * hue] });
    }
  });

  place(420, (x, z, h, slope) => {
    if (h < WATER_LEVEL - 1.2) return;
    if (Math.random() > 0.45) return;
    const scale = rand(0.7, 2.8);
    const g = rand(0.85, 1.15);
    rocks.push({
      x, y: h, z,
      sx: scale * rand(0.8, 1.4), sy: scale * rand(0.5, 1.1), sz: scale * rand(0.8, 1.4),
      rx: rand(-0.25, 0.25), ry: rand(TAU), rz: rand(-0.25, 0.25),
      col: [0.31 * g, 0.30 * g, 0.34 * g],
    });
    if (scale > 1.3) grid.add({ x, z, r: scale * 0.55 });
  });

  place(160, (x, z, h, slope) => {
    if (h < WATER_LEVEL + 1.5 || slope > 0.4) return;
    if (Math.random() > 0.22) return;
    crystals.push({
      x, y: h, z,
      scale: rand(0.9, 2.6),
      rot: rand(TAU),
      col: Math.random() < 0.5 ? [0.35, 0.85, 1.0] : [0.72, 0.45, 1.0],
      phase: rand(TAU),
    });
  });

  place(900, (x, z, h, slope) => {
    if (h < WATER_LEVEL + 0.6 || h > 30 || slope > 0.3) return;
    grassTufts.push({ x, y: h, z, scale: rand(0.35, 0.85) * (SEASON.snow ? 0.6 : 1), rot: rand(TAU) });
  });

  // Blommor växer i ängar, inte jämnt utspridda: ett lågfrekvent brus
  // avgör var marken blommar, så man går genom fält i stället för prickar.
  const MEADOW = [
    [1.0, 0.85, 0.25], [0.95, 0.35, 0.45], [0.70, 0.55, 1.0],
    [1.0, 1.0, 0.95], [1.0, 0.55, 0.20],
  ];
  place(1400, (x, z, h, slope) => {
    if (h < WATER_LEVEL + 0.7 || h > 26 || slope > 0.24) return;
    if (Math.random() > SEASON.flowers) return;   // vår blommar över, vinter knappt alls
    const meadow = fbm(x * 0.035 + 8.1, z * 0.035 - 3.7, 2);
    if (meadow < 0.12) return;
    flowers.push({
      x, y: h, z, scale: rand(0.5, 1.0), rot: rand(TAU),
      col: MEADOW[randInt(0, MEADOW.length - 1)],
    });
  });

  place(420, (x, z, h, slope) => {
    if (h < WATER_LEVEL + 0.8 || h > 30 || slope > 0.32) return;
    if (Math.random() > 0.4) return;
    const s = rand(0.7, 1.5);
    bushes.push({ x, y: h, z, scale: s, rot: rand(TAU),
      col: [lerp(0.10, 0.20, Math.random()), lerp(0.26, 0.42, Math.random()), 0.14],
      berries: Math.random() < 0.3 });
  });

  // vass står i strandkanten, precis ovanför vattenlinjen
  place(700, (x, z, h) => {
    const d = h - WATER_LEVEL;
    if (d < -0.4 || d > 0.9) return;
    if (Math.random() > 0.45) return;
    reeds.push({ x, y: h, z, scale: rand(0.8, 1.6), rot: rand(TAU) });
  });

  return { trees, rocks, crystals, grassTufts, flowers, bushes, logs, mushrooms, reeds, grid };
}

/** Neotropolis: husens kollisionslådor plus gatljus och takantenner. */
export function cityProps() {
  const grid = new ColliderGrid(8);
  const buildings = cityBuildings();
  for (const b of buildings) {
    // en kollisionsrektangel per avsats, så flygaren kan runda tornens smalare topp
    for (const t of b.tiers) {
      grid.add({ rect: true, x: b.x, z: b.z, hx: b.hx * t.f, hz: b.hz * t.f, top: t.top });
    }
  }

  const lights = [];
  for (let i = 0; i <= Math.floor(WORLD_SIZE / CITY_CELL); i++) {
    for (let j = 0; j <= Math.floor(WORLD_SIZE / CITY_CELL); j++) {
      const x = -WORLD_SIZE / 2 + i * CITY_CELL;
      const z = -WORLD_SIZE / 2 + j * CITY_CELL;
      if (Math.hypot(x, z) > 104) continue;
      if (fbm(i * 3.7, j * 5.1, 1) < -0.1) continue;
      lights.push({ x, z, warm: (i + j) % 3 === 0 });
    }
  }

  const antennas = [];
  for (const b of buildings) {
    if (b.neon < 0.45 || b.h > 60) continue;
    antennas.push({
      x: b.x + (b.neon - 0.5) * b.hx, z: b.z + ((b.neon * 3) % 1 - 0.5) * b.hz,
      y: b.h, h: 2.5 + b.neon * 5,
    });
  }

  return { buildings, lights, antennas, grid };
}
