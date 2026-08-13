// Deterministiskt värdebrus + världens höjdfunktion.
import { clamp, lerp, smoothstep } from './math.js';

const SEED = 20260813;

function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/** Fraktalt brus, resultat ungefär i [-1, 1]. */
export function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(fx, fy) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    fx = fx * 2.03 + 17.3; fy = fy * 2.03 - 9.1;
  }
  return sum / norm;
}

export const WATER_LEVEL = 0;
export const ARENA_RADIUS = 112;   // så långt spelaren kommer
export const WORLD_SIZE = 300;     // terrängmeshens sida

// ------------------------------------------------------------ världsväxeln

export let WORLD_ID = 'wild';      // 'wild' = Vildheim, 'city' = Neotropolis
export function setWorld(id) { WORLD_ID = id; }

// ------------------------------------------------------- Neotropolis (stad)

export const CITY_CELL = 26;       // kvartersstorlek — gator ligger på cellgränserna
const CITY_N = Math.floor(WORLD_SIZE / CITY_CELL);

/** Deterministisk byggnad för kvarterscell (i, j), eller null för gata/torg. */
export function cityBuildingOfCell(i, j) {
  if (i < 0 || j < 0 || i >= CITY_N || j >= CITY_N) return null;
  const r = hash2(i * 13 + 101, j * 17 + 57);
  const cx = -WORLD_SIZE / 2 + (i + 0.5) * CITY_CELL;
  const cz = -WORLD_SIZE / 2 + (j + 0.5) * CITY_CELL;
  const dc = Math.hypot(cx, cz);
  if (dc < 22) return null;                       // startplazan hålls öppen
  if (r < 0.24 && dc < 96) return null;           // torg och parker
  const r2 = hash2(i * 29 - 11, j * 31 + 5);
  const r3 = hash2(i * 7 + 913, j * 3 - 401);
  const hx = 6 + r2 * 4.5;
  const hz = 6 + r3 * 4.5;
  let h = 7 + Math.floor(r * 5) * 4 + r2 * 14;
  if (dc > 96) h += (dc - 96) * 1.6;              // skyskrapemur stänger arenan
  const ox = (r3 - 0.5) * (CITY_CELL - 2 * hx - 5);
  const oz = (r2 - 0.5) * (CITY_CELL - 2 * hz - 5);
  return { x: cx + ox, z: cz + oz, hx, hz, h, neon: (r * 7.31) % 1 };
}

/** Byggnaden vars kvarter täcker (x, z), eller null. */
export function cityBuildingAt(x, z) {
  return cityBuildingOfCell(
    Math.floor((x + WORLD_SIZE / 2) / CITY_CELL),
    Math.floor((z + WORLD_SIZE / 2) / CITY_CELL),
  );
}

export function cityBuildings() {
  const out = [];
  for (let i = 0; i < CITY_N; i++) {
    for (let j = 0; j < CITY_N; j++) {
      const b = cityBuildingOfCell(i, j);
      if (b) out.push(b);
    }
  }
  return out;
}

/** Markhöjd i världskoordinater. I staden ingår hustaken (väggar är kollisioner). */
export function terrainHeight(x, z) {
  if (WORLD_ID === 'city') {
    const b = cityBuildingAt(x, z);
    if (b && Math.abs(x - b.x) < b.hx && Math.abs(z - b.z) < b.hz) return b.h;
    return 0;
  }
  return wildHeight(x, z);
}

/** Vildheims kuperade terräng. */
function wildHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm(x * 0.0105, z * 0.0105, 4) * 15.5;
  h += fbm(x * 0.045 + 31.7, z * 0.045 - 12.3, 3) * 2.4;
  h += 2.2;
  // Startområdet planas ut så man inte föds i en backe.
  h = lerp(3.2, h, smoothstep(9, 44, d));
  // Bergsrand som stänger arenan.
  if (d > 96) {
    const t = (d - 96) / 46;
    h += t * t * 86;
  }
  return h;
}

/** Marknormal via differenser. */
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 0.75;
  const hl = terrainHeight(x - e, z), hr = terrainHeight(x + e, z);
  const hd = terrainHeight(x, z - e), hu = terrainHeight(x, z + e);
  let nx = hl - hr, ny = 2 * e, nz = hd - hu;
  const l = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

/** Lutning 0 (platt) .. 1 (lodrätt). */
export function terrainSlope(x, z) {
  const n = terrainNormal(x, z);
  return clamp(1 - n.y, 0, 1);
}

/** Håller en position innanför arenan. Muterar och returnerar p. */
export function clampToArena(p) {
  const d = Math.hypot(p.x, p.z);
  if (d > ARENA_RADIUS) {
    const s = ARENA_RADIUS / d;
    p.x *= s; p.z *= s;
  }
  return p;
}
