// Spelarkaraktären: rörelse, hopp, dash, kamerarigg och den ritade figuren.
import { clamp, lerp, damp, smoothstep, TAU, angleDelta, rand } from './math.js';
import { terrainHeight, WATER_LEVEL, clampToArena } from './noise.js';

export const GRAVITY = -34;
const EYE = 1.35;

export function rotY(x, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x + s * z, -s * x + c * z];
}

export function defaultStats() {
  return {
    maxHp: 100,
    speed: 9.4,
    damage: 13,
    fireRate: 4.2,        // skott per sekund
    projSpeed: 66,
    projSize: 0.34,
    multishot: 1,
    spread: 0.035,
    pierce: 0,
    crit: 0.05,
    critMult: 2.0,
    explosive: 0,         // radie, 0 = av
    lifesteal: 0,
    regen: 0,
    pickupRadius: 4.5,
    dashMax: 2,
    dashRecharge: 2.4,
    jumps: 1,
    xpMult: 1,
    drones: 0,
  };
}

export class Player {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    this.stats = defaultStats();
    this.pos = { x: 0, y: terrainHeight(0, 0) + 2, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.hp = this.stats.maxHp;
    this.yaw = 0;
    this.camYaw = 0;
    this.camPitch = -0.24;
    this.camDist = 9.3;
    this.camDistNow = 9.3;
    this.camPos = { x: 0, y: 6, z: 10 };
    this.fov = 1.22;
    this.fovNow = 1.22;
    this.grounded = false;
    this.jumpsLeft = 1;
    this.dashCharges = this.stats.dashMax;
    this.dashTimer = 0;      // återladdning
    this.dashTime = 0;       // aktiv dash
    this.dashDir = { x: 0, z: 1 };
    this.invuln = 0;
    this.fireTimer = 0;
    this.walkPhase = 0;
    this.hitFlash = 0;
    this.radius = 0.55;
    this.inWater = false;
    this.aim = { x: 0, y: 0, z: 1 };
    this.aimYaw = 0;
    this.droneAngle = 0;
    this.droneTimer = 0;
    this.alive = true;
    this.shake = 0;
    this.shotSide = 1;       // Neotropolis: lasern alternerar mellan händerna
    this.thrusting = false;
    this.swingTime = 0;      // Vildheim: pågående svärdssving
    this.swingDur = 0.26;
    this.swingSide = 1;
    this.swingFinisher = false;
    this.combo = -1;         // 0,1,2 — det tredje hugget är en finisher
    this.comboTimer = 0;
    this.fireballCdMax = 10;
    this.fireballCd = 0;
  }

  get camForward() {
    const cp = Math.cos(this.camPitch);
    return { x: Math.sin(this.camYaw) * cp, y: Math.sin(this.camPitch), z: Math.cos(this.camYaw) * cp };
  }

  look(dx, dy, sens) {
    this.camYaw -= dx * sens;
    // Uppåtgränsen är generös: i Neotropolis kommer fienderna ovanifrån.
    this.camPitch = clamp(this.camPitch - dy * sens, -1.15, 1.0);
    if (this.camYaw > Math.PI) this.camYaw -= TAU;
    if (this.camYaw < -Math.PI) this.camYaw += TAU;
  }

  zoom(delta) {
    this.camDist = clamp(this.camDist + delta * 0.01, 7, 24);
  }

  /**
   * Styrning utan pointer lock. Mitten av skärmen är en stor fri zon där du
   * siktar med korshåret utan att kameran rör sig; först när pekaren närmar
   * sig kanterna börjar vyn svepa — mjukt och likadant i båda led.
   */
  steer(input, dt) {
    // Stor fri zon: vyn står helt stilla över nästan hela skärmen och sveper
    // först när du medvetet för pekaren ut i kanten. En kamera som kryper av
    // sig själv är det som känns obehagligt.
    const dead = 0.82;
    const ramp = (v) => {
      const m = Math.abs(v);
      if (m <= dead) return 0;
      const t = clamp((m - dead) / (1 - dead), 0, 1);
      return (v < 0 ? -1 : 1) * t * t * (3 - 2 * t);
    };
    this.camYaw -= ramp(input.cursorNX) * 3.4 * dt;
    if (this.camYaw > Math.PI) this.camYaw -= TAU;
    if (this.camYaw < -Math.PI) this.camYaw += TAU;
    this.camPitch = clamp(this.camPitch - ramp(input.cursorNY) * 1.7 * dt, -1.15, 1.0);
  }

  /**
   * Riktningen från kameran genom muspekaren — korshåret sitter där pekaren är.
   * Utgår från kamerans faktiska blickriktning (inte den ideala vinkeln), så
   * axelförskjutningen och markklampen inte gör siktet skevt.
   */
  cursorRay() {
    const inp = this.world.input;
    const eye = this.camPos, tgt = this.camTarget || this.pos;
    let fx = tgt.x - eye.x, fy = tgt.y - eye.y, fz = tgt.z - eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // muslås och touch siktar båda rakt fram genom skärmens mitt
    if (!inp || inp.locked || inp.touch) return { x: fx, y: fy, z: fz };

    // kamerans egna höger- och uppvektor
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;

    const rend = this.world.renderer;
    const aspect = rend && rend.height ? rend.width / rend.height : 1.6;
    const tan = Math.tan(this.fovNow / 2);
    const ax = inp.cursorNX * tan * aspect;
    const ay = -inp.cursorNY * tan;
    const dx = fx + rx * ax + ux * ay;
    const dy = fy + uy * ay;
    const dz = fz + rz * ax + uz * ay;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  }

  takeDamage(n) {
    if (this.invuln > 0 || !this.alive) return false;
    this.hp -= n;
    this.invuln = 0.55;
    this.hitFlash = 1;
    this.shake = Math.min(1.2, this.shake + 0.35 + n * 0.012);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return true;
  }

  heal(n) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  tryDash(input) {
    if (this.dashCharges <= 0 || this.dashTime > 0) return false;
    const ax = input.moveAxis();
    let dx, dz;
    if (ax.x || ax.y) {
      const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
      const r = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
      dx = f.x * ax.y + r.x * ax.x;
      dz = f.z * ax.y + r.z * ax.x;
    } else {
      dx = Math.sin(this.yaw); dz = Math.cos(this.yaw);
    }
    const l = Math.hypot(dx, dz) || 1;
    this.dashDir.x = dx / l; this.dashDir.z = dz / l;
    this.dashCharges--;
    this.dashTime = 0.18;
    this.invuln = Math.max(this.invuln, 0.30);
    this.vel.x = this.dashDir.x * 40;
    this.vel.z = this.dashDir.z * 40;
    if (!this.grounded) this.vel.y = Math.max(this.vel.y, 1.5);
    return true;
  }

  update(dt, input, snap) {
    const st = this.stats;
    const w = this.world;

    // ---- kamera-look
    if (input.enabled) {
      if (input.touch) this.look(input.mouseDX, input.mouseDY, input.touchSensitivity);
      else if (input.locked) this.look(input.mouseDX, input.mouseDY, input.sensitivity);
      else this.steer(input, dt);
    }
    if (input.wheel) this.zoom(input.wheel);

    // ---- rörelse
    const ax = input.moveAxis();
    const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const r = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
    let wishX = f.x * ax.y + r.x * ax.x;
    let wishZ = f.z * ax.y + r.z * ax.x;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.001) { wishX /= wishLen; wishZ /= wishLen; }

    const speed = st.speed * (this.inWater ? 0.62 : 1);
    const accel = (this.grounded ? 74 : 26) * dt;
    if (this.dashTime <= 0) {
      const tx = wishX * speed * wishLen, tz = wishZ * speed * wishLen;
      this.vel.x += clamp(tx - this.vel.x, -accel, accel);
      this.vel.z += clamp(tz - this.vel.z, -accel, accel);
      if (this.grounded && wishLen < 0.01) {
        const fr = Math.exp(-9 * dt);
        this.vel.x *= fr; this.vel.z *= fr;
      }
    } else {
      this.dashTime -= dt;
      const fade = Math.exp(-4 * dt);
      this.vel.x *= fade; this.vel.z *= fade;
      w.particles.spawn({
        x: this.pos.x, y: this.pos.y + 0.9 + rand(-0.4, 0.4), z: this.pos.z,
        vx: rand(-1.5, 1.5), vy: rand(0, 2), vz: rand(-1.5, 1.5),
        life: rand(0.25, 0.5), size: rand(0.35, 0.75), size2: 0,
        col: [0.35, 0.95, 1.0], alpha: 0.9, drag: 0.5,
      });
    }

    // ---- hopp / flygning / dash
    const canFly = w.worldId === 'city';
    this.thrusting = false;
    if (canFly && input.down('Space')) {
      // cyborg-thrusters: håll mellanslag för att lyfta och flyga
      this.vel.y = Math.min(this.vel.y + 58 * dt, 11);
      if (this.pos.y > 58) this.vel.y = Math.min(this.vel.y, 0);   // mjukt höjdtak
      this.grounded = false;
      this.thrusting = true;
      if (Math.random() < 0.65) {
        w.particles.spawn({
          x: this.pos.x + rand(-0.25, 0.25), y: this.pos.y + 0.3, z: this.pos.z + rand(-0.25, 0.25),
          vx: rand(-1, 1), vy: rand(-7, -4), vz: rand(-1, 1),
          life: rand(0.25, 0.45), size: rand(0.3, 0.55), size2: 0,
          col: [1.0, 0.45, 0.6], alpha: 0.85, drag: 0.3,
        });
      }
    } else if (input.pressed('Space')) {
      if (this.grounded || this.jumpsLeft > 0) {
        if (!this.grounded) this.jumpsLeft--;
        this.vel.y = 13.2;
        this.grounded = false;
        w.sound.jump();
        w.particles.burst(this.pos.x, this.pos.y + 0.1, this.pos.z, 6,
          { speed: 3, life: 0.35, size: 0.5, col: [0.6, 0.8, 0.9], alpha: 0.5, grav: -6, drag: 0.4 });
      }
    }
    if ((input.pressed('ShiftLeft') || input.pressed('ShiftRight') || input.pressed('KeyE')) && this.tryDash(input)) {
      w.sound.dash();
      w.particles.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 18,
        { speed: 9, life: 0.4, size: 0.7, col: [0.3, 0.9, 1.0], alpha: 0.8, drag: 0.6 });
    }

    // ---- gravitation och mark (i staden glidflyger cyborgen)
    const gravF = this.dashTime > 0 ? 0.25 : this.thrusting ? 0 : canFly && !this.grounded ? 0.4 : 1;
    this.vel.y += GRAVITY * dt * gravF;
    if (canFly && this.vel.y < -13) this.vel.y = -13;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    clampToArena(this.pos);
    if (w.colliders.resolve(this.pos, this.radius)) {
      // glid längs hindret istället för att fastna
      this.vel.x *= 0.85; this.vel.z *= 0.85;
    }

    const gh = terrainHeight(this.pos.x, this.pos.z);
    const wasAir = !this.grounded;
    if (this.pos.y <= gh) {
      if (wasAir && this.vel.y < -12) {
        w.sound.land();
        w.particles.burst(this.pos.x, gh + 0.1, this.pos.z, 8,
          { speed: 4, life: 0.3, size: 0.5, col: [0.75, 0.72, 0.6], alpha: 0.55, grav: -10, drag: 0.5 });
      }
      this.pos.y = gh;
      this.vel.y = 0;
      this.grounded = true;
      this.jumpsLeft = st.jumps;
    } else {
      this.grounded = false;
    }

    const wasWater = this.inWater;
    this.inWater = this.pos.y < WATER_LEVEL + 0.15;
    if (this.inWater && !wasWater) {
      w.particles.burst(this.pos.x, WATER_LEVEL + 0.2, this.pos.z, 14,
        { speed: 5, life: 0.5, size: 0.55, col: [0.45, 0.8, 0.95], alpha: 0.75, grav: -14, drag: 0.4 });
    }

    // ---- riktning och timers: gubben vänder sig dit korshåret pekar
    const turnRate = (wishLen > 0.02 || input.fireDown) ? 22 : 15;
    const face = this.aimYaw === undefined ? this.camYaw : this.aimYaw;
    this.yaw += angleDelta(this.yaw, face) * Math.min(1, dt * turnRate);
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * (this.grounded ? planar * 1.15 : 3);

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.swingTime = Math.max(0, this.swingTime - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.fireballCd = Math.max(0, this.fireballCd - dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.dashCharges < st.dashMax) {
      this.dashTimer += dt;
      if (this.dashTimer >= st.dashRecharge) { this.dashTimer = 0; this.dashCharges++; }
    } else this.dashTimer = 0;
    if (st.regen > 0 && this.hp < st.maxHp) this.heal(st.regen * dt);
    this.droneAngle += dt * 1.6;
    this.droneTimer -= dt;

    // ---- kamera
    this.updateCamera(dt, planar);
  }

  updateCamera(dt, planar) {
    // Kameran sitter högt och en bit bakom, och blicken riktas en bit ovanför
    // figuren. Då hamnar gubben liten och lågt i bild och världen framför
    // syns — det är därför man ser vad man flyger in i.
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    const focus = {
      x: this.pos.x + rx * 1.65,
      y: this.pos.y + EYE + 1.65,
      z: this.pos.z + rz * 1.65,
    };
    const dir = this.camForward;
    const want = this.camDist;
    // dra in kameran om terrängen är i vägen
    let allowed = want;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * want;
      const px = focus.x - dir.x * t, py = focus.y - dir.y * t, pz = focus.z - dir.z * t;
      if (py < terrainHeight(px, pz) + 0.7) { allowed = Math.max(1.8, t - 0.5); break; }
    }
    // snabb men inte hackig indragning när något skymmer, mjuk utfällning
    this.camDistNow = damp(this.camDistNow, allowed, allowed < this.camDistNow ? 0.0001 : 0.02, dt);

    const tx = focus.x - dir.x * this.camDistNow;
    const ty = focus.y - dir.y * this.camDistNow + 0.35;
    const tz = focus.z - dir.z * this.camDistNow;
    // en aning eftersläp ger fart åt rörelsen utan att kännas gummiaktigt
    this.camPos.x = damp(this.camPos.x, tx, 0.0035, dt);
    this.camPos.y = damp(this.camPos.y, ty, 0.0035, dt);
    this.camPos.z = damp(this.camPos.z, tz, 0.0035, dt);
    const minY = terrainHeight(this.camPos.x, this.camPos.z) + 0.6;
    if (this.camPos.y < minY) this.camPos.y = minY;

    const wantFov = 1.22 + smoothstep(6, 22, planar) * 0.13 + (this.dashTime > 0 ? 0.14 : 0);
    this.fovNow = damp(this.fovNow, wantFov, 0.002, dt);
    this.camTarget = focus;
  }

  /** Kameran som renderaren vill ha den, inklusive skärmskak. */
  camera(time) {
    const s = this.shake * this.shake;
    const jx = Math.sin(time * 47) * s * 0.35, jy = Math.cos(time * 41) * s * 0.35;
    return {
      pos: { x: this.camPos.x + jx, y: this.camPos.y + jy, z: this.camPos.z },
      target: { x: this.camTarget.x + jx * 0.5, y: this.camTarget.y + jy * 0.5, z: this.camTarget.z },
      fov: this.fovNow,
    };
  }

  /** Siktriktning från kameran, med lätt målhjälp. */
  aimDir(enemies) {
    const cf = this.cursorRay();
    const origin = { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z };
    const far = { x: origin.x + cf.x * 70, y: origin.y + cf.y * 70, z: origin.z + cf.z * 70 };
    const muzzle = this.muzzle();
    let dx = far.x - muzzle.x, dy = far.y - muzzle.y, dz = far.z - muzzle.z;
    let l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;

    // mild sikthjälp mot närmaste fiende inom en smal kon. I Neotropolis flyger
    // fienderna — striden är 3D — så konen är bredare där, och med tummen som
    // sikte behövs mer hjälp än med mus.
    const inp2 = this.world.input;
    let bestDot = this.world.worldId === 'city' ? 0.955 : 0.978;
    if (inp2 && inp2.touch) bestDot -= 0.03;
    let best = null;
    for (const e of enemies) {
      if (!e.alive) continue;
      let ex = e.pos.x - muzzle.x, ey = e.pos.y + e.height * 0.5 - muzzle.y, ez = e.pos.z - muzzle.z;
      const d = Math.hypot(ex, ey, ez);
      if (d > 55 || d < 0.001) continue;
      ex /= d; ey /= d; ez /= d;
      const dot = ex * dx + ey * dy + ez * dz;
      if (dot > bestDot) { bestDot = dot; best = { x: ex, y: ey, z: ez }; }
    }
    if (best) {
      dx = lerp(dx, best.x, 0.65); dy = lerp(dy, best.y, 0.65); dz = lerp(dz, best.z, 0.65);
      l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
    }
    this.aim.x = dx; this.aim.y = dy; this.aim.z = dz;
    this.aimYaw = Math.atan2(dx, dz);   // gubben vänder sig hit
    return this.aim;
  }

  muzzle() {
    if (this.world.worldId === 'city') {
      // lasern skjuts ur handflatorna, växelvis vänster/höger
      const [ox, oz] = rotY(0.48 * this.shotSide, 0.7, this.yaw);
      return { x: this.pos.x + ox, y: this.pos.y + 1.6, z: this.pos.z + oz };
    }
    const [ox, oz] = rotY(0.42, 0.75, this.yaw);
    return { x: this.pos.x + ox, y: this.pos.y + 1.25, z: this.pos.z + oz };
  }

  /** Ritar figuren i renderarens batchar. */
  draw(rend, time) {
    const B = rend.dyn;
    const f = this.hitFlash;
    const city = this.world.worldId === 'city';
    // Vildheim: vildmarkskrigare i läder med brons och bärnstensmagi.
    // Neotropolis: gunmetal-cyborg med magenta energi och iskalla detaljer.
    const base = city ? {
      plate: [0.16, 0.16, 0.21], suit: [0.06, 0.07, 0.10], accent: [0.85, 0.20, 0.45],
      trim: [1.0, 0.30, 0.55], gold: [0.55, 0.95, 1.0], cape: [0.20, 0.03, 0.12],
    } : {
      plate: [0.40, 0.26, 0.14], suit: [0.19, 0.12, 0.07], accent: [0.30, 0.34, 0.18],
      trim: [1.0, 0.62, 0.22], gold: [0.72, 0.52, 0.24], cape: [0.11, 0.22, 0.12],
    };
    const F = (c0) => [lerp(c0[0], 1.0, f), lerp(c0[1], 0.35, f), lerp(c0[2], 0.4, f)];
    const plate = F(base.plate), suit = F(base.suit), accent = F(base.accent), cape = F(base.cape);
    const trim = base.trim, gold = base.gold;

    const y = this.pos.y, x = this.pos.x, z = this.pos.z, yaw = this.yaw;
    const csY = Math.cos(yaw), snY = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + csY * lx + snY * lz, y + ly, z - snY * lx + csY * lz];
    const put = (batch, p, sx, sy, sz, col, rx = 0, ryOff = 0, rz = 0, g = 0) =>
      batch.push(p[0], p[1], p[2], sx, sy, sz, col, rx, yaw + ryOff, rz, g);

    const inv = this.invuln > 0 ? 0.3 + Math.sin(time * 30) * 0.15 : 0;
    const dash = this.dashTime > 0 ? 1 : 0;
    const planar = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.grounded && planar > 0.6;
    const air = this.grounded ? 0 : 1;
    const amp = this.grounded ? clamp(planar * 0.10, 0, 0.9) : 0.3;
    const swing = Math.sin(this.walkPhase) * amp;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : 0;
    const breathe = 1 + Math.sin(time * 2.1) * 0.012;
    const lean = clamp(planar * 0.011, 0, 0.18) + dash * 0.3;

    // ---- ben i två segment: lårplåt, benskena, knäskydd och känga
    for (const s of [-1, 1]) {
      const ph = this.walkPhase + (s > 0 ? 0 : Math.PI);
      const sw = (moving || air ? Math.sin(ph) * amp : 0) + air * 0.3;
      const lift = (moving ? Math.max(0, -Math.cos(ph)) * 0.5 : 0) + air * 0.45;
      const hipY = 1.08 + bob, hx = 0.27 * s;
      const kneeY = hipY - 0.5 * Math.cos(sw), kneeZ = -0.5 * Math.sin(sw);
      const shinSw = sw + lift;
      const footY = kneeY - 0.48 * Math.cos(shinSw), footZ = kneeZ - 0.48 * Math.sin(shinSw);
      put(B.box, P(hx, hipY - 0.25 * Math.cos(sw), -0.25 * Math.sin(sw)),
        0.30, 0.52, 0.34, plate, sw, 0, 0, inv);
      put(B.sphere, P(hx, kneeY, kneeZ), 0.24, 0.2, 0.24, accent, sw, 0, 0, city ? 0.25 : 0);
      put(B.box, P(hx, kneeY - 0.24 * Math.cos(shinSw), kneeZ - 0.24 * Math.sin(shinSw)),
        0.24, 0.5, 0.27, suit, shinSw, 0, 0, inv);
      put(B.box, P(hx, footY + 0.07, footZ + 0.09), 0.28, 0.16, 0.44, plate, shinSw * 0.3, 0, 0, inv);
    }

    // ---- höftparti med sidoplåtar
    put(B.box, P(0, 1.16 + bob, 0), 0.74, 0.3, 0.48, plate, 0, 0, 0, inv);
    for (const s of [-1, 1]) put(B.box, P(0.42 * s, 1.04 + bob, 0), 0.14, 0.4, 0.4, plate, 0, 0, 0.12 * s, inv);
    put(B.box, P(0, 1.14 + bob, 0.26), 0.2, 0.14, 0.06, gold, 0, 0, 0, 0.3);

    // ---- bål: underdräkt och väst som andas
    put(B.box, P(0, 1.56 + bob, lean * 0.1), 0.6, 0.76, 0.42, suit, lean, 0, 0, inv);
    put(B.box, P(0, 1.76 + bob, 0.08 + lean * 0.18), 0.8 * breathe, 0.56, 0.5, plate, lean, 0, 0, inv);
    if (city) {
      // glödande energikärna + magdetalj
      put(B.octa, P(0, 1.78 + bob, 0.3 + lean * 0.2), 0.24, 0.34, 0.2, trim, 0, time * 1.5, 0, 1.0);
      put(B.box, P(0, 1.38 + bob, 0.24), 0.3, 0.24, 0.06, accent, 0, 0, 0, 0.25);
    } else {
      // axelrem tvärs över västen + bärnstensamulett som glöder när eldbollen är redo
      put(B.box, P(0, 1.72 + bob, 0.3), 0.16, 0.62, 0.05, suit, 0, 0, 0.6, inv);
      const ready = this.fireballCd <= 0;
      put(B.octa, P(0, 1.62 + bob, 0.32), 0.13, 0.2, 0.11, trim, 0, time * 1.5, 0,
        ready ? 0.9 + Math.sin(time * 5) * 0.25 : 0.12);
      put(B.box, P(0, 1.38 + bob, 0.24), 0.34, 0.14, 0.06, gold, 0, 0, 0, 0.1);
    }

    // ---- mantel som flödar bakåt när man springer och flaxar i dashen
    const cp = Math.min(0.24 + planar * 0.045 + dash * 0.5 + Math.sin(time * 2.3) * 0.04, 1.75);
    put(B.box, P(0, 1.92 - 0.48 * Math.cos(cp) + bob, -0.28 - 0.48 * Math.sin(cp)),
      0.56, 0.95, 0.05, cape, cp, 0, Math.sin(time * 1.7) * 0.05, 0.05);

    if (city) {
      // ---- thrusters på ryggen — glöder hårt i dashen och flygningen
      for (const s of [-1, 1]) {
        put(B.box, P(0.24 * s, 1.86 + bob, -0.3), 0.16, 0.3, 0.18, suit, 0.1, 0, 0, inv);
        put(B.octa, P(0.24 * s, 1.7 + bob, -0.34), 0.11, 0.16, 0.11, trim, 0, time * 4, 0,
          0.35 + (dash || this.thrusting ? 1.6 : 0));
      }
    } else {
      // ---- läderränsel på ryggen
      put(B.box, P(0, 1.78 + bob, -0.32), 0.42, 0.42, 0.2, suit, 0.05, 0, 0, inv);
      put(B.box, P(0, 1.9 + bob, -0.33), 0.44, 0.1, 0.22, gold, 0.05, 0, 0, 0);
    }

    // ---- axelskydd med guldrand
    for (const s of [-1, 1]) {
      put(B.sphere, P(0.55 * s, 2.02 + bob, 0), 0.44, 0.30, 0.44, plate, 0, 0, -0.15 * s, inv);
      put(B.box, P(0.55 * s, 2.13 + bob, 0), 0.3, 0.05, 0.3, gold, 0, 0, -0.15 * s, 0.3);
    }

    // ---- hals + huvud
    put(B.cyl, P(0, 2.06 + bob, 0), 0.18, 0.14, 0.18, suit, 0, 0, 0, inv);
    if (city) {
      // hjälm med visir, ögonbrynsrand och kam
      put(B.sphere, P(0, 2.3 + bob, 0.02 + lean * 0.08), 0.5, 0.54, 0.5, plate, lean * 0.5, 0, 0, inv);
      put(B.box, P(0, 2.31 + bob, 0.25), 0.4, 0.13, 0.12, trim, 0, 0, 0, 1.1);
      put(B.box, P(0, 2.43 + bob, 0.22), 0.44, 0.05, 0.08, gold, 0, 0, 0, 0.25);
      put(B.box, P(0, 2.56 + bob, -0.04), 0.06, 0.2, 0.42, accent, -0.1, 0, 0, 0.3);
    } else {
      // bart ansikte under läderhuva
      put(B.sphere, P(0, 2.28 + bob, 0.02 + lean * 0.08), 0.46, 0.5, 0.46,
        [lerp(0.83, 1, f), lerp(0.62, 0.4, f), lerp(0.46, 0.35, f)], lean * 0.5, 0, 0, inv);
      put(B.cone, P(0, 2.52 + bob, -0.08), 0.64, 0.56, 0.64, suit, -0.3, 0, 0, inv);
      put(B.box, P(0, 2.4 + bob, 0.18), 0.5, 0.09, 0.28, suit, -0.35, 0, 0, inv);
    }

    const armSwing = swing * 0.7;
    if (city) {
      // ---- cyborgen: båda armarna sträckta framåt, laser ur handflatorna
      const charge = this.fireTimer > 0 ? 1 : 0.3;
      for (const s of [-1, 1]) {
        put(B.box, P(0.5 * s, 1.9 + bob, 0.12), 0.19, 0.34, 0.19, suit, 0.5, 0, -0.1 * s, inv);
        put(B.box, P(0.48 * s, 1.62 + bob, 0.38), 0.22, 0.24, 0.5, plate, 0, 0, 0, inv);
        put(B.sphere, P(0.48 * s, 1.6 + bob, 0.68), 0.17, 0.17, 0.17, trim, 0, 0, 0,
          0.5 + charge * (s === this.shotSide ? 1.3 : 0.5));
      }
    } else {
      // ---- vänsterarm i två segment med handskydd
      const shY = 1.95 + bob, shX = -0.55;
      const elbY = shY - 0.36 * Math.cos(armSwing), elbZ = 0.36 * Math.sin(armSwing);
      put(B.box, P(shX, shY - 0.18 * Math.cos(armSwing), 0.18 * Math.sin(armSwing)),
        0.19, 0.4, 0.19, suit, -armSwing, 0, 0.1, inv);
      const foreSw = armSwing * 0.8 - 0.35;
      put(B.box, P(shX, elbY - 0.2 * Math.cos(foreSw), elbZ + 0.2 * Math.sin(foreSw)),
        0.23, 0.42, 0.23, plate, -foreSw, 0, 0.1, inv);
      put(B.box, P(shX, elbY - 0.42 * Math.cos(foreSw), elbZ + 0.42 * Math.sin(foreSw)),
        0.2, 0.16, 0.2, suit, -foreSw, 0, 0, inv);
      // ---- högerarm hålls fram mot vapnet, med pansrad underarm
      put(B.box, P(0.5, 1.9 + bob, 0.12), 0.19, 0.34, 0.19, suit, 0.5, 0, -0.1, inv);
      put(B.box, P(0.48, 1.62 + bob, 0.38), 0.22, 0.24, 0.5, plate, 0, 0, 0, inv);

      // ---- svärdet i höger hand: vilar över axeln, sveper i attacken
      const grip = P(0.52, 1.48 + bob, 0.3);
      let sYaw, up;
      if (this.swingTime > 0) {
        const t = 1 - this.swingTime / this.swingDur;
        const ease = t * t * (3 - 2 * t);
        if (this.swingFinisher) {
          // finisher: rakt överhandshugg uppifrån och ner
          sYaw = yaw;
          up = lerp(0.95, -0.5, ease);
        } else {
          sYaw = yaw + lerp(-1.7, 1.7, ease) * this.swingSide;
          up = 0.12;
        }
      } else {
        sYaw = yaw + 0.35;
        up = 0.82;
      }
      const horiz = Math.sqrt(1 - up * up);
      const bd = { x: Math.sin(sYaw) * horiz, y: up, z: Math.cos(sYaw) * horiz };
      const rxB = -Math.asin(up);
      // klinga, parerstång, grepp och knopp
      const hot = this.swingTime > 0 && this.swingFinisher;
      B.box.push(grip[0] + bd.x * 0.95, grip[1] + bd.y * 0.95, grip[2] + bd.z * 0.95,
        0.11, 0.045, 1.5, hot ? [1.0, 0.42, 0.10] : [0.75, 0.78, 0.85],
        rxB, sYaw, 0, hot ? 0.55 : this.swingTime > 0 ? 0.35 : 0.06);
      B.box.push(grip[0] + bd.x * 0.14, grip[1] + bd.y * 0.14, grip[2] + bd.z * 0.14,
        0.4, 0.09, 0.1, gold, rxB, sYaw, 0, 0.1);
      B.box.push(grip[0] - bd.x * 0.08, grip[1] - bd.y * 0.08, grip[2] - bd.z * 0.08,
        0.08, 0.08, 0.3, suit, rxB, sYaw, 0, 0);
      B.octa.push(grip[0] - bd.x * 0.28, grip[1] - bd.y * 0.28, grip[2] - bd.z * 0.28,
        0.1, 0.13, 0.1, gold, 0, time * 2, 0, 0.15);
    }

    // dronare från uppgraderingen
    for (let i = 0; i < this.stats.drones; i++) {
      const a = this.droneAngle + (i / this.stats.drones) * TAU;
      const dx = Math.cos(a) * 2.1, dz = Math.sin(a) * 2.1;
      const dy = y + 2.4 + Math.sin(time * 2 + i) * 0.18;
      B.octa.push(x + dx, dy, z + dz, 0.42, 0.55, 0.42, [1.0, 0.75, 0.25], 0, a * 2, 0, 0.85);
    }

    rend.shadow(x, terrainHeight(x, z), z, 1.0 + (this.pos.y - terrainHeight(x, z)) * 0.05,
      0.42 * Math.max(0, 1 - (this.pos.y - terrainHeight(x, z)) * 0.09));
  }
}
