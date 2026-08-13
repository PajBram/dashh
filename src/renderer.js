// Renderaren: program, statiska världsobjekt, instansbatchar och partiklar.
import { mat4, perspective, lookAt, multiply, invert, lerp, clamp, smoothstep, TAU, rand } from './math.js';
import { initGL, makeProgram, uploadMesh, InstancedBatch, BillboardBatch } from './gl.js';
import { TERRAIN_VS, TERRAIN_FS, INST_VS, INST_FS, SHADOW_VS, SHADOW_FS,
         PART_VS, PART_FS, SKY_VS, SKY_FS, WATER_VS, WATER_FS } from './shaders.js';
import { sphere, box, cone, cylinder, disc, octahedron, grid } from './meshes.js';
import { buildTerrainMesh, buildCityGroundMesh, scatterProps, cityProps } from './terrain.js';
import { WORLD_SIZE, WATER_LEVEL, setWorld } from './noise.js';

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

  return {
    sunDir: dir,
    sunCol: [pal.sun[0] * strength, pal.sun[1] * strength, pal.sun[2] * strength],
    amb: pal.amb,
    fogCol: pal.fog,
    skyTop: pal.top,
    skyHor: pal.hor,
    night,
    fogNear: 44,
    fogFar: 178,
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
    this.worldId = id;
  }

  buildCityWorld() {
    const gl = this.gl, m = this.mesh;
    const props = cityProps();
    const bodies = new InstancedBatch(gl, m.box, 256);
    const bands = new InstancedBatch(gl, m.box, 2048);
    const poles = new InstancedBatch(gl, m.cyl, 512);
    const orbs = new InstancedBatch(gl, m.sphere, 512);
    const NEON = [[0.25, 0.9, 1.0], [1.0, 0.3, 0.7], [1.0, 0.7, 0.2], [0.5, 1.0, 0.5]];

    for (const b of props.buildings) {
      const tone = 0.8 + b.neon * 0.5;
      bodies.push(b.x, b.h / 2, b.z, b.hx * 2, b.h, b.hz * 2,
        [0.055 * tone, 0.06 * tone, 0.088 * tone], 0, 0, 0, 0);
      const neon = NEON[Math.floor(b.neon * NEON.length) % NEON.length];
      // fönsterband runt fasaden + lysande takkant
      for (let y = 2.4; y < b.h - 1.4; y += 3.4) {
        bands.push(b.x, y, b.z, b.hx * 2 + 0.06, 0.3, b.hz * 2 + 0.06,
          [neon[0] * 0.38, neon[1] * 0.38, neon[2] * 0.38], 0, 0, 0, 0.14);
      }
      bands.push(b.x, b.h - 0.1, b.z, b.hx * 2 + 0.16, 0.16, b.hz * 2 + 0.16, neon, 0, 0, 0, 0.9);
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
    return { terrain: uploadMesh(gl, buildCityGroundMesh(60)), static: [bodies, bands, poles, orbs], props };
  }

  buildWildWorld() {
    const gl = this.gl, m = this.mesh;
    const props = scatterProps();
    const trunks = new InstancedBatch(gl, m.cylTaper, 512);
    const leaves = new InstancedBatch(gl, m.cone, 1024);
    const rocks = new InstancedBatch(gl, m.box, 512);
    const crystals = new InstancedBatch(gl, m.octa, 256);
    const tufts = new InstancedBatch(gl, m.cone, 1024);

    for (const t of props.trees) {
      const h = 3.2 * t.scale;
      trunks.push(t.x, t.y + h * 0.5, t.z, 0.5 * t.scale, h, 0.5 * t.scale, t.trunk, 0, t.rot, 0, 0);
      for (let i = 0; i < t.tiers; i++) {
        const f = i / t.tiers;
        const r = (3.4 - f * 1.5) * t.scale;
        leaves.push(t.x, t.y + h * (0.75 + f * 0.72), t.z, r, 3.0 * t.scale, r,
          [t.leaf[0] * (1 - f * 0.12), t.leaf[1] * (1 - f * 0.1), t.leaf[2]], 0, t.rot + f, 0, 0);
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
      static: [trunks, leaves, rocks, crystals, tufts],
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
    p.v3('uFogCol', env.fogCol);
    p.v2('uFog', env.fogNear, env.fogFar);
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
      .f('uNight', env.night);
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

    // --- alla instansierade objekt
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
