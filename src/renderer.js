// Renderaren: program, statiska världsobjekt, instansbatchar och partiklar.
import { mat4, perspective, lookAt, multiply, invert, lerp, clamp, smoothstep, TAU, rand } from './math.js';
import { initGL, makeProgram, uploadMesh, InstancedBatch, BillboardBatch } from './gl.js';
import { TERRAIN_VS, TERRAIN_FS, INST_VS, INST_FS, SHADOW_VS, SHADOW_FS,
         PART_VS, PART_FS, SKY_VS, SKY_FS, WATER_VS, WATER_FS } from './shaders.js';
import { sphere, box, cone, cylinder, disc, octahedron, grid } from './meshes.js';
import { buildTerrainMesh, buildCityGroundMesh, scatterProps, cityProps } from './terrain.js';
import { WORLD_SIZE, WATER_LEVEL, CITY_CELL, setWorld } from './noise.js';

// ------------------------------------------------------------- partikelsystem

export class Particles {
  constructor(max = 2600) {
    this.max = max;
    this.list = [];
  }

  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life, max: o.life,
      size: o.size, size2: o.size2 !== undefined ? o.size2 : 0,
      r: o.col[0], g: o.col[1], b: o.col[2], a: o.alpha !== undefined ? o.alpha : 1,
      grav: o.grav !== undefined ? o.grav : 0,
      drag: o.drag !== undefined ? o.drag : 0.12,
    });
  }

  /** Sfäriskt utkast av partiklar. */
  burst(x, y, z, n, o) {
    for (let i = 0; i < n; i++) {
      const th = rand(TAU), ph = Math.acos(rand(-1, 1));
      const sp = rand(o.speed * 0.35, o.speed);
      this.spawn({
        x, y, z,
        vx: Math.sin(ph) * Math.cos(th) * sp,
        vy: Math.cos(ph) * sp * (o.up || 1) + (o.lift || 0),
        vz: Math.sin(ph) * Math.sin(th) * sp,
        life: rand(o.life * 0.6, o.life),
        size: rand(o.size * 0.6, o.size),
        size2: o.size2 || 0,
        col: o.col, alpha: o.alpha, grav: o.grav, drag: o.drag,
      });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt * 60 * 0.05);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }

  fill(batch) {
    batch.clear();
    for (const p of this.list) {
      const t = p.life / p.max;
      batch.push(p.x, p.y, p.z, lerp(p.size2, p.size, t), p.r, p.g, p.b, p.a * Math.min(1, t * 1.6));
    }
  }
}

// ------------------------------------------------------------------- miljö

const NIGHT = { top: [0.015, 0.025, 0.075], hor: [0.05, 0.07, 0.15], fog: [0.05, 0.07, 0.15], amb: [0.11, 0.14, 0.24], sun: [0.42, 0.52, 0.80] };
const DUSK  = { top: [0.10, 0.14, 0.38], hor: [0.86, 0.40, 0.26], fog: [0.45, 0.30, 0.36], amb: [0.24, 0.22, 0.32], sun: [1.00, 0.52, 0.26] };
const DAY   = { top: [0.20, 0.42, 0.82], hor: [0.66, 0.79, 0.95], fog: [0.64, 0.76, 0.92], amb: [0.34, 0.40, 0.50], sun: [1.00, 0.96, 0.88] };

const mixArr = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** dayTime 0..1 — 0.25 = soluppgång, 0.5 = middag, 0.75 = solnedgång.
 *  Neotropolis har evig neonnatt och ignorerar dygnet. */
export function computeEnv(dayTime, worldId = 'wild') {
  if (worldId === 'city') {
    return {
      sunDir: { x: 0.297, y: 0.772, z: 0.545 },   // hög kall måne
      sunCol: [0.40, 0.34, 0.62],
      amb: [0.21, 0.16, 0.30],
      fogCol: [0.055, 0.03, 0.10],
      skyTop: [0.012, 0.006, 0.045],
      skyHor: [0.17, 0.05, 0.24],
      night: 1,
      fogNear: 42,
      fogFar: 200,
      // Staden: kall magenta från skyltarna ovanifrån, gatans neon underifrån.
      skyTint: [0.92, 0.80, 1.15],
      groundTint: [1.10, 0.86, 1.05],
      // Diset ligger på gatunivå och tunnas ut mot tornens toppar.
      fogHeight: 0.013,
      clouds: 0,
    };
  }
  const a = (dayTime - 0.25) * TAU;
  let sx = Math.cos(a), sy = Math.sin(a), sz = 0.32;
  let l = Math.hypot(sx, sy, sz);
  sx /= l; sy /= l; sz /= l;

  const above = sy;
  const night = 1 - smoothstep(-0.16, 0.06, above);
  const duskT = smoothstep(-0.30, 0.02, above);
  const dayT = smoothstep(0.02, 0.34, above);

  let pal = { top: mixArr(NIGHT.top, DUSK.top, duskT), hor: mixArr(NIGHT.hor, DUSK.hor, duskT),
              fog: mixArr(NIGHT.fog, DUSK.fog, duskT), amb: mixArr(NIGHT.amb, DUSK.amb, duskT),
              sun: mixArr(NIGHT.sun, DUSK.sun, duskT) };
  pal = { top: mixArr(pal.top, DAY.top, dayT), hor: mixArr(pal.hor, DAY.hor, dayT),
          fog: mixArr(pal.fog, DAY.fog, dayT), amb: mixArr(pal.amb, DAY.amb, dayT),
          sun: mixArr(pal.sun, DAY.sun, dayT) };

  // Under horisonten lyser månen i stället — motsatt riktning, svagare.
  const moon = above < 0;
  const dir = moon ? { x: -sx, y: -sy, z: -sz } : { x: sx, y: sy, z: sz };
  const strength = moon ? 0.32 : lerp(0.45, 1.0, dayT);

  // Halvsfärstinter: himlens kulör uppifrån, en varm markreflex underifrån.
  // Normaliserade kring 1,0 så ljusstyrkan är oförändrad — bara kulören rör sig.
  const norm = (c, amount) => {
    const avg = (c[0] + c[1] + c[2]) / 3 || 1;
    return [lerp(1, c[0] / avg, amount), lerp(1, c[1] / avg, amount), lerp(1, c[2] / avg, amount)];
  };

  return {
    sunDir: dir,
    sunCol: [pal.sun[0] * strength, pal.sun[1] * strength, pal.sun[2] * strength],
    amb: pal.amb,
    fogCol: pal.fog,
    skyTop: pal.top,
    skyHor: pal.hor,
    skyTint: norm(pal.top, 0.55),
    groundTint: norm([0.42, 0.38, 0.26], 0.35),   // mossa och jord kastar tillbaka varmt
    night,
    fogNear: 44,
    fogFar: 178,
    // Dalarna behåller sitt dis medan bergstopparna sticker upp ur det.
    fogHeight: 0.009,
    // Molnen tunnas ut på natten, då man ändå bara ser stjärnor genom dem.
    clouds: lerp(0.35, 1.0, dayT),
  };
}

// ----------------------------------------------------------------- renderare

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = initGL(canvas);

    this.pTerrain = makeProgram(gl, TERRAIN_VS, TERRAIN_FS, 'terrain');
    this.pInst = makeProgram(gl, INST_VS, INST_FS, 'inst');
    this.pShadow = makeProgram(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.pPart = makeProgram(gl, PART_VS, PART_FS, 'part');
    this.pSky = makeProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.pWater = makeProgram(gl, WATER_VS, WATER_FS, 'water');

    this.waterMesh = uploadMesh(gl, grid(90));

    const m = {
      sphere: sphere(16, 11),
      box: box(),
      cone: cone(12),
      cyl: cylinder(12),
      cylTaper: cylinder(10, 0.55),
      disc: disc(20),
      octa: octahedron(),
    };
    this.mesh = m;

    // Dynamiska batchar (fylls om varje bildruta).
    this.dyn = {
      sphere: new InstancedBatch(gl, m.sphere, 512),
      box: new InstancedBatch(gl, m.box, 512),
      cone: new InstancedBatch(gl, m.cone, 256),
      cyl: new InstancedBatch(gl, m.cyl, 256),
      octa: new InstancedBatch(gl, m.octa, 512),
    };
    this.shadows = new InstancedBatch(gl, m.disc, 512);
    this.partBatch = new BillboardBatch(gl, 3200);
    this.particles = new Particles();

    this.worldCache = {};
    this.buildWorld('wild');

    this.view = mat4(); this.proj = mat4(); this.vp = mat4(); this.invVP = mat4();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = 1; this.height = 1;
    this.resize();
  }

  /** Väljer aktiv värld; geometrin byggs första gången och cachas sedan. */
  buildWorld(id) {
    setWorld(id);
    if (!this.worldCache[id]) {
      this.worldCache[id] = id === 'city' ? this.buildCityWorld() : this.buildWildWorld();
    }
    const w = this.worldCache[id];
    this.terrain = w.terrain;
    this.static = w.static;
    this.props = w.props;
    this.taxis = w.taxis || null;
    this.worldId = id;
  }

  /**
   * Flygande taxibilar längs stadens gatunät. De ritas i dyn-batcharna varje
   * bildruta och lever bara som en formel: läge = start + fart * tid, lindat
   * runt kartan. Ingen AI, inga kollisioner — de är stadens puls, inte trafik
   * man krockar med, och de flyger på höjder där man ändå inte slåss.
   */
  drawTaxis(time) {
    if (!this.taxis) return;
    const B = this.dyn;
    const S = WORLD_SIZE;
    for (const t of this.taxis) {
      // position längs färdriktningen, lindad till [-S/2, S/2)
      let u = (t.phase + t.speed * time) % S;
      if (u < 0) u += S;
      u -= S / 2;
      const x = t.axis === 'x' ? u : t.line;
      const z = t.axis === 'x' ? t.line : u;
      const y = t.h + Math.sin(time * 0.7 + t.phase) * 0.35;
      const yaw = t.axis === 'x'
        ? (t.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (t.speed > 0 ? 0 : Math.PI);
      const body = t.cab ? [1.0, 0.78, 0.12] : [0.14, 0.15, 0.22];
      const fwd = t.speed > 0 ? 1 : -1;
      const fx = t.axis === 'x' ? fwd : 0, fz = t.axis === 'x' ? 0 : fwd;

      // Måtten är i meter, och en vanlig bil försvinner sedd från gatan
      // trettio meter under. De här är luftbussar, inte personbilar.
      B.box.push(x, y, z, 2.6, 1.0, 5.4, body, 0, yaw, 0, t.cab ? 0.35 : 0.1);
      B.box.push(x, y + 0.8, z, 2.0, 0.7, 2.7, [0.06, 0.10, 0.16], 0, yaw, 0, 0.3);
      // strålkastare framåt, röda lyktor bakåt
      B.sphere.push(x + fx * 2.7, y, z + fz * 2.7, 0.45, 0.34, 0.45, [0.9, 0.95, 1.0], 0, 0, 0, 1.5);
      B.sphere.push(x - fx * 2.7, y, z - fz * 2.7, 0.38, 0.28, 0.38, [1.0, 0.2, 0.15], 0, 0, 0, 1.2);
      // svävfältet under — det som säger "den flyger" snarare än "den åker"
      B.cyl.push(x, y - 0.75, z, 1.7, 0.1, 1.7,
        t.cab ? [1.0, 0.6, 0.2] : [0.35, 0.7, 1.0], 0, 0, 0, 0.9);
    }
  }

  buildCityWorld() {
    const gl = this.gl, m = this.mesh;
    const props = cityProps();
    const bodies = new InstancedBatch(gl, m.box, 1024);
    const bands = new InstancedBatch(gl, m.box, 24576);
    const poles = new InstancedBatch(gl, m.cyl, 1024);
    const orbs = new InstancedBatch(gl, m.sphere, 512);
    const NEON = [[0.25, 0.9, 1.0], [1.0, 0.3, 0.7], [1.0, 0.7, 0.2], [0.5, 1.0, 0.5]];
    // deterministiskt "slumptal" per hus och våning — samma stad varje laddning
    const h01 = (a, c) => { const s = Math.sin(a * 127.1 + c * 311.7) * 43758.5453; return s - Math.floor(s); };

    for (const b of props.buildings) {
      const tone = 0.8 + b.neon * 0.5;
      const bodyCol = [0.055 * tone, 0.06 * tone, 0.088 * tone];
      const neon = NEON[Math.floor(b.neon * NEON.length) % NEON.length];

      // --- kropp i avsatser (samma tiers som kollision och markhöjd)
      let base = 0;
      for (const t of b.tiers) {
        const hx = b.hx * t.f, hz = b.hz * t.f;
        bodies.push(b.x, (base + t.top) / 2, b.z, hx * 2, t.top - base, hz * 2, bodyCol, 0, 0, 0, 0);
        // varje avsats får en svagt lysande kant
        bands.push(b.x, t.top - 0.08, b.z, hx * 2 + 0.14, 0.14, hz * 2 + 0.14, neon,
          0, 0, 0, t.top === b.h ? 0.9 : 0.3);

        // --- fönster, ett i taget i ett rutnät. Band runt hela fasaden blir
        // lysande lameller; enskilda rutor med mörka mellanrum läser som hus.
        // Bara de nedersta 70 metrarna får rutor — resten är fjärran mur.
        const wTop = Math.min(t.top - 1.6, 70);
        for (let y = base + 2.6; y < wTop; y += 3.2) {
          for (const ax of [0, 1]) {
            const halfW = (ax === 0 ? hx : hz);
            const cols = Math.max(2, Math.round(halfW * 2 / 3.1));
            const step = (halfW * 2) / cols;
            for (let c = 0; c < cols; c++) {
              const off = -halfW + step * (c + 0.5);
              const r = h01(b.x + y * 7.3 + c * 2.1, b.z + ax * 13.7);
              let col, glow;
              // de flesta rutor är släckta — det är mörkret som gör de tända
              // till ljus i stället för till en tänd fasad
              if (r < 0.74) { col = [0.075, 0.085, 0.125]; glow = 0.02; }
              else if (r < 0.96) { col = [0.46, 0.40, 0.27]; glow = 0.11; }   // varmt kontorsljus
              else { col = neon; glow = 0.3; }                                // enstaka neonrum
              const w = step * 0.5, hgt = 0.85;
              if (ax === 0) bands.push(b.x + off, y, b.z, w, hgt, hz * 2 + 0.05, col, 0, 0, 0, glow);
              else bands.push(b.x, y, b.z + off, hx * 2 + 0.05, hgt, w, col, 0, 0, 0, glow);
            }
          }
        }
        base = t.top;
      }

      // --- takbråte: fläktlådor och en vattentank gör taklinjen ojämn
      const top = b.tiers[b.tiers.length - 1];
      if (b.h < 70) {
        const n = 1 + Math.floor(h01(b.x, b.z * 3.1) * 3);
        for (let k = 0; k < n; k++) {
          const rx = (h01(b.x + k * 17, b.z) - 0.5) * b.hx * top.f * 1.1;
          const rz = (h01(b.x, b.z + k * 23) - 0.5) * b.hz * top.f * 1.1;
          const s = 0.7 + h01(b.x * 2 + k, b.z) * 1.1;
          bodies.push(b.x + rx, b.h + s * 0.4, b.z + rz, s, s * 0.8, s * 0.9,
            [0.10, 0.11, 0.15], 0, h01(k, b.x) * 1.5, 0, 0);
        }
        if (h01(b.z, b.x) > 0.55) {
          poles.push(b.x - b.hx * top.f * 0.4, b.h + 1.0, b.z + b.hz * top.f * 0.35,
            0.8, 2.0, 0.8, [0.13, 0.14, 0.18], 0, 0, 0, 0);
        }
      }

      // --- gatuplan: skyltfönster och en mörk portöppning
      const dc = Math.hypot(b.x, b.z);
      if (dc < 96) {
        bands.push(b.x, 1.4, b.z, b.hx * 2 * 0.78, 1.1, b.hz * 2 + 0.09,
          [0.75, 0.66, 0.45], 0, 0, 0, 0.22);
        bands.push(b.x, 1.4, b.z, b.hx * 2 + 0.09, 1.1, b.hz * 2 * 0.78,
          [0.75, 0.66, 0.45], 0, 0, 0, 0.22);
        const side = h01(b.x * 3, b.z * 5) > 0.5 ? 1 : -1;
        bands.push(b.x + side * b.hx * 0.5, 1.25, b.z, 1.4, 2.5, b.hz * 2 + 0.14,
          [0.03, 0.03, 0.05], 0, 0, 0, 0);
      }

      // --- takskylt: en lysande neonpanel på högkant, som en logga
      if (b.neon > 0.68 && b.h < 58) {
        const w = Math.min(5.5, b.hx * top.f * 1.2);
        const along = h01(b.x * 7, b.z * 11) > 0.5;
        bodies.push(b.x, b.h + 1.9, b.z, along ? w : 0.3, 3.0, along ? 0.3 : w,
          [0.08, 0.08, 0.12], 0, 0, 0, 0);
        bands.push(b.x, b.h + 1.9, b.z, along ? w * 0.86 : 0.44, 2.3, along ? 0.44 : w * 0.86,
          neon, 0, 0, 0, 1.25);
      }
    }
    for (const a of props.antennas) {
      poles.push(a.x, a.y + a.h / 2, a.z, 0.14, a.h, 0.14, [0.2, 0.2, 0.26], 0, 0, 0, 0.1);
      orbs.push(a.x, a.y + a.h + 0.2, a.z, 0.34, 0.34, 0.34, [1.0, 0.25, 0.3], 0, 0, 0, 1.3);
    }
    for (const l of props.lights) {
      poles.push(l.x, 2.6, l.z, 0.14, 5.2, 0.14, [0.16, 0.17, 0.22], 0, 0, 0, 0);
      orbs.push(l.x, 5.35, l.z, 0.45, 0.3, 0.45,
        l.warm ? [1.0, 0.8, 0.5] : [0.5, 0.9, 1.0], 0, 0, 0, 1.1);
    }

    // --- flygande taxi-rutter: raka filer längs gatunätet på olika höjd.
    // Position är en ren funktion av tiden, så trafiken behöver inget
    // eget tillstånd och rullar även bakom menyn.
    const taxis = [];
    const N = Math.floor(WORLD_SIZE / CITY_CELL);
    for (let i = 1; i < N; i++) {
      const line = -WORLD_SIZE / 2 + i * CITY_CELL;
      if (Math.abs(line) > 105) continue;
      if (h01(i * 3.3, 8.8) < 0.15) continue;          // alla gator har inte trafik
      const nCars = 7 + Math.floor(h01(i, 4.2) * 6);
      for (let k = 0; k < nCars; k++) {
        const dir = h01(i * 7, k * 13) > 0.5 ? 1 : -1;
        taxis.push({
          axis: i % 2 === 0 ? 'x' : 'z',
          line: line + dir * 2.6,                       // högertrafik även i luften
          h: 9 + h01(i * 11, k * 5) * 26,
          speed: dir * (7 + h01(k * 9, i) * 6),
          phase: h01(i * 29, k * 31) * WORLD_SIZE,
          cab: h01(i + k, 17.5) > 0.25,                 // några är inte taxi utan mörka bilar
        });
      }
    }

    return {
      terrain: uploadMesh(gl, buildCityGroundMesh(60)),
      static: [bodies, bands, poles, orbs], props, taxis,
    };
  }

  buildWildWorld() {
    const gl = this.gl, m = this.mesh;
    const props = scatterProps();
    const trunks = new InstancedBatch(gl, m.cylTaper, 2048);
    const leaves = new InstancedBatch(gl, m.cone, 2048);
    const rocks = new InstancedBatch(gl, m.box, 2048);
    const crystals = new InstancedBatch(gl, m.octa, 256);
    const tufts = new InstancedBatch(gl, m.cone, 6144);
    const canopy = new InstancedBatch(gl, m.sphere, 2048);   // lövkronor och buskar
    const petals = new InstancedBatch(gl, m.sphere, 4096);   // blomhuvuden, bär, svamphattar
    const logsB = new InstancedBatch(gl, m.cyl, 1024);       // nedfallna stammar, svampfötter

    for (const t of props.trees) {
      const s = t.scale;
      const lean = t.lean || 0;
      if (t.kind === 'broadleaf') {
        // lövträd: kort grov stam och ett klot av löv i tre klumpar
        const h = 2.6 * s;
        trunks.push(t.x, t.y + h * 0.5, t.z, 0.62 * s, h, 0.62 * s, t.trunk, lean, t.rot, 0, 0);
        const cy = t.y + h + 1.5 * s;
        canopy.push(t.x, cy, t.z, 3.2 * s, 2.6 * s, 3.2 * s, t.leaf, 0, t.rot, 0, 0);
        for (let i = 0; i < 2; i++) {
          const a = t.rot + i * 2.4;
          canopy.push(t.x + Math.cos(a) * 1.5 * s, cy - 0.5 * s, t.z + Math.sin(a) * 1.5 * s,
            2.1 * s, 1.8 * s, 2.1 * s,
            [t.leaf[0] * 0.88, t.leaf[1] * 0.92, t.leaf[2]], 0, a, 0, 0);
        }
      } else if (t.kind === 'birch') {
        // björk: smal ljus stam, gles krona, mörka streck på nävern
        const h = 4.6 * s;
        trunks.push(t.x, t.y + h * 0.5, t.z, 0.30 * s, h, 0.30 * s, t.trunk, lean, t.rot, 0, 0);
        for (let i = 0; i < 3; i++) {
          rocks.push(t.x, t.y + h * (0.3 + i * 0.22), t.z, 0.34 * s, 0.09 * s, 0.34 * s,
            [0.20, 0.19, 0.18], 0, t.rot + i, 0, 0);
        }
        canopy.push(t.x, t.y + h + 0.9 * s, t.z, 2.3 * s, 2.0 * s, 2.3 * s, t.leaf, 0, t.rot, 0, 0);
        canopy.push(t.x, t.y + h + 1.9 * s, t.z, 1.5 * s, 1.4 * s, 1.5 * s,
          [t.leaf[0] * 1.05, t.leaf[1] * 1.02, t.leaf[2]], 0, -t.rot, 0, 0);
      } else if (t.kind === 'dead') {
        // dött träd: bar stam med ett par knotiga grenar
        const h = 3.8 * s;
        trunks.push(t.x, t.y + h * 0.5, t.z, 0.42 * s, h, 0.42 * s, t.trunk, lean, t.rot, 0, 0);
        for (let i = 0; i < 3; i++) {
          const a = t.rot + i * 2.1;
          const by = t.y + h * (0.55 + i * 0.16);
          trunks.push(t.x + Math.cos(a) * 0.8 * s, by, t.z + Math.sin(a) * 0.8 * s,
            0.16 * s, 1.5 * s, 0.16 * s, t.trunk, 0.9, a, 0, 0);
        }
      } else {
        const h = 3.2 * s;
        trunks.push(t.x, t.y + h * 0.5, t.z, 0.5 * s, h, 0.5 * s, t.trunk, lean, t.rot, 0, 0);
        for (let i = 0; i < t.tiers; i++) {
          const f = i / t.tiers;
          const r = (3.4 - f * 1.5) * s;
          leaves.push(t.x, t.y + h * (0.75 + f * 0.72), t.z, r, 3.0 * s, r,
            [t.leaf[0] * (1 - f * 0.12), t.leaf[1] * (1 - f * 0.1), t.leaf[2]], 0, t.rot + f, 0, 0);
        }
      }
    }
    for (const b of props.bushes) {
      const s = b.scale;
      canopy.push(b.x, b.y + 0.5 * s, b.z, 1.5 * s, 1.1 * s, 1.5 * s, b.col, 0, b.rot, 0, 0);
      canopy.push(b.x + 0.5 * s, b.y + 0.35 * s, b.z - 0.4 * s, 1.0 * s, 0.8 * s, 1.0 * s,
        [b.col[0] * 0.85, b.col[1] * 0.9, b.col[2]], 0, -b.rot, 0, 0);
      if (b.berries) {
        for (let i = 0; i < 3; i++) {
          const a = b.rot + i * 2.1;
          petals.push(b.x + Math.cos(a) * 0.8 * s, b.y + 0.9 * s, b.z + Math.sin(a) * 0.8 * s,
            0.15, 0.15, 0.15, [0.85, 0.15, 0.25], 0, 0, 0, 0.15);
        }
      }
    }
    for (const l of props.logs) {
      // liggande stam: cylindern reses på sidan med en kvarts varv
      logsB.push(l.x, l.y + l.r, l.z, l.r * 2, l.len, l.r * 2, l.col, Math.PI / 2, l.rot, 0, 0);
    }
    for (const m of props.mushrooms) {
      const s = m.scale;
      logsB.push(m.x, m.y + 0.16 * s, m.z, 0.10 * s, 0.32 * s, 0.10 * s, [0.88, 0.85, 0.76], 0, 0, 0, 0);
      petals.push(m.x, m.y + 0.34 * s, m.z, 0.34 * s, 0.22 * s, 0.34 * s, m.col, 0, 0, 0, 0.05);
    }
    for (const f of props.flowers) {
      const s = f.scale;
      tufts.push(f.x, f.y + 0.22 * s, f.z, 0.10 * s, 0.5 * s, 0.10 * s, [0.22, 0.40, 0.16], 0, f.rot, 0, 0);
      petals.push(f.x, f.y + 0.50 * s, f.z, 0.32 * s, 0.24 * s, 0.32 * s, f.col, 0, f.rot, 0, 0.28);
    }
    for (const r of props.reeds) {
      const s = r.scale;
      for (let i = 0; i < 3; i++) {
        const a = r.rot + i * 2.1;
        tufts.push(r.x + Math.cos(a) * 0.18, r.y + 0.7 * s, r.z + Math.sin(a) * 0.18,
          0.07, 1.5 * s, 0.07, [0.35, 0.42, 0.20], 0.08, a, 0, 0);
      }
    }
    for (const r of props.rocks) {
      rocks.push(r.x, r.y + r.sy * 0.28, r.z, r.sx, r.sy, r.sz, r.col, r.rx, r.ry, r.rz, 0);
    }
    for (const c of props.crystals) {
      crystals.push(c.x, c.y + c.scale * 0.8, c.z, c.scale * 0.5, c.scale * 2.2, c.scale * 0.5,
        c.col, 0.12, c.rot, 0.1, 0.55);
    }
    for (const g of props.grassTufts) {
      tufts.push(g.x, g.y + 0.22 * g.scale, g.z, 0.5 * g.scale, 0.9 * g.scale, 0.5 * g.scale,
        [0.20, 0.36, 0.16], 0, g.rot, 0, 0);
    }
    return {
      terrain: uploadMesh(gl, buildTerrainMesh(200)),
      static: [trunks, leaves, rocks, crystals, tufts, canopy, petals, logsB],
      props,
    };
  }

  resize() {
    const c = this.canvas;
    const w = Math.max(1, Math.floor(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * this.dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
    }
    this.width = w; this.height = h;
  }

  clearBatches() {
    for (const k in this.dyn) this.dyn[k].clear();
    this.shadows.clear();
  }

  /** Skuggfläck på marken. */
  shadow(x, y, z, radius, alpha) {
    this.shadows.push(x, y + 0.06, z, radius * 2, 1, radius * 2, [0, 0, 0], 0, 0, 0, alpha);
  }

  applyEnv(p, env, eye) {
    p.v3('uSunDir', env.sunDir.x, env.sunDir.y, env.sunDir.z);
    p.v3('uSunCol', env.sunCol);
    p.v3('uAmb', env.amb);
    p.v3('uSkyTint', env.skyTint);
    p.v3('uGroundTint', env.groundTint);
    p.v3('uFogCol', env.fogCol);
    p.v2('uFog', env.fogNear, env.fogFar);
    p.f('uFogHeight', env.fogHeight);
    p.v3('uEye', eye.x, eye.y, eye.z);
    p.m4('uVP', this.vp);
  }

  render(cam, env, time, player) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.width, this.height);

    // På en hög, smal skärm (telefon på höjden) räcker inte det lodräta
    // synfältet i sidled — vidga det så vyn inte blir ett titthål.
    const aspect = this.width / this.height;
    let fov = cam.fov;
    if (aspect < 1.35) {
      const widen = Math.min(1.5, 1.35 / Math.max(aspect, 0.4));
      fov = 2 * Math.atan(Math.tan(fov / 2) * widen);
    }
    perspective(this.proj, fov, aspect, 0.1, 620);
    lookAt(this.view, cam.pos, cam.target, { x: 0, y: 1, z: 0 });
    multiply(this.vp, this.proj, this.view);
    invert(this.invVP, this.vp);

    gl.clearColor(env.fogCol[0], env.fogCol[1], env.fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- himmel
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    this.pSky.use()
      .m4('uInvVP', this.invVP)
      .v3('uEye', cam.pos.x, cam.pos.y, cam.pos.z)
      .v3('uSunDir', env.sunDir.x, env.sunDir.y, env.sunDir.z)
      .v3('uSunCol', env.sunCol)
      .v3('uSkyTop', env.skyTop)
      .v3('uSkyHorizon', env.skyHor)
      .f('uNight', env.night)
      .f('uTime', time)
      .f('uClouds', env.clouds);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);

    // --- terräng
    this.pTerrain.use();
    this.applyEnv(this.pTerrain, env, cam.pos);
    this.pTerrain.v3('uPlayer', player.x, player.y, player.z)
      .f('uNight', env.night)
      .f('uCity', this.worldId === 'city' ? 1 : 0);
    this.terrain.draw();

    // --- alla instansierade objekt (trafiken fylls på strax innan de ritas)
    this.drawTaxis(time);
    this.pInst.use();
    this.applyEnv(this.pInst, env, cam.pos);
    for (const b of this.static) b.draw();
    for (const k in this.dyn) this.dyn[k].draw();

    // --- markskuggor
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.pShadow.use().m4('uVP', this.vp);
    this.shadows.draw();
    gl.depthMask(true);

    // --- vatten (Neotropolis har inget)
    if (this.worldId !== 'city') {
      gl.disable(gl.CULL_FACE);
      this.pWater.use();
      this.pWater.m4('uVP', this.vp)
        .v3('uEye', cam.pos.x, cam.pos.y, cam.pos.z)
        .v3('uSunDir', env.sunDir.x, env.sunDir.y, env.sunDir.z)
        .v3('uSunCol', env.sunCol)
        .v3('uAmb', env.amb)
        .v3('uFogCol', env.fogCol)
        .v2('uFog', env.fogNear, env.fogFar)
        .f('uTime', time)
        .f('uSize', WORLD_SIZE)
        .f('uLevel', WATER_LEVEL);
      this.waterMesh.draw();
      gl.enable(gl.CULL_FACE);
    }

    // --- partiklar (additivt)
    this.particles.fill(this.partBatch);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    const rx = this.view[0], ry = this.view[4], rz = this.view[8];
    const ux = this.view[1], uy = this.view[5], uz = this.view[9];
    this.pPart.use().m4('uVP', this.vp).v3('uRight', rx, ry, rz).v3('uUp', ux, uy, uz);
    this.partBatch.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
